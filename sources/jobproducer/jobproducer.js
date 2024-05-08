/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import _ from 'lodash'
import jwt from 'jsonwebtoken'
import loki from 'lokijs'

import { SSMClient, GetParameterHistoryCommand, GetParameterCommand } from '@aws-sdk/client-ssm'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
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

if (db.collections.length === 0) {
  if (MaximumCacheTime === undefined) {
    MaximumCacheTime = 1
  }

  var identity = db.addCollection('Logverz-Identities', {
    ttl: MaximumCacheTime * 60 * 1000
  })
  // identity.insert({"Path":"/","Arn":"arn:aws:iam::accountnumber:user/bob","Type":"UserAWS","Policies":{"UserInline":[],"GroupInline":["{\"PolicyDocument\":\"{'Version':'2012-10-17','Statement':[{'Action':['dynamodb:ListTables','dynamodb:DescribeTimeToLive'],'Resource':'*','Effect':'Allow','Sid':'ListAndDescribe'},{'Action':['dynamodb:DescribeTable','dynamodb:Get*','dynamodb:BatchGet*','dynamodb:Query','dynamodb:Scan'],'Resource':'arn:aws:dynamodb:ap-southeast-2:accountnumber:table/Logverz*','Effect':'Allow','Sid':'SpecificTable'}]}\",\"PolicyName\":\"Logverz_Users_Minimum_policy\"}"],"UserAttached":["{\"PolicyName\":\"AmazonS3FullAccess\",\"PolicyDocument\":\"{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':'s3:*','Resource':'*'}]}\"}"],"GroupAttached":["{\"PolicyName\":\"shinynew2\",\"PolicyDocument\":\"{'Version':'2012-10-17','Statement':[{'Sid':'VisualEditor0','Effect':'Allow','Action':'license-manager:*','Resource':'*'}]}\"}"]},"Inherited":true,"Name":"bob"});
}

export const handler = async (event, context) => {
  if (process.env.Environment !== 'LocalDev' && event.hasOwnProperty('requestContext')) {
    // Prod lambda function - APiGW invocation
    var commonsharedpath = ('file:///' + path.join(__dirname, './shared/commonsharedv3.js').replace(/\\/g, '/'))
    var commonshared = await GetConfiguration(commonsharedpath, '*')
    var authenticationsharedpath = ('file:///' + path.join(__dirname, './shared/authenticationsharedv3.js').replace(/\\/g, '/'))
    var authenticationshared = await GetConfiguration(authenticationsharedpath, '*')
    var arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var request = JSON.parse(event.body)
    var JOBQueueURL = process.env.JOBQueueURL
    var S3Folders = request.S3Folders
    var S3EnumerationDepth = request.S3EnumerationDepth
    var DataType = request.DataType
    var QueryString = request.QueryString // TODO do try catch lookup
    // var CustomQueryParameters=`CustomQuerySchema=${request.Parameters[0].CustomS3Select}<!!>CustomQueryString=${request.Parameters[0].CustomQueryString}<!!>CustomS3Select=${request.Parameters[0].CustomS3Select}`;
    var LogVolume = request.LogVolume
    var AllocationStrategy = request.AllocationStrategy
    var PreferedWorkerNumber = request.PreferedWorkerNumber
    var DatabaseParameters = request.DatabaseParameters
    var TableParameters = `TableName=${request.DatasetName}<!!>TableDescription=${request.DatasetDescription}<!!>TableOwners=${request.DatasetOwners}<!!>TableAccess=${request.DatasetAccess}`
    var cert = process.env.PublicKey
    var apigateway = true
    var RestApiId = process.env.RestApiId
    var StartJob = process.env.StartJob
    var AllowedOrigins = process.env.AllowedOrigins
    var maskedevent = commonshared.masktoken(JSON.parse(JSON.stringify(event)))
    console.log('REQUEST RECEIVED: \n' + JSON.stringify(context) + '\n\n')
    console.log('THE EVENT: \n' + JSON.stringify(maskedevent) + '\n\n')
  }
  else if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function - CFN invocation
    var commonsharedpath = ('file:///' + path.join(__dirname, './shared/commonsharedv3.js').replace(/\\/g, '/'))
    var commonshared = await GetConfiguration(commonsharedpath, '*')
    var authenticationsharedpath = ('file:///' + path.join(__dirname, './shared/authenticationsharedv3.js').replace(/\\/g, '/'))
    var authenticationshared = await GetConfiguration(authenticationsharedpath, '*')
    var arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var JOBQueueURL = event.ResourceProperties.JOBQueueURL
    var S3Folders = event.ResourceProperties.S3Folders // "S3Folders:"+
    var S3EnumerationDepth = event.ResourceProperties.S3EnumerationDepth
    var DataType = event.ResourceProperties.DataTypeSelector
    var QueryString = event.ResourceProperties.QueryString
    var CustomQueryParameters = event.ResourceProperties.CustomQueryParameters
    var LogVolume = event.ResourceProperties.LogVolume
    var AllocationStrategy = event.ResourceProperties.AllocationStrategy
    var PreferedWorkerNumber = event.ResourceProperties.PreferedWorkerNumber
    var DatabaseParameters = event.ResourceProperties.DatabaseParameters
    var TableParameters = event.ResourceProperties.TableParameters // "TableParameters:"+
    var cert = process.env.PublicKey
    var apigateway = false
    var AllowedOrigins = process.env.AllowedOrigins
    console.log('REQUEST RECEIVED: \n' + JSON.stringify(context) + '\n\n')
    console.log('THE EVENT: \n' + JSON.stringify(event) + '\n\n')
  }
  else {
    // Dev environment settings
    var directory = path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'jobproducer', 'mydev.mjs')
    const mydev = await import('file:///' + directory.replace(/\\/g, '/'))
    var commonshared = mydev.commonshared
    var authenticationshared = mydev.authenticationshared
    var region = mydev.region
    var JOBQueueURL = mydev.JOBQueueURL
    var S3EnumerationDepth = mydev.S3EnumerationDepth
    var DataType = mydev.DataType
    var QueryString = mydev.QueryString
    var CustomQueryParameters = mydev.CustomQueryParameters
    var LogVolume = mydev.LogVolume
    var AllocationStrategy = mydev.AllocationStrategy
    var PreferedWorkerNumber = mydev.PreferedWorkerNumber
    var DatabaseParameters = mydev.DatabaseParameters
    var context = mydev.context
    var cert = mydev.cert
    var RestApiId = mydev.RestApiId
    var StartJob = mydev.StartJob
    var AllowedOrigins = mydev.AllowedOrigins
    var event = mydev.event
    var S3Folders = mydev.S3Folders
    var TableParameters = mydev.TableParameters
    var apigateway = mydev.apigateway
  }

  const sqsclient = new SQSClient({})
  const ddclient = new DynamoDBClient({
    region
  })
  const docClient = DynamoDBDocumentClient.from(ddclient)
  const ssmclient = new SSMClient({})

  if (DataType !== '') {
    var message = 'ok' // regular or custom query types
  }
  else {
    var message = 'query type is not specified'
    // var message = {'query type' :'is not specified'}
  }

  if (apigateway === true) {
    // console.log("Debug: At ApiGW Start");
    // If request is comming from API GW check authentication and authorization to call the function.
    var tokenobject = commonshared.ValidateToken(jwt, event.headers, cert)
    console.log(tokenobject)
    if (tokenobject.state === true) {
      var username = tokenobject.value.user.split(':')[1]
      var usertype = 'User' + tokenobject.value.user.split(':')[0]
      var userattributes = identity.chain().find({
        Type: usertype,
        Name: username
      }).collection.data[0] // ?.data()

      if (userattributes === undefined) {
        var userattributes = await authenticationshared.getidentityattributes(docClient, QueryCommand, username, usertype)
        userattributes = userattributes.Items[0]
        identity.insert(userattributes)
      }
      var Resource = 'undefined'
      if (event.requestContext.resourcePath === '/Start/Job') {
        Resource = 'arn:aws:apigateway:' + region + '::/restapis/' + RestApiId + '/resources/' + StartJob + '/methods/POST'
      }

      var action = {
        Resource,
        Operation: 'apigateway:POST'
      }
      var authorization = authenticationshared.authorize(_, commonshared, action, userattributes)
      if (authorization.status !== 'Allow') {
        // request not authorized
        message = authorization.Reason
        console.log(message)
      }
      // else message remains ok and execution continues;
    }
    else {
      // invalid token
      message = tokenobject.value
    }
  }
  else {
    console.log('Debug: At CloudFormation Start')
    // in case of cloudformation, execution information is not availabe in the context, hence username (that iniated execution) is looked up from the history.
    var retries = [1, 2, 3, 4]
    // Result can be delayed hence the retry
    for await (var attempt of retries) {
      // user name who invoked the job is retrieved from Execution history
      console.log('Attempt ' + attempt + ' of retriving the user from execution history')
      // do try catch here

      var executionhistory = await getallssmparameterhistory(commonshared, ssmclient, GetParameterHistoryCommand, ddclient, PutItemCommand, '/Logverz/Engine/ExecutionHistory')

      // result may not be the last item in case of frequent invocations hence the matching
      var match = matchexecutionwithparameterhistory(executionhistory, S3Folders, TableParameters)
      if (match !== false) {
        break
      }
      else {
        await timeout(4000)
      }
    }

    if (match === false) {
      message = 'Something went wrong cloud not determine the user making the call. As no match was found in the Execution history.'
    }
    else {
      var lastmodifieduserarn = match.LastModifiedUser

      if (lastmodifieduserarn.match(':root') !== null) {
        var username = 'root' // root ||admin
      }
      else {
        var username = lastmodifieduserarn.split('/')[1]
      }
      var usertype = 'UserAWS'
    }
  }

  // Regardless how the function was called, check if user has access to specified s3 resources.
  if (message === 'ok') {
    console.log('Debug: At S3 authorization check Start')
    var userattributes = identity.chain().find({
      Type: usertype,
      Name: username
    }).collection.data[0] // ?.data()
    if (userattributes === undefined) {
      userattributes = await authenticationshared.getidentityattributes(docClient, QueryCommand, username, usertype)
      userattributes = userattributes.Items[0]

      if (userattributes !== undefined) {
        identity.insert(userattributes)
      }
    }

    if (userattributes !== undefined) {
      // Doing S3 authorization here.
      var S3Folders = S3Folders.replace('S3Folders:', '')
      var S3Foldersarray = _.compact(S3Folders.split(';'))
      var message = authenticationshared.authorizeS3access(_, commonshared, userattributes, S3Foldersarray)
    }
    else {
      message = 'User ' + username + ' does not exists in DynamoDB Logverz-Identities table. Could not check entitlement to validate access request.\nIdentity Sync may be needed.'
    }
  }

  // if previous steps of authentication and authorization are successfull send messages
  if (message === 'ok') {
    console.log('Debug: At retrevingthe Schema')
    // Retrieve Schema and other information
    if (DataType !== 'Custom' && DataType !== '') {
      // it is a regular schema (not custom).
      var details = {
        source: 'jobproducer.js:handler',
        message: ''
      }

      var [SchemaObject, Registry] = await Promise.all([
        commonshared.getssmparameter(ssmclient, GetParameterCommand, {
          Name: ('/Logverz/Engine/Schemas/' + DataType)
        }, ddclient, PutItemCommand, details),
        commonshared.getssmparameter(ssmclient, GetParameterCommand, {
          Name: '/Logverz/Database/Registry'
        }, ddclient, PutItemCommand, details)
      ])

      var SchemaParameterObject = JSON.parse(SchemaObject.Parameter.Value)
      var Schema = ('{' + SchemaParameterObject.Schema.map(e => e + '\n') + '}').replace(/,'/g, '"').replace(/'/g, '"')

      var S3SelectParameter = SchemaParameterObject.S3SelectParameters.IO
      var DatabaseParameters = commonshared.SelectDBfromRegistry(_, Registry, DatabaseParameters)
      console.log(QueryString)
    }
    else if (DataType !== '') {
      var CustomQueryParametersArray = CustomQueryParameters.split('<!!>')
      var Schema = CustomQueryParametersArray.filter(s => s.includes('CustomQuerySchema'))[0].split('=')[1]
      var S3SelectParameter = CustomQueryParametersArray.filter(s => s.includes('CustomS3Select'))[0].split('=')[1]
      var QueryString = CustomQueryParametersArray.filter(s => s.includes('CustomQueryString'))[0].split('=')[1]
      console.log(QueryString)
    }
    else {
      var message = 'Something went wrong DataTypeSelector was empty.'
      console.log(message)
    }

    TableParameters += '<!!>Creator=' + username + ':' + usertype
    var JobID = commonshared.makeid(12)
    var MessageAttributes = {
      JobID,
      S3Properties: {
        S3Folders,
        S3EnumerationDepth,
        S3SelectParameter
      },
      QueryString,
      Schema,
      DatabaseParameters,
      TableParameters,
      ComputeEnvironment: {
        LogVolume,
        AllocationStrategy,
        PreferedWorkerNumber
      },
      QueryType: DataType,
      Creator: (username + ':' + usertype)
    }

    var reply
    var message = await sendSQSMessage(sqsclient, SendMessageCommand, JOBQueueURL, MessageAttributes)
    if (apigateway === false) {
      console.log('CFN message1:')
      console.log(message)

      return await commonshared.newcfnresponse(event, context, 'SUCCESS', {})
    }
    else {
      reply = {
        status: 200,
        data: JSON.stringify(MessageAttributes),
        header: {}
      }
      console.log(reply)
      return commonshared.apigatewayresponse(reply, event.headers, AllowedOrigins)
    }
  }
  else {
    console.log('CFN message2:')
    console.log(message)

    if (apigateway === false) {
      console.log('done')
      return await commonshared.newcfnresponse(event, context, 'SUCCESS', {})
    }
    else {
      reply = {
        status: 400,
        data: JSON.stringify(message),
        header: {}
      }
      console.log(reply)
      return commonshared.apigatewayresponse(reply, event.headers, AllowedOrigins)
    }
  }
}

async function sendSQSMessage (sqsclient, SendMessageCommand, JOBQueueURL, MessageAttributes) {
  // https://github.com/aws/aws-sdk-js/issues/745
  var params = {
    MessageAttributes: {
      S3Properties: {
        DataType: 'String',
        StringValue: JSON.stringify(MessageAttributes.S3Properties)
      },
      QueryString: {
        DataType: 'String',
        StringValue: MessageAttributes.QueryString
      },
      QueryType: {
        DataType: 'String',
        StringValue: MessageAttributes.QueryType
      },
      Schema: {
        DataType: 'String',
        StringValue: MessageAttributes.Schema
      },
      DatabaseParameters: {
        DataType: 'String',
        StringValue: MessageAttributes.DatabaseParameters
      },
      TableParameters: {
        DataType: 'String',
        StringValue: MessageAttributes.TableParameters
      },
      ComputeEnvironment: {
        DataType: 'String',
        StringValue: JSON.stringify(MessageAttributes.ComputeEnvironment)
      },
      JobID: {
        DataType: 'String',
        StringValue: MessageAttributes.JobID
      }
    },
    MessageBody: '',
    QueueUrl: JOBQueueURL
  }

  params.MessageBody = JSON.stringify({
    requesttime: Date.now()
  })

  const command = new SendMessageCommand(params)
  try {
    const response = await sqsclient.send(command)
    var today = new Date()
    var date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate()
    var time = today.getHours() + ':' + today.getMinutes() + ':' + today.getSeconds()
    var dateTime = date + ' ' + time
    console.log('Sent SQS message ' + dateTime + ' ' + response.MessageId)
    return response
  }
  catch (err) {
    console.log('Error', err)
    return err
  }
}

async function getbatchofparametersHistory (ssmclient, GetParameterHistoryCommand, parametername, NextToken) {
  if (NextToken) {
    var params = {
      Name: parametername,
      // required
      NextToken,
      MaxResults: 50,
      WithDecryption: false
    }
  }
  else {
    var params = {
      Name: parametername,
      // required
      MaxResults: 50,
      WithDecryption: false
    }
  }

  const command = new GetParameterHistoryCommand(params)
  try {
    const data = await ssmclient.send(command)
    var result = {
      Result: 'PASS',
      Data: data
    }
    return result
  }
  catch (err) {
    var result = {
      Result: 'Fail',
      Data: err
    }
    return result
  }
}

async function getallssmparameterhistory (commonshared, ssmclient, GetParameterHistoryCommand, ddclient, PutItemCommand, parametername) {
  var parametersarray = []
  var NextToken

  do {
    var batchofparameters = await getbatchofparametersHistory(ssmclient, GetParameterHistoryCommand, parametername, NextToken)

    if (batchofparameters.Result === 'PASS') {
      if (batchofparameters.Data.NextToken !== undefined) {
        NextToken = batchofparameters.Data.NextToken
      }
    }
    else {
      var ssmallparamhistoryresult = parametername + ':  SSM Parameter retrieval failed.Because ' + batchofparameters.Data
      var details = {
        source: 'jobproducer.js:getallssmparameterhistory',
        message: ssmallparamhistoryresult
      }
      await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'GetParameter', 'Error', 'Infra', details, 'API')
    }

    parametersarray = parametersarray.concat(batchofparameters.Data.Parameters)
  } while (batchofparameters.Data.NextToken !== undefined)

  return parametersarray.slice(-3) // return last 3 item.
}

function matchexecutionwithparameterhistory (executionhistory, S3Folders, TableParameters) {
  var match = false

  for (var i = 0; i < executionhistory.length; i++) {
    var oneexecutionarray = executionhistory[i]
    oneexecutionarray.Value.split('\n')

    var EHTableParameters = oneexecutionarray.Value.split('\n').filter(s => s.includes('TableParameters'))[0].replace('TableParameters:', '').replace(';', '')
    var EHS3Folders = oneexecutionarray.Value.split('\n').filter(s => s.includes('S3Folders'))[0].replace('S3Folders:', '').replace(';', '')
    if (EHTableParameters === TableParameters && EHS3Folders === S3Folders) {
      match = oneexecutionarray
      console.log('match found')
      break
    }
    else {
      console.log('match false')
    }
  }

  return match
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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
