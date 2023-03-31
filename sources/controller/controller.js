/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

const AWS = require('aws-sdk')
const https = require('https')
const _ = require('lodash')
const Sequelize = require('sequelize')
const { Op } = require('sequelize')
const Bottleneck = require('bottleneck')
const fsPromises = require('fs').promises
const fs = require('fs')
const path = require('path')
const { performance } = require('perf_hooks')
const db = require('./db').db
const dbinstanceclasses = fs.readFileSync(path.join(__dirname, 'DbInstanceClasses.csv'), {
  encoding: 'utf8',
  flag: 'r'
})
const dbenginememorylimits = [
  ['mysql', 12, 100000],
  ['postgres', 9.5, 8388607],
  ['mssql', 10, 32767] // Todo set to 1 , once logic is more robust. Currently using 10 so that automatic connection count is similar to other dbs
] // enginetype, memory requirment per connection, max DB engine connection count.
// https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html#RDS_Limits.MaxConnections
let SQSQUEUENOTNULL = true
const subfolderlist = []
let tobeprocessed = []
var MaximumCacheTime=process.env.MaximumCacheTime

if (process.env.Environment !== 'LocalDev') {
  // CodeBuild prod environment settings
  var engineshared = require('./shared/engineshared')
  var commonshared = require('./shared/commonshared')
  var authenticationshared = require('./shared/authenticationshared')
  var region = process.env.AWS_REGION
  var sqsmessagesize = 50 // TODO Determine the message size based on the number of files and and the length of the files.
  var WorkerFunction = process.env.WorkerFunction
  var SelectedModelPath = './build/SelectedModel'
  var S3SelectQuery = process.env.S3SelectQuery
  var S3SelectParameter = process.env.S3SelectParameter
  var QueryType = process.env.QueryType
  var S3EnumerationDepth = process.env.S3EnumerationDepth
  var S3Folders = process.env.S3Folders
  var DatabaseParameters = process.env.DatabaseParameters
  var TableParameters = process.env.TableParameters
  var Schema = process.env.Schema
  var QueueURL = process.env.MessageQueue
  var jobid = process.env.JobID
  var PreferedWorkerNumber = process.env.PreferedWorkerNumber
  var cbbuildid = process.env.CODEBUILD_BUILD_ID
  console.log('s3folders:')
  console.log(S3Folders)
  console.log('CurrentBuildID:')
  console.log(cbbuildid)
} else {
  // Dev environment settings
  const mydev = require(path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'controller', 'mydev.js'))
  var engineshared = mydev.engineshared
  var commonshared = mydev.commonshared
  var authenticationshared = mydev.authenticationshared
  var jobid = mydev.jobid
  var region = mydev.region
  var sqsmessagesize = mydev.sqsmessagesize
  var WorkerFunction = mydev.WorkerFunction
  var SelectedModelPath = mydev.SelectedModelPath
  var S3SelectQuery = mydev.S3SelectQuery
  var S3SelectParameter = mydev.S3SelectParameter
  var QueryType = mydev.QueryType
  var S3EnumerationDepth = mydev.S3EnumerationDepth
  var S3Folders = mydev.S3Folders
  var PreferedWorkerNumber = mydev.PreferedWorkerNumber
  var DatabaseParameters = mydev.DatabaseParameters
  var TableParameters = mydev.TableParameters
  var Schema = mydev.Schema
  var QueueURL = mydev.QueueURL
  var cbbuildid = mydev.cbbuildid
}
// Limits the number of subfolders queried parallel.
const s3limiter = new Bottleneck({
  // maxConcurrent: 10
})

const sqslimiter = new Bottleneck({
  // minTime: 2000 //for testing rate limitting sending to queue one every 2 seconds
  minTime: 5 // sqs fifo max request count per sec is 300. Configuring 5 milisec between calls, allows max 200 calls/sec
})

const lambdatimeout = 900000
const lambdacheckfrequency = 5000

const agent = new https.Agent({
  maxSockets: Math.round(PreferedWorkerNumber * 1.2) // https://stackoverflow.com/questions/54629780/how-can-the-aws-lambda-concurrent-execution-limit-be-reached
})

AWS.config.update({
  region,
  maxRetries: 2,
  httpOptions: {
    timeout: lambdatimeout, // https://aws.amazon.com/premiumsupport/knowledge-center/lambda-function-retry-timeout-sdk/
    agent
  }
})

const s3 = new AWS.S3()
const codebuild = new AWS.CodeBuild()
const sqs = new AWS.SQS({
  apiVersion: '2012-11-05'
})
const SSM = new AWS.SSM()
const dynamodb = new AWS.DynamoDB()
const docClient = new AWS.DynamoDB.DocumentClient()
const lambda = new AWS.Lambda({
  apiVersion: '2015-03-31'
})
const servicequotas = new AWS.ServiceQuotas()
const cloudwatch = new AWS.CloudWatch()
const ec2 = new AWS.EC2()

if (db.collections.length === 0) {
  
  if (MaximumCacheTime === undefined){
    MaximumCacheTime =1
  }

  var identity = db.addCollection('Logverz-Identities', {
    ttl: MaximumCacheTime * 60 * 1000
  })
}

/* End of Initializing Environment */
main(ec2, s3, sqs, SSM, dynamodb, servicequotas, cloudwatch, Sequelize, fsPromises, s3limiter, sqslimiter, engineshared, jobid, dbinstanceclasses, PreferedWorkerNumber)

async function main (ec2, s3, sqs, SSM, dynamodb, servicequotas, cloudwatch, Sequelize, fsPromises, s3limiter, sqslimiter, engineshared, jobid, dbinstanceclasses, PreferedWorkerNumber) {
  console.log('PreferedWorkerNumber: ' + PreferedWorkerNumber + '\n')

  if (PreferedWorkerNumber !== 'auto' || Number.isInteger(PreferedWorkerNumber)){
    //validate if input is either auto or a number if not change input to 'auto'
    PreferedWorkerNumber ='auto'
    console.log('The PreferedWorkerNumber parameter is incorrect, it has to be a whole number such as 20, 200 etc or auto which will automatically determine the most suitable worker count')
  } 

  const z0 = performance.now()
  console.log('1.) Starting execution')
  const DBName = 'Logverz'
  const Model = Sequelize.Model

  const DBAvalue = DatabaseParameters.split('<!!>')
  let DBEngineType = DBAvalue.filter(s => s.includes('LogverzEngineType'))[0].split('=')[1]
  const DBUserName = DBAvalue.filter(s => s.includes('LogverzDBUserName'))[0].split('=')[1]
  const DBEndpointName = DBAvalue.filter(s => s.includes('LogverzDBEndpointName'))[0].split('=')[1]
  const DBEndpointPort = DBAvalue.filter(s => s.includes('LogverzDBEndpointPort'))[0].split('=')[1]
  const DBSecretRef = DBAvalue.filter(s => s.includes('LogverzDBSecretRef'))[0].split('=')[1]
  const DBTableName = TableParameters.split('<!!>').filter(s => s.includes('TableName'))[0].split('=')[1]
  const DBInstanceClass = DBAvalue.filter(s => s.includes('LogverzDBInstanceClass'))[0].split('=')[1]
  
  var details = {
    source: 'controller.js:main/getssmparameter',
    message: ''
  }

  let DBPassword = await commonshared.getssmparameter(SSM, {
    Name: DBSecretRef,
    WithDecryption: true
  }, dynamodb, details)

  DBPassword = DBPassword.Parameter.Value
  DBEngineType = (DBEngineType.match('sqlserver-') ? 'mssql' : DBEngineType)
  Schema = engineshared.convertschema(Schema, DBEngineType)
  await fsPromises.writeFile(SelectedModelPath, engineshared.constructmodel(Schema, 'controller'))
  const connectionstring = `${DBEngineType}://${DBUserName}:${DBPassword}@${DBEndpointName}:${DBEndpointPort}/${DBName}`
  const sequaliseconfig = {
    pool: {
      max: 10,
      min: 0,
      idle: 5000,
      acquire: 120000
    }
  }

  // get who/what initated the codebuild run
  const buildstatus = await commonshared.getbuildstatus(codebuild, [cbbuildid])
  const username = buildstatus.builds[0].initiator
  const buildenvironment = buildstatus.builds[0].environment.computeType

  // if not authorized process exits;
  await authorizecollection(username)

  const NumberofWorkers = await EnvironmentMaxWokerCount(commonshared, ec2, servicequotas, cloudwatch, dbinstanceclasses, DBInstanceClass, DBEngineType, DBEndpointName, buildenvironment, PreferedWorkerNumber)

  const workerlimiter = new Bottleneck({
    minTime: 200, // so that max 5 request is made per second.
    maxConcurrent: NumberofWorkers
  })

  // check Lambda invocation context size  if its less than 3582 than ok send Schema with lambda invoke,
  var lambdamessagesize = (createmessage(jobid, jobid, S3SelectParameter, Schema)).length

  // if its more than the schema needs to be saved to Parameter store.
  if ((lambdamessagesize + 4) >= 3582) {
    const ssmpath = '/Logverz/Engine/Schemas/'
    QueryType = `Temporary/${jobid}`
    const ssmparams = {
      Name: (ssmpath + QueryType),
      Value: Schema,
      Description: 'Temporary Large Schema',
      Tier: 'Standard',
      Type: 'String'
    }

    var details = {
      source: 'controller.js:main/setssmparameter',
      message: ''
    }
    await commonshared.setssmparameter(SSM, ssmparams, dynamodb, details)
    Schema = ''
  }

  const sequelize = new Sequelize(connectionstring, sequaliseconfig)
  sequelize.options.logging = false // Disable logging

  try {
    await InitiateSQLConnection(sequelize, DBEngineType, connectionstring, DBName)
    console.log('Connection has been established successfully.\n')
  } catch (e) {
    const message = 'Error establishing SQL connection. Further details: \n'
    console.error(message + e)
    var details = {
      source: 'controller.js:InitiateSQLConnection',
      message: message + e,
      jobid
    }
    await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'SQLConnect', 'Error', 'Infra', details, 'API')
    process.exit(1)
  }

  // checking for previous queries that needs to be set inactive in prod environment
  if (process.env.Environment !== 'LocalDev') {
    const DatabaseName = DBAvalue.filter(s => s.includes('LogverzDBFriendlyName'))[0].split('=')[1]
    const DBTableName = TableParameters.split('<!!>').filter(s => s.includes('TableName'))[0].split('=')[1]
    await commonshared.deactivatequery(commonshared, docClient, DatabaseName, DBTableName, jobid)
  }

  // Verify that Invocations table exists, if not create it and the Error messages table,
  try {
    const initatequery = initiatetablesquery(DBEngineType)
    await sequelize.query(initatequery)
  } catch (err) {
    console.log('Invocations table does not exists creating it and Processingerrors table.')
    await CreateSQLTable(sequelize, Model, engineshared.InvocationsModel, 'Invocation', 'Invocations')
    await CreateSQLTable(sequelize, Model, engineshared.ProcessingErrorsModel(DBEngineType), 'ProcessingError', 'ProcessingErrors')
  } finally {
    // TODO: Set "failed to complete status" to stale entries that are running status and older than 15 minutes.
  };

  const SelectedModel = require('./build/SelectedModel')
  try {
    await CreateSQLTable(sequelize, Model, SelectedModel, QueryType, DBTableName)
    console.log('Table ' + DBTableName + ' for "' + QueryType + '" data type queries has been created.')
  } catch (e) {
    console.error(e)
  }

  const z1 = performance.now()

  console.log('2.) Starting walk folders, ellipsed time from the beggining is ' + (z1 - z0) / 1000)
  // TODO: CACHE MODE which  SAVE sallKeys to S3 than read it from there
  tobeprocessed = commonshared.TransformInputValues(S3Folders, S3EnumerationDepth, _)

  do {
    await commonshared.walkfolders(_, s3, dynamodb, commonshared, tobeprocessed, subfolderlist, getCommonPrefixes)
  }
  while (((subfolderlist.length + tobeprocessed.length) !== 0) && (tobeprocessed.length !== 0))
  const z2 = performance.now()
  console.log('3.) Finished walk folders, elipsed time ' + ((z2 - z1) / 1000) + ' from start walking folder and ' + ((z2 - z0) / 1000) + ' from the beginning\n4.) Starting enumerating keys, this could take couple of minutes or more depending on the data volume')

  const alltasksresolved = await s3limiter.schedule(() => {
    const allTasks = subfolderlist.map(
      subfolderarrayitem => getAllKeys(s3, {
        Bucket: subfolderarrayitem[1],
        Prefix: subfolderarrayitem[0],
        Delimiter: subfolderarrayitem[2]
      })
    )
    return Promise.all(allTasks)
  })

  const z3 = performance.now()
  console.log('5.) Finished enumerating keys elipsed time ' + ((z3 - z2) / 1000) + ' from finised walking folders and ' + ((z2 - z0) / 1000) + ' from the beginning')
  var allKeys = _.flatten(alltasksresolved)
  var allKeys = allKeys.filter(item => item[0].endsWith('/') === false) // to remove directories
  console.log('\nThe number of files in specified bucket(s) ' + allKeys.length + '. Current local time:' + commonshared.timeConverter(Date.now()) + '\n\n')

  // TODO: dontwait for all files to be enumerated but do file enumeration and SQL population in parralell
  // TODO: handle allkeys zero case (no acces to bucket or non existent bucket etc.)
  populatesqs(sqs, sqslimiter, allKeys, QueueURL)
  // TODO: Set the message queue size dynamically based on the number of estimated files.

  await controllambdajobs(workerlimiter, dynamodb, SSM, sequelize, Model, engineshared.InvocationsModel, QueueURL, S3SelectParameter, jobid, NumberofWorkers)

  console.log('\n\n FINISHED EXECUTION at: ' + Date.now() + ', ' + commonshared.timeConverter(Date.now()) + ' local time.\n\n')
  process.exit()
  // TODO: console log couple of execution stats such as ellipsed time, number of files processed,
  // entries matched and  inserted to database, number of erros etc. And the settings that where used to create the table.
}

async function EnvironmentMaxWokerCount (commonshared, ec2, servicequotas, cloudwatch, dbinstanceclasses, DBInstanceClass, DBEngineType, DBEndpointName, buildenvironment, PreferedWorkerNumber) {
  const maxworkercount = []
  const monitoringtimeperiod = 5 // min

  // retriving cloudwatch performance metrics for the time specified as monitoringtimeperiod.
  const dbpropertiesarray = [{
    DBInstanceIdentifier: DBEndpointName.split('.')[0],
    CWMetrics: {
      'AWS/RDS:CPUUtilization': 'Average',
      'AWS/RDS:DatabaseConnections': 'Average',
      'AWS/RDS:FreeableMemory': 'Average'
    },
    IdlePeriodMin: monitoringtimeperiod
  }]

  const RDSCWmetrics = (await commonshared.GetRDSInstancesMetrics(cloudwatch, [DBEndpointName.split('.')[0]], dbpropertiesarray)).MetricDataResults
  const currentactiveconnections = RDSCWmetrics.filter(obj => obj.Label.match('DatabaseConnections'))[0].Values[0]
  const currentfreememory = RDSCWmetrics.filter(obj => obj.Label.match('FreeableMemory'))[0].Values[0]
  var maxactiveconnection =0

  const maxdbconnectioncount = determinemaxdbconnectioncount(dbinstanceclasses, DBInstanceClass, DBEngineType)
  maxworkercount.push(maxdbconnectioncount)
  
  if(typeof currentactiveconnections === 'number' &&  typeof currentfreememory === 'number'){
    
    const cpuutilisation = RDSCWmetrics.filter(obj => obj.Label.match('CPUUtilization'))[0]
    console.log('\nDatabase server CPU utilisation metrics in the last few minutes, latest on top: \n')
    cpuutilisation.Values.map(c => {
      console.log(parseFloat(c).toFixed(2) + ' %')
    })

    console.log('\nMaximum database server connections(' + maxdbconnectioncount + ') - active connections(' + currentactiveconnections + '): ' + (maxdbconnectioncount - currentactiveconnections) + '\n')
    maxworkercount.push((maxdbconnectioncount - currentactiveconnections))

    var maxactiveconnection = determinedbmaxactiveconnection(currentfreememory, DBEngineType) - 3 // - controller connections
    maxworkercount.push(maxactiveconnection)
    console.log('Database server effective connections count: ' + maxactiveconnection + '\n' + '(Derived from current free memory (' + Math.round(currentfreememory / 1024 / 1024) + ') MB / per connection memory requirement (approx 10MB) - Controller connections)\n')

  }else{
    console.log('\nFailed to get performance metrics (free memory, cpu utilisation, connection count) for DB instance: \n'+DBEndpointName+'\n')
    console.log('\nMaximum database server connections count: ' + maxdbconnectioncount + '\n') 
  }
  
  // describe vpc network interfaces
  const EniList = await DesribeAllENI(ec2)

  // quotas
  // Network interfaces per Region arn:aws:servicequotas:ca-central-1:accountnumber:vpc/L-DF5E4CA3
  const vpcquotaparams = {
    QuotaCode: 'L-DF5E4CA3',
    /* required */
    ServiceCode: 'vpc' /* required */
  }

  const vpcquota = (await getquotas(servicequotas, vpcquotaparams)).Quota.Value
  maxworkercount.push(vpcquota - EniList.length)
  console.log('Available number of ENIs, determined by quota(' + vpcquota + ') - current usage(' + EniList.length + '): ' + (vpcquota - EniList.length) + '\n')

  // Lambda Concurrent executions per Region arn:aws:servicequotas:ca-central-1::lambda/L-B99A9384
  // aws service-quotas list-service-quotas --service-code lambda
  const lambdaquotaparams = {
    QuotaCode: 'L-B99A9384',
    /* required */
    ServiceCode: 'lambda' /* required */
  }
  const lambdaquota = await getquotas(servicequotas, lambdaquotaparams)

  // lambda concurrent count metrics
  const concurrentlambdacount = await determineconcurrentlambdacount(cloudwatch, commonshared, monitoringtimeperiod)
  console.log('Maximum Lambda executions determined by quota(' + lambdaquota.Quota.Value + ') - current usage(' + concurrentlambdacount + '): ' + (lambdaquota.Quota.Value - concurrentlambdacount) + '\n')

  maxworkercount.push(lambdaquota.Quota.Value - concurrentlambdacount)

  // https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-compute-types.html
  // Type, MemoryAllocated,Concurrency so that one workerthread has approx 10 MB ram.
  const codebuildcomputeproperties = [
    ['BUILD_GENERAL1_SMALL', 3000, 275],
    ['BUILD_GENERAL1_MEDIUM', 7000, 650],
    ['BUILD_GENERAL1_LARGE', 14000, 1400]
  ]
  const codebuildmaxworkercount = codebuildcomputeproperties.filter(cbcp => cbcp[0] === buildenvironment)[0][2]
  console.log('Selected build environment maximum concurrent execution capacity: ' + codebuildmaxworkercount + '\n')
  maxworkercount.push(codebuildmaxworkercount)

  if ((maxactiveconnection !== 0)){ //there are database performance metrics available for further decisions.

    if (PreferedWorkerNumber === 'auto') {
      var NumberofWorkers = parseInt(Math.min(...maxworkercount))
      console.log('The determined worker count equals to the lowest environment limit ('+NumberofWorkers+').\n')
    }
    else if ((Math.min(...maxworkercount) > PreferedWorkerNumber)  && (PreferedWorkerNumber > maxactiveconnection)) {
      console.log(warning)
      var NumberofWorkers = parseInt(PreferedWorkerNumber)
      console.log('The prefered ('+PreferedWorkerNumber+') worker count is under the environment limits, hence it will be used. However the connections memory requirement is more than the available free memory, \n')
      console.log('If its significantly higher the database will start to **SWAP** and execution will be significantly slower or fail, if current number ('+NumberofWorkers+') of Lambda workers are needed a larger capacity DB instance is advised.\n')
    }
    else if ((Math.min(...maxworkercount) > PreferedWorkerNumber)  && (PreferedWorkerNumber < maxactiveconnection)) {
      var NumberofWorkers = parseInt(PreferedWorkerNumber)
      console.log('The prefered ('+PreferedWorkerNumber+') worker count is under the environment limits and memory requirement, hence it will be used.\n')
    }else{
      var NumberofWorkers = parseInt(Math.ceil(Math.min(...maxworkercount) * 0.8))
      console.log('The prefered ('+PreferedWorkerNumber+') worker count is over the lowest environment limit, 80% of the limit ('+NumberofWorkers+') is going to be used.\n')
    }
  }  
  else{ 
    //bellow doing the determination without database performance metrics
    if (PreferedWorkerNumber === 'auto') {
      var NumberofWorkers = parseInt(Math.min(...maxworkercount)* 0.8)
      console.log('The determined worker count is '+NumberofWorkers+', 80% of the lowest environment limit ('+Math.min(...maxworkercount) + ').\n')
    }
    else if ((Math.min(...maxworkercount) > PreferedWorkerNumber) ){
      var NumberofWorkers = parseInt(PreferedWorkerNumber)
      console.log('The determined worker count is '+NumberofWorkers+', as the prefered worker count ('+ PreferedWorkerNumber + ') is lower the lowest environment limit '+Math.min(...maxworkercount)+ '.\n')
    }
    else if ((Math.min(...maxworkercount) < PreferedWorkerNumber) ){
      var NumberofWorkers = parseInt(Math.ceil(Math.min(...maxworkercount) * 0.8))
      console.log('The determined worker count is '+NumberofWorkers+',  80% of the lowest environment limit ('+Math.min(...maxworkercount)+'). As the prefered worker count ('+ PreferedWorkerNumber + ') is over the lowest environment limit. \n')
    }
    else {
      console.log("something went wrong, there should have been a decision made earlier, stopping execution")
      exit
    }
  }

  return NumberofWorkers
}

async function controllambdajobs (workerlimiter, dynamodb, SSM, sequelize, Model, InvocationsModel, QueueURL, S3SelectParameter, jobid, NumberofWorkers) {
  // wait 3 seconds for the queue to be populated.
  console.log('Determined initial number of workers ' + NumberofWorkers)
  await new Promise((resolve, reject) => setTimeout(resolve, 3000)) // wait a bit so that sqs queue is not empty at later check

  const throttledlambdajob = workerlimiter.wrap(lambdajob)
  const initialqueuelength = await getSQSqueueProperties(QueueURL)
  console.log('Initialqueue SQS length ' + initialqueuelength)

  if (initialqueuelength !== 0) { // checks for initial queue length if SQS is empty at start, than no need to start worker lambdas.
    var jobquelength = Math.ceil(NumberofWorkers * 1.2)
    console.log('Internal jobqueue length: ' + jobquelength)
    submitlambdajobs2Q(throttledlambdajob, dynamodb, sequelize, Model, InvocationsModel, jobid, S3SelectParameter, jobquelength)

    let exitcondition = false
    do {
      await new Promise((resolve, reject) => setTimeout(resolve, lambdacheckfrequency / 2))
      const counts = workerlimiter.counts()

      // TODO make this two calls parallel.
      const queuelength = await getSQSqueueProperties(QueueURL) // SQS queue length
      const runninglambdas = await SelectSQLTable(sequelize, Model, InvocationsModel, 'Invocation', 'Invocations', 'findAll', {
        where: {
          jobid,
          status: {
            [Op.ne]: 'COMPLETED'
          },
          updateunixtime: {
            [Op.gt]: Date.now() - (3 * lambdacheckfrequency)
          } // last update was less than X seconds ago. Meaning not stuck.
        }
      })
      console.log('SQS queue length: ' + queuelength + ' running lambdas count: ' + counts.EXECUTING + '\n' + 'internal queue' + JSON.stringify(counts) + '\n\n\n')

      if (queuelength <= (Math.ceil(NumberofWorkers * 0.25)) && SQSQUEUENOTNULL) {
        SQSQUEUENOTNULL = false // when sqs approx length is less than 25% SQSQUEUENOTNULL=false
        console.log('Finished processing the SQS queue. ' + counts.EXECUTING + ' Lambdas are finishing up.')
      } else if ((counts.RECEIVED <= Math.ceil((NumberofWorkers * 0.25))) && (counts.QUEUED <= Math.ceil((NumberofWorkers * 0.25))) && SQSQUEUENOTNULL) {
        // The number of jobs in the internalqueue is getting low adding new jobs
        console.log('placing worker jobs to internal queue\n')
        console.log(JSON.stringify(counts) + '\n')
        var jobquelength = Math.ceil(NumberofWorkers * 0.75)
        submitlambdajobs2Q(throttledlambdajob, dynamodb, sequelize, Model, InvocationsModel, jobid, S3SelectParameter, jobquelength)
        var newcounts = workerlimiter.counts()
        console.log('internal queue state' + JSON.stringify(newcounts))
      }

      // End the loop execution when the conditions are meet.
      if ((SQSQUEUENOTNULL === false) && (runninglambdas.length < 1)) {
        exitcondition = true
        var newcounts = workerlimiter.counts()
        console.log('exit condition met.\nInternal que state' + JSON.stringify(newcounts) + '\n' + 'SQS queue length: ' + queuelength + '\nRunning lambdas:' + runninglambdas.length + '\n')
      }
    } while (!exitcondition)

    // wait  some time for the lambdas to finish..
    // TODO check queue state here instead of timeout. Finish when the queue is empty.
    await timeout(10000)
  } // if queue length !==0

  // Check if QueryType is "Temporary/jobid", than delete it.
  if (QueryType.match('Temporary/') !== null) {
    const params = {
      Name: '/Logverz/Engine/Schemas/' + QueryType
    }
    await SSM.deleteParameter(params).promise()
  }
}

function submitlambdajobs2Q (throttledlambdajob, dynamodb, sequelize, Model, InvocationsModel, jobid, S3SelectParameter, jobquelength) {
  // this is the internal queue (based on bottleneck), that controlls lambda execution ensures that exactly NumberofWorkers lambda jobs are running
  const newjobs = []
  for (let i = 0; i < jobquelength; i++) {
    newjobs.push(i)
  }
  newjobs.map(job => {
    // eslint-disable-next-line no-undef
    value = throttledlambdajob(dynamodb, sequelize, Model, InvocationsModel, jobid, S3SelectParameter)
  })
  console.log('placed ' + JSON.stringify(jobquelength) + ' worker jobs in internal queue')
}

async function lambdajob (dynamodb, sequelize, Model, InvocationsModel, jobid, S3SelectParameter) {
  if (SQSQUEUENOTNULL === true) {
    const invocationid = commonshared.makeid(16)
    // TODO: instead of makeid use :https://www.npmjs.com/package/docker-names
    await invokelambda(invocationid, jobid, S3SelectParameter)
    const mydata = {
      jobid,
      invocationid,
      status: 'INVOKED',
      updateunixtime: Date.now()
    }
    const AddSQLEntryresult = await engineshared.AddSqlEntry(sequelize, Model, engineshared.InvocationsModel, 'Invocation', 'Invocations', mydata)

    // checks for SQL insert success/failure if failed records it in DynamoDb.
    if (AddSQLEntryresult.Result !== 'PASS') {
      const details = {
        source: 'controller.js:lambdajob:AddSqlEntry',
        message: AddSQLEntryresult.Data,
        jobid
      }
      await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'SQLInsert', 'Error', 'Infra', details, 'API')
    }

    // checks for lambda statusin sql if completed or last update more than 15 second old returns promise
    for (let index = 0; index < lambdatimeout / lambdacheckfrequency; index++) {
      const lambdastate = await SelectSQLTable(sequelize, Model, InvocationsModel, 'Invocation', 'Invocations', 'findOne', {
        where: {
          invocationid: `${invocationid}`
        }
      })
      const datenow = Date.now()

      if ((lambdastate.status === 'COMPLETED') || ((lambdastate.status === 'INVOKED') && (parseInt(lambdastate.updateunixtime) + 60000 < datenow))) {
        break
      }
      await timeout(lambdacheckfrequency)
    }
    // console.log("I am here-finished lamdajob")
  } else {
    // There are N number of jobs submited in controllambdajobs. Once the queue is empty we iterate over the remaining jobs without submitting a lambda job.
    return null
  }
}

function createmessage (invocationid, jobid, S3SelectParameter, Schema) {
  // https://docs.aws.amazon.com/lambda/latest/dg/API_Invoke.html#API_Invoke_RequestSyntax
  // max 3583 byte
  var DBTableName = TableParameters.split('<!!>').filter(s => s.includes('TableName'))[0].split('=')[1]
  if (Schema !== '') {
    var Schema = Schema.replace(/"/g, '\\"').replace(/(\r\n|\n|\r)/g, '')
  }
  // if message size where to be larger than 3583 than we send empty schema.Each lambda will need to retrieve schema from parameter store.
  const invocationparameters = `{"Schema":"${Schema}","jobid":"${jobid}","QueryType":"${QueryType}","invocationid":"${invocationid}","QueueURL":"${QueueURL}","S3SelectQuery":"${S3SelectQuery}","DatabaseParameters":"${DatabaseParameters.replace(/"/g, '\\"')}","DBTableName":"${DBTableName}","S3SelectParameter":"${S3SelectParameter.replace(/"/g, '\\"')}"}`
  // console.log(invocationparameters +"\n\n")
  // TODO check if we need to escape S3SelectQuery string.
  const clientcontext = Buffer.from(invocationparameters).toString('base64')

  return clientcontext
}

async function invokelambda (invocationid, jobid, S3SelectParameter) {
  const clientcontext = createmessage(invocationid, jobid, S3SelectParameter, Schema)
  const lambdaparams = {
    ClientContext: clientcontext, // .toString('base64'),
    FunctionName: WorkerFunction,
    InvocationType: 'RequestResponse', // "RequestResponse" || "Event" // bydefault Requestreponse times out after 120 sec, hence the timout 900 000 value
    LogType: 'None'
  }

  lambda.invoke(lambdaparams, function (err, data) {
    if (err) console.log(err, err.stack) // an error occurred
    else console.log(data) // successful response
  })
}

async function SelectSQLTable (sequelize, Model, SelectedModel, QueryType, DBTableName, QueryTypes, QueryParameters) {
  // TODO remove this function and use engineshared.selectsqltable.
  class Query extends Model {}
  Query.init(SelectedModel, { // SelectedModel
    sequelize,
    modelName: QueryTypes, // "Invocation",
    tableName: DBTableName // "Invocations",
  })

  if (QueryTypes === 'findOne') {
    return await Query.findOne(QueryParameters)
  } else if (QueryTypes === 'findAll') {
    return await Query.findAll(QueryParameters)
  } else {
    return await Query.findByPk(QueryParameters)
  }
}

async function CreateSQLTable (sequelize, Model, SelectedModel, QueryType, DBTableName) {
  return new Promise((resolve, reject) => {
    class Entry extends Model {}
    Entry.init(SelectedModel, {
      sequelize,
      modelName: QueryType,
      freezeTableName: true,
      tableName: DBTableName
    }).then(
      resolve(Entry.sync({
        force: true
      }))
    ).catch(err => {
      console.log(err)
      reject(err)
    })
  })
}

async function InitiateSQLConnection (sequelize, DBEngineType, connectionstring, DBName) {
  if (DBEngineType === 'mssql') {
    // by default mssql does not have a Logverz database, so at first execution it needs to be created.

    sequelize.options.validateBulkLoadParameters = true
    sequelize.options.loginTimeout = 15

    try {
      await sequelize.authenticate()
    } catch (err) {
      if (err.name === 'SequelizeAccessDeniedError') {
        await sequelize.close()
        // At first execution Logverz DB is not present need to connect to a different db to verify credentials
        // than create  Logverz DB and if successfull return authenticated true.
        var sequelize = new Sequelize(connectionstring)
        sequelize.connectionManager.config.database = 'master'
        sequelize.options.logging = false

        // trying to authenticate a 2nd time either works (case of 1st execution) or errors (wrong credential).
        // This error is caught in the main try catch
        await sequelize.authenticate()

        // connection succeeded creating mssql database
        await sequelize.query('CREATE DATABASE ' + DBName)
        await sequelize.close()
        // connectioning to newly created DB
        var sequelize = new Sequelize(connectionstring)
        var result = await sequelize.authenticate()
      } else {
        console.log(err)
      }
    }
  } else {
    // non mssql DB
    var result = await sequelize.authenticate()
  }

  return result
}

async function populatesqs (sqs, sqslimiter, allKeys, QueueURL) {
  var MessagesArray = []
  var onebatch = []

  for (var i = 0; i < allKeys.length; i++) {
    onebatch.push(allKeys[i])
    if (i % sqsmessagesize === 0 && i !== 0) {
      MessagesArray.push(onebatch)
      onebatch = []
    }
    if (i === (allKeys.length - 1)) {
      MessagesArray.push(onebatch)
    }
  }

  return await MessagesArray.map(onebatch => {
    sqslimiter.schedule(() => {
      sendSQSMessage(sqs, onebatch, QueueURL)
    }) // sqslimiter
  }) // onebatch
}

async function getSQSqueueProperties (QueueURL) {
  const params = {
    QueueUrl: QueueURL,
    /* required */
    AttributeNames: [
      'ApproximateNumberOfMessages'
    ]
  }
  const numofsqs = await sqs.getQueueAttributes(params, function (err, data) {
    if (err) console.log(err, err.stack) // an error occurred
    // console.log(data);           // successful response
  }).promise()
  return numofsqs.Attributes.ApproximateNumberOfMessages
}

async function sendSQSMessage (sqs, onebatch, QueueURL) {
  // https://github.com/aws/aws-sdk-js/issues/745
  const params = {
    MessageGroupId: '',
    MessageBody: '',
    QueueUrl: QueueURL
  }

  params.MessageBody = JSON.stringify(onebatch)
  params.MessageGroupId = commonshared.makeid(128)
  return await sqs.sendMessage(params, function (err, data) {
    if (err) {
      console.log('Error', JSON.stringify(err))
    } else {
      // const today = new Date()
      // const date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate()
      // const time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds()
      // const dateTime = date + ' ' + time
      // console.log("Sent SQS message "+dateTime+" "+data.MessageId )
    }
  })
}

const getCommonPrefixes = async (dynamodb, commonshared, s3, params, allKeys = [], jobid) => {
  // https://stackoverflow.com/questions/42394429/aws-sdk-s3-best-way-to-list-all-keys-with-listobjectsv2
  // const response = await s3.listObjectsV2(params).promise();

  const promisedresponse = new Promise((resolve, reject) => {
    s3.listObjectsV2(params, function (err, data) {
      if (err) {
        console.error('Error with input parameters:\n', JSON.stringify(params), JSON.stringify(err, null, 2))
        resolve({
          Result: 'Fail',
          Data: err
        })
      } else {
        resolve({
          Result: 'PASS',
          Data: data
        })
      }
    })
  })
  let response = await promisedresponse
  if (response.Result !== 'PASS') {
    const details = {
      source: 'controller.js:getCommonPrefixes',
      message: JSON.stringify(response.Data),
      jobid
    }
    await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'S3List', 'Error', 'Infra', details, 'API')
  } else {
    response = response.Data
    if ((response.Contents.length > 0) && (response.CommonPrefixes.length === 0)) {
      // There are objects in the given prefix so it needs to be explictly scoped to the prefix level, otherwise it  would also contain the subfolders.
      // listing bucket 06/ without delimiter it would contain files from 06/01, 06/02, 06/abc subfolders.
      var delimeter = '/'
      allKeys.push([response.Prefix, params.Bucket, delimeter])
    } else if ((response.Contents.length > 0)) {
      var delimeter = '/'
      allKeys.push([response.Prefix, params.Bucket, delimeter])
      var delimiter = '*'
      response.CommonPrefixes.forEach(obj => allKeys.push([obj.Prefix, params.Bucket, delimiter]))
    } else {
      var delimiter = '*'
      response.CommonPrefixes.forEach(obj => allKeys.push([obj.Prefix, params.Bucket, delimiter]))
    }
  }
  return allKeys
}

async function getAllKeys (s3, params, allKeys = []) {
  // https://stackoverflow.com/questions/42394429/aws-sdk-s3-best-way-to-list-all-keys-with-listobjectsv2
  const response = await s3.listObjectsV2(params).promise()
  response.Contents.forEach(obj => allKeys.push([obj.Key, params.Bucket]))

  if (response.NextContinuationToken) {
    params.ContinuationToken = response.NextContinuationToken
    await getAllKeys(s3, params, allKeys) // RECURSIVE CALL
  }
  return allKeys
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function determinemaxdbconnectioncount (dbinstanceclasses, DBInstanceClass, DBEngineType) {
  
  const dbarray = dbinstanceclasses.split(/\r\n|\r|\n/).filter(text => text.match(/^db.*/)).map(dbi => dbi.split(';'))
 
  if(DBInstanceClass.match("db.serverless")){
    var maxacu = DBInstanceClass.split(":")[1].split("-")[1]
    //Set instance memory based limit, 1 ACU => 2GB RAM
    var instancememorymb =maxacu  * 2 * 1000
  }
  else{
    var instancememorymb = dbarray.filter(dba => dba[0] === DBInstanceClass)[0][1].replace(' GiB', '') * 1000
  }

  instancememorymb = instancememorymb - 600 //removing 600 MB for general OS purposes
  const specificenginelimit = dbenginememorylimits.filter(de => de[0] === DBEngineType)[0]
  //const maxutilisation = 0.90 // 90%
  const maxdbconnectioncount = specificenginelimit[2] ? Math.round(instancememorymb / specificenginelimit[1]) : specificenginelimit[2] // specificenginelimit[1] * maxutilisation
  return maxdbconnectioncount
}

function determinedbmaxactiveconnection (currentfreememory, DBEngineType) {
  const freememorymegabyte = Math.round(currentfreememory / 1024 / 1024)
  const specificenginelimit = dbenginememorylimits.filter(de => de[0] === DBEngineType)[0]

  const maxactiveconnection = Math.round(specificenginelimit[2] ? Math.round(freememorymegabyte / specificenginelimit[1]) : specificenginelimit[2])
  return maxactiveconnection
}

async function determineconcurrentlambdacount (cloudwatch, commonshared, monitoringtimeperiod) {
  const MetricDataQueries = [{
    Id: 'accountCurrentLambdaExecutions',
    MetricStat: {
      Metric: {
        Namespace: 'AWS/Lambda',
        MetricName: 'ConcurrentExecutions'
      },
      Period: 60,
      Stat: 'Average'
    },

    Label: 'ConcurrentExecutionsNumber',
    ReturnData: true

  }]

  const time = commonshared.CreatePeriod(monitoringtimeperiod)

  const cwlambdaconcurentexecutions = {
    StartTime: time.StartDate,
    EndTime: time.Enddate,
    MetricDataQueries,
    ScanBy: 'TimestampDescending'
  }

  const LambdaConcurrentExecutionsCount = await commonshared.GetCWmetrics(cloudwatch, cwlambdaconcurentexecutions)
  let concurrentlambdacount = LambdaConcurrentExecutionsCount.MetricDataResults[0].Values

  if (concurrentlambdacount.length !== 0) {
    concurrentlambdacount = Math.round(concurrentlambdacount.reduce((a, v, i) => (a * i + v) / (i + 1)))
  } else {
    concurrentlambdacount = 0
  }
  return concurrentlambdacount
}

async function getquotas (servicequotas, lambdaquotaparams) {
  const promisedquotavalue = new Promise((resolve, reject) => {
    servicequotas.getServiceQuota(lambdaquotaparams, function (err, data) {
      if (err) reject(err) // console.log(err, err.stack); // an error occurred
      else resolve(data) // console.log(data);           // successful response
    })
  })
  const quotavalue = await promisedquotavalue
  return quotavalue
}

async function DesribeAllENI (ec2) {
  const ENIlistArray = []
  let NextToken

  do {
    var ENIlistpartial = await ENIlistsegment(ec2, NextToken)
    if (ENIlistpartial.NextToken !== undefined) {
      NextToken = ENIlistpartial.NextToken
    }
    ENIlistArray.push(ENIlistpartial)
  } while (ENIlistpartial.NextToken !== undefined)

  return _.flatten(ENIlistArray.map(ea => ea.NetworkInterfaces))
}

function ENIlistsegment (ec2, NextToken) {
  if (NextToken) {
    var params = {
      NextToken
      //, MaxResults: '5'
    }
  } else {
    var params = {}
  }
  return new Promise(function (resolve, reject) {
    ec2.describeNetworkInterfaces(params, function (err, data) {
      if (err) {
        console.log(err, err.stack)
        reject(err)
        // an error occurred
      } else resolve(data) // successful response
    })
  })
}

function initiatetablesquery (DBEngineType) {
  if (DBEngineType === 'postgres') {
    var initiatetables = 'SELECT 1 FROM public."Invocations"'
  } else if (DBEngineType === 'mysql') {
    var initiatetables = 'SELECT 1 FROM Invocations'
  } else if (DBEngineType.match('mssql')) {
    var initiatetables = 'SELECT 1 FROM dbo.Invocations'
  } else {
    var initiatetables = 'null'
    console.error('unknown unsupported DB option')
  }
  return initiatetables
}

async function authorizecollection (username) {
  const S3Foldersarray = _.compact(S3Folders.split(';'))

  // if not match Logverz-MasterController than check user authorization for given s3 folders.
  if (username.match('Logverz-MasterController') === null) {
    const usertype = 'UserAWS'
    console.log("Checking authorization of '" + username + "'." + "Type:'UserAWS'.")

    let userattributes = identity.chain().find({
      Type: usertype,
      Name: username
    }).collection.data[0] // ?.data()
    if (userattributes === undefined) {
      userattributes = await authenticationshared.getidentityattributes(commonshared, docClient, username, usertype)
      userattributes = userattributes.Items[0]
      identity.insert(userattributes)
    }

    var S3authresult = authenticationshared.authorizeS3access(_, commonshared, userattributes, S3Foldersarray)
  } else {
    // if match than authorization is granted. TODO , perform authoriation check on MasterController as well.
    var S3authresult = 'ok'
  }

  if (S3authresult !== 'ok') {
    const message = 'User not allowed to access one or more S3 locations. Further details: \n' + S3authresult
    console.error(message)
    const details = {
      source: 'controller.js:authorizeS3access',
      message,
      jobid
    }
    await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'S3Access', 'Error', 'User', details, 'API')
    process.exit(1)
  } else {
    console.log(username + ' can access folders ' + S3Foldersarray)
  }
}

// kudos : "https://manytools.org/hacker-tools/ascii-banner/"
const warning = `
dP   dP   dP                            oo                   
88   88   88                                                 
88  .8P  .8P .d8888b. 88d888b. 88d888b. dP 88d888b. .d8888b. 
88  d8'  d8' 88'  '88 88'  '88 88'  '88 88 88'  '88 88'  '88 
88.d8P8.d8P  88.  .88 88       88    88 88 88    88 88.  .88 
8888' Y88'   '88888P8 dP       dP    dP dP dP    dP 8888P88 
                                                         .88 
                                                     d8888P 
`
