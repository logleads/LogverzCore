/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

import { performance } from 'perf_hooks'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import loki from 'lokijs'
// import https from 'https'
// import { NodeHttpHandler } from '@smithy/node-http-handler'
import { sdkStreamMixin } from '@smithy/util-stream'
import _ from 'lodash'
import pkg from 'tasktimer'
//import * as fflate from 'fflate'

import yauzl from 'yauzl'
import pako from 'pako'

import Papa from 'papaparse';

import { Sequelize, QueryTypes } from 'sequelize'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'


const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const { TaskTimer } = pkg

let rdsinsertsuccess = false
let t0
let sqsempty = 0
let MaximumCacheTime = process.env.MaximumCacheTime

if (typeof db === 'undefined') {
  // the variable is defined
  var db = new loki('db.json', {
    autoupdate: true
  })
}

if (db.collections.length === 0) {
  if (MaximumCacheTime === undefined) {
    MaximumCacheTime = 1
  }
  var i = 0
  
  var DBpasswordsCache = db.addCollection('Logverz-DBPasswords', {
    ttl: MaximumCacheTime * 60 * 1000
  })

  var SchemasCache = db.addCollection('Logverz-Schemas', {
    ttl: MaximumCacheTime * 60 * 1000
  })

  var ExecParamsCache = db.addCollection('Logverz-ExecParams', {
    ttl: 3 * 60 * 1000 //up to 3 min 
  })

  var DBparamsCache = db.addCollection('Logverz-DBparams', {
    ttl: MaximumCacheTime * 60 * 1000
  })

}

const sqsclient = new SQSClient({})
const ssmclient = new SSMClient({})
const ddclient = new DynamoDBClient({})

/*
Function logic: 
1) download data from referenced url.

2) determine if data is zipped or not, unzip if needed. 

3) check if there is any where condition in the query
   a) if no: 
    Than do data to schema conversion using destination db constraints  
   insert directly to destination db. 

   b) if yes:
    Than do data to schema conversion using sqlite db constraints  
    insert data to sqlite and run users's query 
    use the outcome- result and insert it to destination db.

4) delete sqs message 

*/
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
    var transformconfigpath= ('file:///' + path.join('tmp', 'transformconfig.js').replace(/\\/g, '/'))
    var TestingTimeout = process.env.TestingTimeout
    var DebugInsert = process.env.DebugInsert
    var EngineBucket = process.env.EngineBucket
    var TransformsModule= '' //placeholder
    console.log('REQUEST RECEIVED: ' + JSON.stringify(context))
    console.log('THE EVENT: \n' + JSON.stringify(event) + '\n\n')
  }
  else {
    // Dev environment settings
    var directory = path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'worker', 'mydev.mjs')
    const mydev = await import('file:///' + directory.replace(/\\/g, '/'))
    var engineshared = mydev.engineshared
    var commonshared = mydev.commonshared
    var region = mydev.region
    var FileName = mydev.FileName
    var transformconfigpath= mydev.transformconfigpath
    var context = mydev.context
    var event = mydev.event
    var TestingTimeout = mydev.TestingTimeout
    var DebugInsert = mydev.DebugInsert
    var EngineBucket = mydev.EngineBucket
    var TransformsModule= mydev.TransformsModule
  }

  let executiontype
  let DBFrendlyName
  let DBPassword
  let DBTableName
  let Schema
  let DataType
  let DBAvalue
  let QueryString
  let StgSelectParameter
  let QueueURL
  let jobid
  let invocationid
  let TransformConfig

  if (context.clientContext === undefined){
    executiontype="sqs"
    let eventSourceARN=event.Records[0].eventSourceARN
    let executionhistorykey="/Logverz/Engine/ExecutionHistory/"+eventSourceARN.split(':')[5].replace('Logverz_','')
    DBFrendlyName= executionhistorykey.split('_')[0].split('/')[4]
    DataType=executionhistorykey.split('_')[executionhistorykey.split('_').length-2]
    QueueURL=eventSourceARN.replaceAll(':','/').replace('arn/aws/sqs/','https://sqs').replace(region,'.'+region+'.amazonaws.com')
    jobid = 'ContinousCollection'
    invocationid =eventSourceARN.split(':')[5]
    //https://sqs
    //check here in cache if not there than download in parallel.
    await InitialseCCparameters(commonshared, executionhistorykey, DBFrendlyName, DBPassword, DataType, Schema, DBAvalue)

    DBPassword = DBpasswordsCache.chain().find({
      Name: DBFrendlyName
    }).collection.data[0].Value

    Schema = SchemasCache.chain().find({
      Name: DataType
    }).collection.data[0].Value

    DBAvalue = DBparamsCache.chain().find({
      Name: 'Registry'
    }).collection.data[0].Value.split(',') 

    let ExecutionHistory= ExecParamsCache.chain().find({
      Name: executionhistorykey
    }).collection.data[0].Value

    QueryString= ExecutionHistory.split('\n').filter(s => s.includes('QueryString'))[0].split(':')[1].replace(';','')
    DBTableName= ExecutionHistory.split('\n').filter(s => s.includes('TableParameters'))[0].replace('TableParameters:','').split('<!!>').filter(f => f.includes('TableName'))[0].split('=')[1]
    StgSelectParameter=JSON.parse(Schema).StgSelectParameters.IO
    TransformConfig = JSON.parse(Schema).TransformConfig

    let convertedschema=""
    JSON.parse(Schema).Schema.map(s => convertedschema+=s.replace(/'/g, '"').replace(/,/g, ',\n'))
    Schema ='{'+convertedschema+'}'

  }
  else{
    executiontype="controller"
    DBAvalue = context.clientContext.DatabaseParameters.split('<!!>')
    DataType = context.clientContext.DataType
    QueueURL = context.clientContext.QueueURL
    Schema = context.clientContext.Schema
    QueryString = context.clientContext.QueryString
    StgSelectParameter = JSON.parse(context.clientContext.StgSelectParameter.replace('\n','\\n').replace('"""','"\\""')) // replace linebreak with escpaed linebreak and """ with escaped version "\""
    TransformConfig = JSON.parse(context.clientContext.TransformConfig)
    DBFrendlyName = DBAvalue.filter(s => s.includes('LogverzDBFriendlyName'))[0].split('=')[1]
    DBTableName = context.clientContext.DBTableName
    jobid = context.clientContext.jobid
    invocationid = context.clientContext.invocationid
    const initialparameters = await initialseparameters(commonshared, Schema, DataType, DBFrendlyName, ssmclient, GetParameterCommand, ddclient, PutItemCommand)
    Schema = initialparameters.Schema
    DBPassword = initialparameters.Password

  }

  //shared parameters. 
  let DBEngineType = DBAvalue.filter(s => s.includes('LogverzEngineType'))[0].split('=')[1]
  DBEngineType = (DBEngineType.match('sqlserver-') ? 'mssql' : DBEngineType)
  const DBUserName = DBAvalue.filter(s => s.includes('LogverzDBUserName'))[0].split('=')[1] // "LogverzAdmin"
  const DBEndpointName = DBAvalue.filter(s => s.includes('LogverzDBEndpointName'))[0].split('=')[1]
  const DBEndpointPort = DBAvalue.filter(s => s.includes('LogverzDBEndpointPort'))[0].split('=')[1]
  const DBName = 'Logverz'
  const Model = Sequelize.Model

  fs.writeFileSync(fileURLToPath(FileName), engineshared.constructmodel(Schema, 'worker'))
  var SelectedModel = (await import(FileName)).SelectedModel

  const connectionstring = `${DBEngineType}://${DBUserName}:${DBPassword}@${DBEndpointName}:${DBEndpointPort}/${DBName}`

  try {
    var sequelize = await InitiateConnection(DBEngineType, connectionstring)
    console.log('\nSQL Server Connection has been established successfully.')
  }
  catch (e) {
    console.log('Error establishing SQL Server connection. Further details: \n')
    console.error(e)
    process.exit()
  }

  t0 = performance.now()

  if (executiontype === "controller") {
    await StartLambdastate(commonshared, ddclient, sequelize, Model, engineshared.InvocationsModel, jobid, invocationid)
    const timer = new TaskTimer(5000)
    timer.on('tick', async () => {
      await UpdateLambdaState(context, sequelize, Model, engineshared, invocationid) 
    })
    timer.start()
    
    
    await loop(sqsclient, sequelize, event, context, TestingTimeout, engineshared, commonshared, ddclient, StgSelectParameter, DataType, QueueURL, QueryString, Model, SelectedModel, DBTableName, DBEngineType,DebugInsert,EngineBucket, region, FileName, executiontype, invocationid, transformconfigpath)

    timer.stop()
  }
  else{
    //Continous collection
    const t1 = performance.now()
    await Task(sqsclient, engineshared, commonshared, ddclient, StgSelectParameter, DataType, QueueURL, QueryString, sequelize, Model, SelectedModel, DBTableName, DBEngineType, context, event, DebugInsert, EngineBucket, region, FileName, executiontype, transformconfigpath)
    const t2 = performance.now()
    const processingtime = (t2 - t1)
    const ellipsedtime = (t2 - t0)
    console.log('ellipsedtime ' + ellipsedtime)
    i = i + 1
    console.log('Lambda instance :' + invocationid + ' @ iteration ' + i + ' had processing time ' + (processingtime / 1000) + ' second(s).')
  }

  return {
    statusCode: 200,
    body: {}
  }
} // module exports

async function filterdata(filearray, QueryString, commonshared, sequelize, Model, SelectedModel, DataType, DBEngineType, DBTableName, DebugInsert, EngineBucket, region, FileName, TransformsModule, transformconfigpath){
    
    if(QueryString.toLowerCase().includes('where') ){
      
      console.log('got where')
      //troubleshoot data processing issues with presistent storage option
      //let newfilefullname=FileName.replace("SelectedModel.mjs",'test.db')
      const sequelizelocal = new Sequelize({
        dialect: 'sqlite',
        storage: ':memory:'
        //storage: fileURLToPath(newfilefullname)
      })

      //Creating in memory sqlite database table for local querying
      await createTempTable(sequelizelocal, Model, SelectedModel, DataType, DBTableName)

      //inserting data to in memory sqlite database for local querying
      await InsertData(commonshared, sequelizelocal, Model, SelectedModel, DataType, DBTableName, filearray, DebugInsert, EngineBucket, region, FileName)

      const matchingresult = await sequelizelocal.query(QueryString , {
        type: QueryTypes.SELECT,
      })

      convertdatatosqlschema(matchingresult, SelectedModel, 'sqlite')
      convertdatatosqlschema(matchingresult, SelectedModel, DBEngineType)
      
      //inserting the matching converted data to the destination db
      if (matchingresult.length !== 0){
        rdsinsertsuccess=await InsertData(commonshared, sequelize, Model, SelectedModel, DataType, DBTableName, matchingresult, DebugInsert, EngineBucket, region, FileName)
        return rdsinsertsuccess
      } 
    }
    else{
      console.log('not where')
      //testing
      //let result =await TransformsModule.transformdata(filearray, transformconfigpath)

      convertdatatosqlschema(filearray, SelectedModel, DBEngineType)
      //inserting the matching converted data to the destination db
      if (filearray.length !== 0){
        //just for local testing... not needed in production setup.
        //await createTempTable(sequelize, Model, SelectedModel, DataType, DBTableName)

        rdsinsertsuccess=await InsertData(commonshared, sequelize, Model, SelectedModel, DataType, DBTableName, filearray, DebugInsert, EngineBucket, region, FileName)
        return rdsinsertsuccess
      }
    }

}

async function createTempTable(sequelize, Model, SelectedModel, DataType, DBTableName){

  class Entry extends Model {}
  await Entry.init(SelectedModel, {
    sequelize,
    modelName: DataType,
    tableName: DBTableName,
    freezeTableName: true
  })
 sequelize.options.logging = false
  await sequelize.sync({force: true})

}

async function loaddata(prefixarray){

  const data= await loadfroms3(prefixarray)
  
  return data
}

async function loadfroms3(prefixarray){
  
  const promises=[]
  const t0 = performance.now();
  prefixarray.map(prefix => {
      
      promises.push(
        new Promise(async (resolve, reject) => {
          const region = prefix[2]
          const s3client = new S3Client({ region })
          const Body  = s3client.send(
            new GetObjectCommand({
              Bucket: prefix[1],
              Key:  prefix[0],
            })
          )
        resolve(Body)
      }))
  })
          
  const resolved = await Promise.all(promises)
  console.log('Finished retriving ' + promises.length + ' file')
  const t1 = performance.now();
  console.log("Took " + (t1 - t0).toFixed(2) + " milliseconds.");
  return resolved
}

async function preprocessdata(bytestreamarray, StgSelectParameter, sequelize, SelectedModel, Model, engineshared, DBEngineType, ddclient, context ){
  
  const t0 = performance.now();

  const promises=[]
  bytestreamarray.map(bytestream => {
    promises.push(preprocesss3data(bytestream, StgSelectParameter, sequelize, SelectedModel, Model, engineshared, DBEngineType, ddclient, context ))
  }) 

  const resolved = await Promise.all(promises)

  let results = _.compact(_.flatten(resolved))

  if ((results.length != 0) &&(StgSelectParameter.InputSerialization.RootElement !== undefined) && (typeof results[0][StgSelectParameter.InputSerialization.RootElement] === 'object')) {
    // its a list of elements
    const combined = []
    results.map(r => combined.push(r[StgSelectParameter.InputSerialization.RootElement]))
    results = _.flatten(combined)
  }
  else{
    
  }

  console.log('Finished preprocessing  ' + bytestreamarray.length + ' file')
  const t1 = performance.now();
  console.log("Took " + (t1 - t0).toFixed(2) + " milliseconds.");
  return results
}

async function preprocesss3data(bytestream, StgSelectParameter, sequelize, SelectedModel, Model, engineshared, DBEngineType, ddclient, context ){

  const filename = bytestream.Body.req.path.split('?')[0]
  const body = await sdkStreamMixin(bytestream.Body).transformToByteArray()
  
  //just for local testing not needed in production setup.
  //const body = fs.readFileSync('./sources/worker/build/file.log.gz',{ flag: 'r' })

  if (bytestream.ContentType  ===  "application/x-zip-compressed" || bytestream.ContentType === 'application/zip' || StgSelectParameter.InputSerialization.Compression ==='ZIP'){
    var strData = await unzipdata(body, filename, sequelize, Model, engineshared, DBEngineType, ddclient, context,'ZIP')
    //remove starting and ending linebreaks from text (messes up csv operations)
    if (strData !==undefined){

      try{
      strData = strData.replace(/^\s+|\s+$/g, '');
      } 
      catch(error){
        console.log(error)
      }
    }
    else{
      console.log("error unzipping: " + filename)
      return ''
    }

    var processeddata = handle_processing(bytestream,StgSelectParameter,strData,SelectedModel )
    return processeddata
  }
  else if (bytestream.ContentEncoding === 'gzip' || StgSelectParameter.InputSerialization.Compression ==='GZIP'){
      //Compressed files either content encoding is set or the schema specifies GZIP
    var strData = await unzipdata(body, filename, sequelize, Model, engineshared, DBEngineType, ddclient, context,'GZIP')
    //remove starting and ending linebreaks from text (messes up csv operations)
    if (strData !==undefined){

      try{
      strData = strData.replace(/^\s+|\s+$/g, '');
      } 
      catch(error){
        console.log(error)
      }
    }
    else{
      console.log("error unzipping: " + filename)
      return ''
    }

    var processeddata = handle_processing(bytestream,StgSelectParameter,strData,SelectedModel )
    return processeddata
  }
  else{
  //Non compressed file
    var processeddata
    let  strData = new TextDecoder().decode(body)
    //remove starting and ending linebreaks from text (messes up csv operations)
    if (strData !==undefined){

      try{
      strData = strData.replace(/^\s+|\s+$/g, '');
      } 
      catch(error){
        console.log(error)
      }
    }
    else{
      console.log("error processing: " + filename)
      return ''
    }

    var processeddata = handle_processing(bytestream,StgSelectParameter,strData,SelectedModel )
    return processeddata

  }
 
}

function handle_processing(bytestream,StgSelectParameter,strData,SelectedModel ){
  var processeddata

    if ((bytestream.ContentType ==='application/json'|| StgSelectParameter.InputSerialization.JsonType !== undefined) && strData !== undefined){
      // Convert to Object
      processeddata = JSON.parse(strData)
      return processeddata
    }
    else if (strData !== undefined && StgSelectParameter.InputSerialization.CSV.FileHeaderInfo !== false){
      // Convert to Object
      let papaconfig=createpapaconfig(StgSelectParameter)
      let processeddata =Papa.parse(strData,papaconfig).data

      return processeddata
    }
    else{
      //The text file does not have a header row so we need to combine the header information from the schema with the data from the file.
      //console.log('at csv without header')
      let processeddata = []
      const headers = Object.keys(SelectedModel)

      let papaconfig=createpapaconfig(StgSelectParameter)
      var intermedatedata =Papa.parse(strData,papaconfig)
  
      for (let i = 0; i < intermedatedata.data.length; i++) {
        
        let oneentry =intermedatedata.data[i]
        if (intermedatedata.data[i].length > 1 && oneentry !== '' && oneentry !== null ) {
          processeddata.push(_.zipObject(headers, oneentry))
        } // if oneentry not empty
      } // for i entries
     
      return processeddata
    }

}

function createpapaconfig(StgSelectParameter){

  let config={}
  if(StgSelectParameter.InputSerialization.CSV.FieldDelimiter !== undefined){
    config['delimiter'] =StgSelectParameter.InputSerialization.CSV.FieldDelimiter
  }

  if(StgSelectParameter.InputSerialization.CSV.RecordDelimiter !== undefined){
    config['newline'] =StgSelectParameter.InputSerialization.CSV.RecordDelimiter
  }

  if(StgSelectParameter.InputSerialization.CSV.QuoteCharacter !== undefined){
    config['quoteChar'] =StgSelectParameter.InputSerialization.CSV.QuoteCharacter
  }
  
  if(StgSelectParameter.InputSerialization.CSV.FileHeaderInfo !== undefined && StgSelectParameter.InputSerialization.CSV.FileHeaderInfo == 'USE'){
    config['header'] =StgSelectParameter.InputSerialization.CSV.FileHeaderInfo
  }

  return config
}

async function unzipdata(body, filename, sequelize, Model, engineshared, DBEngineType, ddclient, context, type ){
  
  try{
    if ( type === "GZIP"){
      //https://github.com/nodeca/pako/issues/236 and ..139
      const string= pako.inflate(new Uint8Array(body), { to: 'string', chunkSize: 1024*1024 })
      // const decompressed = fflate.decompressSync(body) // const string = new TextDecoder().decode(decompressed)
      //fflate did not work, for the reason mentioned above, possible solution at: https://github.com/101arrowz/fflate/issues/46
      if(string.length < body.length) {
        console.log("\n probable issue with decompressing " + filename +" the uncompressed bit stream length is smaller than the original.")
      }
      return string
    }
    else if (type === "ZIP"){
      
      const object = await unzipToVariable(Buffer.from(body))
      let key=Object.keys(object)
      if (key.length > 1){

        console.log('\n\n Error multiple files per zip archive is not supported!\nUse zip archives with single file in them!')
        //TODO handle multiple files in one zip case
       
      }
      else{
        let string =object[key]
        return string
      }
    }

  }
  catch(error){
    const mydata = {
      jobid: context.clientContext.jobid,
      invocationid: context.clientContext.invocationid,
      updateunixtime: Date.now(),
      path: 'worker.js:unzipdata',
      loggroup: context.logGroupName,
      logstream: context.logStreamName,
      errormessage: 'Error processing '+ filename +' '+ error.message
    }

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

// Function to extract ZIP contents and return them in a variable
async function unzipToVariable(buffer) {
  return new Promise((resolve, reject) => {
    const files = {}; // Object to store file contents

    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);

      zipfile.readEntry();

      zipfile.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName)) {
          // Directory; skip it
          zipfile.readEntry();
        } else {
          // File
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) return reject(err);

            const chunks = [];
            readStream.on("data", (chunk) => chunks.push(chunk));
            readStream.on("end", () => {
              files[entry.fileName] = Buffer.concat(chunks).toString(); // Convert Buffer to string
              zipfile.readEntry();
            });
          });
        }
      });

      zipfile.on("end", () => resolve(files));
    });
  });
}


async function loop (sqsclient, sequelize, event, context, TestingTimeout, engineshared, commonshared, ddclient, StgSelectParameter, DataType, QueueURL, QueryString, Model, SelectedModel, DBTableName, DBEngineType, DebugInsert, EngineBucket, region, FileName, executiontype, invocationid, transformconfigpath) {
  
  var i = 0

  try {
    let exitcondition = false
    do {
      if (TestingTimeout > 0) {
        console.log('testing timeout of: ' + TestingTimeout / 1000 + ' seconds where applied.')
        await timeout(TestingTimeout) // for testing log running lambdas
      }
      const t1 = performance.now()
      await Task(sqsclient, engineshared, commonshared, ddclient, StgSelectParameter, DataType, QueueURL, QueryString, sequelize, Model, SelectedModel, DBTableName, DBEngineType, context, event, DebugInsert, EngineBucket, region, FileName, executiontype, transformconfigpath)
      const t2 = performance.now()
      const processingtime = (t2 - t1)
      const ellipsedtime = (t2 - t0)
      console.log('ellipsedtime ' + ellipsedtime)
      i = i + 1
      console.log('Lambda instance :' + invocationid + ' @ iteration ' + i + ' had processing time ' + (processingtime / 1000) + ' second(s).')

      if (process.env.Environment === 'Windows') { // for local test environment
        var remainingtime = context.getRemainingTimeInMillis() - ellipsedtime
      }
      else {
        var remainingtime = context.getRemainingTimeInMillis()
      }

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
    if (err.message != "ConnectionManager.getConnection was called after the connection manager was closed!"){
    console.log(err)
    }
  }

  console.log(`Reporting state of instance ${invocationid} at ${new Date().toLocaleString()} : COMPLETED`)
}

async function Task(sqsclient, engineshared, commonshared, ddclient, StgSelectParameter, DataType, QueueURL, QueryString, sequelize, Model, SelectedModel, DBTableName, DBEngineType, context, event, DebugInsert, EngineBucket, region, FileName, executiontype, transformconfigpath) {
  
  let sqsmessages
  var dataexists =false
  if(executiontype === "controller"){
    sqsmessages = await commonshared.receiveSQSMessage(sqsclient, ReceiveMessageCommand, QueueURL, '1')
    if (sqsmessages.Messages !== undefined) {
      try {
        var prefixarray = _.flatten(sqsmessages.Messages.map(msg => JSON.parse(msg.Body)))
        var ReceiptHandle = sqsmessages.Messages.map(msg => msg.ReceiptHandle)
        dataexists =true
      }
      catch (e) {
        console.log('Error parsing Message retrieved from SQS. Further details: \n')
        console.error(e)
        process.exit()
      }
    }  
  }
  else{
    //executiontype==="sqs"
    sqsmessages = parseevent4sqsmessages(event, QueueURL)
    if (sqsmessages !== undefined){
      try {
        var prefixarray = sqsmessages.map(msg => [msg.key,msg.bucket,msg.region])
        var ReceiptHandle = sqsmessages.map(msg => msg.receiptHandle)
        dataexists =true
      }
      catch (e) {
        console.log('Error parsing Message retrieved from automatic sqs invocation event. Further details: \n')
        console.error(e)
        process.exit()
      }
    }
  }

  if (dataexists) {

    const bytestream = await loaddata(prefixarray)
    const filearray = await preprocessdata(bytestream, StgSelectParameter, sequelize, SelectedModel, Model, engineshared, DBEngineType, ddclient, context )
    const rdsinsertsuccess = await filterdata(filearray, QueryString, commonshared, sequelize, Model, SelectedModel, DataType, DBEngineType, DBTableName, DebugInsert, EngineBucket, region, FileName, TransformsModule, transformconfigpath)
    await deleteSQSMessage(sqsclient, QueueURL, ReceiptHandle, rdsinsertsuccess)

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

async function StartLambdastate(commonshared, ddclient,sequelize, Model, InvocationsModel, jobid, invocationid){
  const mydata = {
    jobid,
    invocationid,
    status: 'INVOKED',
    updateunixtime: Date.now()
  }

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

async function UpdateLambdaState(context, sequelize, Model, engineshared, invocationid)    {
  console.log(`Reporting state of instance ${invocationid} at ${new Date().toLocaleString()} : RUNNING`)

  const updatedfields = {

    status: 'RUNNING',
    updateunixtime: Date.now(),
    loggroup: context.logGroupName,
    logstream: context.logStreamName
  }
  const conditions = {
    where: {
      invocationid: invocationid
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

async function InsertData (commonshared, sequelize, Model, SelectedModel, DataType, DBTableName, Transformeddata, DebugInsert, EngineBucket, region, FileName) {
  
  class Entry extends Model {}
  await Entry.init(SelectedModel, {
    sequelize,
    modelName: DataType,
    tableName: DBTableName,
    freezeTableName: true
  })

  var insertsuccess
  const t = await sequelize.transaction();

  try {
    await Entry.bulkCreate(Transformeddata, {
      transaction: t 
    })
    
    await t.commit();
    insertsuccess = true
    console.log('SQL Server BulkEntry  has been completed successfully. Number of rows: ' + Transformeddata.length)
    
    return insertsuccess

  } catch (err) {
    console.log(err.message, "\nline: ",err.original.line)
    if (DebugInsert === 1){

      let filenamepart=Date.now() /1000+"_error.sql"
      let newfilefullname=FileName.replace("SelectedModel.mjs",filenamepart)
      fs.writeFileSync(fileURLToPath(newfilefullname), err.sql)
      const s3client = new S3Client({region})
      console.log('Starting SQL commands debug file upload')
      await commonshared.s3putdependencies(newfilefullname, EngineBucket, s3client, PutObjectCommand, fs, fileURLToPath, 'DebugInsert/'+filenamepart)
      
      insertsuccess = false
          // Transaction has been rolled back
          // err is whatever rejected the promise chain returned to the transaction callback
      await t.rollback()
      return  insertsuccess
    }
    else{
      insertsuccess = false
      // Transaction has been rolled back
      // err is whatever rejected the promise chain returned to the transaction callback
      await t.rollback()
      return   insertsuccess
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

      if((DBEngineType === 'sqlite') && (type === 'JSON')) {
         // convert data from string to json as sequalise v6 query of json datatype returns a string simmilar to:
        // https://sequelize.org/master/manual/other-data-types.html#mssql
        try {
          value = JSON.parse(value)
        }
        catch (error) {
          console.log('Could not parse json')
          console.log(JSON.stringify(error))
          value = 'error processingfield'
        }
        existingentry[Modelskey] = value
      }
      else if ((DBEngineType === 'mssql') && (typeof (value) === 'object')) {
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
      else if (value === null || value === 'null' || value === "NULL" || value === undefined) {
        value = null
        existingentry[Modelskey] = value
      }
      else if ((type === 'INTEGER' || type === 'BIGINT') && (value !== undefined)) {
        // convert non number value such as '-' to NULL
        // Note value can be undefined if the processed file does not contain same number of fields as schema example "ELBAccessLogTestFile" vs generic ELB AccessLogs
        if (value === "-" || value === ""){
          value = null
          existingentry[Modelskey] = value
        }
        else {
          try {
            value = parseInt(value)
          }
          catch (err) {
            console.log('The key: \n' + Modelskey + '\nThe Value: \n' + value + '\nThe error: \n' + err)
            console.log(JSON.stringify(existingentry))
          };
          existingentry[Modelskey] = value
        }
      }
      else if ( type === 'BOOLEAN') {
        if (value.toLowerCase().indexOf('true')){
          value = true
          existingentry[Modelskey] = value
        }
        else if(value.toLowerCase().indexOf('false')){
          value = false
          existingentry[Modelskey] = value
        }
      }
      else if (type === 'DOUBLE PRECISION' || type === 'FLOAT') {

        if (value === "-" || value === ""){
          value = null
          existingentry[Modelskey] = value
        }
        else{
          try {
            value = parseFloat(value)
          }
          catch (err) {
            console.log('The key: \n' + Modelskey + '\nThe Value: \n' + value + '\nThe error: \n' + err)
            console.log(JSON.stringify(existingentry))
          };
          existingentry[Modelskey] = value
        }
      }
      else if ((type === 'STRING' ) &&  (typeof (value) === 'string') && (value.includes('\r\n'))) {
        //line breaks mess up formating of the insert strings so we remove them. 
        //But only if its string (value !== null) && (typeof (value) !== 'object') <json> and has linebreak charachters.
        existingentry[Modelskey] = value.replaceAll('\r\n'," ")
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

async function initialseparameters (commonshared, Schema, DataType, DBFrendlyName, ssmclient, GetParameterCommand, ddclient, PutItemCommand) {
  //Function is for classic collection paramters initialisation 
  if (Schema === '') {
    // It only retrieves schema parameter if the client context does not have it. Which happenes if the schema is big + query is big so the
    // total client context is close to or more than 3583bytes.https://docs.aws.amazon.com/lambda/latest/dg/API_Invoke.html#API_Invoke_RequestSyntax

    var [DBPassword, SchemaObject] = await Promise.all([
      commonshared.getssmparameter(ssmclient, GetParameterCommand, {
        Name: `/Logverz/Database/${DBFrendlyName}Password`,
        WithDecryption: true
      }, ddclient, PutItemCommand),
      commonshared.getssmparameter(ssmclient, GetParameterCommand, {
        Name: ('/Logverz/Engine/Schemas/' + DataType)
      }, ddclient, PutItemCommand)
    ])
    const SchemaArray = JSON.parse(SchemaObject.Parameter.Value).Schema
    var Schema = ('{' + SchemaArray.map(e => e + '\n') + '}').replace(/,'/g, '"').replace(/'/g, '"') 
    // TODO investigate if adding engineshared.convertschema() is needed or not.

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

async function InitialseCCparameters(commonshared, executionhistorykey, DBFrendlyName, DBPassword, DataType, Schema, DBAvalue){
  //Function is for continous collection parameters initialisation, it checks multipleparameters if those are in the cache
  //than parallel conditionally executes the retrieval of missing parameter(s).

  //checking cache to validate if value is available locally or not 
  DBPassword = DBpasswordsCache.chain().find({
    Name: DBFrendlyName
  }).collection.data[0] 

  let ExecutionHistory= ExecParamsCache.chain().find({
    Name: executionhistorykey
  }).collection.data[0] 

  Schema = SchemasCache.chain().find({
    Name: DataType
  }).collection.data[0] 

  DBAvalue = DBparamsCache.chain().find({
    Name: 'Registry'
  }).collection.data[0] 
  
  const promises=[]

  if (DBPassword === undefined) {
    promises.push(new Promise(async (resolve, reject) => {
       
      let dbpasswordvalue= await commonshared.getssmparameter(ssmclient, GetParameterCommand, {
          Name: `/Logverz/Database/${DBFrendlyName}Password`,
            WithDecryption: true
          }, ddclient, PutItemCommand)

      let dbpasswordobj ={"Name": DBFrendlyName,"Value": dbpasswordvalue.Parameter.Value, "Recordtype":"DBpassword"}
      DBpasswordsCache.insert(dbpasswordobj)
      console.log('\nRetrieved '+DBFrendlyName+' password.')
      resolve(dbpasswordobj)
    }))
  }
  else{
    console.log('\nCache contained '+DBFrendlyName+' password.')
  }

  if (ExecutionHistory === undefined) {
    promises.push(new Promise(async (resolve, reject) => {
      
      let executionhistoryvalue= await commonshared.getssmparameter(ssmclient, GetParameterCommand, {
          Name: executionhistorykey,
            WithDecryption: false
          }, ddclient, PutItemCommand)
      let executionhistoryobj ={"Name": executionhistorykey,"Value": executionhistoryvalue.Parameter.Value , "Recordtype":"ExecutionHistory"}
      ExecParamsCache.insert(executionhistoryobj)
      console.log('\nRetrieved executionhistory'+executionhistorykey+' value.')
      resolve(executionhistoryobj)
    }))
  }
  else{
    console.log('\nCache contained executionhistory'+executionhistorykey+' value.')
  }

  if (Schema === undefined) {
     promises.push(new Promise(async (resolve, reject) => {
      
      let schemavalue= await commonshared.getssmparameter(ssmclient, GetParameterCommand, {
          Name: ('/Logverz/Engine/Schemas/' + DataType),
            WithDecryption: false
          }, ddclient, PutItemCommand)
      let schemaobj ={"Name": DataType,"Value": schemavalue.Parameter.Value , "Recordtype":"Schema"}
      SchemasCache.insert(schemaobj)
      console.log('\nRetrieved '+DataType+' schema.')
      resolve(schemaobj)
    }))
  }
  else{
    console.log('\nCache contained '+DataType+' schema.')
  }

  if (DBAvalue === undefined) {
    promises.push(new Promise(async (resolve, reject) => {
       
      let dbregistryvalue= await commonshared.getssmparameter(ssmclient, GetParameterCommand, {
          Name: '/Logverz/Database/Registry',
            WithDecryption: false
          }, ddclient, PutItemCommand)

      let dbregistryobj ={"Name": 'Registry',"Value": dbregistryvalue.Parameter.Value, "Recordtype":"DBRegistry"}
      DBparamsCache.insert(dbregistryobj)
      console.log('\nRetrieved \'/Logverz/Database/Registry\' key\'s value.')
      resolve(dbregistryobj)
    }))
  }
  else{
    console.log('\nCache contained \'/Logverz/Database/Registry\' key\'s value.')
  }

  await Promise.all(promises)
  //const resolved = await Promise.all(promises)
  //return resolved
} 

async function UpdateSqlEntry (sequelize, Model, SelectedModel, DataType, DBTableName, updatedfields, conditions) {
 
    class DBEntry extends Model {}
    await DBEntry.init(SelectedModel, {
      sequelize,
      modelName: DataType,
      tableName: DBTableName,
      freezeTableName: true
    })

    var result = await DBEntry.update(updatedfields, conditions)
    console.log('SQL Entry ' + JSON.stringify(result) + 'has been updated.')

}

async function AddSqlEntry(sequelize, Model, SelectedModel, DataType, DBTableName, mydata) {

  class DBEntry extends Model {}
  await DBEntry.init(SelectedModel, {
    sequelize,
    modelName: DataType,
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

function parseevent4sqsmessages(event, QueueURL){

  let data=event.Records.map(r=> {
    return {
      "receiptHandle": r.receiptHandle,
      "bucket": JSON.parse(r.body).Records[0].s3.bucket.name,
      "key": JSON.parse(r.body).Records[0].s3.object.key,
      "region":JSON.parse(r.body).Records[0].awsRegion,
      QueueURL
    }
  })

  //JSON.parse(event.Records[0].body).Records[0].s3.bucket.name
  //console.log(Messages)
  return  data
}
  // Testing setup: After initiate connection, before loop:
  /*
  var prefixarray=[
      [
        "key",
        "bucket",
        "region"
      ],
      [
        "key",
        "bucket",
        "region"
      ]
  ]

  const bytestream = await loaddata(prefixarray)
  const filearray = await preprocessdata(bytestream, StgSelectParameter, sequelize, SelectedModel, Model, engineshared, DBEngineType, ddclient, context )
  await filterdata(filearray, QueryString, commonshared, sequelize, Model, SelectedModel, DataType, DBEngineType, DBTableName, DebugInsert, EngineBucket, region, FileName, TransformsModule, transformconfigpath)
*/