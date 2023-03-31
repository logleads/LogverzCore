/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
const AWS = require('aws-sdk')
// const fs = require('fs');
const path = require('path')
const fsPromises = require('fs').promises
const params = {}
const environment = {}

module.exports.handler = async function (event, context) {
  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    const arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    params.VPCID = event.ResourceProperties.VPCID
    params.PrivateSubnet = event.ResourceProperties.PrivateSubnet
    params.PublicSubnet = event.ResourceProperties.PublicSubnet
    params.NumberOfControllers = event.ResourceProperties.NumberOfControllers
    params.DBAllocatedStorage = event.ResourceProperties.DBAllocatedStorage
    params.DBInstanceClass = event.ResourceProperties.DBInstanceClass
    params.DBEngineType = event.ResourceProperties.DBEngineType
    params.DBSnapshotID = event.ResourceProperties.DBSnapshotID
    params.DBUserName = event.ResourceProperties.DBUserName
    params.DBUserPasswd = event.ResourceProperties.DBpassword
    params.WebRTCProxyAmiId = event.ResourceProperties.WebRTCProxyAmiId
    params.WebRTCProxyInstanceSize = event.ResourceProperties.WebRTCProxyInstanceSize
    params.WebRTCProxyASGConfig = event.ResourceProperties.WebRTCProxyASGConfig
    params.WebRTCProxyKey = event.ResourceProperties.WebRTCProxyKey
    params.TurnServerAmiId = event.ResourceProperties.TurnServerAmiId
    params.TurnSrvInstanceSize = event.ResourceProperties.TurnSrvInstanceSize
    params.TurnSrvPassword = event.ResourceProperties.TurnSrvPassword
    params.TokenSigningPassphrase = event.ResourceProperties.TokenSigningPassphrase
    params.StageName = event.ResourceProperties.StageName
    params.DBDeploymentMethod = event.ResourceProperties.DBDeploymentMethod
    params.DBPrincipalProperty = event.ResourceProperties.DBPrincipalProperty
    params.SourcesVersion = event.ResourceProperties.SourcesVersion
    params.Mode = event.ResourceProperties.Mode
    params.Tags = event.ResourceProperties.Tags
    params.PublicKeyVersion = '/Logverz/Logic/PublicKey:1'
    params.MaximumCacheTime = '20'
    params.EnableSocialIdenties = 'false'
    environment.localpath = '/var/task/'
    // params.myKeyPair="";
    environment.BootStrapBucket = process.env.BootStrapBucket
    environment.CFNRole = process.env.CFNRole
    var maskedevent = maskcredentials(JSON.parse(JSON.stringify(event)))
    console.log('THE EVENT: \n' + JSON.stringify(maskedevent) + '\n\n')
    console.log('context RECEIVED: ' + JSON.stringify(context))
  } else {
    // Dev environment settings
    const mydev = require(path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'bootstrap', 'mydev.js'))
    var region = mydev.region
    var event = mydev.event
    var context = mydev.context
    params.VPCID = mydev.params.VPCID
    params.PrivateSubnet = mydev.params.PrivateSubnet
    params.PublicSubnet = mydev.params.PublicSubnet
    params.NumberOfControllers = mydev.params.NumberOfControllers
    params.DBAllocatedStorage = mydev.params.DBAllocatedStorage
    params.DBInstanceClass = mydev.params.DBInstanceClass
    params.DBEngineType = mydev.params.DBEngineType
    params.DBSnapshotID = mydev.params.DBSnapshotID
    params.DBUserName = mydev.params.DBUserName
    params.DBUserPasswd = mydev.params.DBpassword
    params.DBDeploymentMethod = mydev.params.DBDeploymentMethod
    params.DBPrincipalProperty = mydev.params.DBPrincipalProperty
    params.WebRTCProxyAmiId = mydev.params.WebRTCProxyAmiId
    params.WebRTCProxyInstanceSize = mydev.params.WebRTCProxyInstanceSize
    params.WebRTCProxyASGConfig = mydev.params.WebRTCProxyASGConfig
    params.WebRTCProxyKey = mydev.params.WebRTCProxyKey
    params.TurnServerAmiId = mydev.params.TurnServerAmiId
    params.TurnSrvInstanceSize = mydev.params.TurnSrvInstanceSize
    params.TurnSrvPassword = mydev.params.TurnSrvPassword
    params.TokenSigningPassphrase = mydev.params.TokenSigningPassphrase
    // params.myKeyPair="";
    params.StageName = mydev.params.StageName
    params.Tags = mydev.params.Tags
    params.PublicKeyVersion = mydev.params.PublicKeyVersion
    params.MaximumCacheTime = mydev.params.MaximumCacheTime
    params.EnableSocialIdenties = mydev.params.EnableSocialIdenties
    params.SourcesVersion = mydev.params.SourcesVersion
    params.Mode = event.ResourceProperties.Mode
    environment.BootStrapBucket = mydev.environment.BootStrapBucket
    environment.localpath = mydev.environment.localpath
    environment.CFNRole = mydev.environment.CFNRole
  }

  environment.templatename = 'Logverz.json'
  params.SourcesBucket = environment.BootStrapBucket
  params.SourcesPath = 'init.zip'

  AWS.config.update({
    region
  })
  const s3 = new AWS.S3({
    apiVersion: '2006-03-01'
  })
  const cloudformation = new AWS.CloudFormation()
  const result = await main(event, cloudformation, s3, params, region)
  console.log(result)
  // return result
  return newcfnresponse(event, context, 'SUCCESS', {})
}

async function main (event, cloudformation, s3, params, region) {
  console.log('main')

  var initzipversion = 'init_v' + params.SourcesVersion + '.zip'
  var remotepath = ''

  if (params.Mode === 'CreateUpdate' && event.RequestType === 'Create') {
    // new stack creation
    remotepath = initzipversion
    await s3putdependencies(environment.localpath + environment.templatename, environment.BootStrapBucket, s3, environment.templatename)
    await s3putdependencies(environment.localpath + 'init.zip', environment.BootStrapBucket, s3, initzipversion)
    params.SourcesPath = remotepath
  } else if (params.Mode === 'CreateUpdate' && event.RequestType === 'Update') {
    // existing stack update
    const cfnparams = {
      // NextToken: 'STRING_VALUE'
    }
    remotepath = 'bin/' + initzipversion
    var allexports = []
    await cfnlistexports(cloudformation, cfnparams, allexports)
    const initbucketname = allexports.filter(e => e.Name === 'InitBucket')[0].Value
    await s3putdependencies(environment.localpath + environment.templatename, environment.BootStrapBucket, s3, environment.templatename)
    await s3putdependencies(environment.localpath + 'init.zip', initbucketname, s3, remotepath)
    params.SourcesPath = remotepath
    // console.log(allexports)
  }

  const cfnresult = await cfnoperation(event, cloudformation, s3, params, environment, region)
  return cfnresult
}

async function cfnoperation (event, cloudformation, s3, params, environment, region) {
  const stackparameters = []
  // var resolveparameters=event.ResourceProperties.ResolveParameters;

  if (params.Mode === 'StackDelete' && event.RequestType === 'Create') {
    console.log('Inital service call to create the SendDeleteSignal Custom::LambdaFunction')
  } else if (params.Mode === 'StackDelete' && event.RequestType === 'Delete') {
    console.log('Starting delete')
    const result = await emptybucket(s3, params.SourcesBucket)
    console.log('Finished all delete')
    return result
  } else if (event.RequestType === 'Create') {
    console.log('\n\n')
    // console.log(JSON.stringify(environment))

    Object.keys(params).map(p => {
      if (p !== 'Mode' && p !== 'SourcesVersion') {
        const parametervalue = convertparamtostring(params, p)
        // console.log(p)
        // console.log(parametervalue)
        const value = {
          ParameterKey: p,
          ParameterValue: parametervalue
        }
        stackparameters.push(value)
      }
    })

    var cfnparams = {
      StackName: 'Logverz',
      Capabilities: [
        'CAPABILITY_NAMED_IAM',
        'CAPABILITY_AUTO_EXPAND'
      ],
      DisableRollback: true,
      EnableTerminationProtection: false,
      Parameters: stackparameters,
      RoleARN: environment.CFNRole,
      Tags: [JSON.parse(params.Tags)],
      TemplateURL: 'https://' + environment.BootStrapBucket + '.s3.' + region + '.amazonaws.com/' + environment.templatename,
      TimeoutInMinutes: '20'
    }
    console.log('The CFN params:\n')
    // TODO use commonshared.masktoken function here
    // console.log(JSON.stringify(cfnparams))
    return await cfncreate(cloudformation, cfnparams)
  } else if (event.RequestType === 'Update') {
    Object.keys(params).map(p => {
      if (p === 'Mode') {
        // skipping Mode
      } else {
        const parametervalue = convertparamtostring(params, p)
        const value = {
          ParameterKey: p,
          ParameterValue: parametervalue
        }
        stackparameters.push(value)
      }
    })

    var cfnparams = {
      StackName: 'LogverzSAR',
      Capabilities: [
        'CAPABILITY_NAMED_IAM',
        'CAPABILITY_AUTO_EXPAND'
      ],
      Parameters: stackparameters,
      RoleARN: environment.CFNRole,
      Tags: [JSON.parse(params.Tags)],
      TemplateURL: 'https://' + environment.BootStrapBucket + '.s3.' + region + '.amazonaws.com/' + environment.templatename
    }
    return await cfnupdate(cloudformation, cfnparams)
  } else {
    console.log('Some other operation.')
  }
}

async function cfnlistexports (cloudformation, cfnparams, allexports = []) {
  const response = await cloudformation.listExports(cfnparams).promise()
  response.Exports.forEach(obj => allexports.push({
    Name: obj.Name,
    Value: obj.Value
  }))

  if (response.NextToken) {
    cfnparams.NextToken = response.NextToken
    await cfnlistexports(cloudformation, cfnparams, allexports) // RECURSIVE CALL
  }
  return allexports
}

async function cfncreate (cloudformation, cfnparams) {
  const promisedcfnresult = new Promise((resolve, reject) => {
    cloudformation.createStack(cfnparams, function (err, data) {
      if (err) {
        console.error(JSON.stringify(err, null, 2))
        reject(err)
      } else {
        // console.log("Query succeeded.");
        resolve(data)
      }
    })
  })
  const cfnresult = await promisedcfnresult
  return cfnresult.StackId
}

async function cfnupdate (cloudformation, cfnparams) {
  const promisedcfnresult = new Promise((resolve, reject) => {
    cloudformation.updateStack(cfnparams, function (err, data) {
      if (err) {
        console.error(JSON.stringify(err, null, 2))
        reject(err)
      } else {
        // console.log("Query succeeded.");
        resolve(data)
      }
    })
  })
  const cfnresult = await promisedcfnresult
  return cfnresult.StackId
}

// async function cfndelete (cloudformation, cfnparams) {
//   const promisedcfnresult = new Promise((resolve, reject) => {
//     cloudformation.deleteStack(cfnparams, function (err, data) {
//       if (err) {
//         console.error(JSON.stringify(err, null, 2))
//         reject(err)
//       } else {
//         // console.log("Query succeeded.");
//         resolve(data)
//       }
//     })
//   })
//   const cfnresult = await promisedcfnresult
//   return cfnresult.StackId
// }

async function s3putdependencies (FileNameandPath, Bucket, s3, FileName) {
  const content = await fsPromises.readFile(FileNameandPath)
  const uploadParams = {
    Bucket,
    Key: FileName,
    Body: content
  }
  const promiseduploadresult = new Promise((resolve, reject) => {
    s3.putObject(uploadParams, function (err, data) {
      if (err) {
        console.error(err)
        reject(err)
      } else {
        console.log('Successfully put dependency ' + FileName + ' to: ' + Bucket + ' bucket.')
        resolve(data)
      }
    })
  })

  const s3result = await promiseduploadresult
  return s3result.ETag
}

async function emptybucket (s3, bucket) {
  const params = {
    Bucket: bucket
    //, MaxKeys: "10"
  }
  var allversions = []
  await getallversions(s3, params, allversions)
  console.log("In bucket '" + bucket + "' the total number of files are " + allversions.length)

  const promises = allversions.map(onefile => {
    const deleteParam = {
      Bucket: onefile[0],
      Key: onefile[1],
      VersionId: onefile[2]
    }
    const removefilepromise = new Promise((resolve, reject) => {
      s3.deleteObject(deleteParam, function (err, data) {
        if (err) {
          console.log(err.code, err.message)
          reject(err)
          // an error occurred
        } else resolve(data) // console.log(data);// successful response
      })
    })

    return removefilepromise
  })

  const resolved = await Promise.all(promises)
  console.log('finished emptying ' + bucket)
  return resolved
}

async function getallversions (s3, params, allversions = []) {
  const response = await s3.listObjectVersions(params).promise()
  response.Versions.forEach(obj => allversions.push([params.Bucket, obj.Key, obj.VersionId]))

  if (response.NextVersionIdMarker) {
    params.VersionIdMarker = response.NextVersionIdMarker
    params.KeyMarker = response.NextKeyMarker

    await getallversions(s3, params, allversions) // RECURSIVE CALL
  }
  return allversions
}

async function newcfnresponse(event, context, responseStatus, responseData){

  return new Promise((resolve, reject) => {
      var responseBody = JSON.stringify({
          Status: responseStatus,
          Reason: "See the details in CloudWatch Log Stream: " + context.logStreamName,
          PhysicalResourceId: context.logStreamName,
          StackId: event.StackId,
          RequestId: event.RequestId,
          LogicalResourceId: event.LogicalResourceId,
          NoEcho: false,
          Data: responseData
      });

      console.log("Response body:\n", responseBody);

      var https = require("https");
      var url = require("url");

      var parsedUrl = url.parse(event.ResponseURL);
      var options = {
          hostname: parsedUrl.hostname,
          port: 443,
          path: parsedUrl.path,
          method: "PUT",
          headers: {
              "content-type": "application/json",
              "content-length": responseBody.length
          }
      };

      var request = https.request(options, function(response) {
          console.log("Status code: " + response.statusCode);
          console.log("Status message: " + response.statusMessage);
          resolve(context.done());
      });

      request.on("error", function(error) {
          console.log("send(..) failed executing https.request(..): " + error);
          reject(context.done(error));
      });

      request.write(responseBody);
      request.end();
  })

}

function convertparamtostring (params, p) {
  if (typeof (params[p]) !== 'string') {
    // convert array to string, dependency of create stack api call
    console.log('The non string params:\n\n')
    console.log(p)
    console.log(params[p])
    console.log('\n\n')
    var parametervalue = (JSON.stringify(params[p])).slice(1, -1).replace(/"/g, '')
  } else {
    var parametervalue = params[p]
  }

  return parametervalue
}

function maskcredentials (mevent) {
  if (mevent.OldResourceProperties !== undefined && mevent.ResourceProperties.TokenSigningPassphrase !== undefined) {
    mevent.ResourceProperties.TokenSigningPassphrase = '****'
    mevent.OldResourceProperties.TokenSigningPassphrase = '****'
  } else if (mevent.ResourceProperties.TokenSigningPassphrase !== undefined) {
    // at first deployment time no OldResourceProperties exists
    mevent.ResourceProperties.TokenSigningPassphrase = '****'
  }

  if (mevent.OldResourceProperties !== undefined && mevent.ResourceProperties.TurnSrvPassword !== undefined) {
    mevent.ResourceProperties.TurnSrvPassword = '****'
    mevent.OldResourceProperties.TurnSrvPassword = '****'
  } else if (mevent.ResourceProperties.TurnSrvPassword !== undefined) {
    // at first deployment time no OldResourceProperties exists
    mevent.ResourceProperties.TurnSrvPassword = '****'
  }

  if (mevent.OldResourceProperties !== undefined && mevent.ResourceProperties.WebRTCProxyKey !== undefined) {
    mevent.ResourceProperties.WebRTCProxyKey = '****'
    mevent.OldResourceProperties.WebRTCProxyKey = '****'
  } else if (mevent.ResourceProperties.WebRTCProxyKey !== undefined) {
    // at first deployment time no OldResourceProperties exists
    mevent.ResourceProperties.WebRTCProxyKey = '****'
  }

  if (mevent.OldResourceProperties !== undefined && mevent.ResourceProperties.DBpassword !== undefined) {
    mevent.ResourceProperties.DBpassword = '****'
    mevent.OldResourceProperties.DBpassword = '****'
  } else if (mevent.ResourceProperties.DBpassword !== undefined) {
    // at first deployment time no OldResourceProperties exists
    mevent.ResourceProperties.DBpassword = '****'
  }

  return mevent
}
