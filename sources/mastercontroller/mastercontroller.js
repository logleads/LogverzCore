/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

import path from 'path'
import fs from 'fs'
import _ from 'lodash'
import { fileURLToPath } from 'url'
import { stringify } from 'flatted'

import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { CodeBuildClient, ListBuildsForProjectCommand, StartBuildCommand, BatchGetBuildsCommand, BatchGetProjectsCommand } from '@aws-sdk/client-codebuild'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const handler = async (event, context) => {
  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    var commonsharedpath = ('file:///' + path.join(__dirname, './shared/commonsharedv3.js').replace(/\\/g, '/'))
    var commonshared = await GetConfiguration(commonsharedpath, '*')
    var arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var SQSMessageQueues = process.env.SQSMessageQueues
    var WorkerFunction = process.env.WorkerFunction
    console.log('REQUEST RECEIVED: ' + JSON.stringify(event))
    console.log('CONTEXT RECEIVED: ' + JSON.stringify(context))
  }
  else {
    // Dev environment settings
    var directory = path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'mastercontroller', 'mydev.mjs')
    const mydev = await import('file:///' + directory.replace(/\\/g, '/'))
    var region = mydev.region
    var commonshared = mydev.commonshared
    var SQSMessageQueues = mydev.SQSMessageQueues
    var WorkerFunction = mydev.WorkerFunction
    var event = mydev.event
  }

  var cbbuildprojects = SQSMessageQueues.split('<!!>').map(value => value.split('=')[0])

  const cbclient = new CodeBuildClient({})
  const ddclient = new DynamoDBClient({})

  var availablecontrollers = await listavailablecontrollers(cbclient, cbbuildprojects)

  var onejob = event.Records[0].messageAttributes
  var ComputeEnvironment = JSON.parse(onejob.ComputeEnvironment.stringValue)
  var specifiedenvironment = getenvironmentsize(ComputeEnvironment.LogVolume) // LogVolume

  var specifiedstrategy = ComputeEnvironment.AllocationStrategy
  var selectedcontroller = selectcontroller(availablecontrollers, specifiedenvironment, specifiedstrategy)

  var messagequeueurl = selectmessagequeue(SQSMessageQueues, selectedcontroller)
  var buildresult = await startbuild(cbclient, selectedcontroller, onejob, ComputeEnvironment, messagequeueurl, WorkerFunction) // QueryType

  var type ='C' //C means general colleciton
  await commonshared.RecordQuery(_, ddclient, PutItemCommand, commonshared, onejob, selectedcontroller, type)

  console.log('finished')
}

function selectmessagequeue (SQSMessageQueues, selectedcontroller) {
  var messagequeues = SQSMessageQueues.split('<!!>')
  var selectedmessagequeueurl
  messagequeues.map(queue => {
    const controllername = queue.split('=')[0]
    const queueurl = queue.split('=')[1]
    if (controllername === selectedcontroller) {
      selectedmessagequeueurl = queueurl
    }
  })
  return selectedmessagequeueurl
}

function selectcontroller (availablecontrollers, specifiedenvironment, specifiedstrategy) {
  var smallcontrollers = []
  var mediumcontrollers = []
  var largecontrollers = []
  var buildcontroller

  availablecontrollers.map(controller => {
    if (controller.environment.computeType === 'BUILD_GENERAL1_SMALL') {
      smallcontrollers.push({
        projectName: controller.projectName
      })
    }
    else if (controller.environment.computeType === 'BUILD_GENERAL1_MEDIUM') {
      mediumcontrollers.push({
        projectName: controller.projectName
      })
    }
    else {
      largecontrollers.push({
        projectName: controller.projectName
      })
    }
  })

  switch (specifiedstrategy) {
    case 'cost-sensitive':
      switch (specifiedenvironment) {
        case 'BUILD_GENERAL1_SMALL':
          if (smallcontrollers.length >= 1) {
            buildcontroller = smallcontrollers[0].projectName
          }
          else {
            buildcontroller = null
            console.log('currently there are no available controller with selected allocation strategy.')
          }
          break
        case 'BUILD_GENERAL1_MEDIUM':
          if (mediumcontrollers.length >= 1) {
            buildcontroller = mediumcontrollers[0].projectName
          }
          else {
            buildcontroller = null
            console.log('currently there are no available controller with selected allocation strategy.')
          }
          break
        case 'BUILD_GENERAL1_LARGE':
          if (largecontrollers.length >= 1) {
            buildcontroller = largecontrollers[0].projectName
          }
          else {
            buildcontroller = null
            console.log('currently there are no available controller with selected allocation strategy.')
          }
          break
        default:
					// console.log("A standard controller can only be small, medium or large.")
					// process.exit()
      }
      break
    case 'balanced':
      switch (specifiedenvironment) {
        case 'BUILD_GENERAL1_SMALL':
          if (smallcontrollers.length >= 1) {
            buildcontroller = smallcontrollers[0].projectName
          }
          else if (mediumcontrollers.length >= 1) {
            buildcontroller = mediumcontrollers[0].projectName
          }
          else {
            buildcontroller = null
            console.log('currently there are no available controller with selected allocation strategy.')
          }
          break
        case 'BUILD_GENERAL1_MEDIUM':
          if (mediumcontrollers.length >= 1) {
            buildcontroller = mediumcontrollers[0].projectName
          }
          else if (largecontrollers.length >= 1) {
            buildcontroller = largecontrollers[0].projectName
          }
          else {
            buildcontroller = null
            console.log('currently there are no available controller with selected allocation strategy.')
          }
          break
        case 'BUILD_GENERAL1_LARGE':
          if (largecontrollers.length >= 1) {
            buildcontroller = largecontrollers[0].projectName
          }
          else {
            buildcontroller = null
            console.log('currently there are no available controller with selected allocation strategy.')
          }
          break
        default:
					// console.log("A standard controller can only be small, medium or large.")
					// process.exit()
      }
      break
    case 'time-sensitive':
      switch (specifiedenvironment) {
        case 'BUILD_GENERAL1_SMALL':
          if (smallcontrollers.length >= 1) {
            buildcontroller = smallcontrollers[0].projectName
          }
          else if (mediumcontrollers.length >= 1) {
            buildcontroller = mediumcontrollers[0].projectName
          }
          else if (largecontrollers.length >= 1) {
            buildcontroller = largecontrollers[0].projectName
          }
          else {
            buildcontroller = null
            console.log('currently there are no available controller with selected allocation strategy.')
          }
          break
        case 'BUILD_GENERAL1_MEDIUM':
          if (mediumcontrollers.length >= 1) {
            buildcontroller = mediumcontrollers[0].projectName
          }
          else if (largecontrollers.length >= 1) {
            buildcontroller = largecontrollers[0].projectName
          }
          else {
            buildcontroller = null
            console.log('currently there are no available controller with selected allocation strategy.')
          }
          break
        case 'BUILD_GENERAL1_LARGE':
          if (largecontrollers.length >= 1) {
            buildcontroller = largecontrollers[0].projectName
          }
          else {
            buildcontroller = null
            console.log('currently there are no available controller with selected allocation strategy.')
          }
          break
        default:
					// console.log("A standard controller can only be small, medium or large.")
					// process.exit()
      }
      break
    default:
			// code block
			// console.log("An allocation strategy must be specified")
			// process.exit()
  }
  return buildcontroller
}

async function listavailablecontrollers (cbclient, cbbuildprojects) {
  var cbbuildprojects = _.compact(cbbuildprojects)
  var newcontrollers = cbbuildprojects
  var availablecontrollers = []

  var buildids = cbbuildprojects.map(
    CBProjectName => {
      var lastbuild = getlastbuildID(cbclient, CBProjectName)
      return lastbuild
    })
  const retrievedbuildids = await Promise.all(buildids)

  var lastbuildids = _.compact(retrievedbuildids) // we compact  to remove null values, a controller without buildids is a new controller

  if (lastbuildids.length !== retrievedbuildids.length) {
    // get the properties of build ids if there is one than its an existing controller, if there is none its a new controller.
    retrievedbuildids.map(
      buildid => {
        // We determine which is/are the new controller(s) by eliminating old/existing controllers.
        if ((typeof buildid !== 'undefined')) { // .includes(CBProjectName)
          _.pull(newcontrollers, buildid.split(':')[0])
        }
      }
    )
    var params = {
      names: newcontrollers
    }

    const command = new BatchGetProjectsCommand(params)
    const newcontrollerproperties = await cbclient.send(command)

    newcontrollerproperties.projects.map(
      controller => {
        availablecontrollers.push({
          projectName: controller.name,
          environment: {
            computeType: controller.environment.computeType,
            type: controller.environment.type
          }
        })
      })
  }

  if (lastbuildids.length !== 0) {
    // get the properties of existing controllers.
    var params = {
      ids: lastbuildids
    }

    const command = new BatchGetBuildsCommand(params)
    const lastbuildstatus = await cbclient.send(command)

    lastbuildstatus.builds.map(build => {
      if (build.currentPhase === 'COMPLETED') {
        availablecontrollers.push({
          projectName: build.projectName,
          environment: {
            computeType: build.environment.computeType,
            type: build.environment.type
          }
        })
      }
    })
  }
  // console.log("availablecontrollers: "+availablecontrollers.length)
  return availablecontrollers
}

async function getlastbuildID (cbclient, CBProjectName) {
  var params = {
    projectName: CBProjectName,
    sortOrder: 'DESCENDING'
  }

  const command = new ListBuildsForProjectCommand(params)
  const buildprojectids = (await cbclient.send(command)).ids[0]
  return buildprojectids
}

async function startbuild (cbclient, selectedcontroller, onejob, ComputeEnvironment, messagequeueurl, WorkerFunction) {
  var S3Properties = JSON.parse(onejob.S3Properties.stringValue)
  var ComputeEnvironment = JSON.parse(onejob.ComputeEnvironment.stringValue)
  var buildparams = {
    projectName: selectedcontroller,
    environmentVariablesOverride: [{
      name: 'DatabaseParameters',
      value: onejob.DatabaseParameters.stringValue,
      type: 'PLAINTEXT'
    },
    {
      name: 'S3SelectQuery',
      value: onejob.QueryString.stringValue,
      type: 'PLAINTEXT'
    },
    {
      name: 'S3EnumerationDepth',
      value: S3Properties.S3EnumerationDepth,
      type: 'PLAINTEXT'
    },
    {
      name: 'S3Folders',
      value: S3Properties.S3Folders,
      type: 'PLAINTEXT'
    },
    {
      name: 'S3SelectParameter',
      value: JSON.stringify(S3Properties.S3SelectParameter),
      type: 'PLAINTEXT'
    },
    {
      name: 'Schema',
      value: onejob.Schema.stringValue,
      type: 'PLAINTEXT'
    },
    {
      name: 'TableParameters',
      value: onejob.TableParameters.stringValue,
      type: 'PLAINTEXT'
    },
    {
      name: 'WorkerFunction',
      value: WorkerFunction,
      type: 'PLAINTEXT'
    },
    {
      name: 'MessageQueue',
      value: messagequeueurl,
      type: 'PLAINTEXT'
    },
    {
      name: 'PreferedWorkerNumber',
      value: ComputeEnvironment.PreferedWorkerNumber,
      type: 'PLAINTEXT'
    },
    {
      name: 'QueryType',
      value: onejob.QueryType.stringValue,
      type: 'PLAINTEXT'
    },
    {
      name: 'JobID',
      value: onejob.JobID.stringValue,
      type: 'PLAINTEXT'
    }
    ]
  }

  const command = new StartBuildCommand(buildparams)
  const codebuildresult = await cbclient.send(command)
  console.log(stringify(codebuildresult))
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getenvironmentsize (LogVolume) {
  switch (LogVolume) {
    case 'micro':
      return 'BUILD_GENERAL1_SMALL'

    case 'small':
      return 'BUILD_GENERAL1_SMALL'

    case 'medium':
      return 'BUILD_GENERAL1_MEDIUM'

    case 'large':
      return 'BUILD_GENERAL1_LARGE'

    default:
			// console.log("A standard controller can only be small, medium or large.")
			// process.exit()
  }
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
