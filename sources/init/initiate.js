import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

import { CodeBuildClient, StartBuildCommand, BatchGetBuildsCommand } from '@aws-sdk/client-codebuild'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { APIGatewayClient, CreateDeploymentCommand } from '@aws-sdk/client-api-gateway'
import { IAMClient, GetGroupCommand, RemoveUserFromGroupCommand } from '@aws-sdk/client-iam'
import { ECRClient, ListImagesCommand, BatchDeleteImageCommand } from '@aws-sdk/client-ecr'
import { SSMClient, DeleteParameterCommand, GetParametersByPathCommand } from '@aws-sdk/client-ssm'
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectVersionsCommand } from '@aws-sdk/client-s3'

// Flatted circular json parser
// https://www.npmjs.com/package/flatted
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

export const handler = async (event, context) => {
  console.log('REQUEST RECEIVED: ' + JSON.stringify(event))
  const Sources = 'sources.zip'
  const Login = 'PortalAccess.zip'
  const Main = 'Portal.zip'
  let ECRRepoName = 'logverz/webrtcproxy'

  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings

    var commonsharedpath=('file:///'+path.join(__dirname, 'commonsharedv3.js').replace(/\\/g, "/"))
    var commonshared=await GetConfiguration(commonsharedpath,'*')
    const arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var LocalPath = 'file:///'+'/var/task/'
    var buildspecoverride = fs.readFileSync('./buildspec_init.yaml', 'utf8')
    var InitBucket = process.env.InitBucket
    var CBProjectName = process.env.CBProject
    var WaitConditionURL = process.env.WaitConditionHandler
    var requesttype = event.RequestType
    var LogicalResourceId = event.LogicalResourceId
    var LogverzBuckets = process.env.LogverzBuckets
    var SourcesBucket = process.env.SourcesBucket
    var SourcesPath = process.env.SourcesPath
    const maskedevent = commonshared.maskcredentials(JSON.parse(JSON.stringify(event)))
    console.log('THE EVENT: \n' + JSON.stringify(maskedevent) + '\n\n')
    console.log('context RECEIVED: ' + JSON.stringify(context))
    // Debug lambda function environment:
    // var filename =path.resolve("./initiate.js");
    // console.log(filename); ///var/task/initenvironment.js
    // var directorycontents=fs.readdirSync("/var/task/")
    // console.log (directorycontents+ "\n\n\n\n")
  }
  else {
    // Dev environment settings
    var directory = path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'initiate', 'mydev.mjs')
    const mydev = await import('file:///' + directory.replace(/\\/g, '/'))
    var commonshared = mydev.commonshared
    var region = mydev.region
    var LocalPath = mydev.LocalPath
    var buildspecoverride = mydev.buildspecoverride
    var InitBucket = mydev.InitBucket
    var CBProjectName = mydev.CBProjectName
    var WaitConditionURL = mydev.WaitConditionURL
    var LogverzBuckets = mydev.LogverzBuckets
    var SourcesBucket = mydev.InitBucket
    var SourcesPath = mydev.SourcesPath
    var event = mydev.event
    var context = mydev.context
    var requesttype = event.RequestType
    var LogicalResourceId = event.LogicalResourceId
  }

  var config = {
    region,
    maxRetries: 2,
    httpOptions: {
      timeout: 900000
    }
  }

  const s3client = new S3Client(config)
  const cbclient = new CodeBuildClient(config)
  const ssmclient = new SSMClient(config)
  const ecrclient = new ECRClient(config)
  const iamclient = new IAMClient(config)
  const lmdclient = new LambdaClient(config)
  const agwclient = new APIGatewayClient(config)

  var LogverzUsersGroupName = 'LogverzUsers' + '-' + region
  const LogverzPowerUsersGroupName = 'LogverzPowerUsers' + '-' + region
  const LogverzDBGroupDefaultDB = 'Logverz-DBGroup-DefaultDB' + '-' + region

  if ((requesttype === 'Create' || requesttype === 'Update') && (LogicalResourceId === 'InitiateResource')) {
    console.log('Initiating build using source ' + SourcesBucket + '/' + SourcesPath + '\n\n')

    await Promise.all([
      commonshared.s3putdependencies(LocalPath + Sources, InitBucket, s3client, PutObjectCommand, fs, fileURLToPath, 'bin/' + Sources),
      commonshared.s3putdependencies(LocalPath + Login, InitBucket, s3client, PutObjectCommand, fs, fileURLToPath, 'bin/' + Login),
      commonshared.s3putdependencies(LocalPath + Main, InitBucket, s3client, PutObjectCommand, fs, fileURLToPath, 'bin/' + Main)
    ])

    const buildresult = await startbuild(cbclient, CBProjectName, 'bin/' + Sources, InitBucket, buildspecoverride)

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
      const buildstatus = await commonshared.getbuildstatus(cbclient, BatchGetBuildsCommand, buildid)
      if (buildstatus.builds[0].phases.length >= 6) {
        prebuildphasestatus = buildstatus.builds[0].phases[5].phaseStatus //
      }

      if (prebuildphasestatus === 'SUCCEEDED') {
        exitcondition = true
        console.log('buildstatus: ' + prebuildphasestatus + ' initiating signaling.')
        await timeout(waittime)
        const wctrigerresult = await signalwaitcondition(WaitConditionURL)
        console.log('WaitCondition trigger result: ' + wctrigerresult)
      }
      i++
    }
    while (!exitcondition)
    console.log('finished InitiateResource building lambdas stage')

    return await commonshared.newcfnresponse(event, context, 'SUCCESS', {})
  }
  else if ((requesttype === 'Create' || requesttype === 'Update') && (LogicalResourceId === 'PostDeploymentResource')) {
    console.log('starting PostDeploymentResource actions')

    await Promise.all([
      invokeidentitysync(lmdclient),
      redeploy(agwclient, event)
    ])
    console.log('finished PostDeploymentResource actions')
    // return response(event, context, 'SUCCESS', 'postdeploymentresults')
    return await commonshared.newcfnresponse(event, context, 'SUCCESS', {})
  }
  else if ((requesttype === 'Delete') && (LogicalResourceId === 'PostDeploymentResource')) {
    // only perform delete if the Postdeployment resource is called. Post deployment resource only runs at stack creation or when the stack is deleted by the user.
    // Note failed stack creation (role back) when postdeployment resource does not exists is not handled...
    console.log('I hoped it does not come to this. ;-( ... So long!')

    console.log("Removing parameters starting with '/Logverz'\n\n")
    const Logverzparameters = await getallparameters(ssmclient)
    await removeallparameters(ssmclient, Logverzparameters)

    if (event.ResourceProperties.ECRRepoName !== undefined) {
      // if CFN deployment canceled by user the property is not defined, in case its undefined we set the default parameter
      ECRRepoName = event.ResourceProperties.ECRRepoName
    }
    const imageIds = await listecrimages(ecrclient, ECRRepoName)
    if (imageIds.imageIds.length > 0) {
      console.log('Removing ECR images: \n\n' + JSON.stringify(imageIds.imageIds))
      await removeecrimages(ecrclient, ECRRepoName, imageIds.imageIds)
    }

    console.log(`Detaching users from group ${LogverzUsersGroupName}\n\n`)
    var LogverzUsersGroupMembers = await getallusersofgroup(iamclient, LogverzUsersGroupName)
    await removealliamusersfromgroup(iamclient, LogverzUsersGroupMembers, LogverzUsersGroupName)

    console.log(`Detaching users from group ${LogverzPowerUsersGroupName}\n\n`)
    var LogverzUsersGroupMembers = await getallusersofgroup(iamclient, LogverzPowerUsersGroupName)
    await removealliamusersfromgroup(iamclient, LogverzUsersGroupMembers, LogverzPowerUsersGroupName)

    console.log(`Detaching users from group ${LogverzDBGroupDefaultDB}\n\n`)
    var LogverzUsersGroupMembers = await getallusersofgroup(iamclient, LogverzDBGroupDefaultDB)
    await removealliamusersfromgroup(iamclient, LogverzUsersGroupMembers, LogverzDBGroupDefaultDB)

    // Interate  all Logverz S3 buckets List objects versions and delete them.
    for await (var bucket of LogverzBuckets.split(',')) {
      await commonshared.emptybucket(s3client, ListObjectVersionsCommand, DeleteObjectCommand, bucket)
    }
    console.log('finished delete')
    // return response(event, context, 'SUCCESS', 'deleted')
    return await commonshared.newcfnresponse(event, context, 'SUCCESS', {})
  }
  else if (requesttype === 'Delete') {
    console.log(`Delete action, initiated from ${LogicalResourceId}, (not 'PostDeploymentResource'), not doing a thing.`)
    // happens at the end of version updates
    // return response(event, context, 'SUCCESS', 'deleted')
    return await commonshared.newcfnresponse(event, context, 'SUCCESS', {})
  }
}

async function removeallparameters (ssmclient, Logverzparameters) {
  const promises = Logverzparameters.map(parametername => {
    const params = {
      Name: parametername
    }
    const command = new DeleteParameterCommand(params)
    const response = ssmclient.send(command)
    return response
  })

  const resolved = await Promise.all(promises)
  return resolved
}

async function getallparameters (ssmclient) {
  let parametersarray = []
  let NextToken

  do {
    var batchofparameters = await getbatchofparameters(ssmclient, NextToken)
    if (batchofparameters.NextToken !== undefined) {
      NextToken = batchofparameters.NextToken
    }
    parametersarray = parametersarray.concat(batchofparameters.Parameters.map(n => n.Name))
  } while (batchofparameters.NextToken !== undefined)

  return parametersarray
}

async function getbatchofparameters (ssmclient, NextToken) {
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

  const command = new GetParametersByPathCommand(params)
  const response = await ssmclient.send(command)
  return response
}

async function removeecrimages (ecrclient, ECRRepoName, imageIds) {
  const params = {
    imageIds,
    repositoryName: ECRRepoName
  }

  const command = new BatchDeleteImageCommand(params)
  const response = await ecrclient.send(command)
  return response
}

async function listecrimages (ecrclient, ECRRepoName) {
  // TODO make it paginated like getuserofgroupsegment or getbatchofparameters
  const params = {
    repositoryName: ECRRepoName
  }

  const command = new ListImagesCommand(params)
  const response = await ecrclient.send(command)
  return response
}

async function removealliamusersfromgroup (iamclient, LogverzUsersGroupMembers, LogverzUsersGroupName) {
  const promises = LogverzUsersGroupMembers.map(username => {
    const params = {
      GroupName: LogverzUsersGroupName,
      UserName: username
    }

    const command = new RemoveUserFromGroupCommand(params)
    const response = iamclient.send(command)
    return response
  })

  const resolved = await Promise.all(promises)
  return resolved
}

async function getuserofgroupsegment (iamclient, Marker, GroupName) {
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

  const command = new GetGroupCommand(params)
  const response = await iamclient.send(command)
  return response
}

async function getallusersofgroup (iamclient, GroupName) {
  let groupmembershiparray = []
  let Marker

  do {
    var groupsegment = await getuserofgroupsegment(iamclient, Marker, GroupName)
    if (groupsegment.Marker !== undefined) {
      Marker = groupsegment.Marker
    }

    if (groupsegment.length !== 0) {
      groupmembershiparray = groupmembershiparray.concat(groupsegment.Users.map(n => n.UserName))
    }
  } while (groupsegment.Marker !== undefined)

  return groupmembershiparray
}

async function redeploy (agwclient, event) {
  // cli:
  // aws apigateway create-deployment --rest-api-id <> --region <> --stage-name <>
  const params = {
    restApiId: event.ResourceProperties.RestApiId,
    // required
    cacheClusterEnabled: false,
    description: 'Post deployment automatic deployment of APIGW',
    stageName: event.ResourceProperties.RestApiStageName
  }

  const command = new CreateDeploymentCommand(params)
  const response = await agwclient.send(command)
  return response
}

async function invokeidentitysync (lmdclient) {
  const lambdaparams = {
    FunctionName: 'Logverz-IdentitySync',
    InvocationType: 'RequestResponse', // bydefault Requestreponse times out after 120 sec, hence the timout 900000 value in config
    LogType: 'None'
  }
  const command = new InvokeCommand(lambdaparams)
  const response = await lmdclient.send(command)
  console.log('Result of the identity sync function:' + response.$metadata.httpStatusCode)
  return response
}

async function startbuild (cbclient, CBProjectName, Sources, InitBucket, buildspecoverride) {
  const params = {
    projectName: CBProjectName,
    buildspecOverride: buildspecoverride,
    sourceLocationOverride: InitBucket + '/' + Sources,
    timeoutInMinutesOverride: 15
  }

  const command = new StartBuildCommand(params)
  const buildresult = await cbclient.send(command)

  return buildresult
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function signalwaitcondition (WaitConditionURL) {
  const data = JSON.stringify({
    Status: 'SUCCESS',
    UniqueId: 'Some UniqueId:' + Math.random(),
    Reason: 'Building Lambda Functions sources are Complete'
  })

  var response = await fetch(WaitConditionURL, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    },
    method: 'PUT',
    body: data
  })

  const result = await response.text()
  return result
}

async function GetConfiguration (directory, value) {
  
  //Kudos: https://stackoverflow.com/questions/71432755/how-to-use-dynamic-import-from-a-dependency-in-node-js
  const moduleText = fs.readFileSync(fileURLToPath(directory), 'utf-8').toString();
  const moduleBase64 = Buffer.from(moduleText).toString('base64');
  const moduleDataURL = `data:text/javascript;base64,${moduleBase64}`;
  if (value !=="*"){
      var data = (await import(moduleDataURL))[value];
  }
  else{
      var data = (await import(moduleDataURL));
  }
  return data
}