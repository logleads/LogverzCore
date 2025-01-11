/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import _ from 'lodash'
import jwt from 'jsonwebtoken'
import loki from 'lokijs'

import { SSMClient, GetParameterCommand, DescribeParametersCommand } from '@aws-sdk/client-ssm'
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds'
import { AutoScalingClient, DescribeAutoScalingGroupsCommand } from '@aws-sdk/client-auto-scaling'
import { S3Client, ListBucketsCommand, GetBucketLocationCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
// import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation"
// import { CodeBuildClient, ListProjectsCommand } from '@aws-sdk/client-codebuild'
import { AccountClient, GetContactInformationCommand } from '@aws-sdk/client-account'
import { CognitoIdentityProviderClient, ListIdentityProvidersCommand } from '@aws-sdk/client-cognito-identity-provider'
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2'

import { BlobServiceClient } from '@azure/storage-blob'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
}

export const handler = async (event, context) => {
  console.log('start')
  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    var arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var accountnumber = arnList[4]
    var commonsharedpath = ('file:///' + path.join(__dirname, './shared/commonsharedv3.js').replace(/\\/g, '/'))
    var commonshared = await GetConfiguration(commonsharedpath, '*')
    var authenticationsharedpath = ('file:///' + path.join(__dirname, './shared/authenticationsharedv3.js').replace(/\\/g, '/'))
    var authenticationshared = await GetConfiguration(authenticationsharedpath, '*')
    var cert = process.env.PublicKey
    var AllowedOrigins = process.env.AllowedOrigins
    var UserPoolClient = process.env.UserPoolClient
    var UserPoolId = process.env.UserPoolId
    var maskedevent = commonshared.masktoken(JSON.parse(JSON.stringify(event)))
    var maskedcontext = commonshared.masktoken(JSON.parse(JSON.stringify(context)))
    console.log('REQUEST RECEIVED: \n' + JSON.stringify(maskedcontext) + '\n\n')
    console.log('THE EVENT: \n' + JSON.stringify(maskedevent) + '\n\n')
  }
  else {
    // Dev environment settings
    var directory = path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'info', 'mydev.mjs')
    const mydev = await import('file:///' + directory.replace(/\\/g, '/'))
    var region = mydev.region
    var accountnumber = mydev.accountnumber
    var commonshared = mydev.commonshared
    var authenticationshared = mydev.authenticationshared
    var event = mydev.event
    var context = mydev.context
    var cert = mydev.cert
    var AllowedOrigins = mydev.AllowedOrigins
    var UserPoolClient = mydev.UserPoolClient
    var UserPoolId = mydev.UserPoolId
  }
  var arnList = (context.invokedFunctionArn).split(':')

  const rdsclient = new RDSClient({})// {apiVersion: '2014-10-31'}
  const asgclient = new AutoScalingClient({})
  const ddclient = new DynamoDBClient({ region })
  const docClient = DynamoDBDocumentClient.from(ddclient)
  const ssmclient = new SSMClient({})
  const s3client = new S3Client({})
  // const cfnclient = new CloudFormationClient({})
  // const cbclient = new CodeBuildClient({})
  const cipcclient = new CognitoIdentityProviderClient({})
  const accclient = new AccountClient({ region: 'us-east-1' })
  const ec2client = new EC2Client({})

  var message = 'ok'

  if (event.clientContext !== undefined) {
    // using step function invocation
    var authparameters = event.clientContext
  }
  else if (Object.keys(event).length === 0) {
    // using collection function direct lambda invocation
    var authparameters = context.clientContext
  }
  else {
    // std apigw invocation
    var authparameters = event.headers
  }

  var tokenobject = commonshared.ValidateToken(jwt, authparameters, cert)
  console.log(tokenobject)
  if (tokenobject.state === true) {
    var username = tokenobject.value.Name
    var usertype = tokenobject.value.Type
    var userattributes = identity.chain().find({
      Type: usertype,
      Name: username
    }).data() // .collection.data[0];

    if (userattributes.length === 0) {
      var userattributes = await authenticationshared.getidentityattributes(docClient, QueryCommand, username, usertype)
      console.log('local cache EMPTY -> retrived identity from DynamoDB')
      userattributes = userattributes.Items[0]
      identity.insert(userattributes)
    }
    else {
      console.log('local cache MATCH')
      var userattributes = userattributes[0]
    }
  }
  else {
    // invalid token
    message = tokenobject.value
  }

  if (message === 'ok') {
    // its comming from authorized source: aws events or api gateway or stepfunction
    console.log('Calling Main')
    var reply = await main(context, event, rdsclient, asgclient, ec2client, ddclient, ssmclient, s3client, cipcclient, accclient, commonshared, authenticationshared, _, userattributes, region, accountnumber, UserPoolClient, UserPoolId)
  }
  else {
    // its invalid token
    console.error(message)
    reply = {
      status: 400,
      data: message,
      header: {}
    }
  }

  var result = commonshared.apigatewayresponse(reply, event.headers, AllowedOrigins)

  return result
}

async function main (context, event, rdsclient, asgclient, ec2client, ddclient, ssmclient, s3client, cipcclient, accclient, commonshared, authenticationshared, _, userattributes, region, accountnumber, UserPoolClient, UserPoolId) {
  console.log('main')

  var stepfunction = false

  if (event.clientContext !== undefined) {
    // step function call
    stepfunction = true
    var service = commonshared.getquerystringparameter(event.clientContext.service)
    var apicall = commonshared.getquerystringparameter(event.clientContext.apicall)
    var parameters = commonshared.getquerystringparameter(event.clientContext.Parameters)
  }
  else if (Object.keys(event).length === 0) {
    // continous ingestion direct lambda call
    var service = commonshared.getquerystringparameter(context.clientContext.service)
    var apicall = commonshared.getquerystringparameter(context.clientContext.apicall)
    var parameters = commonshared.getquerystringparameter(context.clientContext.Parameters)
  }
  else {
    // std api gw calls
    var service = commonshared.getquerystringparameter(event.queryStringParameters.service)
    var apicall = commonshared.getquerystringparameter(event.queryStringParameters.apicall)
    var parameters = commonshared.getquerystringparameter(event.queryStringParameters.Parameters)
  }

  var resource = authenticationshared.setIAMresource(apicall, parameters, region, accountnumber)

  var action = {
    Resource: resource,
    Operation: service + ':' + apicall
  }
  var authorization = authenticationshared.authorize(_, commonshared, action, userattributes)
  if (authorization.status !== 'Allow') {
    // request not authorized
    var responsecode = 400
    var result = authorization.Reason
    console.log(result)
  }
  else {
    var responsecode = 200
    switch (service) {
      case 'autoscaling':
        const asgcommand = new DescribeAutoScalingGroupsCommand(JSON.parse(parameters))
        var result = JSON.stringify((await asgclient.send(asgcommand)))
        break
      case 'rds':

        var rdsinstancename = JSON.parse(parameters).DBInstanceIdentifier
        const rdscommand = new DescribeDBInstancesCommand({ DBInstanceIdentifier: rdsinstancename })
        const dbsettings = await rdsclient.send(rdscommand)

        var DBInstanceStatus = dbsettings.DBInstances[0].DBInstanceStatus
        var RDSstatusmessage = RDSstatus(DBInstanceStatus)
        var object = {
          origin: dbsettings.DBInstances[0],
          extra: {
            statusmessage: RDSstatusmessage
          }
        }
        var result = JSON.stringify(object)

        console.log('\n\nDB instance: ' + rdsinstancename + ' \nstatus: ' + DBInstanceStatus)
        break
      case 's3':
        if (apicall === 'ListAllMyBuckets') {
          var result = JSON.stringify(await ListBucketDetails(s3client, ssmclient, ddclient, commonshared))
        }
        else if (apicall === 'ListBucket') {
          parameters = JSON.parse(parameters)
          var subfolderlist = []
          var tobeprocessed = []
          const callerid = ''
          const jobid = ''
          // tobeprocessed = commonshared.TransformInputValues(parameters.Path, parameters.S3EnumerationDepth, _)
          tobeprocessed = await commonshared.TransformInputValues(s3client, GetBucketLocationCommand, parameters.Path, parameters.S3EnumerationDepth, _)

          do {
            // await commonshared.walkfolders(_, s3, dynamodb, commonshared, tobeprocessed, subfolderlist, getCommonPrefixes)
            await commonshared.walkfolders(_, ListObjectsV2Command, ddclient, PutItemCommand, commonshared, tobeprocessed, subfolderlist, getCommonPrefixes, callerid, jobid)
          }
          while (((subfolderlist.length + tobeprocessed.length) !== 0) && (tobeprocessed.length !== 0))

          var result = JSON.stringify(TransformOutputValues(parameters.Path, subfolderlist))
          if (result === '{}') {
            // the function did not have permission to list folders eg (bucket policies) it results in empty list and currently frontend datacollection s3 tree listing fails with an empty list.
            result = '{"' + parameters.Path.replace('s3://', '') + '":{' + '"": "/"}}'
          }
        }
        else {
          console.log('unhandled s3 command')
        }

        break
      case 'ec2':
        const ec2command = new DescribeInstancesCommand(JSON.parse(parameters))
        var result = await ec2client.send(ec2command)
        break
      case 'cloudformation':
        if (apicall === 'SignalResource') {
          //this code is used by the Logverz-StartDBfunction to signal db start failure to the initiating stack 
          let customevent={
            "StackId": event.clientContext.StackId,
            "RequestId": event.clientContext.RequestId,
            "LogicalResourceId": event.clientContext.LogicalResourceId,
            "ResponseURL":decodeURIComponent(JSON.parse(parameters).Endpoint)
          }
          let customcontext={
            "logStreamName": "",
            "PhysicalResourceId": "",
          }
          await commonshared.newcfnresponse(customevent, customcontext, 'FAILED', {})
          var result = "{}"
        }
        else {
          console.log('unhandled cfn command')
        }
        break
      // case 'codebuild':
      // apicall = apicalltranslator(apicall)
      // var result = JSON.stringify(await cb[apicall](parameters).promise())
      // break
      case 'ssm':
        parameters = JSON.parse(parameters)
        if (apicall === 'GetParameter') {
          const details = {
            source: 'info.js:main/getssmparameter',
            message: ''
          }
          var result = JSON.stringify(await commonshared.getssmparameter(ssmclient, GetParameterCommand, parameters, ddclient, PutItemCommand, details))
        }
        else if (apicall === 'DescribeParameters') {
          var result = await describessmparameters(ssmclient, ddclient, PutItemCommand, commonshared, parameters)
        }

        break
      case 'iam':
        var Admin = false
        var adminuser = false
        var adminGmember = false
        var poweruser = false

        if (userattributes.Policies.UserAttached.length !== 0) {
          adminuser = userattributes.Policies.UserAttached.map(p => JSON.parse(p).PolicyName === 'AdministratorAccess').includes(true)
        }
        if (userattributes.Policies.GroupAttached.length !== 0) {
          adminGmember = userattributes.Policies.GroupAttached.map(p => JSON.parse(p).PolicyName === 'AdministratorAccess').includes(true)
        }
        if (userattributes.IAMGroups.map(g => g === 'LogverzPowerUsers' + '-' + region).includes(true)) {
          poweruser = true
        }

        if ((apicall === 'GetGroup') && (event.queryStringParameters.username === 'self')) {
          if (adminuser || adminGmember) {
            Admin = true
          }
          // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/account/command/GetContactInformationCommand/
          const command = new GetContactInformationCommand({})
          const info = (await accclient.send(command)).ContactInformation.CompanyName

          var result = JSON.stringify({
            Admin,
            LisaPowerUsers: poweruser, // todo rename this to LogverzPowerUsers, in parallel making the LisaPowerUsers->LogverzPowerUsers change in the main web application
            LisaUsers: true, // todo rename this to LogverzUsers, in parallel making the LisaUsers->LogverzUsers change in the main web application
            UserName: userattributes.Name + ':' + userattributes.Type,
            IamGroups: userattributes.IAMGroups.map(i => i + ':GroupAWS'),
            AccountId: accountnumber,
            AccountOwner: info
          })
        }
        break
      case 'cognito-idp':
        if (UserPoolId === '[]') {
          // Authentication provider is not set.
          var result = '[]'
        }
        else {
          var upparams = {
            UserPoolId
          }

          try {
            // var response = await cognitoidentityserviceprovider.listIdentityProviders(upparams).promise()
            const cipscommand = new ListIdentityProvidersCommand(upparams)
            const response = await cipcclient.send(cipscommand)
            var result = JSON.stringify(response.Providers.map(p => p.ProviderName))
          }
          catch (err) {
            console.log('Lambda function Logverz-Authentiation has ' + UserPoolId + ' a resource policy associated to it, where:' + err)
          }
        }
        break
      default:
        var responsecode = 500
        var result = 'unknown service'
                // var contenttype="text/html"
    }
  }

  if (stepfunction === true) {
    result = JSON.parse(result)
  }
  var reply = {
    status: responsecode,
    data: result,
    header: {}
  }

  return reply
} // main

async function getCommonPrefixes (currentdepth, region, jobid, callerid, ddclient, PutItemCommand, commonshared, ListObjectsV2Command, params, allKeys = []) {
  // TODO move this and controller.js equivalent to commonshared.
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

function TransformOutputValues (input, subfolderlist) {
  // input=input.substr(0,input.length-1).replace("s3://","").replace(/\//g, '.');
  // input=input.replace("/$","").replace("s3://","").replace(/\//g, '.');
  var result = {}
  // _.setWith(result,input,null, Object);

  for (var i = 0; i < subfolderlist.length; i++) {
    var item = subfolderlist[i]
    var path = (item[1] + '/' + item[0].substr(0, item[0].length - 1)).replace(/\//g, '.')
    var result = _.setWith(result, path, item[2], Object)
  }

  return result
}

async function ListBucketDetails (s3client, ssmclient, ddclient, commonshared) {
  const params = {
    // MaxBuckets: Number("15"),
    // ContinuationToken: ""
  }

  var responses = []
  let response
  do {
    // list all the buckets
    const command = new ListBucketsCommand(params)
    response = await s3client.send(command)
    responses.push(response.Buckets)

    if (response.ContinuationToken !== undefined) { // response !==undefined &&
      params.ContinuationToken = response.ContinuationToken
    }
  } // until there are no more bukets to list
  while (response.ContinuationToken !== undefined)
  const BucketNames = _.flatten(responses).map(b => b.Name)

  // get bucket's location
  var promises = BucketNames.map(
    bucket => {
      return getbucketlocation(s3client, bucket)
    }
  )

  // compact is used to remove undefined from the array. Undefined value is generated if
  // bucket policy prevents access outside of the vpc or only some principls are whitelisted not including the Logverz-info function's role.
  const BucketRegions = _.compact(await Promise.all(promises))
  var regions = _.uniqWith(BucketRegions.map(r => r.Region), _.isEqual)
  // once having the unique region ids get the corresponsing names
  var regionnames = await getregionname(commonshared, ssmclient, ddclient, regions)
  console.log(regionnames)
  var resultobject = []

  BucketRegions.map(bucket => {
    var locationlong = regionnames[_.findKey(regionnames, function (rn) {
      return rn.Region === bucket.Region
    })].Geography

    var Geography = locationlong.substring(locationlong.indexOf('(') + 1, locationlong.indexOf(')'))
    resultobject.push({
      BucketName: bucket.BucketName,
      Region: bucket.Region,
      Geography
    })
  })
  return resultobject
}

async function getregionname (commonshared, ssmclient, ddclient, regions) {
  const promises = regions.map(
    region => {
      const details = {
        source: 'info.js:main/getssmparameter',
        message: ''
      }
      const param = {
        Name: `/aws/service/global-infrastructure/regions/${region}/longName`,
        WithDecryption: false
      }
      return commonshared.getssmparameter(ssmclient, GetParameterCommand, param, ddclient, PutItemCommand, details)
    }
  )

  let LongNames = await Promise.all(promises)
  LongNames = LongNames.map(ln => {
    const object = {
      Region: ln.Parameter.Name.split('/')[5],
      Geography: ln.Parameter.Value
    }
    return object
  })

  return LongNames
}

async function getbucketlocation (s3client, bucket) {
  const params = { // GetBucketLocationRequest
    Bucket: bucket
  }
  let s3bucketlocation
  let result
  const command = new GetBucketLocationCommand(params)
  try {
    s3bucketlocation = await s3client.send(command)
    result = {
      BucketName: bucket,
      Region: s3bucketlocation.LocationConstraint
    }
  }
  catch (e) {
    s3bucketlocation = e
    // console.log(e)
    console.log('Bucket not accessible to Logverz-Info function:\n' + bucket)
  }

  return result
}

async function describessmparameters (ssmclient, ddclient, PutItemCommand, commonshared, parameters) {
  var allparameters = []
  let ssmresult
  const command = new DescribeParametersCommand(parameters)
  do {
    try {
      ssmresult = await ssmclient.send(command)
      allparameters.push(ssmresult.Parameters)
      parameters.NextToken = ssmresult.NextToken
    }
    catch (error) {
      ssmresult = parameters + ':     ' + error + ' Describing SSM Parameters failed.'
      console.error(ssmresult)
      var details = {
        source: 'info.js:handler',
        message: ssmresult
      }
      await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'ListParameters', 'Error', 'Infra', details, 'API')
    }
  } while (ssmresult.NextToken !== undefined)

  allparameters = _.flatten(allparameters)
  return JSON.stringify(allparameters)
}

function RDSstatus (DBInstanceStatus) {
  var rdsstatus = null

  if (DBInstanceStatus === 'stopped') {
    var rdsstatus = 'RDS server is stopped, when starting usually it takes about 3-5 minutes to become available.'
  }
  else if (DBInstanceStatus === 'rebooting') {
    var rdsstatus = 'Database is in "rebooting" state, it may take 6-8 minutes for it to become available'
  }
  else if (DBInstanceStatus === 'starting') {
    var rdsstatus = 'Database is in "starting" state, it may take 1-3 minutes for it to become available'
  }
  else if (DBInstanceStatus === 'available' || DBInstanceStatus === 'configuring-enhanced-monitoring') {
    var rdsstatus = 'ok'
  }
  else if (DBInstanceStatus === 'stopping') {
    var rdsstatus = 'Database is in "stopping" state, it may take a few minutes for it to stop and start, and become available'
  }
  else if (DBInstanceStatus === 'upgrading') {
    var rdsstatus = 'Database is in "upgrading" state, depending on configuration and datavolume, it  may take from few minutes to few hours to complete, and become available.'
  }
  else if (DBInstanceStatus === 'modifying') {
    var rdsstatus = 'Database is in "modifying" state, which happens at configuration changes such as scale up-scaldown, networking change. Depending on configuration and datavolume, it  may take from few minutes to few hours to complete, and become available.'
  }
  else {
    var rdsstatus = 'unhandled state.'
    // rdsstatus={"status":500,"data":message,"header":{}};
  }

  return rdsstatus
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

async function ListBlobStorage(){
  const account = "logleadstest1"
  const sas = "/?sv=2022-11-02&ss=b&srt=sco&sp=rlitf&.....SECRET...."
  const blobServiceClient = new BlobServiceClient(`https://${account}.blob.core.windows.net${sas}`)

  const options = {
    includeDeleted: false,
    includeMetadata: true,
    includeSystem: true,
//    prefix: containerNamePrefix
  }

  let i = 1;
  const containers = blobServiceClient.listContainers(options);
  for await (const container of containers) {
    console.log(`Container ${i++}: ${container.name}`);
  }
  
}