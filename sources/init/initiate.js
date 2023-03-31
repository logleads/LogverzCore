const AWS = require('aws-sdk')
const fs = require('fs')
const path = require('path')
const https = require('https')
const fsPromises = require('fs').promises

// Flatted circular json parser
// https://www.npmjs.com/package/flatted
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

module.exports.handler = async function (event, context) {
  console.log('REQUEST RECEIVED: ' + JSON.stringify(event))
  const Sources = 'sources.zip'
  const Login = 'PortalAccess.zip'
  const Main = 'Portal.zip'
  let ECRRepoName = 'logverz/webrtcproxy'

  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    var commonshared = require('./commonshared')
    const arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var LocalPath = '/var/task/'
    var buildspecoverride = fs.readFileSync('./buildspec_init.yaml', 'utf8')
    var InitBucket = process.env.InitBucket
    var CBProjectName = process.env.CBProject
    var WaitConditionURL = process.env.WaitConditionHandler
    var requesttype = event.RequestType
    var LogicalResourceId = event.LogicalResourceId
    var LogverzBuckets = process.env.LogverzBuckets
    var SourcesBucket = process.env.SourcesBucket
    var SourcesPath = process.env.SourcesPath
    const maskedevent = maskcredentials(JSON.parse(JSON.stringify(event)))
    console.log('THE EVENT: \n' + JSON.stringify(maskedevent) + '\n\n')
    console.log('context RECEIVED: ' + JSON.stringify(context))
    // Debug lambda function environment:
    // var filename =path.resolve("./initenvironment.js");
    // console.log(filename); ///var/task/initenvironment.js
    // var directorycontents=fs.readdirSync("/var/task/")
    // console.log (directorycontents+ "\n\n\n\n")
  }
  else {
    // Dev environment settings
    const mydev = require(path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'initiate', 'mydev.js'))
    var commonshared = mydev.commonshared
    var region = mydev.region
    var LocalPath = mydev.LocalPath
    var buildspecoverride = mydev.buildspecoverride
    var InitBucket = mydev.InitBucket
    var CBProjectName = mydev.CBProjectName
    var WaitConditionURL = mydev.WaitConditionURL
    var LogverzBuckets = mydev.LogverzBuckets
    var SourcesBucket = mydev.SourcesBucket
    var SourcesPath = mydev.SourcesPath
    var event = mydev.event // createPostDeploymentResource //deleteInitiateResource //deletePostDeploymentResource
    var requesttype = event.RequestType // Create,Update,Delete
    var LogicalResourceId = event.LogicalResourceId // InitiateResource
  }

  AWS.config.update({
    region,
    maxRetries: 2,
    httpOptions: {
      timeout: 900000
    }
  })
  const s3 = new AWS.S3({
    apiVersion: '2006-03-01'
  })
  const codebuild = new AWS.CodeBuild()
  const lambda = new AWS.Lambda()
  const apigateway = new AWS.APIGateway()
  const iam = new AWS.IAM()
  const ecr = new AWS.ECR()
  const ssm = new AWS.SSM()
  const LogverzUsersGroupName = 'LogverzUsers' + '-' + region
  const LogverzPowerUsersGroupName = 'LogverzPowerUsers' + '-' + region
  const LogverzDBGroupDefaultDB= 'Logverz-DBGroup-DefaultDB' + '-' + region

  if ((requesttype === 'Create' || requesttype === 'Update') && (LogicalResourceId === 'InitiateResource')) {
    console.log('Initiating build using source ' + SourcesBucket + '/' + SourcesPath + '\n\n')

    await Promise.all([
      s3putdependencies(LocalPath + Sources, InitBucket, s3, 'bin/' + Sources),
      s3putdependencies(LocalPath + Login, InitBucket, s3, 'bin/' + Login),
      s3putdependencies(LocalPath + Main, InitBucket, s3, 'bin/' + Main)
    ])

    const buildresult = await startbuild(codebuild, CBProjectName, 'bin/' + Sources, InitBucket, buildspecoverride)

    let i = 1
    const waittime = 4000
    let prebuildphasestatus = ''
    const buildid = []
    buildid.push(buildresult.build.id)
    let exitcondition = false
    console.log(buildid)

    do {
      await timeout(waittime)

      console.log('waiting for CodeBuild PrebuildPhase Success ' + (i * (waittime / 1000)) + ' sec.')
      const buildstatus = await commonshared.getbuildstatus(codebuild, buildid)
      if (buildstatus.builds[0].phases.length >= 6) {
        prebuildphasestatus = buildstatus.builds[0].phases[5].phaseStatus //
      }

      if (prebuildphasestatus === 'SUCCEEDED') {
        exitcondition = true
        console.log('buildstatus: ' + prebuildphasestatus + ' initiating signaling.')
        await timeout(waittime)
        const wctrigerresult = await signalwaitcondition(WaitConditionURL)
        console.log('WaitCondition trigger result: ' + wctrigerresult)
        // console.log()
      }
      i++
    }
    while (!exitcondition)
    console.log('finished InitiateResource building lambdas stage')

    return await commonshared.newcfnresponse(event, context, 'SUCCESS', {})
  }
  else if ((requesttype === 'Create' || requesttype === 'Update') && (LogicalResourceId === 'PostDeploymentResource')) {
    await invokeidentitysync(lambda)
    await redeploy(apigateway, event)
    //await updatelambdas(commonshared, lambda, event)
    console.log('finished PostDeploymentResource actions')
    //return response(event, context, 'SUCCESS', 'postdeploymentresults')
    return await commonshared.newcfnresponse(event, context, 'SUCCESS', {})
  }
  else if ((requesttype === 'Delete') && (LogicalResourceId === 'PostDeploymentResource')) {
    // only perform delete if the Postdeployment resource is called. Post deployment resource only runs at stack creation or when the stack is deleted by the user. 
    // Note failed stack creation (role back) when postdeployment resource does not exists is not handled...
    console.log("I hoped it does not come to this. ;-( ... So long!")

    console.log("Removing parameters starting with '/Logverz'\n\n")
    const Logverzparameters = await getallparameters(ssm)
    await removeallparameters(ssm, Logverzparameters)

    if (event.ResourceProperties.ECRRepoName !== undefined) {
      // if CFN deployment canceled by user the property is not defined, in case its undefined we set the default parameter
      ECRRepoName = event.ResourceProperties.ECRRepoName
    }
    const imageIds = await listecrimages(ecr, ECRRepoName)
    if (imageIds.imageIds.length > 0) {
      console.log('Removing ECR images: \n\n' + JSON.stringify(imageIds.imageIds))
      await removeecrimages(ecr, ECRRepoName, imageIds.imageIds)
    }

    console.log(`Detaching users from group ${LogverzUsersGroupName}\n\n`)
    var LogverzUsersGroupMembers = await getallusersofgroup(iam, LogverzUsersGroupName)
    await removealliamusersfromgroup(iam, LogverzUsersGroupMembers, LogverzUsersGroupName)

    console.log(`Detaching users from group ${LogverzPowerUsersGroupName}\n\n`)
    var LogverzUsersGroupMembers = await getallusersofgroup(iam, LogverzPowerUsersGroupName)
    await removealliamusersfromgroup(iam, LogverzUsersGroupMembers, LogverzPowerUsersGroupName)

    console.log(`Detaching users from group ${LogverzDBGroupDefaultDB}\n\n`)
    var LogverzUsersGroupMembers = await getallusersofgroup(iam, LogverzDBGroupDefaultDB)
    await removealliamusersfromgroup(iam, LogverzUsersGroupMembers, LogverzDBGroupDefaultDB)

    // Interate  all Logverz S3 buckets List objects versions and delete them.
    for await (var bucket of LogverzBuckets.split(',')) {
      await emptybucket(s3, bucket)
    }
    console.log('finished delete')
    //return response(event, context, 'SUCCESS', 'deleted')
    return await commonshared.newcfnresponse(event, context, 'SUCCESS', {})
  }
  else if (requesttype === 'Delete') {
    console.log(`Delete action, initiated from ${LogicalResourceId}, (not 'PostDeploymentResource'), not doing a thing.`)
    //happens at the end of version updates
    //return response(event, context, 'SUCCESS', 'deleted')
    return await commonshared.newcfnresponse(event, context, 'SUCCESS', {})
  }
}

async function emptybucket (s3, bucket) {
  const params = {
    Bucket: bucket
    //, MaxKeys: "10"
  }
  var allversions
  await getallversions(s3, params, allversions = [])
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
        }
        else {
          resolve(data)
        } // console.log(data);// successful response
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

// async function updatelambdas (commonshared, lambda, event) {
//   const apigwurl = event.ResourceProperties.ApiGWurl
//   const functionnames = event.ResourceProperties.SetAPIGWUrl.split(',')

//   for await (var functionname of functionnames) {
//     const data = {
//       AttributeName: 'APIGatewayURL',
//       AttributeValue: apigwurl
//     }
//     await commonshared.updatelambdaenvironmentvariables(lambda, functionname, data)
//   }
//   console.log('finished with lambda environment variables update')
// }

async function removeallparameters (ssm, Logverzparameters) {
  const promises = Logverzparameters.map(parametername => {
    const params = {
      Name: parametername
    }

    const removeparameterpromise = new Promise((resolve, reject) => {
      ssm.deleteParameter(params, function (err, data) {
        if (err) {
          console.log(err, err.stack)
          reject(err)
          // an error occurred
        }
        else {
          resolve(data) 
        }// console.log(data);// successful response
      })
    })

    return removeparameterpromise
  })

  const resolved = await Promise.all(promises)
  return resolved
}

async function getallparameters (ssm) {
  let parametersarray = []
  let NextToken

  do {
    var batchofparameters = await getbatchofparameters(ssm, NextToken)
    if (batchofparameters.NextToken !== undefined) {
      NextToken = batchofparameters.NextToken
    }
    parametersarray = parametersarray.concat(batchofparameters.Parameters.map(n => n.Name))
  } while (batchofparameters.NextToken !== undefined)

  return parametersarray
}

async function getbatchofparameters (ssm, NextToken) {
  if (NextToken) {
    var params = {
      Path: '/Logverz',
      NextToken,
      Recursive: true,
      WithDecryption: true
    }
  }
  else {
    var params = {
      Path: '/Logverz',
      Recursive: true,
      WithDecryption: true
    }
  }

  return new Promise(function (resolve, reject) {
    ssm.getParametersByPath(params, function (err, data) {
      if (err) {
        console.log(err, err.stack) // an error occurred
        reject(err)
      }
      else {
        resolve(data) // successful response
      }
    })
  })
}

async function removeecrimages (ecr, ECRRepoName, imageIds) {
  const params = {
    imageIds,
    repositoryName: ECRRepoName
  }

  return new Promise(function (resolve, reject) {
    ecr.batchDeleteImage(params, function (err, data) {
      if (err) {
        console.log(err, err.stack) // an error occurred
        reject(err)
      } 
      else {
        resolve(data) // successful response
      }
    })
  })
}

async function listecrimages (ecr, ECRRepoName) {
  const params = {
    repositoryName: ECRRepoName
  }

  return new Promise(function (resolve, reject) {
    ecr.listImages(params, function (err, data) {
      if (err) {
        console.log(err.code, err.message) // an error occurred
        // reject(error)
        resolve([])
      }
      else {
        resolve(data) // successful response
      }
    })
  })
}

async function removealliamusersfromgroup (iam, LogverzUsersGroupMembers, LogverzUsersGroupName) {
  const promises = LogverzUsersGroupMembers.map(username => {
    const params = {
      GroupName: LogverzUsersGroupName,
      UserName: username
    }

    const removeuserpromise = new Promise((resolve, reject) => {
      iam.removeUserFromGroup(params, function (err, data) {
        if (err) {
          console.log(err, err.stack)
          reject(err)
          // an error occurred
        }
        else {
          resolve(data) // console.log(data);// successful response
        }
      })
    })

    return removeuserpromise
  })

  const resolved = await Promise.all(promises)
  return resolved
}

function getuserofgroupsegment (iam, Marker, GroupName) {
  if (Marker) {
    var params = {
      GroupName,
      Marker
      // MaxItems: "2"
    }
  }
  else {
    var params = {
      GroupName
      //, MaxItems: "2"
    }
  }
  return new Promise(function (resolve, reject) {
    iam.getGroup(params, function (err, data) {
      if (err) {
        console.log(err.code, err.message)
        // reject(error)
        resolve([])
        // an error occurred
      }
      else {
        resolve(data) // successful response
      }
    })
  })
}

async function getallusersofgroup (iam, GroupName) {
  let groupmembershiparray = []
  let Marker

  do {
    var groupsegment = await getuserofgroupsegment(iam, Marker, GroupName)
    if (groupsegment.Marker !== undefined) {
      Marker = groupsegment.Marker
    }

    if (groupsegment.length !== 0) {
      groupmembershiparray = groupmembershiparray.concat(groupsegment.Users.map(n => n.UserName))
    }
  } while (groupsegment.Marker !== undefined)

  return groupmembershiparray
}

async function redeploy (apigateway, event) {
  // cli:
  // aws apigateway create-deployment --rest-api-id <> --region <> --stage-name <>
  const params = {
    restApiId: event.ResourceProperties.RestApiId,
    /* required */
    cacheClusterEnabled: false,
    description: 'Post deployment automatic deployment of APIGW',
    stageName: event.ResourceProperties.RestApiStageName
  }

  // return await
  const deploymentpromise = new Promise((resolve, reject) => {
    apigateway.createDeployment(params, function (err, data) {
      if (err) {
        console.log(err.code, err.message)
        resolve(err)
        // an error occurred
      }
      else {
        resolve(data) // console.log(data);// successful response
      }
    })
  })

  const deploymentresults = await deploymentpromise
  return deploymentresults
}

async function invokeidentitysync (lambda) {
  const lambdaparams = {
    FunctionName: 'Logverz-IdentitySync',
    InvocationType: 'RequestResponse', // bydefault Requestreponse times out after 120 sec, hence the timout 900000 value in config
    LogType: 'None'
  }

  // return await
  const lambdapromise = new Promise((resolve, reject) => {
    lambda.invoke(lambdaparams, function (err, data) {
      if (err) {
        console.log(err, err.stack)
        reject(err)
      // an error occurred
      }
      else { 
        resolve(data) // console.log(data);// successful response
      }
    })
  })
  const lambdaresult = await lambdapromise
  return lambdaresult
}

async function startbuild (codebuild, CBProjectName, Sources, InitBucket, buildspecoverride) {
  // aws codebuild batch-get-projects --names Logverz001eLogverz_Controller
  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CodeBuild.html#startBuild-property
  const params = {
    projectName: CBProjectName,
    buildspecOverride: buildspecoverride,
    sourceLocationOverride: InitBucket + '/' + Sources,
    timeoutInMinutesOverride: '15'
  }

  const promisedbuild = new Promise((resolve, reject) => {
    codebuild.startBuild(params, function (err, data2) {
      if (err) {
        console.log(err, err.stack)
        reject(err)
      } // an error occurred
      else {     //console.log(stringify(data2));           // successful response
        resolve(data2)
      }
    })
  })
  const buildresult = await promisedbuild
  return buildresult
}

async function s3putdependencies (LocalPath, InitBucket, s3, FileName) {
  const content = await fsPromises.readFile(LocalPath)
  const uploadParams = {
    Bucket: InitBucket,
    Key: FileName,
    Body: content
  }
  const promiseduploadresult = new Promise((resolve, reject) => {
    s3.putObject(uploadParams, function (err, data) {
      if (err) {
        console.error(err)
        reject(err)
      }
      else {
        console.log('Successfully put dependency ' + FileName + ' to: ' + InitBucket + ' bucket.')
        resolve(data)
      }
    })
  })

  const s3result = await promiseduploadresult
  return s3result.ETag
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function signalwaitcondition (WaitConditionURL) {
  WaitConditionURL = WaitConditionURL.replace('https://', '')
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      Status: 'SUCCESS',
      UniqueId: 'Some UniqueId:' + Math.random(),
      Reason: 'Building Lambda Functions sources are Complete'
    })

    const options = {
      hostname: WaitConditionURL.split('amazonaws.com')[0] + 'amazonaws.com',
      port: 443,
      path: WaitConditionURL.split('amazonaws.com')[1],
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }

    const req = https.request(options, (res) => {
      // console.log(`statusCode: ${res.statusCode}`)

      res.on('data', (d) => {
        process.stdout.write(d)
      })

      resolve(res.statusCode)
    })

    req.on('error', (error) => {
      console.error(error)
      reject(error)
    })

    req.write(data)
    req.end()
  })
}

function maskcredentials (mevent) {
  if (mevent.OldResourceProperties !== undefined && mevent.ResourceProperties.TokenSigningPassphrase !== undefined) {
    mevent.ResourceProperties.TokenSigningPassphrase = '****'
    mevent.OldResourceProperties.TokenSigningPassphrase = '****'
  }
  else if (mevent.ResourceProperties.TokenSigningPassphrase !== undefined) {
    // at first deployment time no OldResourceProperties exists
    mevent.ResourceProperties.TokenSigningPassphrase = '****'
  }

  if (mevent.OldResourceProperties !== undefined && mevent.ResourceProperties.TurnSrvPassword !== undefined) {
    mevent.ResourceProperties.TurnSrvPassword = '****'
    mevent.OldResourceProperties.TurnSrvPassword = '****'
  }
  else if (mevent.ResourceProperties.TurnSrvPassword !== undefined) {
    // at first deployment time no OldResourceProperties exists
    mevent.ResourceProperties.TurnSrvPassword = '****'
  }

  if (mevent.OldResourceProperties !== undefined && mevent.ResourceProperties.WebRTCProxyKey !== undefined) {
    mevent.ResourceProperties.WebRTCProxyKey = '****'
    mevent.OldResourceProperties.WebRTCProxyKey = '****'
  }
  else if (mevent.ResourceProperties.WebRTCProxyKey !== undefined) {
    // at first deployment time no OldResourceProperties exists
    mevent.ResourceProperties.WebRTCProxyKey = '****'
  }

  if (mevent.OldResourceProperties !== undefined && mevent.ResourceProperties.DBpassword !== undefined) {
    mevent.ResourceProperties.DBpassword = '****'
    mevent.OldResourceProperties.DBpassword = '****'
  }
  else if (mevent.ResourceProperties.DBpassword !== undefined) {
    // at first deployment time no OldResourceProperties exists
    mevent.ResourceProperties.DBpassword = '****'
  }

  return mevent
}

// const samplebuildresult = {
//   id: 'initenvironmentLogverz_InitEnvironment:796142a6-14a5-491a-9149-ac8661a3f0b9',
//   arn: 'arn:aws:codebuild:ap-southeast-2:036523543218:build/initenvironmentLogverz_InitEnvironment:796142a6-14a5-491a-9149-ac8661a3f0b9',
//   buildNumber: 4,
//   startTime: '2020-08-04T22:41:32.044Z',
//   currentPhase: 'QUEUED',
//   buildStatus: 'IN_PROGRESS',
//   projectName: 'initenvironmentLogverz_InitEnvironment',
//   phases: [{
//     phaseType: 'SUBMITTED',
//     phaseStatus: 'SUCCEEDED',
//     startTime: '2020-08-04T22:41:32.044Z',
//     endTime: '2020-08-04T22:41:32.154Z',
//     durationInSeconds: 0
//   }, {
//     phaseType: 'QUEUED',
//     startTime: '2020-08-04T22:41:32.154Z'
//   }],
//   source: {
//     type: 'S3',
//     location: 'initenvironment-initbucket-vouaml1xdb1f/sources.zip',
//     buildspec: 'version: 0.2\r\nphases:\r\n  install:\r\n    runtime-versions:\r\n       nodejs: 10\r\n  pre_build:\r\n    commands:\r\n       - export InitBucket\r\n       - echo "Downloading sources.zip to build environment for installation."\r\n       - aws s3 cp s3://$InitBucket/sources.zip sources.zip\r\n       - mkdir sources && unzip sources.zip -d ./sources && cd sources && chmod +x ./npminstall.sh ./zipcopy.sh\r\n  build:\r\n    commands:\r\n       - ./npminstall.sh\r\n       - ./zipcopy.sh\r\n  post_build:\r\n    commands:\r\n       - echo "CloudFormation stack creation comes here"',
//     insecureSsl: false
//   },
//   artifacts: {
//     location: ''
//   },
//   cache: {
//     type: 'NO_CACHE'
//   },
//   environment: {
//     type: 'LINUX_CONTAINER',
//     image: 'aws/codebuild/standard:6.0',
//     computeType: 'BUILD_GENERAL1_SMALL',
//     environmentVariables: [{
//       name: 'InitBucket',
//       value: 'initenvironment-initbucket-vouaml1xdb1f',
//       type: 'PLAINTEXT'
//     }, {
//       name: 'VPCID',
//       value: 'vpc-8e7949e9',
//       type: 'PLAINTEXT'
//     }, {
//       name: 'PrivateSubnet',
//       value: 'subnet-01575b46ba269e342,subnet-01d8c55079b654934',
//       type: 'PLAINTEXT'
//     }],
//     privilegedMode: false,
//     imagePullCredentialsType: 'CODEBUILD'
//   },
//   serviceRole: 'arn:aws:iam::036523543218:role/initenvironmentLogverz_Init_Role',
//   logs: {
//     deepLink: 'https://console.aws.amazon.com/cloudwatch/home?region=ap-southeast-2#logEvent:group=null;stream=null',
//     cloudWatchLogsArn: 'arn:aws:logs:ap-southeast-2:036523543218:log-group:null:log-stream:null'
//   },
//   timeoutInMinutes: 5,
//   queuedTimeoutInMinutes: 480,
//   buildComplete: false,
//   initiator: 'admin',
//   encryptionKey: 'arn:aws:kms:ap-southeast-2:036523543218:alias/aws/s3'
// }
