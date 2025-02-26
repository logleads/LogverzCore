/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

import { performance } from 'perf_hooks'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import https from 'https'
import _ from 'lodash'
import { Sequelize, Op } from 'sequelize'
import Bottleneck from 'bottleneck'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { S3Client, ListObjectsV2Command, GetBucketLocationCommand } from '@aws-sdk/client-s3'
import { CodeBuildClient, BatchGetBuildsCommand } from '@aws-sdk/client-codebuild'
import { SQSClient, SendMessageCommand, GetQueueAttributesCommand, PurgeQueueCommand } from '@aws-sdk/client-sqs'
import { SSMClient, GetParameterCommand, DeleteParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm'
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { ServiceQuotasClient, GetServiceQuotaCommand } from '@aws-sdk/client-service-quotas'
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import { EC2Client, paginateDescribeNetworkInterfaces } from '@aws-sdk/client-ec2'
import { RDSClient,  DescribeDBInstancesCommand } from '@aws-sdk/client-rds'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dbinstanceclasses = fs.readFileSync(path.join(__dirname, 'DbInstanceClasses.csv'), { encoding: 'utf8', flag: 'r' })

// enginetype, memory requirment per connection, max DB engine connection count.
// https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html#RDS_Limits.MaxConnections
const dbenginememorylimits = [
  ['mysql', 100, 100000],
  ['postgres',120, 8388607],
  ['mssql', 100, 32767]
// based on testing while sustained load higher memory requirement per lambda is required  than stated in the docu
//MSSQL: RequestError: There is insufficient system memory in resource pool 'internal' to run this query.
//Postgres: https://dba.stackexchange.com/questions/206448/postgresql-large-transaction-oom-killer
// https://github.com/sequelize/sequelize/issues/15404 , https://www.enterprisedb.com/blog/tuning-maxwalsize-postgresql
]
var usage = 'controller'
let SQSQUEUENOTNULL = true
const subfolderlist = []
let tobeprocessed = []

if (process.env.Environment !== 'LocalDev') {
  // CodeBuild prod environment settings
  var commonsharedpath = ('file:///' + path.join(__dirname, 'shared', 'commonsharedv3.js').replace(/\\/g, '/'))
  var commonshared = await GetConfiguration(commonsharedpath, '*')
  var authenticationsharedpath = ('file:///' + path.join(__dirname, 'shared', 'authenticationsharedv3.js').replace(/\\/g, '/'))
  var authenticationshared = await GetConfiguration(authenticationsharedpath, '*')
  var enginesharedpath = ('file:///' + path.join(__dirname, 'shared', 'enginesharedv3.mjs').replace(/\\/g, '/'))
  var engineshared = await GetConfiguration(enginesharedpath, '*')
  var region = process.env.AWS_REGION
  var defaultsqsmessagesize = 50
  var WorkerFunction = process.env.WorkerFunction
  var SelectedModelPath = ('file:///' + path.join(__dirname, 'build', 'SelectedModel.mjs').replace(/\\/g, '/'))
  var TransformConfig = JSON.stringify(process.env.Transforms)
  // './build/SelectedModel'
  var QueryString = process.env.QueryString
  var StgSelectParameter = process.env.StgSelectParameter
  var DataType = process.env.DataType
  var StgEnumerationDepth = process.env.StgEnumerationDepth
  var StgFolders = process.env.StgFolders
  var DatabaseParameters = process.env.DatabaseParameters
  var TableParameters = process.env.TableParameters
  var Schema = process.env.Schema
  var QueueURL = process.env.MessageQueue
  var jobid = process.env.JobID
  var PreferedWorkerNumber = process.env.PreferedWorkerNumber
  var cbbuildid = process.env.CODEBUILD_BUILD_ID
  console.log('StgFolders:')
  console.log(StgFolders)
  console.log('CurrentBuildID:')
  console.log(cbbuildid)
}
else {
  // Dev environment settings
  var directory = path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'controller', 'mydev.mjs')
  const mydev = await import('file:///' + directory.replace(/\\/g, '/'))
  // const Sequelize =  await import(process.env.sequalisepath)
  var engineshared = mydev.engineshared
  var commonshared = mydev.commonshared
  var authenticationshared = mydev.authenticationshared
  var jobid = mydev.jobid
  var region = mydev.region
  var defaultsqsmessagesize = mydev.defaultsqsmessagesize
  var WorkerFunction = mydev.WorkerFunction
  var SelectedModelPath = mydev.SelectedModelPath
  var TransformConfig = JSON.stringify(mydev.Transforms)
  var QueryString = mydev.QueryString
  var StgSelectParameter = mydev.StgSelectParameter
  var DataType = mydev.DataType
  var StgEnumerationDepth = mydev.StgEnumerationDepth
  var StgFolders = mydev.StgFolders
  var PreferedWorkerNumber = mydev.PreferedWorkerNumber
  var DatabaseParameters = mydev.DatabaseParameters
  var TableParameters = mydev.TableParameters
  var Schema = mydev.Schema
  var QueueURL = mydev.MessageQueue
  var cbbuildid = mydev.cbbuildid
}
if (PreferedWorkerNumber === 'auto') {
  var socketnumber = 500 // default 50
}
else {
  var socketnumber = Math.max(100, Math.round(PreferedWorkerNumber * 1.2))
}

// console.log('typeof StgSelectParameter')
// console.log(typeof StgSelectParameter )
// console.log(StgSelectParameter )
// Limits the number of subfolders queried parallel.
const s3limiter = new Bottleneck({
  // maxConcurrent: 10
})

const sqslimiter = new Bottleneck({
  // minTime: 2000 //for testing rate limitting sending to queue one every 2 seconds
  minTime: 4 // sqs fifo max request count per sec is 300. Configuring 5 milisec between calls, allows max 250 calls/sec
})

// https://aws.amazon.com/premiumsupport/knowledge-center/lambda-function-retry-timeout-sdk/
const lambdatimeout = 900000
const lambdacheckfrequency = 5000

const agentOptions = {
  keepAlive: false,
  maxSockets: socketnumber
}

const httpsAgent = new https.Agent(agentOptions)

var config = {
  region,
  maxRetries: 2,
  requestHandler: new NodeHttpHandler({
    httpsAgent
  }),
  requestTimeout: lambdatimeout
}

const rdsclient = new RDSClient(config)
const cbclient = new CodeBuildClient(config)
const sqsclient = new SQSClient(config)
const ssmclient = new SSMClient(config)
const ddclient = new DynamoDBClient(config)
const docClient = DynamoDBDocumentClient.from(ddclient)
const lmdclient = new LambdaClient(config)
const scclient = new ServiceQuotasClient(config)
const cwclient = new CloudWatchClient(config)

/* End of Initializing Environment */

main(defaultsqsmessagesize, rdsclient, cbclient, sqsclient, ssmclient, ddclient, docClient, scclient, cwclient, s3limiter, sqslimiter, engineshared, jobid, dbinstanceclasses, PreferedWorkerNumber)

async function main (defaultsqsmessagesize, rdsclient, cbclient, sqsclient, ssmclient, ddclient, docClient, scclient, cwclient, s3limiter, sqslimiter, engineshared, jobid, dbinstanceclasses, PreferedWorkerNumber) {
  console.log('PreferedWorkerNumber: ' + PreferedWorkerNumber + '\n' )

  if (PreferedWorkerNumber !== 'auto' && (Number.isNaN(Number(PreferedWorkerNumber)) === true)) {
    // validate if input is not auto and not a number. Than change PreferedWorkerNumber 'auto'
    PreferedWorkerNumber = 'auto'
    console.log('The PreferedWorkerNumber parameter is incorrect, it has to be a whole number such as 20, 200 etc or auto which will automatically determine the most suitable worker count')
  }
  else if (Number.isInteger(Number(PreferedWorkerNumber))) {
    // if its value eg "10" or 10, that can be converted to integer, than convert it to integer.
    PreferedWorkerNumber = Number(PreferedWorkerNumber)
  }
  else {
    PreferedWorkerNumber = 'auto'
  }

  const z0 = performance.now()
  console.log('1.) Starting execution')

  const dbparams =await engineshared.LookupDBParameters (DatabaseParameters, TableParameters, commonshared, ssmclient, ddclient,  GetParameterCommand, PutItemCommand)
  const buildstatus = await commonshared.getbuildstatus(cbclient, BatchGetBuildsCommand, [cbbuildid])
  // get who/what initated the codebuild run
  const username = buildstatus.builds[0].initiator
  const buildenvironment = buildstatus.builds[0].environment.computeType
  // if not authorized process exits;
  await engineshared.authorizecollection(_, docClient, QueryCommand, ddclient, PutItemCommand, commonshared, authenticationshared, StgFolders, username)

  // checking for previous queries that needs to be set inactive in prod environment
  if (process.env.Environment !== 'LocalDev') {
    await commonshared.deactivatequery(docClient, QueryCommand, UpdateCommand, dbparams.DatabaseName, dbparams.DBTableName, jobid)
  }

  //TODO check queue properties using function getSQSqueueProperties and if queue messages count >0 run purge: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sqs/command/PurgeQueueCommand/


  const NumberofWorkers = await EnvironmentMaxWokerCount(rdsclient, commonshared, scclient, cwclient, dbinstanceclasses, dbparams.DBInstanceClass, dbparams.DBEngineType, dbparams.DBEndpointName, buildenvironment, PreferedWorkerNumber, QueryString)

  const workerlimiter = new Bottleneck({
    minTime: 200, // so that max 5 request is made per second.
    maxConcurrent: NumberofWorkers
  })

  // used in Cloudformation custom schema mode, checking Lambda invocation context size  if its less than 3582 than ok send Schema with lambda invoke,
  var lambdamessagesize = (createmessage(jobid, jobid, StgSelectParameter, Schema)).length

  // if its more than the lambda invocation limit, than schema needs to be saved to Parameter store.
  if ((lambdamessagesize + 4) >= 3582) {
    const ssmpath = '/Logverz/Engine/Schemas/'
    DataType = `Temporary/${jobid}`
    const ssmparams = {
      Name: (ssmpath + DataType),
      Value: Schema,
      Description: 'Temporary Large Schema',
      Tier: 'Advanced',
      Type: 'String'
    }

    var details = {
      source: 'controller.js:main/setssmparameter',
      message: ''
    }
    await commonshared.setssmparameter(ssmclient, PutItemCommand, PutParameterCommand, ssmparams, ddclient, details)
    Schema = ''
  }

  //Connect to Database and setup Tables
  let sequelize
  let Model = Sequelize.Model
  sequelize = await engineshared.ConnectDBserver(sequelize, Sequelize, Schema, dbparams, fs, fileURLToPath, SelectedModelPath, ddclient, engineshared, commonshared, usage)
              await engineshared.ConfigureDBCreateTables(sequelize, engineshared, dbparams, Model, SelectedModelPath, DataType)

  const z1 = performance.now()

  console.log('2.) Starting walk folders, elipsed time from the beginning (in seconds) is ' + ((z1 - z0) / 1000).toFixed(2))
  // TODO: CACHE MODE which  SAVE sallKeys to S3 than read it from there
  const s3client = new S3Client({})
  tobeprocessed = await commonshared.TransformInputValues(s3client, GetBucketLocationCommand, StgFolders, StgEnumerationDepth, _)

  do {
    await commonshared.walkfolders(_, ListObjectsV2Command, ddclient, PutItemCommand, commonshared, tobeprocessed, subfolderlist, getCommonPrefixes, 'controller.js', jobid)
  }
  while (((subfolderlist.length + tobeprocessed.length) !== 0) && (tobeprocessed.length !== 0))
  const z2 = performance.now()
  console.log('3.) Finished walk folders, elipsed time (in seconds) ' + ((z2 - z1) / 1000).toFixed(2) + ' from start walking folder and ' + ((z2 - z0) / 1000).toFixed(2) + ' from the beginning\n4.) Starting enumerating keys, this could take couple of minutes or more depending on the data volume')

  const alltasksresolved = await s3limiter.schedule(() => {
    const allTasks = subfolderlist.map(
      subfolderarrayitem => getAllKeys(subfolderarrayitem[4], {
        Bucket: subfolderarrayitem[1],
        Prefix: subfolderarrayitem[0],
        Delimiter: subfolderarrayitem[2]
      })
    )
    return Promise.all(allTasks)
  })

  const z3 = performance.now()
  console.log('5.) Finished enumerating keys elipsed time (in seconds) ' + ((z3 - z2) / 1000).toFixed(2) + ' from finised walking folders and ' + ((z2 - z0) / 1000).toFixed(2) + ' from the beginning')
  var allKeys = _.flatten(alltasksresolved)
  var allKeys = allKeys.filter(item => item[0].endsWith('/') === false) // to remove directories
  var sumfilesize = allKeys.map(s =>s[3]).reduce((accumulator, currentValue) => accumulator + currentValue,0)
  console.log('\nThe number of files in specified bucket(s) ' + allKeys.length+' total file size '+sumfilesize + ' KB. Current local time:' + commonshared.timeConverter(Date.now()) + '\n\n')

  // TODO: dontwait for all files to be enumerated but do file enumeration and SQL population in parralell
  // TODO: handle allkeys zero case (no acces to bucket or non existent bucket etc.)
var sqsmessagesize=setsqsmessagesize(defaultsqsmessagesize, allKeys.length, sumfilesize, DataType)
 populatesqs(sqsclient, SendMessageCommand, sqslimiter, allKeys, QueueURL, sqsmessagesize)

  await controllambdajobs(workerlimiter, ddclient, ssmclient, sequelize, Model, engineshared.InvocationsModel, QueueURL, StgSelectParameter, jobid, NumberofWorkers)

  console.log('\n\n FINISHED EXECUTION at: ' + Date.now() + ', ' + commonshared.timeConverter(Date.now()) + ' local time.\n\n')
  process.exit()
  // TODO: console log couple of execution stats such as ellipsed time, number of files processed,
  // entries matched and  inserted to database, number of erros etc. And the settings that where used to create the table.
}

async function EnvironmentMaxWokerCount (rdsclient, commonshared, scclient, cwclient, dbinstanceclasses, DBInstanceClass, DBEngineType, DBEndpointName, buildenvironment, PreferedWorkerNumber, QueryString) {

  const maxworkercount = []
  const monitoringtimeperiod = 5 // min
  const lambdaconnectioncount=2

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

  const RDSCWmetrics = (await commonshared.GetRDSInstancesMetrics(cwclient, GetMetricDataCommand, [DBEndpointName.split('.')[0]], dbpropertiesarray)).MetricDataResults
  const currentactiveconnections = RDSCWmetrics.filter(obj => obj.Label.match('DatabaseConnections'))[0].Values[0]
  const currentfreememory = RDSCWmetrics.filter(obj => obj.Label.match('FreeableMemory'))[0].Values[0]
  var maxactiveconnection = 0

  const maxdbconnectioncount = determinemaxdbconnectioncount(dbinstanceclasses, DBInstanceClass, DBEngineType)
  maxworkercount.push(maxdbconnectioncount)

  if (typeof currentactiveconnections === 'number' && typeof currentfreememory === 'number') {
    const cpuutilisation = RDSCWmetrics.filter(obj => obj.Label.match('CPUUtilization'))[0]
    console.log('\nDatabase server CPU utilisation metrics in the last few minutes, latest on top: \n')
    cpuutilisation.Values.map(c => {
      console.log(parseFloat(c).toFixed(2) + ' %')
    })

    console.log('\nMaximum database server connections(' + maxdbconnectioncount + ') - active connections(' + currentactiveconnections + '): ' + (maxdbconnectioncount - currentactiveconnections) + '\n')
    maxworkercount.push((maxdbconnectioncount - currentactiveconnections))

    var maxactiveconnection = Math.ceil((determinedbmaxactiveconnection(currentfreememory, DBEngineType)) )
    maxworkercount.push(maxactiveconnection)
    var specificenginelimit = dbenginememorylimits.filter(de => de[0] === DBEngineType)[0][1]
    console.log('Database server effective connections count: ' + maxactiveconnection + '\n' + '(Derived from current free memory (' + Math.round(currentfreememory / 1024 / 1024) + ') MB / (lambda memory requirement (approx '+specificenginelimit+' MB)\n')
  }
  else {
    console.log('\nFailed to get performance metrics (free memory, cpu utilisation, connection count) for DB instance: \n' + DBEndpointName + '\n')
    console.log('\nMaximum database server connections count: ' + maxdbconnectioncount + '\n')
  }

  // get the RDS storage capabilities

  const input = { // DescribeDBInstancesMessage
    DBInstanceIdentifier: DBEndpointName.split('.')[0]
  };

  const rdscommand = new DescribeDBInstancesCommand(input);
  const response = await rdsclient.send(rdscommand);
  
  const dbconfig = {
    AllocatedStorage: response.DBInstances[0].AllocatedStorage,
    StorageType: response.DBInstances[0].StorageType,
    DBEngineType
  } 

  console.log('Database storage type ('+dbconfig.StorageType + ') Database storage capacity ' + dbconfig.AllocatedStorage +' GB\n')

  var diskcapacity =diskiocapacity(dbconfig, QueryString)
  maxworkercount.push(diskcapacity)
  // // describe vpc network interfaces
  // const EniList = await DesribeAllENI()

  // const vpcquotaparams = {
  //   QuotaCode: 'L-DF5E4CA3',
  //   /* required */
  //   ServiceCode: 'vpc' /* required */
  // }

  // var command = new GetServiceQuotaCommand(vpcquotaparams)
  // const vpcquota = (await scclient.send(command)).Quota.Value

  // // const vpcquota = (await getquotas(servicequotas, vpcquotaparams)).Quota.Value
  // maxworkercount.push(vpcquota - EniList.length)
  // console.log('Available number of ENIs, determined by quota(' + vpcquota + ') - current usage(' + EniList.length + '): ' + (vpcquota - EniList.length) + '\n')

  // Lambda Concurrent executions per Region arn:aws:servicequotas:ca-central-1::lambda/L-B99A9384
  // aws service-quotas list-service-quotas --service-code lambda
  const lambdaquotaparams = {
    QuotaCode: 'L-B99A9384',
    /* required */
    ServiceCode: 'lambda' /* required */
  }
  var command = new GetServiceQuotaCommand(lambdaquotaparams)
  const lambdaquota = (await scclient.send(command)).Quota.Value

  // lambda concurrent count metrics
  const concurrentlambdacount = await determineconcurrentlambdacount(cwclient, GetMetricDataCommand, commonshared, monitoringtimeperiod)
  console.log('Maximum Lambda executions determined by quota(' + lambdaquota + ') - current usage(' + concurrentlambdacount + '): ' + (lambdaquota - concurrentlambdacount) + '\n')

  maxworkercount.push(lambdaquota - concurrentlambdacount)

  // https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-compute-types.html
  // Type, MemoryAllocated,Concurrency so that one workerthread has approx 10 MB /40 MB ram.
  const codebuildcomputeproperties = [
    ['BUILD_GENERAL1_SMALL', 3000, 275],
    ['BUILD_GENERAL1_MEDIUM', 7000, 650],
    ['BUILD_GENERAL1_LARGE', 14000, 1400]
  ]
  const codebuildmaxworkercount = codebuildcomputeproperties.filter(cbcp => cbcp[0] === buildenvironment)[0][2]
  console.log('Selected build environment maximum concurrent execution capacity: ' + codebuildmaxworkercount + '\n')
  maxworkercount.push(codebuildmaxworkercount)

  var minenvlimit=parseInt((Math.min(...maxworkercount) ))
  if ((maxactiveconnection !== 0)) { // there are database performance metrics available for further decisions.
    if (PreferedWorkerNumber === 'auto') {
      var NumberofWorkers = parseInt((minenvlimit)) // 1 lambda creats 2 connecttions hence we take half of the lowest workercount, and use 40% of it
      console.log('The determined worker count equals to the lowest environment limit ('+ minenvlimit +'). The calculated worker number is (' + NumberofWorkers + ').\n')
    }
    else if (((minenvlimit ) > PreferedWorkerNumber) && (PreferedWorkerNumber > maxactiveconnection)) {
      console.log(warning)
      var NumberofWorkers = parseInt(PreferedWorkerNumber)
      console.log('The prefered (' + PreferedWorkerNumber + ') worker count is under the environment limits, hence it will be used. However the connections memory requirement is more than the available free memory, \n')
      console.log('If its significantly higher the database will start to **SWAP** and execution will be significantly slower or fail, if current number (' + NumberofWorkers + ') of Lambda workers are needed a larger capacity DB instance is advised.\n')
    }
    else if (((minenvlimit ) > PreferedWorkerNumber) && (PreferedWorkerNumber < maxactiveconnection)) {
      var NumberofWorkers = parseInt(PreferedWorkerNumber)
      console.log('The prefered (' + PreferedWorkerNumber + ') worker count is under the environment limits and memory requirement, hence it will be used.\n')
    }
    else {
      var NumberofWorkers = parseInt(Math.ceil((minenvlimit )))
      console.log('The prefered (' + PreferedWorkerNumber + ') worker count is over the lowest environment limit ('+ minenvlimit +'). The calculated worker number is: ' + NumberofWorkers + '\n')
    }
  }
  else {
    // bellow doing the determination without database performance metrics
    if (PreferedWorkerNumber === 'auto') {
      var NumberofWorkers = parseInt((minenvlimit ) ) // 1 lambda creats 2 connecttions hence we take half of the lowest workercount, and use 40% of it.
      console.log('The determined worker count equals to the lowest environment limit ('+ minenvlimit +'). The calculated worker number is (' + NumberofWorkers + ').\n')

    }
    else if (((minenvlimit ) > PreferedWorkerNumber)) {
      var NumberofWorkers = parseInt(PreferedWorkerNumber)
      console.log('The determined worker count is ' + NumberofWorkers + ', as the prefered worker count (' + PreferedWorkerNumber + ') is lower the lowest environment limit ' + minenvlimit + '.\n')
    }
    else if (((minenvlimit ) < PreferedWorkerNumber)) {
      var NumberofWorkers = parseInt(Math.ceil((minenvlimit )))
      console.log('The determined worker count is ' + NumberofWorkers + ',  equals to the lowest environment limit ('+ minenvlimit +'). \n')
    }
    else {
      console.log('something went wrong, there should have been a decision made earlier, stopping execution')
      process.exit(1)
    }
  }

  if (NumberofWorkers < 1){
    NumberofWorkers =1
  }
  
  return NumberofWorkers
}

async function controllambdajobs (workerlimiter, ddclient, ssmclient, sequelize, Model, InvocationsModel, QueueURL, StgSelectParameter, jobid, NumberofWorkers) {
  // wait 3 seconds for the queue to be populated.
  console.log('Determined initial number of workers ' + NumberofWorkers)
  await new Promise((resolve, reject) => setTimeout(resolve, 3000)) // wait a bit so that sqs queue is not empty at later check

  const throttledlambdajob = workerlimiter.wrap(lambdajob)
  const initialqueuelength = (await getSQSqueueProperties(QueueURL)).ApproximateNumberOfMessages
  console.log('Initialqueue SQS length ' + initialqueuelength)

  if (initialqueuelength !== 0) { // checks for initial queue length if SQS is empty at start, than no need to start worker lambdas.
    var jobquelength = Math.ceil(NumberofWorkers * 1.2)
    console.log('Internal jobqueue length: ' + jobquelength)
    submitlambdajobs2Q(throttledlambdajob, ddclient, sequelize, Model, InvocationsModel, jobid, StgSelectParameter, jobquelength)

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

      console.log('SQS queue length: ' + queuelength.ApproximateNumberOfMessages + ' messages in flight ' + queuelength.ApproximateNumberOfMessagesNotVisible + '. Running lambdas count: ' + runninglambdas.length + '\n' + ' controller\'s internal queue' + JSON.stringify(counts) + '\n\n\n')

      if (queuelength.ApproximateNumberOfMessages <= (Math.ceil(NumberofWorkers * 0.10)) && queuelength.ApproximateNumberOfMessagesNotVisible <= (Math.ceil(NumberofWorkers * 0.10)) && SQSQUEUENOTNULL) {
        SQSQUEUENOTNULL = false // when sqs approx length is less than 25% SQSQUEUENOTNULL=false
        console.log('Finished processing the SQS queue. ' + counts.EXECUTING + ' Lambdas are finishing up.')
      }
      else if ((counts.RECEIVED <= Math.ceil((NumberofWorkers * 0.25))) && (counts.QUEUED <= Math.ceil((NumberofWorkers * 0.25))) && SQSQUEUENOTNULL) {

        // The number of jobs in the internalqueue is getting low adding new jobs
        console.log('placing worker jobs to internal queue\n')
        console.log(JSON.stringify(counts) + '\n')
        var jobquelength = Math.ceil(NumberofWorkers * 0.75)
        submitlambdajobs2Q(throttledlambdajob, ddclient, sequelize, Model, InvocationsModel, jobid, StgSelectParameter, jobquelength)
        var newcounts = workerlimiter.counts()
        console.log('internal queue state' + JSON.stringify(newcounts))
      }

      // End the loop execution when the conditions are meet.
      if ((SQSQUEUENOTNULL === false) && (runninglambdas.length < 1)) {
        exitcondition = true
        var newcounts = workerlimiter.counts()
        console.log('exit condition met.\nInternal que state: ' + JSON.stringify(newcounts) + '\n' + 'SQS queue length: ' + JSON.stringify(queuelength) + '\nRunning lambdas:' + runninglambdas.length + '\n')
      }
    } while (!exitcondition)

    // wait  some time for the lambdas to finish..
    // TODO check queue state here instead of timeout. Finish when the queue is empty.
    await timeout(5000)
  } // if queue length !==0

  // Check if DataType is "Temporary/jobid", than delete it.
  if (DataType.match('Temporary/') !== null) {
    const params = {
      Name: '/Logverz/Engine/Schemas/' + DataType
    }
    const command = new DeleteParameterCommand(params)
    await ssmclient.send(command)
  }
}

function submitlambdajobs2Q (throttledlambdajob, ddclient, sequelize, Model, InvocationsModel, jobid, StgSelectParameter, jobquelength) {
  // this is the internal queue (based on bottleneck), that controlls lambda execution ensures that exactly NumberofWorkers lambda jobs are running
  const newjobs = []
  for (let i = 0; i < jobquelength; i++) {
    newjobs.push(i)
  }

  newjobs.map(j => throttledlambdajob(ddclient, sequelize, Model, InvocationsModel, jobid, StgSelectParameter, j))
  console.log('placed ' + JSON.stringify(jobquelength) + ' worker jobs in internal queue')
}

async function lambdajob (ddclient, sequelize, Model, InvocationsModel, jobid, StgSelectParameter) {
  if (SQSQUEUENOTNULL === true) {
    const invocationid = commonshared.makeid(16)
    const clientcontext = createmessage(invocationid, jobid, StgSelectParameter, Schema)
    // console.log("clientcontext\n")
    // console.log(clientcontext)
    await commonshared.invokelambda (lmdclient, InvokeCommand, clientcontext, WorkerFunction)

    //TODO ADD TRY CATCH
    console.log("invokedlambda id"+invocationid)
    // checks for lambda statusin sql if completed or last update more than 15 second old returns promise
    for (let index = 0; index < lambdatimeout / lambdacheckfrequency; index++) {

      await timeout(lambdacheckfrequency)

      const lambdastate = await SelectSQLTable(sequelize, Model, InvocationsModel, 'Invocation', 'Invocations', 'findOne', {
        where: {
          invocationid: `${invocationid}`
        }
      })
      var maxdelay=lambdacheckfrequency*2
      const datenow = Date.now()
      
      if (lambdastate !== null) {
        console.log("invocationid: " + invocationid + ' lambdastate: '+ lambdastate.status + " last update: " + lambdastate.updateunixtime )

      }
      else{
        console.log("problem starting worker lambdas please check cloudwatch /aws/lambda/Logverz-Worker logs.")
       // return null
      }
   
      if (lambdastate !== null && ((lambdastate.status === 'COMPLETED')  || ((parseInt(lambdastate.updateunixtime) + maxdelay) < datenow))) {
        console.log('Lambda of invocation id ' +invocationid + ' has finished.')
        return null
      }
    
    }

  }
  else {
    // There are N number of jobs submited in controllambdajobs. Once the queue is empty we iterate over the remaining jobs without submitting a lambda job.
    return null
  }
}

function createmessage (invocationid, jobid, StgSelectParameter, Schema) {
  // https://docs.aws.amazon.com/lambda/latest/dg/API_Invoke.html#API_Invoke_RequestSyntax
  // max 3583 byte
  var DBTableName = TableParameters.split('<!!>').filter(s => s.includes('TableName'))[0].split('=')[1]
  if (Schema !== '') {
    var Schema = Schema.replace(/"/g, '\\"').replace(/(\r\n|\n|\r)/g, '')
  }

  const partialmessage= `{"Schema":"","jobid":"${jobid}","DataType":"${DataType}","invocationid":"${invocationid}","QueueURL":"${QueueURL}","QueryString":"${QueryString}","DatabaseParameters":"${DatabaseParameters.replace(/"/g, '\\"')}","DBTableName":"${DBTableName}","StgSelectParameter":"${StgSelectParameter.replace(/"\n/g, '"\\n').replace(/"/g, '\\"').replace(/\\\\"/g, '\\\\\\"')}","TransformConfig":${TransformConfig}}`
  //notes : 
  //.replace(/"""/g, '"\\\\""') is used in "QuoteCharacter":""" => \"QuoteCharacter\":\"\\\"\"
  //.replace(/"\n/g, '"\\n') is used in  "RecordDelimiter":"\n" => \"RecordDelimiter\":\"\n\"
  
  if ((3582 - partialmessage.length ) < Schema.length){
    // if complete message size where to be larger than 3582 than we send empty schema.Each lambda will need to retrieve schema from parameter store.
    var Schema = ''
  }

  const invocationparameters =partialmessage.replace('"Schema":""',`"Schema":"${Schema}"`)
  // console.log(invocationparameters +"\n\n")
  const clientcontext = Buffer.from(invocationparameters).toString('base64')

  return clientcontext
}

async function SelectSQLTable (sequelize, Model, SelectedModel, DataType, DBTableName, QueryTypes, QueryParameters) {
  // TODO remove this function and use engineshared.selectsqltable.
  class Query extends Model {}
  Query.init(SelectedModel, { // SelectedModel
    sequelize,
    modelName: QueryTypes, // "Invocation",
    tableName: DBTableName // "Invocations",
  })

  if (QueryTypes === 'findOne') {
    return await Query.findOne(QueryParameters)
  }
  else if (QueryTypes === 'findAll') {
    return await Query.findAll(QueryParameters)
  }
  else {
    return await Query.findByPk(QueryParameters)
  }
}

async function populatesqs (sqsclient, SendMessageCommand, sqslimiter, allKeys, QueueURL, sqsmessagesize) {
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

  MessagesArray.map(onebatch => {
    sqslimiter.schedule(() => {
      const params = {
        MessageGroupId: '',
        MessageBody: '',
        QueueUrl: QueueURL
      }

      params.MessageBody = JSON.stringify(onebatch)
      params.MessageGroupId = commonshared.makeid(128)
      const command = new SendMessageCommand(params)
      sqsclient.send(command)
    }) // sqslimiter
  }) // onebatch
}

async function getSQSqueueProperties (QueueURL) {
  const params = {
    QueueUrl: QueueURL,
    /* required */
    AttributeNames: [
      'ApproximateNumberOfMessages',
      'MaximumMessageSize',
      'ApproximateNumberOfMessagesNotVisible'
    ]
  }

  const command = new GetQueueAttributesCommand(params)
  const numofsqs = await sqsclient.send(command)
  return numofsqs.Attributes
}

const getCommonPrefixes = async (currentdepth, region, jobid, callerid, ddclient, PutItemCommand, commonshared, ListObjectsV2Command, params, allKeys = []) => {
  // https://stackoverflow.com/questions/42394429/aws-sdk-s3-best-way-to-list-all-keys-with-listobjectsv2

  const s3client = new S3Client({ region }) // region: "us-west-2"
  try {
    const command = new ListObjectsV2Command(params)
    var data = await s3client.send(command)
    var response = {
      Result: 'PASS',
      Data: data
    }
  }
  catch (error) {
    // console.error(error) // from creation or business logic
    var response = {
      Result: 'Fail',
      Data: error
    }
  }

  if (response.Result !== 'PASS') {
    const details = {
      source: callerid + ':getCommonPrefixes',
      message: JSON.stringify(response.Data),
      jobid
    }
    await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'S3List', 'Error', 'Infra', details, 'API')
  }
  else {
    response = response.Data

    if (response.CommonPrefixes !== undefined) {
      // folders with more subfolders to be scanned
      var delimiter = '*'
      response.CommonPrefixes.forEach(obj => allKeys.push([obj.Prefix, params.Bucket, delimiter, currentdepth, region]))
    }
    else {
      // folders with no more subfolders to be scanned
      var delimiter = '/'
      allKeys.push([response.Prefix, params.Bucket, delimiter, currentdepth, region])
    }
  }

  return allKeys
}

async function getAllKeys (region, params, allKeys = []) {
  // https://stackoverflow.com/questions/42394429/aws-sdk-s3-best-way-to-list-all-keys-with-listobjectsv2

  const s3client = new S3Client({ region })
  const command = new ListObjectsV2Command(params)
  const response = await s3client.send(command)
  response.Contents.forEach(obj => allKeys.push([obj.Key, params.Bucket, region, Math.ceil(obj.Size/1024)]))

  if (response.NextContinuationToken) {
    params.ContinuationToken = response.NextContinuationToken
    await getAllKeys(region, params, allKeys) // RECURSIVE CALL
  }
  return allKeys
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function determinemaxdbconnectioncount (dbinstanceclasses, DBInstanceClass, DBEngineType) {
  const dbarray = dbinstanceclasses.split(/\r\n|\r|\n/).filter(text => text.match(/^db.*/)).map(dbi => dbi.split(';'))

  if (DBInstanceClass.match('db.serverless')) {
    var maxacu = DBInstanceClass.split(':')[1].split('-')[1]
    // Set instance memory based limit, 1 ACU => 2GB RAM
    var instancememorymb = maxacu * 2 * 1000
  }
  else {
    var instancememorymb = dbarray.filter(dba => dba[0] === DBInstanceClass)[0][1].replace(' GiB', '') * 1000
  }

  instancememorymb = instancememorymb - 600 // removing 600 MB for general OS purposes
  var specificenginelimit = dbenginememorylimits.filter(de => de[0] === DBEngineType)[0]
  console.log('limit:' + specificenginelimit)
  // const maxutilisation = 0.90 // 90%
  const maxdbconnectioncount = specificenginelimit[2] ? Math.round(instancememorymb / specificenginelimit[1]) : specificenginelimit[2] // specificenginelimit[1] * maxutilisation
  return maxdbconnectioncount
}

function determinedbmaxactiveconnection (currentfreememory, DBEngineType) {
  const freememorymegabyte = Math.round(currentfreememory / 1024 / 1024)
  const specificenginelimit = dbenginememorylimits.filter(de => de[0] === DBEngineType)[0]

  const maxactiveconnection = Math.round(specificenginelimit[2] ? Math.round(freememorymegabyte / specificenginelimit[1]) : specificenginelimit[2])
  return maxactiveconnection
}

async function determineconcurrentlambdacount (cwclient, GetMetricDataCommand, commonshared, monitoringtimeperiod) {
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
    StartTime: new Date(time.StartDate),
    EndTime: new Date(time.Enddate),
    MetricDataQueries,
    ScanBy: 'TimestampDescending'
  }

  const command = new GetMetricDataCommand(cwlambdaconcurentexecutions)
  let concurrentlambdacount = (await cwclient.send(command)).MetricDataResults[0].Values

  if (concurrentlambdacount.length !== 0) {
    concurrentlambdacount = Math.round(concurrentlambdacount.reduce((a, v, i) => (a * i + v) / (i + 1)))
  }
  else {
    concurrentlambdacount = 0
  }
  return concurrentlambdacount
}

async function DesribeAllENI () {
  const paginatorConfig = {
    client: new EC2Client({}),
    pageSize: 100
  }

  const paginator = paginateDescribeNetworkInterfaces(paginatorConfig, {})
  const ENIlistArray = []
  for await (const onelist of paginator) {
    ENIlistArray.push(...onelist.NetworkInterfaces)
  }
  return ENIlistArray
}

async function GetConfiguration (directory, value) {
  // Kudos: https://stackoverflow.com/questions/71432755/how-to-use-dynamic-import-from-a-dependency-in-node-js
  const moduleText = fs.readFileSync(fileURLToPath(directory), 'utf-8').toString()
  const moduleBase64 = Buffer.from(moduleText).toString('base64')
  const moduleDataURL = `data:text/javascript;base64,${moduleBase64}`
  if (value !== '*') {
    var data = (await import(moduleDataURL))[value]
  }
  else {
    var data = (await import(moduleDataURL))
  }
  return data
}

function diskiocapacity(dbconfig, QueryString){

  //regular statement with limitted result set
  var queryweight =2.5
  //default db engine of logverz is postgres
  var dbenginecorrection=1
 // TODO add criteria for query complexity a query containing  1-2 'AND' or 'OR' conditions should be set queryweight =>6 if more than use the general query weight (2.5).  
  if (QueryString.includes('WHERE') === false){
    // data dump (insert all data no where statements) puts extra 400%-600% stress on the db server 
    queryweight =12
  }

  if (dbconfig.DBEngineType === 'mssql'){
    //based on testing mssql uses more IO for the same input data, hence lowering the value by 20%
    dbenginecorrection =0.8
  }

  if (dbconfig.AllocatedStorage < 10){
    //Aurora serverless starts with 0 disk capacity allocated so we configure as it had 10 
    dbconfig.AllocatedStorage = 10
  }

  switch (dbconfig.StorageType) {
    case 'gp3':
      var parallellambdacapacity = (dbconfig.AllocatedStorage * dbenginecorrection)/ queryweight
      break;
    case 'aurora':
      //aurora according to test and pricing is about 2X fast than standard gp3 + it has scalable additional memory
      //test: https://hackmysql.com/are-aurora-performance-claims-true/
      var performancecounter = 2
      var parallellambdacapacity = (dbconfig.AllocatedStorage * performancecounter ) / queryweight
      break
    case 'io1':
      // io1 according to documentation is approx 4 times faster than gp3 so we adjust the allocation
      var performancecounter = 4
      var parallellambdacapacity = (dbconfig.AllocatedStorage * performancecounter * dbenginecorrection) / queryweight
      break;
    case 'aurora-iopt1':
        //aurora according to pricing is about 2X fast than standard io1
        var performancecounter = 8
        var parallellambdacapacity = (dbconfig.AllocatedStorage * performancecounter) / queryweight
        break
    case 'io2':
      // io2 according to documentation is approx 8-16 times faster than gp3 so we adjust the allocation
      var performancecounter = 12
      var parallellambdacapacity = (dbconfig.AllocatedStorage * performancecounter * dbenginecorrection) / queryweight
      break;
    default:
      console.log(`unknown storage type`);
  }
  parallellambdacapacity =parseInt(parallellambdacapacity)
  console.log('Database storage configuration and typeof query concurent working lambda worker limit: '+parallellambdacapacity+ '')
  if(dbconfig.StorageType.includes("aurora")===false){
    console.log("(Increasing the storage capacity or switching disk type could increase this number)\n")
  }
  return parallellambdacapacity
}

function setsqsmessagesize(defaultsqsmessagesize, sumfilenumber, sumfilesize, DataType){
  
  //Lambdas may get terminated because of insufficent memory, with message:  Error: Runtime exited with error: signal: killedRuntime.ExitError
  // in order to limit that we reduce the number of files per message processed in one iteration of lambda workers. 
 let avgfilesize=Math.ceil(sumfilesize/sumfilenumber)
 let sqsmessagesize

  if (DataType === "CostDemoAWS"){
    //Schema is huge (processing on the DB side takes long ) so less file per message
    sqsmessagesize = Math.ceil(defaultsqsmessagesize * (20/avgfilesize))
  }
  else if (avgfilesize > 40){
    //assumption is that a typical bundle's size is 40 KB  or less in that case we add 50 files to a message.
    //So 1 message cotains (references/paths) to 40 files * 50 KB up to 2 MB of compressed data. 
    //If avg file size is more than 40 KB/file , eg 115 KB/file than we than we reduce number of messages,
    // 17 X 115 ~1.95MB
    sqsmessagesize = Math.ceil(defaultsqsmessagesize * (40/avgfilesize))
  }
  else{
    sqsmessagesize = defaultsqsmessagesize
  }
  //TODO determine default values for more datatypes
  return sqsmessagesize
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
