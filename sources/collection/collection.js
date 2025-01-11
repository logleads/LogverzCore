/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import _ from 'lodash'
import loki from 'lokijs'
import jwt from 'jsonwebtoken'
import { Sequelize } from 'sequelize'
import { SSMClient, GetParameterHistoryCommand, GetParameterCommand } from '@aws-sdk/client-ssm'
import { LambdaClient, InvokeCommand, CreateEventSourceMappingCommand, ListEventSourceMappingsCommand, DeleteEventSourceMappingCommand } from '@aws-sdk/client-lambda'
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, GetBucketNotificationConfigurationCommand, PutBucketNotificationConfigurationCommand } from '@aws-sdk/client-s3'
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { CloudFormationClient, DescribeStacksCommand, DescribeStackResourcesCommand } from "@aws-sdk/client-cloudformation"; 
import { SQSClient, ListQueuesCommand } from "@aws-sdk/client-sqs"
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/dynamodb-example-dynamodb-utilities.html

var MaximumCacheTime = process.env.MaximumCacheTime
if (typeof db === 'undefined') {
  // the variable is defined
  var db = new loki('db.json', {
    autoupdate: true
  })
}

var tokenconfig={
  algorithm: 'RS512',
  expiresIn: '15m'
}

var type = 'CC' //meaning continous collection
var usage = 'lambda'
if (db.collections.length === 0) {
  if (MaximumCacheTime === undefined) {
    MaximumCacheTime = 1
  }

  var identity = db.addCollection('Logverz-Identities', {
    ttl: MaximumCacheTime * 60 * 1000
  })
  var queries = db.addCollection('Logverz-Queries', {
    ttl: MaximumCacheTime * 60 * 1000
  })
}
/*
Function logic: 
1) function checks DB status by making a system call to info function. If up skip to step 4.
2) If down start logverz configure continous ingestion step function, with DB identifier, authorization token, sqs notification settings, table and permissions parameters etc (see steps 4/5)
3) step function starts DB and waits till its up than call continous ingestion function
4) insert of the event notification rule to the specified bucket. Also at the end of the run print out the before and after state of the S3 bucket's rules.
5) Connect to Database server and create the table, Connect to DynamoDB and add entry to Logverz-Queries 
*/

export const handler = async (event, context) => {

  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function
    var commonsharedpath = ('file:///' + path.join(__dirname, 'shared', 'commonsharedv3.js').replace(/\\/g, '/'))
    var commonshared = await GetConfiguration(commonsharedpath, '*')
    var enginesharedpath = ('file:///' + path.join(__dirname, 'shared', 'enginesharedv3.mjs').replace(/\\/g, '/'))
    var engineshared = await GetConfiguration(enginesharedpath, '*')
    var authenticationsharedpath = ('file:///' + path.join(__dirname, './shared/authenticationsharedv3.js').replace(/\\/g, '/'))
    var authenticationshared = await GetConfiguration(authenticationsharedpath, '*')
    var arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var stateMachineArn =process.env.StartDbStepFunctionArn
    var SelectedModelPath  = ('file:///' + path.join('tmp', 'SelectedModel.mjs').replace(/\\/g, '/'))
    const maskedevent = commonshared.masktoken(JSON.parse(JSON.stringify(event)))
    console.log('REQUEST RECEIVED: \n' + JSON.stringify(context) + '\n\n')
    console.log('THE EVENT: \n' + JSON.stringify(maskedevent) + '\n\n')
  }
  else {
    // Dev environment settings
    var directory = path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'collection', 'mydev.mjs')
    const mydev = await import('file:///' + directory.replace(/\\/g, '/'))
    var context = mydev.context
    var event = mydev.event
    var commonshared = mydev.commonshared
    var authenticationshared = mydev.authenticationshared
    var engineshared = mydev.engineshared
    var region = mydev.region
    var SelectedModelPath = mydev.SelectedModelPath
    var stateMachineArn =mydev.stateMachineArn
  }

  let message = 'ok'
  let identityresult
  let notificationid
  let S3bucket
  let S3Prefix
  let S3Suffix
  let DataType
  let DBServerAlias
  let QueryString
  let TableParameters
  let TableName
  let JOBQueueARN
  let OldTableParameters 
  let OldTableName
  let OldJOBQueueARN
  let MaxBatchWaitTime
  let MaximumWorkerNumber
  let executiontype


  if (event.clientContext === undefined){
    //CFN invocation by user who sets up a configuration
    
    var S3parameters = event.ResourceProperties.S3parameters.split("<!!>")
    var ExecutionHistory = event.ResourceProperties.ExecutionHistory 
    
    executiontype="CFN"
    JOBQueueARN = event.ResourceProperties.JOBQueueARN
    DataType = event.ResourceProperties.DataTypeSelector
    MaximumWorkerNumber = event.ResourceProperties.MaximumWorkerNumber
    MaxBatchWaitTime = event.ResourceProperties.MaxBatchWaitTime
    console.log("Execution Type: "+ executiontype)
  }
  else {
    //SF invocation when the dataabase was not availble hence SF reruns the function
    
     var StackId= event.clientContext.StackId
     executiontype="SF"
     var customevent={
      "StackId":StackId,
      "RequestId": event.clientContext.RequestId,
      "LogicalResourceId": event.clientContext.LogicalResourceId,
      "ResponseURL":decodeURIComponent(JSON.parse(event.clientContext.Parameters).Endpoint)
    }
    var customcontext={
      "logStreamName": event.clientContext.logStreamName,
      "PhysicalResourceId": event.clientContext.logStreamName
    }
    console.log("Execution Type: "+ executiontype)
   // await commonshared.newcfnresponse(customevent, customcontext, 'SUCCESS', {})
  }

  const ddclient = new DynamoDBClient({
    region
  })
  const docClient = DynamoDBDocumentClient.from(ddclient)
  const ssmclient = new SSMClient({})
  const s3client = new S3Client({})
  const lmdclient = new LambdaClient({})
  const sfclient = new SFNClient({})
  const cfnclient = new CloudFormationClient({})
  const sqsclient = new SQSClient({});

  if (executiontype === "CFN"){
    if (DataType === '') {
        message = 'query type is not specified'
    }
    notificationid =JOBQueueARN.split(":")[5].replace('Queue.fifo','')
    DBServerAlias = event.ResourceProperties.DBServerAlias
    QueryString = event.ResourceProperties.QueryString
    TableParameters = event.ResourceProperties.TableParameters
    TableName=TableParameters.split("<!!>").filter(s=> s.includes('TableName'))[0].split('=')[1]
    S3bucket=S3parameters.filter(s=> s.includes('S3Bucket'))[0].split('=')[1]
    S3Prefix=S3parameters.filter(s=> s.includes('S3Prefix'))[0].split('=')[1]
    S3Suffix=S3parameters.filter(s=> s.includes('S3Suffix'))[0].split('=')[1]

    if(event.RequestType === "Delete"){
      console.log('Entered Delete branch')
      //delete also happens as part of the update cycle. In that case the resources (execution history,sqs queue, lambda trigger) 
      //has been allready deleted when the lambda is called, making the validation not possible. 
      // Incase the resources are deleted  
      let QueueURL=JOBQueueARN.replaceAll(':','/').replace('arn/aws/sqs/','https://sqs').replace(region,'.'+region+'.amazonaws.com')
      let allqueues = await  ListSQSQueues (sqsclient)
      let queuedeleted = (allqueues.filter(q => q === QueueURL).length === 0)
      console.log("queuedeleted result:")
      console.log(queuedeleted)
      
      let mapping =await ListLambdaSQSMappings(lmdclient, JOBQueueARN)
      let mappingdeleted = mapping.EventSourceMappings.length === 0
      console.log("mappingdeleted result:")
      console.log(mappingdeleted)
      
      let details = {
        source: 'collection.js:main',
        message: ''
      }
      
      let ExecutionHistoryValue =  await commonshared.getssmparameter(ssmclient, GetParameterCommand, { Name: ExecutionHistory }, ddclient, PutItemCommand, details)
      let exechkeydeleted = (ExecutionHistoryValue.indexOf("ParameterNotFound: UnknownError") !==-1)

      console.log("SSM deleted:")
      console.log(exechkeydeleted)
     
      if (queuedeleted && mappingdeleted && exechkeydeleted){
        //if all above resource had been deleted prior we reply back with done.Note:
        //We dont check for DB table as we assume that its also deleted. Additonally,
        //absent of Execution history we could not determine the caller identity. 
        console.log('CFN message3:')
        console.log(message)
        return await commonshared.newcfnresponse(event, context, 'SUCCESS', {})
      }
      else{
        const input = { // GetBucketNotificationConfigurationRequest
          Bucket: S3bucket
        };
        const command = new GetBucketNotificationConfigurationCommand(input);
        const bucketNotificationConfiguration = (await s3client.send(command)).QueueConfigurations;
        let bucketconfigurationresult = await setbucketseventsconfiguration(s3client, S3bucket, S3Prefix, S3Suffix, notificationid, JOBQueueARN, bucketNotificationConfiguration, event.RequestType)
        console.log(bucketconfigurationresult)
        let lambdaconfigurationresult =  await setlambdasqseventmapping(lmdclient, JOBQueueARN, MaxBatchWaitTime, MaximumWorkerNumber, event.RequestType )
        console.log(lambdaconfigurationresult)
        console.log('CFN message3:')
        console.log(message)
        return await commonshared.newcfnresponse(event, context, 'SUCCESS', {})
      }

    }
    else if(event.RequestType === "Update"){
      //incase of update the previous configuration is in the OldResourceProperties object.
      OldTableParameters = event.OldResourceProperties.TableParameters
      OldTableName = OldTableParameters.split("<!!>").filter(s=> s.includes('TableName'))[0].split('=')[1]
      OldJOBQueueARN = event.OldResourceProperties.JOBQueueARN
    }
    
    identityresult =await commonshared.CFNExecutionIdentity(commonshared, ssmclient, GetParameterHistoryCommand, ddclient, PutItemCommand, ExecutionHistory, S3bucket, TableParameters)
  //identityresult =await CFNExecutionIdentity(commonshared, ssmclient, GetParameterHistoryCommand, ddclient, PutItemCommand, ExecutionHistory, S3bucket, TableParameters)
  }
  else{
    //this is the statefunction execution,
    //stackname is for this function to retrieve the parameters once the DB was started. 
    //We don't trust the parameters comming from step function, hence we only retrive stacknme and response url.
    const DescribeStacks = { // DescribeStacksInput
      StackName: StackId.split('/')[1],
      //NextToken: "STRING_VALUE",
    };

    const DescribeStackResources = { // DescribeStackResourcesInput
      StackName: StackId.split('/')[1]
      //,LogicalResourceId: "ContinousCollectionResource"
    };

    const command = new DescribeStacksCommand(DescribeStacks)
    const response = await cfnclient.send(command)
    const stackresourcescommand = new DescribeStackResourcesCommand(DescribeStackResources)
    const stackresourcesresponse = await cfnclient.send(stackresourcescommand)
    //const PhysicalResourceId=stackresourcesresponse.StackResources.filter(r=> r.LogicalResourceId.includes('ContinousCollectionResource'))[0].PhysicalResourceId
    const ContinousCollectionJobQueue = stackresourcesresponse.StackResources.filter(r=> r.LogicalResourceId.includes('ContinousCollectionJobQueue'))[0].PhysicalResourceId
    const TableDescription=response.Stacks[0].Parameters.filter(s=> s.ParameterKey.includes('DatasetDescription'))[0].ParameterValue
    const TableOwners=response.Stacks[0].Parameters.filter(s=> s.ParameterKey.includes('DatasetOwners'))[0].ParameterValue
    const TableAccess=response.Stacks[0].Parameters.filter(s=> s.ParameterKey.includes('DatasetAccess'))[0].ParameterValue

    //most of the parameters below are used in reporting (Query History)
    S3bucket=response.Stacks[0].Parameters.filter(s=> s.ParameterKey.includes('S3Bucket'))[0].ParameterValue
    S3Prefix=response.Stacks[0].Parameters.filter(s=> s.ParameterKey.includes('S3Prefix'))[0].ParameterValue
    S3Suffix=response.Stacks[0].Parameters.filter(s=> s.ParameterKey.includes('S3Suffix'))[0].ParameterValue
    DataType=response.Stacks[0].Parameters.filter(s=> s.ParameterKey.includes('DataTypeSelector'))[0].ParameterValue
    DBServerAlias=response.Stacks[0].Parameters.filter(s=> s.ParameterKey.includes('DBServerAlias'))[0].ParameterValue
    QueryString = response.Stacks[0].Parameters.filter(s=> s.ParameterKey.includes('QueryString'))[0].ParameterValue
    JOBQueueARN=ContinousCollectionJobQueue.replace('https://sqs.','arn:aws:sqs:').replace('.amazonaws.com','').replaceAll('/',':')
    notificationid =JOBQueueARN.split(":")[5].replace('Queue.fifo','')
    MaximumWorkerNumber =response.Stacks[0].Parameters.filter(s=> s.ParameterKey.includes('MaximumWorkerNumber'))[0].ParameterValue
    MaxBatchWaitTime =response.Stacks[0].Parameters.filter(s=> s.ParameterKey.includes('MaxBatchWaitTime'))[0].ParameterValue
    TableName=response.Stacks[0].Parameters.filter(s=> s.ParameterKey.includes('DatasetName'))[0].ParameterValue
    TableParameters= `TableName=${TableName}<!!>TableDescription=${TableDescription}<!!>TableOwners=${TableOwners}<!!>TableAccess=${TableAccess}` 
    
    event.RequestType=event.clientContext.RequestType
    event["ResourceProperties"]={}
    event.ResourceProperties["TableParameters"]= TableParameters
    event.ResourceProperties["DataTypeSelector"]=DataType
    event.ResourceProperties["QueryString"]=QueryString
    event.ResourceProperties["S3parameters"]=`s3://l${S3bucket}/${S3Prefix}*`
    
    if (S3Suffix !== ""){
      event.ResourceProperties["S3parameters"]+=`  ${S3Suffix}`
    }

    const ExecutionHistory= `/Logverz/Engine/ExecutionHistory/${DBServerAlias}_${TableName}_${DataType}_Queue`
    identityresult =await commonshared.CFNExecutionIdentity(commonshared, ssmclient, GetParameterHistoryCommand, ddclient, PutItemCommand, ExecutionHistory, S3bucket, TableParameters)
    console.log(identityresult)
  }

  // Check if user has access to specified s3 resources.
  if (message === 'ok' || identityresult.Result === 'PASS') {
    //console.log('Debug: At S3 authorization check Start')
    const s3authorizationresult= await commonshared.JobExecutionAuthorization(_, authenticationshared, commonshared, docClient, QueryCommand, identity, identityresult, S3bucket) 
    //const s3authorizationresult= await JobExecutionAuthorization(_, authenticationshared, commonshared, docClient, QueryCommand, identity, identityresult, S3bucket) 
    if (s3authorizationresult !== 'ok') {
      // identity not authorized, hence we update the message with the details, if authorized function returns okay
      message=s3authorizationresult.message
    }

    if (message === 'ok'  && event.RequestType !== "Create"){
      //For update and delete operations checking if user has access to specified DB/Table. 
      //If operation is create than assume access to be able to create a new table (s3 permissions validated in prior lines)
      let clientinputparams = {
        TableName,
        DatabaseName: DBServerAlias,
        Operation: 'dynamodb:DeleteItem'
      }
      let requestoridentity ={
        Type: identityresult.usertype,
        Name: identityresult.username
      }
      var authorization = await authenticationshared.resourceaccessauthorization(_, docClient, QueryCommand, identity, queries, clientinputparams, requestoridentity, region)
      //var authorization = await resourceaccessauthorization(_, docClient, QueryCommand, identity, queries, clientinputparams, requestoridentity, region)

      if (authorization.status !== 'Allow') {
        message = JSON.stringify(authorization)
      }

    }
      
  }
  else{
    //could not determine the identity making the call 
    message =identityresult.message
  }

  // if previous steps of authentication and authorization are successfull configure DB
  if (message === 'ok') {

    let envstate = await GatherEnvCurrentState(commonshared, engineshared, authenticationshared, identityresult, ssmclient, lmdclient, ddclient, s3client, DataType, DBServerAlias, TableParameters, S3bucket) //InitaliseState
    let  status= envstate.dbstate.origin.DBInstanceStatus
    //if status of db is not available or in configuiring monitoring state, then call step function to start db and callback once done.
    if(!(status === "available" || status === "configuring-enhanced-monitoring")){
      //start here statemachine, as DB start may take 5-10 minutes we wait till its up.

      const payload= {
        input: JSON.stringify({
          "initial":{
            "Parameters":JSON.stringify({"DBInstanceIdentifier":envstate.dbstate.origin.DBInstanceIdentifier}),
            "cookie": "LogverzAuthToken="+envstate.token,
            JOBQueueARN,
            "StackId": event.StackId,
            "ResponseURL": encodeURIComponent(event.ResponseURL),
            "RequestType": event.RequestType,
            "LogicalResourceId": event.LogicalResourceId,
            "RequestId":event.RequestId,
            "logStreamName": context.logStreamName
          },
          "Counter": {
            "Value": 0
          }
        }),
        stateMachineArn
      }
        
      const command = new StartExecutionCommand(payload);
      const response = await sfclient.send(command);
      console.log(response)
      console.log("Waiting for database to start, and that the continous collection configuration to be restarted by the stepfunction")
    }
    else{
      //Database is running - available
      
      //Connecting to the database and d ofurther actions create or delete tables based on the request received from the client.
      let sequelize
      let Model = Sequelize.Model
      sequelize =await engineshared.ConnectDBserver(sequelize, Sequelize, envstate.Schema, envstate.dbparams, fs, fileURLToPath, SelectedModelPath, ddclient, engineshared, commonshared, usage)

      if (event.RequestType === "Create"){
        //creating new resources
        //configure database, add continous collection table and if its the first collection than additional system tables
        await engineshared.ConfigureDBCreateTables(sequelize, engineshared, envstate.dbparams, Model, SelectedModelPath, DataType)
       
        printbucketseventsconfiguration(envstate.bucketNotificationConfiguration,S3bucket)
        let bucketconfigurationresult = await setbucketseventsconfiguration(s3client, S3bucket, S3Prefix, S3Suffix, notificationid, JOBQueueARN, envstate.bucketNotificationConfiguration, event.RequestType)
        console.log("Bucketconfigurationresult:")
        console.log(bucketconfigurationresult)
        let lambdaconfigurationresult = await setlambdasqseventmapping(lmdclient, JOBQueueARN, MaxBatchWaitTime, MaximumWorkerNumber, event.RequestType )
        console.log("Lambdaconfigurationresult:")
        console.log(lambdaconfigurationresult)

        //recording query only after the S3 configuration was done as that can frequently fail due to clientmisconfiguration
        event.ResourceProperties.DatabaseParameters=envstate.DatabaseParameters
        event.ResourceProperties.TableParameters+='<!!>Creator=' + identityresult.username + ':' + identityresult.usertype //needed for recording query
        await commonshared.RecordQuery(_, ddclient, PutItemCommand, commonshared, event.ResourceProperties, 'continous collection', type)
      }
      else if(event.RequestType === "Delete"){
        //deleting old resources
        await engineshared.ConfigureDBDeleteTables(commonshared, event, identityresult, sequelize, Model, TableName, docClient, PutItemCommand, QueryCommand, UpdateCommand, ddclient, DBServerAlias )
        let bucketconfigurationresult = await setbucketseventsconfiguration(s3client, S3bucket, S3Prefix, S3Suffix, notificationid, JOBQueueARN, envstate.bucketNotificationConfiguration, event.RequestType)
        //console.log(bucketconfigurationresult)
        let lambdaconfigurationresult =  await setlambdasqseventmapping(lmdclient, JOBQueueARN, MaxBatchWaitTime, MaximumWorkerNumber, event.RequestType )
        //console.log(lambdaconfigurationresult)
      }
      else if(event.RequestType === "Update"){
        //TODO handle case when the queue and DB name remains the same only the ingestion toggle on/off changes
        //deleting old resources
        await engineshared.ConfigureDBDeleteTables(commonshared, event, identityresult, sequelize, Model, OldTableName, docClient, PutItemCommand, QueryCommand, UpdateCommand, ddclient, DBServerAlias )
        let bucketconfigurationresult = await setbucketseventsconfiguration(s3client, S3bucket, S3Prefix, S3Suffix, notificationid, OldJOBQueueARN, envstate.bucketNotificationConfiguration, event.RequestType)
        //console.log(bucketconfigurationresult)
        let lambdaconfigurationresult =  await setlambdasqseventmapping(lmdclient, OldJOBQueueARN, MaxBatchWaitTime, MaximumWorkerNumber, event.RequestType )
        //console.log(lambdaconfigurationresult)
        
        //creating new resources
        await engineshared.ConfigureDBCreateTables(sequelize, engineshared, envstate.dbparams, Model, SelectedModelPath, DataType)
        bucketconfigurationresult = await setbucketseventsconfiguration(s3client, S3bucket, S3Prefix, S3Suffix, notificationid, JOBQueueARN, envstate.bucketNotificationConfiguration, "Create")
        //console.log(bucketconfigurationresult)
        lambdaconfigurationresult = await setlambdasqseventmapping(lmdclient, JOBQueueARN, MaxBatchWaitTime, MaximumWorkerNumber, "Create" )
        //console.log(lambdaconfigurationresult)

      }
      else{
        console.log("someting went wrong...")
      }

      console.log('CFN message1:')
      console.log(message)

      if (executiontype === "SF"){
        return await commonshared.newcfnresponse(customevent, customcontext, 'SUCCESS', {})
      }
      else{
        return await commonshared.newcfnresponse(event, context, 'SUCCESS', {})
      }
    }
    
  }
  else {
  // authentication or authorization has FAILED 
    console.log('CFN message2:')
    console.log(message)  
    if (executiontype === "SF"){
      return await commonshared.newcfnresponse(customevent, customcontext, 'FAILED', {})
    }
    else{
      return await commonshared.newcfnresponse(event, context, 'FAILED', {})
    }
  }

}

async function GatherEnvCurrentState(commonshared, engineshared, authenticationshared, identityresult, ssmclient, lmdclient, ddclient, s3client, DataType, DBServerAlias, TableParameters, S3bucket){

  let envstate ={}  
  let details = {
    source: 'collection.js:main',
    message: ''
  }
  let passphparam = {
    Name: '/Logverz/Logic/Passphrase',
    WithDecryption: true
  }
  let pkparam = {
    Name: '/Logverz/Logic/PrivateKey',
    WithDecryption: true
  }
  let schparam ={
    Name: ('/Logverz/Engine/Schemas/' + DataType)
  }
  let regparam = {
    Name: '/Logverz/Database/Registry'
  }

  let [privateKey, passphrase, SchemaObject, Registry] = await Promise.all([
    commonshared.getssmparameter(ssmclient, GetParameterCommand, pkparam, ddclient, PutItemCommand, details),
    commonshared.getssmparameter(ssmclient, GetParameterCommand, passphparam, ddclient, PutItemCommand, details),
    commonshared.getssmparameter(ssmclient, GetParameterCommand, schparam, ddclient, PutItemCommand, details),
    commonshared.getssmparameter(ssmclient, GetParameterCommand, regparam, ddclient, PutItemCommand, details)
  ])

  var SchemaParameterObject = JSON.parse(SchemaObject.Parameter.Value)
  var Schema = ('{' + SchemaParameterObject.Schema.map(e => e + '\n') + '}').replace(/,'/g, '"').replace(/'/g, '"')
  var DatabaseParameters = commonshared.SelectDBfromRegistry(_, Registry, DBServerAlias)
  const dbparams =await engineshared.LookupDBParameters (DatabaseParameters, TableParameters, commonshared, ssmclient, ddclient, GetParameterCommand, PutItemCommand)

  //TODO change identity to Logverz:System
  var token = authenticationshared.createtoken(jwt, 'AWS', identityresult.username, privateKey.Parameter.Value, passphrase.Parameter.Value, tokenconfig, identityresult.usertype)
  //var token = createtoken(jwt, 'AWS', identityresult.username, privateKey.Parameter.Value, passphrase.Parameter.Value, tokenconfig, tokenidenditytype)
  const clientcontext = createmessage(dbparams, token)
  var dbstate= await commonshared.invokelambda (lmdclient, InvokeCommand, clientcontext, 'Logverz-Info')
  var dbstateobject = JSON.parse(JSON.parse(new TextDecoder().decode(dbstate.Payload)).body)

  //List bucket notification configuration.
  const input = { // GetBucketNotificationConfigurationRequest
    Bucket: S3bucket
  };
  const command = new GetBucketNotificationConfigurationCommand(input);
  const bucketNotificationConfiguration = (await s3client.send(command)).QueueConfigurations;

  envstate["Schema"]=Schema
  envstate["dbparams"]=dbparams
  envstate["DatabaseParameters"]=DatabaseParameters
  envstate["dbstate"]=dbstateobject
  envstate["bucketNotificationConfiguration"]=bucketNotificationConfiguration
  envstate["token"]=token

  return envstate
}

function createmessage (dbparams, token) {
  // https://docs.aws.amazon.com/lambda/latest/dg/API_Invoke.html#API_Invoke_RequestSyntax
  // max 3583 byte
 
  // "Parameters": "{\"DBInstanceIdentifier\":\"llu8dvl0nswrom\"}",
  // "apicall": "DescribeDBInstances",
  // "service": "rds"

// specifying the databaseid which is a partial of the endpoint value.
  var dbid= JSON.stringify({"Parameters": JSON.stringify({DBInstanceIdentifier: dbparams.DBEndpointName.split('.')[0]})})
  dbid=dbid.substring(1,dbid.length-1)
  //console.log("\n\n"+dbid +"\n\n")
  
  const invocationparameters = `{${dbid},"apicall": "DescribeDBInstances","service": "rds", "cookie": "LogverzAuthToken=${token}"}`
  // console.log("\n\n"+invocationparameters +"\n\n")
  const clientcontext = Buffer.from(invocationparameters).toString('base64')

  return clientcontext
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

function printbucketseventsconfiguration(QueueConfigurations,S3bucket){
  //response.
  QueueConfigurations.map(qc => {

    console.log("\nName of Configuration: "+ qc.Id + "\nBucketname: "+ S3bucket + "\nDestination: "+ qc.QueueArn + " \nEvents: " +qc.Events + "\nConfigured filters: " +JSON.stringify(qc.Filter)) //+"\n"
    //console.table(
  })
}

async function setbucketseventsconfiguration(s3client, S3bucket, S3Prefix, S3Suffix, notificationid, JOBQueueARN, bucketNotificationConfiguration, RequestType){
  
  let input
  if (RequestType === "Create"){

    let existconfig=bucketNotificationConfiguration.filter(bnc=> bnc.QueueArn === JOBQueueARN)
    if (existconfig.length ===1 ){
      bucketNotificationConfiguration=bucketNotificationConfiguration.filter(bnc=> bnc.QueueArn !== existconfig[0].QueueArn)
      console.log('\nThere has been a stale config with the same queue as destination, removing it to be able to add current config')
    }
    
    input = { // PutBucketNotificationConfigurationRequest
      Bucket: S3bucket, // required
      NotificationConfiguration: { // NotificationConfiguration
      
        QueueConfigurations: [ // QueueConfigurationList
          { // QueueConfiguration
            Id: notificationid,
            QueueArn: JOBQueueARN, // required
            Events: [ // required
              "s3:ObjectCreated:Put",
              "s3:ObjectCreated:Copy",
              "s3:ObjectCreated:Post",
              "s3:ObjectCreated:CompleteMultipartUpload"
            ],
            Filter: {
              Key: {
                FilterRules: [
                  {
                    Name: "prefix",
                    Value: S3Prefix,
                  },
                  {
                    Name: "suffix",
                    Value: S3Suffix,
                  }
                ],
              },
            },
          },
        ]
      },
      SkipDestinationValidation: true,
    }

    //adding back to the the existing Configuration
    for (let i = 0; i < bucketNotificationConfiguration.length; i++) {
      input.NotificationConfiguration.QueueConfigurations.push(bucketNotificationConfiguration[i])
    }
  }
  else if (RequestType === "Delete" || RequestType === "Update" ){
    
    let existconfig=bucketNotificationConfiguration.filter(bnc=> bnc.QueueArn === JOBQueueARN)

    if (existconfig.length === 1 ){
      bucketNotificationConfiguration=bucketNotificationConfiguration.filter(bnc=> bnc.QueueArn !== existconfig[0].QueueArn)
      console.log('\nBased on the received request, removing the bucket notification configuration')
    }

    input = { // PutBucketNotificationConfigurationRequest
      Bucket: S3bucket, // required
      NotificationConfiguration: { // NotificationConfiguration
        QueueConfigurations: [ // QueueConfigurationList
        ]
      },
      SkipDestinationValidation: true,
    }

    bucketNotificationConfiguration.map(c => {

      let existingS3Prefix = c.Filter.Key.FilterRules.filter(f => f.Name ==="Prefix")[0]
      let existingS3Suffix = c.Filter.Key.FilterRules.filter(f => f.Name ==="Suffix")[0]

      if (existingS3Prefix !== undefined){
        existingS3Prefix= existingS3Prefix.Value
      }
      else{
        existingS3Prefix=""
      }

      if (existingS3Suffix !== undefined){
        existingS3Suffix= existingS3Suffix.Value
      }
      else{
        existingS3Suffix=""
      }

      let oneconfig={ // QueueConfiguration
        Id: c.Id,
        QueueArn: c.QueueArn, // required
        Events: [ // required
          "s3:ObjectCreated:Put",
          "s3:ObjectCreated:Copy",
          "s3:ObjectCreated:Post",
          "s3:ObjectCreated:CompleteMultipartUpload"
        ],
        Filter: {
          Key: {
            FilterRules: [
              {
                Name: "Prefix",
                Value: existingS3Prefix
              },
              {
                Name: "Suffix",
                Value: existingS3Suffix
              }
            ],
          },
        },
      }
      input.NotificationConfiguration.QueueConfigurations.push(oneconfig)
    })
  }

  console.log("\nThe new notification configuration: ")
  console.log(JSON.stringify(input))

  const command = new PutBucketNotificationConfigurationCommand(input)
  let response
  try {
    response = await s3client.send(command)
  }
  catch (e) {
    response=e
  }
  return response
}

async function setlambdasqseventmapping(lmdclient, JOBQueueARN, MaxBatchWaitTime, MaximumWorkerNumber, RequestType){

  const mapping =await ListLambdaSQSMappings(lmdclient, JOBQueueARN)
  console.log(mapping)

  if (RequestType === "Create"){
  
    //only if eventmapping is not set configure eventmapping 
    if (mapping.EventSourceMappings.length === 0){
      const input = { // CreateEventSourceMappingRequest
        EventSourceArn: JOBQueueARN,
        FunctionName: 'Logverz-Worker', // required
        Enabled: true,
        BatchSize: Number("10"),
        MaximumBatchingWindowInSeconds: Number(MaxBatchWaitTime),
        ScalingConfig: { // ScalingConfig
          MaximumConcurrency: Number(MaximumWorkerNumber),
        }
      }

      let response
      const command = new CreateEventSourceMappingCommand(input)
      
      try {
        response = await lmdclient.send(command)
      }
      catch (e) {
        response=e
      }
      return response
    }

  }
  else if (RequestType === "Delete"  || RequestType === "Update"){

    if (mapping.EventSourceMappings.length !== 0){
      const input = { // DeleteEventSourceMappingRequest
        UUID: mapping.EventSourceMappings[0].UUID // required
      };
      
      console.log("\nDeleting "+ mapping.EventSourceMappings[0].EventSourceArn.split(':')[5] + ' lambda sqs trigger.')
      
      let response
      const command = new DeleteEventSourceMappingCommand(input)
      try {
        response = await lmdclient.send(command)
      }
      catch (e) {
        response=e
      }
      return response
    }
    else{
      console.log("\nCorresponding Lambda sqs trigger has allready been removed.")
    }
      return "done"
  }
  else{
    console.log("someting went wrong...")
  }

}

async function ListSQSQueues (sqsclient) {
  const params = {
    //MaxResults: Number("2"),
    //NextToken:
  }

  var responses = []
  let response
  do {
    // list all the buckets
    const command = new ListQueuesCommand(params)
    response = await sqsclient.send(command)
    responses.push(response.QueueUrls)

    if (response.NextToken !== undefined) { // response !==undefined &&
      params.NextToken = response.NextToken
    }
  } // until there are no more bukets to list
  while (response.NextToken !== undefined)
  const QueueUrls = _.flatten(responses)

  return QueueUrls
}

async function ListLambdaSQSMappings(lmdclient, JOBQueueARN){
  //get event mapping status
  const inputlist = { // ListEventSourceMappingsRequest
    EventSourceArn: JOBQueueARN,
    FunctionName: 'Logverz-Worker',
    // Marker: "STRING_VALUE",
    // MaxItems: Number("int"),
    //https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html#events-sqs-eventsource
  };
  const commandls = new ListEventSourceMappingsCommand(inputlist);
  const mapping = await lmdclient.send(commandls);

  return mapping
}