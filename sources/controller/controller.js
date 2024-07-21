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
import { SQSClient, SendMessageCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs'
import { SSMClient, GetParameterCommand, DeleteParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm'
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { ServiceQuotasClient, GetServiceQuotaCommand } from '@aws-sdk/client-service-quotas'
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import { EC2Client, paginateDescribeNetworkInterfaces } from '@aws-sdk/client-ec2'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dbinstanceclasses = fs.readFileSync(path.join(__dirname, 'DbInstanceClasses.csv'), { encoding: 'utf8', flag: 'r' })

// enginetype, memory requirment per connection, max DB engine connection count.
// https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Limits.html#RDS_Limits.MaxConnections
const dbenginememorylimits = [
  ['mysql', 12, 100000],
  ['postgres', 9.5, 8388607],
  ['mssql', 10, 32767]
  // Todo set to 1 , once logic is more robust. Currently using 10 so that automatic connection count is similar to other dbs
]
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
  var sqsmessagesize = 50 // TODO Determine the message size based on the number of files and and the length of the files.
  var WorkerFunction = process.env.WorkerFunction
  var SelectedModelPath = ('file:///' + path.join(__dirname, 'build', 'SelectedModel.js').replace(/\\/g, '/'))
  // './build/SelectedModel'
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
  var QueueURL = mydev.MessageQueue
  var cbbuildid = mydev.cbbuildid
}
if (PreferedWorkerNumber === 'auto') {
  var socketnumber = 500 // default 50
}
else {
  var socketnumber = Math.max(100, Math.round(PreferedWorkerNumber * 1.2))
}

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

const cbclient = new CodeBuildClient(config)
const sqsclient = new SQSClient(config)
const ssmclient = new SSMClient(config)
const ddclient = new DynamoDBClient(config)
const docClient = DynamoDBDocumentClient.from(ddclient)
const lmdclient = new LambdaClient(config)
const scclient = new ServiceQuotasClient(config)
const cwclient = new CloudWatchClient(config)

/* End of Initializing Environment */

main(cbclient, sqsclient, ssmclient, ddclient, docClient, scclient, cwclient, s3limiter, sqslimiter, engineshared, jobid, dbinstanceclasses, PreferedWorkerNumber)

async function main (cbclient, sqsclient, ssmclient, ddclient, docClient, scclient, cwclient, s3limiter, sqslimiter, engineshared, jobid, dbinstanceclasses, PreferedWorkerNumber) {
  console.log('PreferedWorkerNumber: ' + PreferedWorkerNumber + '\n' + '(note each lambda uses 2 connections to the database)\n\n')

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

  const Model = Sequelize.Model
  const DBAvalue = DatabaseParameters.split('<!!>')
  let DBEngineType = DBAvalue.filter(s => s.includes('LogverzEngineType'))[0].split('=')[1]
  const DBUserName = DBAvalue.filter(s => s.includes('LogverzDBUserName'))[0].split('=')[1]
  const DBEndpointName = DBAvalue.filter(s => s.includes('LogverzDBEndpointName'))[0].split('=')[1]
  const DBEndpointPort = DBAvalue.filter(s => s.includes('LogverzDBEndpointPort'))[0].split('=')[1]
  const DBSecretRef = DBAvalue.filter(s => s.includes('LogverzDBSecretRef'))[0].split('=')[1]
  const DBTableName = TableParameters.split('<!!>').filter(s => s.includes('TableName'))[0].split('=')[1]
  const DBInstanceClass = DBAvalue.filter(s => s.includes('LogverzDBInstanceClass'))[0].split('=')[1]
        DBEngineType = (DBEngineType.match('sqlserver-') ? 'mssql' : DBEngineType)

  var details = {
    source: 'controller.js:main/getssmparameter',
    message: ''
  }
  var params = {
    Name: DBSecretRef,
    WithDecryption: true
  }

  let DBPassword = await commonshared.getssmparameter(ssmclient, GetParameterCommand, params, ddclient, PutItemCommand, details)
  const buildstatus = await commonshared.getbuildstatus(cbclient, BatchGetBuildsCommand, [cbbuildid])
  // get who/what initated the codebuild run
  const username = buildstatus.builds[0].initiator
  const buildenvironment = buildstatus.builds[0].environment.computeType
  // if not authorized process exits;
  await authorizecollection(username)

  const NumberofWorkers = await EnvironmentMaxWokerCount(commonshared, scclient, cwclient, dbinstanceclasses, DBInstanceClass, DBEngineType, DBEndpointName, buildenvironment, PreferedWorkerNumber)

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
    await commonshared.setssmparameter(ssmclient, PutItemCommand, PutParameterCommand, ssmparams, ddclient, details)
    Schema = ''
  }

  DBPassword = DBPassword.Parameter.Value

  Schema = engineshared.convertschema(Schema, DBEngineType)
  fs.writeFileSync(fileURLToPath(SelectedModelPath), engineshared.constructmodel(Schema, 'controller'))
  const DBName = 'Logverz'
  const connectionstring = `${DBEngineType}://${DBUserName}:${DBPassword}@${DBEndpointName}:${DBEndpointPort}/${DBName}`
  const sequaliseconfig = engineshared.ConfigureSequalize(DBEngineType)
  let sequelize = new Sequelize(connectionstring, sequaliseconfig)
  sequelize.options.logging = false // Disable logging

  try {
    await InitiateSQLConnection(sequelize, DBEngineType, connectionstring, DBName)
    console.log('Connection has been established successfully.\n')
  }
  catch (e) {
    const message = 'Error establishing SQL connection. Further details: \n'
    console.error(message + e)
    var details = {
      source: 'controller.js:InitiateSQLConnection',
      message: message + e,
      jobid
    }
    await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'SQLConnect', 'Error', 'Infra', details, 'API')
    process.exit(1)
  }

  // checking for previous queries that needs to be set inactive in prod environment
  if (process.env.Environment !== 'LocalDev') {
    const DatabaseName = DBAvalue.filter(s => s.includes('LogverzDBFriendlyName'))[0].split('=')[1]
    const DBTableName = TableParameters.split('<!!>').filter(s => s.includes('TableName'))[0].split('=')[1]
    await commonshared.deactivatequery(docClient, QueryCommand, UpdateCommand, DatabaseName, DBTableName, jobid)
  }

  // Verify that Invocations table exists, if not create it and the processing errors table,
  try {
    const initatequery = initiatetablesquery(DBEngineType)
    await sequelize.query(initatequery)
  }
  catch (err) {
    console.log('Invocations table does not exists creating it and Processingerrors table.')
    await CreateSQLTable(sequelize, Model, engineshared.InvocationsModel, 'Invocation', 'Invocations')
    await CreateSQLTable(sequelize, Model, engineshared.ProcessingErrorsModel(DBEngineType), 'ProcessingError', 'ProcessingErrors')
  }
  finally {
    // TODO: Set "failed to complete status" to stale entries that are running status and older than 15 minutes.
  };

  // const SelectedModel = require('./build/SelectedModel')
  var SelectedModelpath = ('file:///' + path.join(__dirname, 'build', 'SelectedModel.js').replace(/\\/g, '/'))
  const SelectedModel = (await import(SelectedModelpath)).SelectedModel

  try {
    await CreateSQLTable(sequelize, Model, SelectedModel, QueryType, DBTableName)
    console.log('Table ' + DBTableName + ' for "' + QueryType + '" data type queries has been created.')
  }
  catch (e) {
    console.error(e)
  }

  const z1 = performance.now()

  console.log('2.) Starting walk folders, ellipsed time from the beginning is ' + (z1 - z0) / 1000)
  // TODO: CACHE MODE which  SAVE sallKeys to S3 than read it from there
  const s3client = new S3Client({})
  tobeprocessed = await commonshared.TransformInputValues(s3client, GetBucketLocationCommand, S3Folders, S3EnumerationDepth, _)

  do {
    await commonshared.walkfolders(_, ListObjectsV2Command, ddclient, PutItemCommand, commonshared, tobeprocessed, subfolderlist, getCommonPrefixes, 'controller.js', jobid)
  }
  while (((subfolderlist.length + tobeprocessed.length) !== 0) && (tobeprocessed.length !== 0))
  const z2 = performance.now()
  console.log('3.) Finished walk folders, elipsed time ' + ((z2 - z1) / 1000) + ' from start walking folder and ' + ((z2 - z0) / 1000) + ' from the beginning\n4.) Starting enumerating keys, this could take couple of minutes or more depending on the data volume')

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
  console.log('5.) Finished enumerating keys elipsed time ' + ((z3 - z2) / 1000) + ' from finised walking folders and ' + ((z2 - z0) / 1000) + ' from the beginning')
  var allKeys = _.flatten(alltasksresolved)
  var allKeys = allKeys.filter(item => item[0].endsWith('/') === false) // to remove directories
  console.log('\nThe number of files in specified bucket(s) ' + allKeys.length + '. Current local time:' + commonshared.timeConverter(Date.now()) + '\n\n')

  // TODO: dontwait for all files to be enumerated but do file enumeration and SQL population in parralell
  // TODO: handle allkeys zero case (no acces to bucket or non existent bucket etc.)
  populatesqs(sqsclient, SendMessageCommand, sqslimiter, allKeys, QueueURL)
  // TODO: Set the message queue size dynamically based on the number of estimated files.

  await controllambdajobs(workerlimiter, ddclient, PutItemCommand, ssmclient, sequelize, Model, engineshared.InvocationsModel, QueueURL, S3SelectParameter, jobid, NumberofWorkers)

  console.log('\n\n FINISHED EXECUTION at: ' + Date.now() + ', ' + commonshared.timeConverter(Date.now()) + ' local time.\n\n')
  process.exit()
  // TODO: console log couple of execution stats such as ellipsed time, number of files processed,
  // entries matched and  inserted to database, number of erros etc. And the settings that where used to create the table.
}

async function EnvironmentMaxWokerCount (commonshared, scclient, cwclient, dbinstanceclasses, DBInstanceClass, DBEngineType, DBEndpointName, buildenvironment, PreferedWorkerNumber) {
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

    var maxactiveconnection = determinedbmaxactiveconnection(currentfreememory, DBEngineType) - 3 // - controller connections
    maxworkercount.push(maxactiveconnection)
    console.log('Database server effective connections count: ' + maxactiveconnection + '\n' + '(Derived from current free memory (' + Math.round(currentfreememory / 1024 / 1024) + ') MB / per connection memory requirement (approx 10MB) - Controller connections)\n')
  }
  else {
    console.log('\nFailed to get performance metrics (free memory, cpu utilisation, connection count) for DB instance: \n' + DBEndpointName + '\n')
    console.log('\nMaximum database server connections count: ' + maxdbconnectioncount + '\n')
  }

  // describe vpc network interfaces
  const EniList = await DesribeAllENI()

  const vpcquotaparams = {
    QuotaCode: 'L-DF5E4CA3',
    /* required */
    ServiceCode: 'vpc' /* required */
  }

  var command = new GetServiceQuotaCommand(vpcquotaparams)
  const vpcquota = (await scclient.send(command)).Quota.Value

  // const vpcquota = (await getquotas(servicequotas, vpcquotaparams)).Quota.Value
  maxworkercount.push(vpcquota - EniList.length)
  console.log('Available number of ENIs, determined by quota(' + vpcquota + ') - current usage(' + EniList.length + '): ' + (vpcquota - EniList.length) + '\n')

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
  // Type, MemoryAllocated,Concurrency so that one workerthread has approx 10 MB ram.
  const codebuildcomputeproperties = [
    ['BUILD_GENERAL1_SMALL', 3000, 275],
    ['BUILD_GENERAL1_MEDIUM', 7000, 650],
    ['BUILD_GENERAL1_LARGE', 14000, 1400]
  ]
  const codebuildmaxworkercount = codebuildcomputeproperties.filter(cbcp => cbcp[0] === buildenvironment)[0][2]
  console.log('Selected build environment maximum concurrent execution capacity: ' + codebuildmaxworkercount + '\n')
  maxworkercount.push(codebuildmaxworkercount)

  if ((maxactiveconnection !== 0)) { // there are database performance metrics available for further decisions.
    if (PreferedWorkerNumber === 'auto') {
      var NumberofWorkers = parseInt((Math.min(...maxworkercount) / 2) * 0.4) // 1 lambda creats 2 connecttions hence we take half of the lowest workercount, and use 40% of it
      console.log('The determined worker count equals to 40% of the lowest environment limit \'s ' + NumberofWorkers + ' ,taking into account that each lambda has 2 active connections to the DB.\n')
    }
    else if (((Math.min(...maxworkercount) / 2) > PreferedWorkerNumber) && (PreferedWorkerNumber > maxactiveconnection)) {
      console.log(warning)
      var NumberofWorkers = parseInt(PreferedWorkerNumber)
      console.log('The prefered (' + PreferedWorkerNumber + ') worker count is under the environment limits, hence it will be used. However the connections memory requirement is more than the available free memory, \n')
      console.log('If its significantly higher the database will start to **SWAP** and execution will be significantly slower or fail, if current number (' + NumberofWorkers + ') of Lambda workers are needed a larger capacity DB instance is advised.\n')
    }
    else if (((Math.min(...maxworkercount) / 2) > PreferedWorkerNumber) && (PreferedWorkerNumber < maxactiveconnection)) {
      var NumberofWorkers = parseInt(PreferedWorkerNumber)
      console.log('The prefered (' + PreferedWorkerNumber + ') worker count is under the environment limits and memory requirement, hence it will be used.\n')
    }
    else {
      var NumberofWorkers = parseInt(Math.ceil((Math.min(...maxworkercount) / 2) * 0.6))
      console.log('The prefered (' + PreferedWorkerNumber + ') worker count is over the lowest environment limit, 60% of the limit (' + NumberofWorkers + ') is going to be used.\n')
    }
  }
  else {
    // bellow doing the determination without database performance metrics
    if (PreferedWorkerNumber === 'auto') {
      var NumberofWorkers = parseInt((Math.min(...maxworkercount) / 2) * 0.4) // 1 lambda creats 2 connecttions hence we take half of the lowest workercount, and use 40% of it.
      console.log('The determined worker count is ' + NumberofWorkers + ', 40% of the lowest environment limit (' + Math.min(...maxworkercount) + ').\n')
    }
    else if (((Math.min(...maxworkercount) / 2) > PreferedWorkerNumber)) {
      var NumberofWorkers = parseInt(PreferedWorkerNumber)
      console.log('The determined worker count is ' + NumberofWorkers + ', as the prefered worker count (' + PreferedWorkerNumber + ') is lower the lowest environment limit ' + Math.min(...maxworkercount) + '.\n')
    }
    else if (((Math.min(...maxworkercount) / 2) < PreferedWorkerNumber)) {
      var NumberofWorkers = parseInt(Math.ceil((Math.min(...maxworkercount) / 2) * 0.6))
      console.log('The determined worker count is ' + NumberofWorkers + ',  60% of the lowest environment limit (' + Math.min(...maxworkercount) + '), taking into account that each lambda has 2 active connections to the DB. \n')
    }
    else {
      console.log('something went wrong, there should have been a decision made earlier, stopping execution')
      process.exit(1)
    }
  }

  return NumberofWorkers
}

async function controllambdajobs (workerlimiter, ddclient, PutItemCommand, ssmclient, sequelize, Model, InvocationsModel, QueueURL, S3SelectParameter, jobid, NumberofWorkers) {
  // wait 3 seconds for the queue to be populated.
  console.log('Determined initial number of workers ' + NumberofWorkers)
  await new Promise((resolve, reject) => setTimeout(resolve, 3000)) // wait a bit so that sqs queue is not empty at later check

  const throttledlambdajob = workerlimiter.wrap(lambdajob)
  const initialqueuelength = (await getSQSqueueProperties(QueueURL)).ApproximateNumberOfMessages
  console.log('Initialqueue SQS length ' + initialqueuelength)

  if (initialqueuelength !== 0) { // checks for initial queue length if SQS is empty at start, than no need to start worker lambdas.
    var jobquelength = Math.ceil(NumberofWorkers * 1.2)
    console.log('Internal jobqueue length: ' + jobquelength)
    submitlambdajobs2Q(throttledlambdajob, ddclient, PutItemCommand, sequelize, Model, InvocationsModel, jobid, S3SelectParameter, jobquelength)

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

      console.log('SQS queue length: ' + queuelength.ApproximateNumberOfMessages + ' messages in flight ' + queuelength.ApproximateNumberOfMessagesNotVisible + '. Running lambdas count: ' + counts.EXECUTING + '\n' + ' controller\'s internal queue' + JSON.stringify(counts) + '\n\n\n')

      if (queuelength.ApproximateNumberOfMessages <= (Math.ceil(NumberofWorkers * 0.10)) && queuelength.ApproximateNumberOfMessagesNotVisible <= (Math.ceil(NumberofWorkers * 0.10)) && SQSQUEUENOTNULL) {
        SQSQUEUENOTNULL = false // when sqs approx length is less than 25% SQSQUEUENOTNULL=false
        console.log('Finished processing the SQS queue. ' + counts.EXECUTING + ' Lambdas are finishing up.')
      }
      else if ((counts.RECEIVED <= Math.ceil((NumberofWorkers * 0.25))) && (counts.QUEUED <= Math.ceil((NumberofWorkers * 0.25))) && SQSQUEUENOTNULL) {
        // The number of jobs in the internalqueue is getting low adding new jobs
        console.log('placing worker jobs to internal queue\n')
        console.log(JSON.stringify(counts) + '\n')
        var jobquelength = Math.ceil(NumberofWorkers * 0.75)
        submitlambdajobs2Q(throttledlambdajob, ddclient, PutItemCommand, sequelize, Model, InvocationsModel, jobid, S3SelectParameter, jobquelength)
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
    await timeout(5000)
  } // if queue length !==0

  // Check if QueryType is "Temporary/jobid", than delete it.
  if (QueryType.match('Temporary/') !== null) {
    const params = {
      Name: '/Logverz/Engine/Schemas/' + QueryType
    }
    const command = new DeleteParameterCommand(params)
    await ssmclient.send(command)
  }
}

function submitlambdajobs2Q (throttledlambdajob, ddclient, PutItemCommand, sequelize, Model, InvocationsModel, jobid, S3SelectParameter, jobquelength) {
  // this is the internal queue (based on bottleneck), that controlls lambda execution ensures that exactly NumberofWorkers lambda jobs are running
  const newjobs = []
  for (let i = 0; i < jobquelength; i++) {
    newjobs.push(i)
  }

  newjobs.map(j => throttledlambdajob(ddclient, PutItemCommand, sequelize, Model, InvocationsModel, jobid, S3SelectParameter, j))
  console.log('placed ' + JSON.stringify(jobquelength) + ' worker jobs in internal queue')
}

async function lambdajob (ddclient, PutItemCommand, sequelize, Model, InvocationsModel, jobid, S3SelectParameter) {
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
      await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'SQLInsert', 'Error', 'Infra', details, 'API')
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
  }
  else {
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

  const command = new InvokeCommand(lambdaparams)
  await lmdclient.send(command)
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
  }
  else if (QueryTypes === 'findAll') {
    return await Query.findAll(QueryParameters)
  }
  else {
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

async function populatesqs (sqsclient, SendMessageCommand, sqslimiter, allKeys, QueueURL) {
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
  response.Contents.forEach(obj => allKeys.push([obj.Key, params.Bucket, region]))

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

function initiatetablesquery (DBEngineType) {
  if (DBEngineType === 'postgres') {
    var initiatetables = 'SELECT 1 FROM public."Invocations"'
  }
  else if (DBEngineType === 'mysql') {
    var initiatetables = 'SELECT 1 FROM Invocations'
  }
  else if (DBEngineType.match('mssql')) {
    var initiatetables = 'SELECT 1 FROM dbo.Invocations'
  }
  else {
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
    let userattributes = await authenticationshared.getidentityattributes(docClient, QueryCommand, username, usertype)
    userattributes = userattributes.Items[0]
    var S3authresult = authenticationshared.authorizeS3access(_, commonshared, userattributes, S3Foldersarray)
  }
  else {
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
    await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'S3Access', 'Error', 'User', details, 'API')
    process.exit(1)
  }
  else {
    console.log(username + ' can access folders ' + S3Foldersarray)
  }
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

async function InitiateSQLConnection (sequelize, DBEngineType, connectionstring, DBName) {

  if (DBEngineType === 'mssql') {
    // by default mssql does not have a Logverz database, so at first execution it needs to be created.

    sequelize.options.validateBulkLoadParameters = true
    sequelize.options.loginTimeout = 15

    try {
      await sequelize.authenticate()
    }
    catch (err) {
      if (err.name === 'SequelizeAccessDeniedError') {

        // At first execution Logverz DB is not present need to connect to a different db to verify credentials
        // than create  Logverz DB and if successfull return authenticated true.
        sequelize = new Sequelize(connectionstring)
        sequelize.connectionManager.config.database = 'master'
        sequelize.options.logging = false

        // trying to authenticate a 2nd time either works (case of 1st execution) or errors (wrong credential).
        // This error is caught in the main try catch
        await sequelize.authenticate()

        // connection succeeded creating mssql database
        await sequelize.query('CREATE DATABASE ' + DBName)

        // connectioning to newly created DB
        sequelize = new Sequelize(connectionstring)
        await sequelize.authenticate()

      }
      else {
        console.log(err)
      }
    }
  }
  else {
    //non mssql DB
    await sequelize.authenticate()
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
