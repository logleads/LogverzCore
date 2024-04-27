/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

// const fs = require('fs');
//const path = require('path')
//const fsPromises = require('fs').promises
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

import { CloudFormationClient, CreateStackCommand, UpdateStackCommand } from "@aws-sdk/client-cloudformation"
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectVersionsCommand } from '@aws-sdk/client-s3'

const params = {}
const environment = {}

export const handler = async (event, context) => {

  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    var commonsharedpath=('file:///'+path.join(__dirname, 'commonsharedv3.js').replace(/\\/g, "/"))
    var commonshared=await GetConfiguration(commonsharedpath,'*')
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
     //TODO consider using the pasted over version from the event source
    params.PublicKeyVersion = '/Logverz/Logic/PublicKey:1'
    params.MaximumCacheTime = '20'
    params.EnableSocialIdenties = 'false'
    params.LocalBundle = 'init.zip'
    environment.localpath = 'file:///' + '/var/task/'
    // params.myKeyPair="";
    environment.BootStrapBucket = process.env.BootStrapBucket
    environment.CFNRole = process.env.CFNRole
    var maskedevent = maskcredentials(JSON.parse(JSON.stringify(event)))
    console.log('THE EVENT: \n' + JSON.stringify(maskedevent) + '\n\n')
    console.log('context RECEIVED: ' + JSON.stringify(context))
  }
  else {
    // Dev environment settings
    var directory = path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'bootstrap', 'mydev.mjs')
    const mydev = await import('file:///' + directory.replace(/\\/g, '/'))
    var commonshared = mydev.commonshared
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
    params.LocalBundle = mydev.params.LocalBundle
    environment.BootStrapBucket = mydev.environment.BootStrapBucket
    environment.localpath = mydev.environment.localpath
    environment.CFNRole = mydev.environment.CFNRole
  }

  environment.templatename = 'Logverz.json'
  params.SourcesBucket = environment.BootStrapBucket
  params.ChildStackName= event.StackId.split("/")[1].replace("serverlessrepo-","")
  
  const s3client = new S3Client({})
  const cfnclient = new CloudFormationClient({});

  const result = await main(event, cfnclient, s3client, commonshared, params, region)
  console.log(result)
  // return result
  return commonshared.newcfnresponse(event, context, 'SUCCESS', {})
}

async function main (event, cfnclient, s3client, commonshared, params, region) {
  console.log('main')

  var initzipversion = 'init_v' + params.SourcesVersion + '.zip'
  params.SourcesPath=initzipversion

  //upload template and initv_x.y.z.zip to serverless bucket
  await Promise.all([
  commonshared.s3putdependencies(environment.localpath + environment.templatename, environment.BootStrapBucket, s3client, PutObjectCommand, fs, fileURLToPath, environment.templatename),
  commonshared.s3putdependencies(path.join(environment.localpath + params.LocalBundle), environment.BootStrapBucket, s3client, PutObjectCommand, fs, fileURLToPath, params.SourcesPath)
  ])

  const cfnresult = await cfnoperation(event, cfnclient, s3client, ListObjectVersionsCommand, DeleteObjectCommand, commonshared, params, environment, region)
  return cfnresult

}

async function cfnoperation (event, cfnclient, s3client, ListObjectVersionsCommand, DeleteObjectCommand, commonshared, params, environment, region) {

  const stackparameters = []

  if (params.Mode === 'StackDelete' && event.RequestType === 'Create') {
    console.log('Inital service call to create the SendDeleteSignal Custom::LambdaFunction')
  }
  else if (params.Mode === 'StackDelete' && event.RequestType === 'Delete') {
    console.log('Starting delete')
    const result = await commonshared.emptybucket(s3client, ListObjectVersionsCommand, DeleteObjectCommand, params.SourcesBucket)
    console.log('Finished all delete')
    return result
  }
  else if (event.RequestType === 'Create') {

    Object.keys(params).map(p => {
      if (p !== 'Mode' && p !== 'SourcesVersion' && p!='LocalBundle' && p!="ChildStackName") {
        const parametervalue = convertparamtostring(params, p)
        const value = {
          ParameterKey: p,
          ParameterValue: parametervalue
        }
        stackparameters.push(value)
      }
    })

    var cfnparams = {
      StackName: params.ChildStackName,
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
    var maskedcfn = maskcredentials(JSON.parse(JSON.stringify(cfnparams)))
    console.log('THE  CFN params: \n' + JSON.stringify(maskedcfn) + '\n\n')

    const command = new CreateStackCommand(cfnparams);
    const response = await cfnclient.send(command);
    return response.StackId
  }
  else if (event.RequestType === 'Update') {

    Object.keys(params).map(p => {

      if (p !== 'Mode' && p !== 'SourcesVersion' && p!='LocalBundle' && p!="ChildStackName") {

        const parametervalue = convertparamtostring(params, p)
        const value = {
          ParameterKey: p,
          ParameterValue: parametervalue
        }
        stackparameters.push(value)
      }
    })

    var cfnparams = {
      StackName: params.ChildStackName,
      Capabilities: [
        'CAPABILITY_NAMED_IAM',
        'CAPABILITY_AUTO_EXPAND'
      ],
      Parameters: stackparameters,
      RoleARN: environment.CFNRole,
      Tags: [JSON.parse(params.Tags)],
      TemplateURL: 'https://' + environment.BootStrapBucket + '.s3.' + region + '.amazonaws.com/' + environment.templatename
    }

    const command = new UpdateStackCommand(cfnparams);
    const response = await cfnclient.send(command);
    return response.StackId
  }
  else {
    console.log('Some other operation.')
  }
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