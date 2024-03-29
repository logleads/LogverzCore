/* eslint-disable no-redeclare */
/* eslint-disable no-var */
const AWS = require('aws-sdk')
var jwt = require('jsonwebtoken')
const path = require('path')
var _ = require('lodash')
var db = require('./db').db
var MaximumCacheTime=process.env.MaximumCacheTime

if (db.collections.length === 0) {

  if (MaximumCacheTime === undefined){
    MaximumCacheTime =1
  }
  var identity = db.addCollection('Logverz-Identities', {
    ttl: MaximumCacheTime * 60 * 1000
  })

  // Loading test permissions
  // var guser=require(path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment','events','info','googleuserpermissions.json'));
  // var awsuser=require(path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment','events','info','awsuserpermissions.json'));
  // identity.data.push(guser[0]); //guser[0];
}
console.log('start')

module.exports.handler = async function (event, context) {

  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    var arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var accountnumber = arnList[4]
    var commonshared = require('./shared/commonshared')
    var authenticationshared = require('./shared/authenticationshared')
    var cert = process.env.PublicKey
    var AllowedOrigins = process.env.AllowedOrigins
    var UserPoolClient = process.env.UserPoolClient
    var UserPoolId = process.env.UserPoolId
    var maskedevent = commonshared.masktoken(JSON.parse(JSON.stringify(event)))
    console.log('REQUEST RECEIVED: \n' + JSON.stringify(context) + '\n\n')
    console.log('REQUEST RECEIVED: \n' + JSON.stringify(maskedevent) + '\n\n')
  } else {
    // Dev environment settings
    const mydev = require(path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'info', 'mydev.js'))
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

  AWS.config.update({
    region
  })
  console.log(AWS.VERSION)
  var docClient = new AWS.DynamoDB.DocumentClient()
  var message = 'ok'

  var tokenobject = commonshared.ValidateToken(jwt, event.headers, cert)
  console.log(tokenobject)
  if (tokenobject.state === true) {
    var username = tokenobject.value.user.split(':')[1]
    var usertype = 'User' + tokenobject.value.user.split(':')[0]
    var userattributes = identity.chain().find({
      Type: usertype,
      Name: username
    }).data() // .collection.data[0];

    if (userattributes.length === 0) {
      var userattributes = await authenticationshared.getidentityattributes(commonshared, docClient, username, usertype)
      console.log('local cache EMPTY -> retrived identity from DynamoDB')
      userattributes = userattributes.Items[0]
      identity.insert(userattributes)
    } else {
      console.log('local cache MATCH')
      var userattributes = userattributes[0]
    }
  } else {
    // invalid token
    message = tokenobject.value
  }

  if (message === 'ok') {
    // its comming from authorized source: aws events or api gateway
    console.log('Calling Main')
    var reply = await main(event, commonshared, authenticationshared, _, userattributes, region, accountnumber, UserPoolClient, UserPoolId)
  } else {
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

async function main (event, commonshared, authenticationshared, _, userattributes, region, accountnumber, UserPoolClient, UserPoolId) {
  console.log('main')
  var rds = new AWS.RDS({
    apiVersion: '2014-10-31'
  })
  const s3 = new AWS.S3()
  var cfn = new AWS.CloudFormation()
  var ec2 = new AWS.EC2()
  var cb = new AWS.CodeBuild()
  var SSM = new AWS.SSM()
  var account = new AWS.Account({region: 'us-east-1'});
  const dynamodb = new AWS.DynamoDB()
  var cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider()
  var autoscaling = new AWS.AutoScaling()

  const service = commonshared.getquerystringparameter(event.queryStringParameters.service)
  var apicall = commonshared.getquerystringparameter(event.queryStringParameters.apicall)
  var parameters = commonshared.getquerystringparameter(event.queryStringParameters.Parameters)
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
  } else {
    var responsecode = 200
    switch (service) {
      case 'autoscaling':
        apicall = apicalltranslator(apicall)
        // TODO try catch and request logging here.
        var result = JSON.stringify(await autoscaling[apicall](JSON.parse(parameters)).promise())
        // ASGstatus(autoscaling,AutoScalingGroupNames)
        break
      case 'rds':
        apicall = apicalltranslator(apicall)
        var rdsinstancename = JSON.parse(parameters).DBInstanceIdentifier
        var dbsettings = await commonshared.GetRDSSettings(rds, (JSON.parse(parameters)))

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
          var result = JSON.stringify(await ListBucketDetails(s3, SSM, dynamodb, commonshared))
        } else if (apicall === 'ListBucket') {
          parameters = JSON.parse(parameters)
          var subfolderlist = []
          var tobeprocessed = []
          tobeprocessed = commonshared.TransformInputValues(parameters.Path, parameters.S3EnumerationDepth, _)

          do {
            await commonshared.walkfolders(_, s3, dynamodb, commonshared, tobeprocessed, subfolderlist, getCommonPrefixes)
          }
          while (((subfolderlist.length + tobeprocessed.length) !== 0) && (tobeprocessed.length !== 0))

          var result = JSON.stringify(TransformOutputValues(parameters.Path, subfolderlist))
          if (result ==="{}"){
            //the function did not have permission to list folders eg (bucket policies) it results in empty list and currently frontend datacollection s3 tree listing fails with an empty list. 
            result="{\""+parameters.Path.replace('s3://',"")+"\":{"+"\"\": \"/\"}}"
            
          }
        } else {
          var result = apicalltranslator(apicall)
        }

        break
      case 'ec2':
        apicall = apicalltranslator(apicall)
        var result = JSON.stringify(await ec2[apicall](JSON.parse(parameters)).promise())
        break
      case 'cloudformation':
        apicall = apicalltranslator(apicall)
        var result = JSON.stringify(await cfn[apicall](parameters).promise())
        break
      case 'codebuild':
        apicall = apicalltranslator(apicall)
        var result = JSON.stringify(await cb[apicall](parameters).promise())
        break
      case 'ssm':
        parameters = JSON.parse(parameters)
        if (apicall === 'GetParameter') {
          apicall = apicalltranslator(apicall)
          var result = JSON.stringify(await SSM[apicall](parameters).promise())
        } else if (apicall === 'DescribeParameters') {
          var result = await describessmparameters(SSM, dynamodb, commonshared, parameters)
        }
        // TODO add autosclaing group info here.
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
          var info= await getContactInfo(account)

          var result = JSON.stringify({
            Admin,
            LisaPowerUsers: poweruser, // todo rename this to LogverzPowerUsers, in parallel making the LisaPowerUsers->LogverzPowerUsers change in the main web application
            LisaUsers: true, // todo rename this to LogverzUsers, in parallel making the LisaUsers->LogverzUsers change in the main web application
            UserName: userattributes.Name + ':' + userattributes.Type,
            IamGroups: userattributes.IAMGroups.map(i => i + ':GroupAWS'),
            "AccountId": accountnumber,
            "AccountOwner": info
          })

          console.log(apicall)
        } else if ((apicall === 'GetGroup') && (adminuser || adminGmember || poweruser)) {
          // looking up parameters for other users if needed using identity.chain().find() and await authenticationshared.getidentityattributes()
        }
        // TODO add autosclaing group and RDS info here.
        break
      case 'cognito-idp':
        if (UserPoolId === '[]') {
          // Authentication provider is not set.
          var result = '[]'
        } else {
          var upparams = {
            UserPoolId /* required */
          }

          try {
            var response = await cognitoidentityserviceprovider.listIdentityProviders(upparams).promise()
            var result = JSON.stringify(response.Providers.map(p => p.ProviderName))
          } catch (err) {
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

  var reply = {
    status: responsecode,
    data: result,
    header: {}
  }

  return reply
} // main

const getCommonPrefixes = async (dynamodb, commonshared, s3, params, allKeys = []) => {
  // https://stackoverflow.com/questions/42394429/aws-sdk-s3-best-way-to-list-all-keys-with-listobjectsv2
  // const response = await s3.listObjectsV2(params).promise();

  var promisedresponse = new Promise((resolve, reject) => {
    s3.listObjectsV2(params, function (err, data) {
      if (err) {
        console.error('Error with input parameters:\n', JSON.stringify(params), JSON.stringify(err, null, 2))
        resolve({
          Result: 'Fail',
          Data: {
                "error":err,
                "input":params
                }
        })
      } else {
        resolve({
          Result: 'PASS',
          Data: data
        })
      }
    })
  })
  var response = await promisedresponse
  if (response.Result !== 'PASS') {
    var details = {
      source: 'info.js:getCommonPrefixes',
      message: JSON.stringify(response.Data.error.message) +"   " +JSON.stringify(response.Data.input)  
    }
    await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'S3List', 'Error', 'Infra', details, 'API')
  } else {
    response = response.Data
    if (response.CommonPrefixes.length === 0) {
      // There are objects in the given prefix so it needs to be explictly scoped to the prefix level, otherwise it  would also contain the subfolders.
      // listing bucket 06/ without delimiter it would contain files from 06/01, 06/02, 06/abc subfolders.
      var delimeter = '/'
      allKeys.push([response.Prefix, params.Bucket, delimeter])
    } else {
      var delimiter = '*'
      response.CommonPrefixes.forEach(obj => allKeys.push([obj.Prefix, params.Bucket, delimiter]))
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

async function ListBucketDetails (s3, SSM, dynamodb, commonshared) {
  var params = {}

  try {
    var data = (await s3.listBuckets(params).promise())
    var Bucketnames = data.Buckets.map(b => b.Name)
  } catch (e) {
    var Bucketnames = e
    console.log(Bucketnames)
  }

  var promises = Bucketnames.map(
    bucket => {
      return getbucketlocation(s3, bucket)
    }
  )
  const BucketRegions = await Promise.all(promises)

  var regions = _.uniqWith(BucketRegions.map(r => r.LocationConstraint), _.isEqual)

  // remove undefined from the array. Undefined value is generate if bucket policy prevents access outside of the vpc
  // or only some principls are whitelisted not including the Logverz-info function's role.
  // regions=_.without(regions, undefined)
  regions = _.compact(regions)
  console.log(regions)

  var promises2 = regions.map(
    region => {
      var details = {
        source: 'info.js:main/getssmparameter',
        message: ''
      }
      return commonshared.getssmparameter(SSM, {
        Name: `/aws/service/global-infrastructure/regions/${region}/longName`,
        WithDecryption: false
      }, dynamodb, details)
    }
  )
  var LongNames = await Promise.all(promises2)
  LongNames = LongNames.map(ln => {
    var object = {
      Region: ln.Parameter.Name.split('/')[5],
      Geography: ln.Parameter.Value
    }
    return object
  })

  var resultobject = []
  BucketRegions.map(bucket => {
    if (bucket.code === 'AccessDenied') {
      console.log("Error retrieving bucket details, bucket is not accessible to the Logverz info function's role")
    } else {
      var region = bucket.LocationConstraint
      var bucketname = bucket.$response.request.params.Bucket
      var locationlong = LongNames[_.findKey(LongNames, function (l) {
        return l.Region === region
      })].Geography
      var location = locationlong.substring(locationlong.indexOf('(') + 1, locationlong.indexOf(')'))
      resultobject.push({
        BucketName: bucketname,
        Region: region,
        Geography: location
      })
    }
  })

  var accessdeniedbucket = _.differenceWith(Bucketnames, resultobject.map(bns => bns.BucketName), _.isEqual)
  console.log('List of buckets with permission issues, not accessible to Logverz-Info:\n' + accessdeniedbucket)
  return resultobject
}

async function getbucketlocation (s3, bucket) {
  var params = {
    Bucket: bucket
  }

  try {
    var s3bucketlocation = (await s3.getBucketLocation(params).promise())
  } catch (e) {
    var s3bucketlocation = e
  }

  return s3bucketlocation
}

async function describessmparameters (SSM, dynamodb, commonshared, params) {
  var allparameters = []
  do {
    try {
      var ssmresult = await SSM.describeParameters(params).promise()
      allparameters.push(ssmresult.Parameters)
      params.NextToken = ssmresult.NextToken
    } catch (error) {
      ssmresult = params + ':     ' + error + ' Describing SSM Parameters failed.'
      console.error(ssmresult)
      var details = {
        source: 'info.js:handler',
        message: ssmresult
      }
      await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'ListParameters', 'Error', 'Infra', details, 'API')
    }
  } while (ssmresult.NextToken !== undefined)
  allparameters = _.flatten(allparameters)
  return JSON.stringify(allparameters) // allparameters;
}

function apicalltranslator (apicall) {
  // AWS api calls and Nodejs sdk calls differ example ListStacks(IAM api) vs listStacks(JS sdk)
  switch (apicall) {
    case 'ListStacks':
      var result = 'listStacks'
      break
    case 'DescribeInstances':
      var result = 'describeInstances'
      break
    case 'DescribeRegions':
      var result = 'describeRegions'
      break
    case 'ListProjects':
      var result = 'listProjects'
      break
    case 'GetParameter':
      var result = 'getParameter'
      break
    case 'ListBuckets':
      var result = 'listBuckets'
      break
    case 'DescribeDBInstances':
      var result = 'describeDBInstances'
      break
    case 'DescribeAutoScalingGroups':
      var result = 'describeAutoScalingGroups'
      break
    default:
      var result = 'unknown api call'
  }
  return result
}

function RDSstatus (DBInstanceStatus) {
  var rdsstatus = null

  if (DBInstanceStatus === 'stopped') {
    var rdsstatus = 'RDS server is starting, usually it takes about 3-4 minutes to become available.'
  } else if (DBInstanceStatus === 'rebooting') {
    var rdsstatus = 'Database is in "rebooting" state, it may take 6-8 minutes for it to become available'
  } else if (DBInstanceStatus === 'starting') {
    var rdsstatus = 'Database is in "starting" state, it may take 1-3 minutes for it to become available'
  } else if (DBInstanceStatus === 'available' || DBInstanceStatus === 'configuring-enhanced-monitoring') {
    var rdsstatus = 'ok'
  } else if (DBInstanceStatus === 'stopping') {
    var rdsstatus = 'Database is in "stopping" state, it may take a few minutes for it to stop and start, and become available'
  } else if (DBInstanceStatus === 'upgrading') {
    var rdsstatus = 'Database is in "upgrading" state, depending on configuration and datavolume, it  may take from few minutes to few hours to complete, and become available.'
  } else if (DBInstanceStatus === 'modifying') {
    var rdsstatus = 'Database is in "modifying" state, which happens at configuration changes such as scale up-scaldown, networking change. Depending on configuration and datavolume, it  may take from few minutes to few hours to complete, and become available.'
  } else {
    var rdsstatus = 'unhandled state.'
    // rdsstatus={"status":500,"data":message,"header":{}};
  }

  return rdsstatus
}

async function getContactInfo(account){
  var info={}

  //2.1178.0
  //minimum version 2.1181.0
  //https://github.com/aws/aws-sdk-js/blob/master/CHANGELOG.md
  if (parseFloat(AWS.VERSION) > parseFloat(2.1181)){
      var promisedresponse = new Promise((resolve, reject) => {
        account.getContactInformation({}, function(err, data) {
          if (err){
            console.log(err, err.stack);
            //reject(err)
            resolve({})
          } // an error occurred
          else{
            resolve(data);     //      // successful response
          }
        })
      })
    
      var response = await promisedresponse
      if (response.ContactInformation){
        info =response.ContactInformation.CompanyName
      }
  }

  return info
}
