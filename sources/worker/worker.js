/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

import { performance } from 'perf_hooks'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
// import https from 'https'
// import { NodeHttpHandler } from '@smithy/node-http-handler'
import _ from 'lodash'
import pkg from 'tasktimer'
import { Sequelize } from 'sequelize'
import { S3Client, SelectObjectContentCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const { TaskTimer } = pkg

let rdsinsertsuccess = false
let t0
let sqsempty = 0

export const handler = async (event, context) => {
  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    var commonsharedpath = ('file:///' + path.join(__dirname, 'shared', 'commonsharedv3.js').replace(/\\/g, '/'))
    var commonshared = await GetConfiguration(commonsharedpath, '*')
    var enginesharedpath = ('file:///' + path.join(__dirname, 'shared', 'enginesharedv3.mjs').replace(/\\/g, '/'))
    var engineshared = await GetConfiguration(enginesharedpath, '*')
    const arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var FileName = ('file:///' + path.join('tmp', 'SelectedModel.mjs').replace(/\\/g, '/')) // '/tmp/SelectedModel.js'
    var TestingTimeout = process.env.TestingTimeout
    var DebugInsert = process.env.DebugInsert
    var EngineBucket = process.env.EngineBucket
    console.log('REQUEST RECEIVED: ' + JSON.stringify(context))
  }
  else {
    // Dev environment settings
    var directory = path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'worker', 'mydev.mjs')
    const mydev = await import('file:///' + directory.replace(/\\/g, '/'))
    var engineshared = mydev.engineshared
    var commonshared = mydev.commonshared
    var region = mydev.region
    var FileName = mydev.FileName
    var context = mydev.context
    var TestingTimeout = mydev.TestingTimeout
    var DebugInsert = mydev.DebugInsert
    var EngineBucket = mydev.EngineBucket
  }

  const DBName = 'Logverz'
  const DBAvalue = context.clientContext.DatabaseParameters.split('<!!>')
  let DBEngineType = DBAvalue.filter(s => s.includes('LogverzEngineType'))[0].split('=')[1]
  DBEngineType = (DBEngineType.match('sqlserver-') ? 'mssql' : DBEngineType)
  const DBUserName = DBAvalue.filter(s => s.includes('LogverzDBUserName'))[0].split('=')[1] // "LogverzAdmin"
  const DBEndpointName = DBAvalue.filter(s => s.includes('LogverzDBEndpointName'))[0].split('=')[1]
  const DBEndpointPort = DBAvalue.filter(s => s.includes('LogverzDBEndpointPort'))[0].split('=')[1]
  const DBFrendlyName = DBAvalue.filter(s => s.includes('LogverzDBFriendlyName'))[0].split('=')[1]
  const QueueURL = context.clientContext.QueueURL
  const S3SelectQuery = context.clientContext.S3SelectQuery
  const S3SelectParameter = JSON.parse(context.clientContext.S3SelectParameter) // .replace("\\","")
  const QueryType = context.clientContext.QueryType
  const DBTableName = context.clientContext.DBTableName
  var Schema = context.clientContext.Schema
  const Model = Sequelize.Model

  var header = true
  if (S3SelectParameter.InputSerialization.JsonType !== undefined) {
    var type = 'JSON'
  }
  else if (S3SelectParameter.InputSerialization.CSV.FileHeaderInfo === 'USE') {
    var type = 'CSV'
  }
  else {
    var type = 'CSV'
    var header = false
  }

  const sqsclient = new SQSClient({})
  const ssmclient = new SSMClient({})
  const ddclient = new DynamoDBClient({})

  const initialparameters = await initialseparameters(commonshared, Schema, QueryType, DBFrendlyName, ssmclient, GetParameterCommand, ddclient, PutItemCommand)
  const DBPassword = initialparameters.Password
  Schema = initialparameters.Schema

  fs.writeFileSync(fileURLToPath(FileName), engineshared.constructmodel(Schema, 'worker'))
  var SelectedModel = (await import(FileName)).SelectedModel

  const connectionstring = `${DBEngineType}://${DBUserName}:${DBPassword}@${DBEndpointName}:${DBEndpointPort}/${DBName}`

  try {
    var sequelize = await InitiateConnection(DBEngineType, connectionstring) // sequelize,
    console.log('SQL Server Connection has been established successfully.')
  }
  catch (e) {
    console.log('Error establishing SQL Server connection. Further details: \n')
    console.error(e)
    process.exit()
  }

  await StartLambdastate(ddclient, sequelize, Model, engineshared.InvocationsModel, context.clientContext.jobid, context.clientContext.invocationid)

  t0 = performance.now()
  const timer = new TaskTimer(5000)
  timer.on('tick', async () => {
    await UpdateLambdaState(context, sequelize, Model, engineshared) 
  })
  timer.start()
  // two actions are run in parallel:
  // 1.) reporting lambda state to sql database,
  // 2.) processing sqs messages via TASK function
  await loop(sqsclient, sequelize, context, TestingTimeout, engineshared, commonshared, ddclient, S3SelectParameter, QueryType, QueueURL, S3SelectQuery, Model, SelectedModel, DBTableName, DBEngineType, type, header,DebugInsert,EngineBucket, region, FileName)

  timer.stop()

  return {
    statusCode: 200,
    body: {}
  }
} // module exports

async function loop (sqsclient, sequelize, context, TestingTimeout, engineshared, commonshared, ddclient, S3SelectParameter, QueryType, QueueURL, S3SelectQuery, Model, SelectedModel, DBTableName, DBEngineType, type, header, DebugInsert, EngineBucket, region, FileName) {
  
  let i = 0

  try {
    let exitcondition = false
    do {
      if (TestingTimeout > 0) {
        console.log('testing timeout of: ' + TestingTimeout / 1000 + ' seconds where applied.')
        await timeout(TestingTimeout) // for testing log running lambdas
      }
      const t1 = performance.now()
      await Task(sqsclient, engineshared, commonshared, ddclient, S3SelectParameter, QueryType, QueueURL, S3SelectQuery, sequelize, Model, SelectedModel, DBTableName, DBEngineType, context, type, header, DebugInsert, EngineBucket, region, FileName)
      const t2 = performance.now()
      const processingtime = (t2 - t1)
      const ellipsedtime = (t2 - t0)
      console.log('ellipsedtime ' + ellipsedtime)

      if (process.env.Environment === 'Windows') { // for local test environment
        var remainingtime = context.getRemainingTimeInMillis() - ellipsedtime
      }
      else {
        var remainingtime = context.getRemainingTimeInMillis()
      }

      i = i + 1
      console.log('Lambda instance :' + context.awsRequestId + ' @ iteration ' + i + ' had processing time ' + (processingtime / 1000) + ' second(s).')
      // End the loop execution when the conditions are meet.
      if ((remainingtime < (processingtime * 2)) || (remainingtime < 10000)) {
        exitcondition = true
        await CompleteLambdaState(context, sequelize, Model, engineshared)
        await sequelize.close()
        console.log('exit condition met, the Lambdafunctions remaining time ' + remainingtime / 1000 + 'sec last iteration time ' + processingtime / 1000 + 'sec')
      }
    } while (!exitcondition)
  }
  catch (err) {
    console.log(err)
  }

  console.log(`Reporting state of instance ${context.clientContext.invocationid} at ${new Date().toLocaleString()} : COMPLETED`)
  // await CompleteLambdaState(context, sequelize, Model, engineshared)
  // await sequelize.close()
}

async function Task (sqsclient, engineshared, commonshared, ddclient, S3SelectParameter, QueryType, QueueURL, S3SelectQuery, sequelize, Model, SelectedModel, DBTableName, DBEngineType, context, type, header, DebugInsert, EngineBucket, region, FileName) {
  const sqsmessages = await commonshared.receiveSQSMessage(sqsclient, ReceiveMessageCommand, QueueURL, '3')

  if (sqsmessages.Messages !== undefined) {
    try {
      var prefixarray = _.flatten(sqsmessages.Messages.map(msg => JSON.parse(msg.Body)))
      var ReceiptHandle = sqsmessages.Messages.map(msg => msg.ReceiptHandle)
    }
    catch (e) {
      console.log('Error parsing Message retrieved from SQS. Further details: \n')
      console.error(e)
      process.exit()
    }

    const s3results = await processS3data(prefixarray, S3SelectQuery, S3SelectParameter, context, DBEngineType, engineshared, commonshared, ddclient, sequelize, Model, type, header)
    const Transformeddata = DatatoSchemaTransformation(s3results, SelectedModel, S3SelectParameter, DBEngineType, type, header)

    // Only call InsertData if Transformed data is not null;
    if (Transformeddata.length !== 0) {
      rdsinsertsuccess=await InsertData(commonshared, sequelize, Model, SelectedModel, QueryType, DBTableName, Transformeddata, DebugInsert, EngineBucket, region, FileName)
      await deleteSQSMessage(sqsclient, QueueURL, ReceiptHandle, rdsinsertsuccess)
    }
    else {
      //if there was no data we can delete the  sqs message 
      rdsinsertsuccess = true
      await deleteSQSMessage(sqsclient, QueueURL, ReceiptHandle, rdsinsertsuccess)
    }
  }
  else if (sqsempty > 2) {
    console.log('\nQueue was empty for prolonged time stopping lambda function\n')
    await CompleteLambdaState(context, sequelize, Model, engineshared)
    await sequelize.close()

    //process.exit(0)
    return null
  }
  else {
    console.log('\nQueue was empty waiting 1 second for new messages\n')
    await timeout(1000)
    sqsempty++
  }
}

async function StartLambdastate(ddclient,sequelize, Model, InvocationsModel, jobid, invocationid){
  const mydata = {
    jobid,
    invocationid,
    status: 'INVOKED',
    updateunixtime: Date.now()
  }
  //const AddSQLEntryresult = await engineshared.AddSqlEntry(sequelize, Model, InvocationsModel, 'Invocation', 'Invocations', mydata)

  var AddSQLEntryresult =await AddSqlEntry(sequelize, Model, InvocationsModel, 'Invocation', 'Invocations', mydata)

   
  // checks for SQL insert success/failure if failed records it in DynamoDb.
  if (AddSQLEntryresult.Result !== 'PASS') {
    const details = {
      source: 'worker.js:StartLambdastate:AddSqlEntry',
      message: JSON.stringify(AddSQLEntryresult.Data),
      jobid
    }
    await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'SQLInsert', 'Error', 'Infra', details, 'API')
  }

}

async function UpdateLambdaState(context, sequelize, Model, engineshared)    {
  console.log(`Reporting state of instance ${context.clientContext.invocationid} at ${new Date().toLocaleString()} : RUNNING`)

  const updatedfields = {

    status: 'RUNNING',
    updateunixtime: Date.now(),
    loggroup: context.logGroupName,
    logstream: context.logStreamName
  }
  const conditions = {
    where: {
      invocationid: context.clientContext.invocationid
    }
  }

  await UpdateSqlEntry(sequelize, Model, engineshared.InvocationsModel, 'Invocation', 'Invocations', updatedfields, conditions)
}

async function CompleteLambdaState(context, sequelize, Model, engineshared){

  const conditions = {
    where: {
      invocationid: context.clientContext.invocationid
    }
  }
  var status=  {
    status: 'COMPLETED'
  }

  await UpdateSqlEntry(sequelize, Model, engineshared.InvocationsModel, 'Invocation', 'Invocations', status, conditions)

}

async function InsertData (commonshared, sequelize, Model, SelectedModel, QueryType, DBTableName, Transformeddata, DebugInsert, EngineBucket, region, FileName) {
  
  class Entry extends Model {}
  await Entry.init(SelectedModel, {
    sequelize,
    modelName: QueryType,
    tableName: DBTableName,
    freezeTableName: true
  })
  var rdsinsertsuccess
  const t = await sequelize.transaction();

  try {
    await Entry.bulkCreate(Transformeddata, {
      transaction: t 
    })
    
    await t.commit();
    rdsinsertsuccess = true
    console.log('SQL Server BulkEntry  has been completed successfully. Number of rows: ' + Transformeddata.length)
    return rdsinsertsuccess

  } catch (err) {
    console.log(err.message, "\nline: ",err.original.line)
    if (DebugInsert === 1){

      let filenamepart=Date.now() /1000+"_error.sql"
      let newfilefullname=FileName.replace("SelectedModel.mjs",filenamepart)
      fs.writeFileSync(fileURLToPath(newfilefullname), err.sql)
      const s3client = new S3Client({region})
      console.log('Starting SQL commands debug file upload')
      await commonshared.s3putdependencies(newfilefullname, EngineBucket, s3client, PutObjectCommand, fs, fileURLToPath, 'DebugInsert/'+filenamepart)
      // setTimeout(function () {
          rdsinsertsuccess = false
          // Transaction has been rolled back
          // err is whatever rejected the promise chain returned to the transaction callback
          t.rollback()
          return  rdsinsertsuccess
      // }, 1500);
    }
    else{
      rdsinsertsuccess = false
      // Transaction has been rolled back
      // err is whatever rejected the promise chain returned to the transaction callback
      t.rollback()
      return   rdsinsertsuccess
    }
  }
} // insert data function

async function processS3data (prefixarray, S3SelectQuery, S3SelectParameter, context, DBEngineType, engineshared, commonshared, ddclient, sequelize, Model, type, header) {
  // source: https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#selectObjectContent-property

  const s3parameters = {
    Bucket: '',
    Key: '',
    ExpressionType: 'SQL',
    Expression: S3SelectQuery,
    InputSerialization: {
      CompressionType: S3SelectParameter.InputSerialization.Compression
    },
    OutputSerialization: {}
  }

  if (type === 'JSON') {
    s3parameters.InputSerialization.JSON = {}
    s3parameters.InputSerialization.JSON.Type = S3SelectParameter.InputSerialization.JsonType
    s3parameters.OutputSerialization.JSON = {}
    s3parameters.OutputSerialization.JSON.RecordDelimiter = ','
  }
  else if (type === 'CSV') {
    if (header === false) {
      s3parameters.InputSerialization.CSV = {}
      s3parameters.OutputSerialization.CSV = S3SelectParameter.OutputSerialization.CSV
    }
    else {
      s3parameters.OutputSerialization.JSON = {}
      s3parameters.OutputSerialization.JSON.RecordDelimiter = ','
    }
    s3parameters.InputSerialization.CSV = S3SelectParameter.InputSerialization.CSV
  }
  else if (S3SelectParameter.InputSerialization.Parquet !== undefined) {
    console.log('Parquet support to be done!')
  }


  const promises = prefixarray.map(prefix => {
    s3parameters.Key = prefix[0]
    s3parameters.Bucket = prefix[1]
    const region = prefix[2]
    const params = s3parameters
    const s3client = new S3Client({ region })
    return FilteredS3data(ddclient, s3client, params, context, engineshared, commonshared, sequelize, Model, DBEngineType, type, header)
  }) // prefixarray.map

  const resolved = await Promise.all(promises)
  let results = _.compact(_.flatten(resolved))

  if ((S3SelectParameter.InputSerialization.RootElement !== undefined) && (typeof results[0][S3SelectParameter.InputSerialization.RootElement] === 'object')) {
    // its a list of elements
    const combined = []
    results.map(r => combined.push(r.Records))
    results = _.flatten(combined)
  }

  console.log('Number of events ' + results.length + ' \n')
  return results
}

async function FilteredS3data (ddclient, s3client, params, context, engineshared, commonshared, sequelize, Model, DBEngineType, type, header) {
  const asyncIterableStreamToString = (asyncIterable) =>
    new Promise(async (resolve, reject) => {
      try {
        const chunks = [new Uint8Array()]
        for await (const selectObjectContentEventStream of asyncIterable) {
          if (selectObjectContentEventStream.Records) {
            if (selectObjectContentEventStream.Records.Payload) {
              chunks.push(selectObjectContentEventStream.Records.Payload)
            }
          }

          if (selectObjectContentEventStream.End) {
            resolve(Buffer.concat(chunks).toString('utf8'))
          }
        }
      }
      catch (err) {
        console.error(err)
        reject(err)
      }
    }
    )

  const command = new SelectObjectContentCommand(params)
  var result
  try {
    const response = await s3client.send(command)

    if (response.$metadata.httpStatusCode === 200) {
      if (response.Payload) {
        const body = await asyncIterableStreamToString(response.Payload)

        if (type === 'JSON') {
          result = convertrawdata(body)
        }
        else if (type === 'CSV' && header === true) {
          result = convertrawdata(body)
        }
        else if (type === 'CSV' && header === false) {
          result = {
            Result: 'PASS',
            Data: body
          }
        }
        // console.log(body)
      }
      else {
        console.warn(`S3Select did not have payload for ${bucketName}/${key}`)
      }
    }
    else if (response.error !== null) {
      const errorstring = response.httpResponse.stream.req._header
      const file = errorstring.match(/POST.*?select.*/g)
      const bucket = errorstring.match(/Host:.*/g)
      // this is the compacted errormessage
      const errormessagedatabase = 'Error Processing request: \n' + file + '\n' + bucket + '\nReason:\n' + Buffer.from(response.httpResponse.body).toString('utf8')
      // this is the full errormessage:
      let errormessageconsole = 'Error Processing request: \n' + errorstring + '\n------------------------------------------------------------------\n'
      errormessageconsole += Buffer.from(response.httpResponse.body).toString('utf8')
      console.log(errormessageconsole)
      result = {
        Result: 'Fail',
        Data: errormessagedatabase
      }
    }
  }
  catch (e) {
    var errormessage ="\n   S3Error:  "+e.message+"\n   Bucket:   "+e.$response.body.req.host+"\n   File:  "+ e.$response.body.req.path.split('?')[0]
    console.log(errormessage)
    result = {
      Result: 'Fail',
      Data: errormessage
    }
  }

  if (result.Result === 'PASS') {
    return result.Data
  }
  else {
    const mydata = {
      jobid: context.clientContext.jobid,
      invocationid: context.clientContext.invocationid,
      updateunixtime: Date.now(),
      path: 'worker.js:FilteredS3data.req.on.complete',
      loggroup: context.logGroupName,
      logstream: context.logStreamName,
      errormessage: result.Data
    }
    // const AddSQLEntryresult = await engineshared.AddSqlEntry(sequelize, Model, engineshared.ProcessingErrorsModel(DBEngineType), 'ProcessingError', 'ProcessingErrors', mydata)
    const AddSQLEntryresult = await AddSqlEntry(sequelize, Model, engineshared.ProcessingErrorsModel(DBEngineType), 'ProcessingError', 'ProcessingErrors', mydata)
    // checks for SQL insert success/failure if failed records it in DynamoDb.
    if (AddSQLEntryresult.Result !== 'PASS') {
      const details = {
        source: 'Worker.js:AddSqlEntry',
        message: 'failed to insert processing errors to SQL table, because: ' + result.Data,
        jobid: context.clientContext.jobid
      }
      await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'SQLInsert', 'Error', 'Infra', details, 'API')
    }
  }
}

async function InitiateConnection (DBEngineType, connectionstring) {
  if (DBEngineType === 'mssql') {
    var config = {
      dialect: 'mssql',
      logging: false,
      dialectOptions: {
        options: {
          validateBulkLoadParameters: true,
          loginTimeout: 60
        }
      },
      pool: {
        max: 2,
        min: 1,
        idle: 10000,
        acquire: 60000
      }
    }
    var sequelize = new Sequelize(connectionstring, config)
  }
  else if (DBEngineType === 'postgres') {
    var config = {
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false
        }
      },
      pool: {
        max: 2,
        min: 2,
        idle: 10000,
        acquire: 60000
      }
    }
    var sequelize = new Sequelize(connectionstring, config)
    sequelize.options.logging = false // Disable logging
  }
  else {
    var config = {
      pool: {
        max: 2,
        min: 0,
        idle: 5000,
        acquire: 30000
      }
    }
    var sequelize = new Sequelize(connectionstring, config)
    sequelize.options.logging = false // Disable logging
  }

  sequelize.authenticate()

  return sequelize
}

function DatatoSchemaTransformation (s3results, SelectedModel, S3SelectParameter, DBEngineType, type, header) {
  if (type === 'JSON') {
    var finalarray = convertdatatosqlschema(s3results, SelectedModel, DBEngineType)
  }
  else if (type === 'CSV' && header === true) {
    var finalarray = convertdatatosqlschema(s3results, SelectedModel, DBEngineType)
  }
  else if (type === 'CSV' && header === false) {
    var intermediatearray = []
    const headers = Object.keys(SelectedModel)

    _.forEach(s3results, onefile => {
      const temparray = []
      let entries = []
      entries = onefile.split(S3SelectParameter.OutputSerialization.CSV.RecordDelimiter)

      for (let i = 0; i < entries.length; i++) {
        if (S3SelectParameter.OutputSerialization.CSV.FieldDelimiter === ' ') {
          var oneentry = entries[i].match(/(?:[^\s"]+|"[^"]*")+/g)
        }
        else {
          var oneentry = entries[i].split(S3SelectParameter.OutputSerialization.CSV.FieldDelimiter)
        }

        if (oneentry !== '' && oneentry !== null) {
          oneentry = oneentry.map(oe => {
            if (oe.match(/^".*"$/)) {
              oe = oe.substring(1, oe.length - 1) // remove starting " and ending " charchters...
            }
            return oe
          })
          temparray.push(_.zipObject(headers, oneentry))
        } // if oneentry not empty
      } // for i entries
      intermediatearray.push(temparray)
    })
    var intermediatearray = _.compact(_.flatten(intermediatearray))
    // debug dump location 1:
    // fs.writeFileSync(fileURLToPath("file:///C:\\...path...\\intermediatearray.json"), JSON.stringify(intermediatearray))
    var finalarray = convertdatatosqlschema(intermediatearray, SelectedModel, DBEngineType)
    // debug dump location 2:
    // fs.writeFileSync(fileURLToPath("file:///C:\\...path...\\finalarray.json"), JSON.stringify(finalarray))
  }
  else {
    console.log('Parquet filetype not yet supported')
  }

  return finalarray
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function deleteSQSMessage (sqsclient, QueueURL, ReceiptHandles, rdsinsertsuccess) {
  const promises = ReceiptHandles.map(ReceiptHandle => {
    const deleteParams = {
      QueueUrl: QueueURL,
      ReceiptHandle
    }

    if (rdsinsertsuccess) {
      const command = new DeleteMessageCommand(deleteParams)
      try {
        const response = sqsclient.send(command)
        console.log('Message Deleted:', JSON.stringify(response))
      }
      catch (e) {
        const response = e
        console.error('Error:', JSON.stringify(response))
      }
    }
    else {
      console.log('Database insert of the contents of the message failed not deleting sqs message')
    }
  }) // prefixarray.map

  await Promise.all(promises)
}

function convertdatatosqlschema (s3results, SelectedModel, DBEngineType) {
  const array = []
  const themodel = SelectedModel
  _.forEach(s3results, existingentry => {
    for (const Modelskey in SelectedModel) {
      let value = existingentry[Modelskey]
      const type = (themodel[Modelskey]).type.key
      if ((DBEngineType === 'mssql') && (typeof (value) === 'object')) {
        // convert data from json to string as mssql does not have JSON datatype
        // https://sequelize.org/master/manual/other-data-types.html#mssql
        try {
          value = JSON.stringify(value)
        }
        catch (error) {
          console.log('Could not stringify json')
          console.log(JSON.stringify(error))
          value = 'error processingfield'
        }
        existingentry[Modelskey] = value
      }
      else if ((type === 'INTEGER' || type === 'BIGINT') && (value !== undefined)) {
        // convert non number value such as '-' to NULL
        // Note value can be undefined if the processed file does not contain same number of fields as schema example "ELBAccessLogTestFile" vs generic ELB AccessLogs
        if (value === null || value === "null" || value === "NULL"){
          value = null
          existingentry[Modelskey] = value
        }
        else {
          try {
            value = parseInt(value)
          }
          catch (err) {
            console.log('The key: \n' + Modelskey + '\nThe Value: \n' + value + '\nThe error: \n' + err)
          };
          existingentry[Modelskey] = value
        }
      }
      else if ((type === 'STRING' ) &&  (typeof (value) === 'string') && (value.includes('\r\n'))) {
        //line breaks mess up formating of the insert strings so we remove them. 
        //But only if its string (value !== null) && (typeof (value) !== 'object') <json> and has linebreak charachters.
        existingentry[Modelskey] = value.replaceAll('\r\n'," ")
      }
      else if (value === null || value === 'null' || value === "NULL" || value === undefined) {
        value = null
        existingentry[Modelskey] = value
      }
      else if ((type === 'STRING' ) &&  (typeof (value) === 'object') && (value.length === 0)) {
        //Empty array fails for postgres: 
        //https://github.com/sequelize/sequelize/issues/714
        existingentry[Modelskey] = ""
      }

    }
    array.push(existingentry)
  })
  return array
}

function convertrawdata (plainstring) {
  // eslint-disable-next-line no-useless-escape
  plainstring = plainstring.replace(/\,$/, '')
  // Add into JSON 'array'
  plainstring = `[${plainstring}]`
  try {
    const JSONobject = JSON.parse(plainstring)
    var result = {
      Result: 'PASS',
      Data: JSONobject
    } // encapsulating state of data to PASS/FAIL JSON object.
  }
  catch (e) {
    console.log(e)
    var result = {
      Result: 'Fail',
      Data: e
    }
  }

  return result
}

async function initialseparameters (commonshared, Schema, QueryType, DBFrendlyName, ssmclient, GetParameterCommand, ddclient, PutItemCommand) {
  if (Schema === '') {
    // It only retrieves schema parameter if the client context does not have it. Which happenes if the schema is big + query is big so the
    // total client context is close to or more than 3583bytes.https://docs.aws.amazon.com/lambda/latest/dg/API_Invoke.html#API_Invoke_RequestSyntax

    var [DBPassword, SchemaObject] = await Promise.all([
      commonshared.getssmparameter(ssmclient, GetParameterCommand, {
        Name: '/Logverz/Database/DefaultDBPassword',
        WithDecryption: true
      }, ddclient, PutItemCommand),
      commonshared.getssmparameter(ssmclient, GetParameterCommand, {
        Name: ('/Logverz/Engine/Schemas/' + QueryType)
      }, ddclient, PutItemCommand)
    ])
    const SchemaArray = JSON.parse(SchemaObject.Parameter.Value).Schema
    var Schema = ('{' + SchemaArray.map(e => e + '\n') + '}').replace(/,'/g, '"').replace(/'/g, '"') // TODO add engineshared.convertschema()

    var result = {
      Schema,
      Password: DBPassword.Parameter.Value
    }
  }
  else {
    var DBPassword = await commonshared.getssmparameter(ssmclient, GetParameterCommand, {
      Name: `/Logverz/Database/${DBFrendlyName}Password`,
      WithDecryption: true
    }, ddclient, PutItemCommand)

    var result = {
      Schema,
      Password: DBPassword.Parameter.Value
    }
  }

  return result
}

async function UpdateSqlEntry (sequelize, Model, SelectedModel, QueryType, DBTableName, updatedfields, conditions) {
 
    class DBEntry extends Model {}
    await DBEntry.init(SelectedModel, {
      sequelize,
      modelName: QueryType,
      tableName: DBTableName,
      freezeTableName: true
    })

    var result = await DBEntry.update(updatedfields, conditions)
    console.log('SQL Entry ' + JSON.stringify(result) + 'has been updated.')

}

async function AddSqlEntry(sequelize, Model, SelectedModel, QueryType, DBTableName, mydata) {

  class DBEntry extends Model {}
  await DBEntry.init(SelectedModel, {
    sequelize,
    modelName: QueryType,
    tableName: DBTableName,
    freezeTableName: true
  })

  var result
  try{
    var response = await DBEntry.create(mydata)
    result={
      Result: 'PASS',
      Data: response
    }
  }
  catch(err){
    result={
      Result: 'Fail',
      Data: err
    }
  }

  return result
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

  // Testing setup: After initiate connection, before loop:
  // var prefixarray=[
  //     [
  //       "key",
  //       "bucket",
  //       "region"
  //     ],
  //     [
  //       "key",
  //       "bucket",
  //       "region"
  //     ]
  // ]
  // var s3results = await processS3data(prefixarray, S3SelectQuery, S3SelectParameter, context, DBEngineType, engineshared, commonshared, ddclient, sequelize, Model, type, header)
  // var Transformeddata = DatatoSchemaTransformation(s3results, SelectedModel, S3SelectParameter, DBEngineType, type, header)
  // await InsertData(commonshared, sequelize, Model, SelectedModel, QueryType, DBTableName, Transformeddata, DebugInsert, EngineBucket, region, FileName)
  // await timeout(2000)
