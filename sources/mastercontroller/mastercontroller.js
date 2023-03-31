/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
var AWS = require('aws-sdk')
const fs = require('fs')
const path = require('path')
var _ = require('lodash')
const {stringify} = require('flatted')

module.exports.handler = async function (event, context) {
  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    var commonshared = require('./shared/commonshared')
    var arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var buildspecoverride = fs.readFileSync('./buildspec.yaml', 'utf8')
    // var JobsQueueURL= process.env.JobsQueueURL;
    var SQSMessageQueues = process.env.SQSMessageQueues
    var WorkerFunction = process.env.WorkerFunction
    console.log('REQUEST RECEIVED: ' + JSON.stringify(event))
    console.log('CONTEXT RECEIVED: ' + JSON.stringify(context))
  } else {
    // Dev environment settings
    const mydev = require(path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'mastercontroller', 'mydev.js'))
    var region = mydev.region
    var commonshared = mydev.commonshared
    var buildspecoverride = mydev.buildspecoverride
    // var JobsQueueURL= mydev.JobsQueueURL;
    var SQSMessageQueues = mydev.SQSMessageQueues
    var WorkerFunction = mydev.WorkerFunction
    var event = mydev.event
  }

  AWS.config.update({
    region
  })

  var cbbuildprojects = SQSMessageQueues.split('<!!>').map(value => value.split('=')[0])

  var codebuild = new AWS.CodeBuild()
  const dynamodb = new AWS.DynamoDB()
  // var sqs = new AWS.SQS({
  // 	apiVersion: '2012-11-05'
  // });

  var availablecontrollers = await listavailablecontrollers(codebuild, cbbuildprojects)

  var onejob = event.Records[0].messageAttributes
  var ComputeEnvironment = JSON.parse(onejob.ComputeEnvironment.stringValue)
  var specifiedenvironment = getenvironmentsize(ComputeEnvironment.LogVolume) // LogVolume

  var specifiedstrategy = ComputeEnvironment.AllocationStrategy
  var selectedcontroller = selectcontroller(availablecontrollers, specifiedenvironment, specifiedstrategy)

  var messagequeueurl = selectmessagequeue(SQSMessageQueues, selectedcontroller)
  // var MessageGroupId=commonshared.makeid(128);
  // var sqsmessage= await sendSQSMessage(sqs,messagequeueurl,'0',MessageAttributes,MessageGroupId);
  // console.log(selectedcontroller);

  var buildresult = await startbuild(codebuild, selectedcontroller, buildspecoverride, onejob, ComputeEnvironment, messagequeueurl, WorkerFunction) // QueryType

  await RecordQuery(dynamodb, commonshared, onejob, selectedcontroller)
  console.log(buildresult)

  await timeout(1000)
  console.log('finished')
}

async function RecordQuery (dynamodb, commonshared, onejob, selectedcontroller) {
  var TableParameters = onejob.TableParameters.stringValue.split('<!!>')
  var DBvalue = onejob.DatabaseParameters.stringValue.split('<!!>')
  var S3Properties = JSON.parse(onejob.S3Properties.stringValue)
  var DDBTableName = 'Logverz-Queries'

  var d = new Date()
  var weeknumber = getWeekNumber(d) // new Date()
  var hours = d.getHours()
  var minutes = d.getMinutes()

  var UsersQuery = commonshared.propertyvaluelookup(TableParameters.filter(t => t.includes('Creator')))
  var TableOwners = _.uniqWith((UsersQuery + ',' + commonshared.propertyvaluelookup(TableParameters.filter(t => t.includes('TableOwners')))).split(','), _.isEqual)
  var TableAccess = (commonshared.propertyvaluelookup(TableParameters.filter(t => t.includes('TableAccess')))).split(',')
  var QueryName = commonshared.propertyvaluelookup(TableParameters.filter(t => t.includes('TableName'))) + '-W' + weeknumber[1] + getdayName(d) + 'T' + hours + ':' + minutes
  var DatabaseName = DBvalue.filter(s => s.includes('LogverzDBFriendlyName'))[0].split('=')[1]

  var QuerySettings = {
    QueryString: onejob.QueryString.stringValue,
    ComputeEnvironment: selectedcontroller,
    JobID: onejob.JobID.stringValue,
    S3Folders: S3Properties.S3Folders,
    Description: commonshared.propertyvaluelookup(TableParameters.filter(t => t.includes('TableDescription')))
  }

  var params = {
    Item: {
      UsersQuery: {
        S: (UsersQuery)
      }, // +"-Collection"
      UnixTime: {
        N: Date.now().toString()
      },
      QueryName: {
        S: QueryName
      }, // tablename+timeformat
      QueryType: {
        S: 'C'
      }, // Collection
      TableName: {
        S: (TableParameters.filter(t => t.includes('TableName'))[0].split('=')[1])
      },
      DatabaseName: {
        S: DatabaseName
      },
      DataType: {
        S: onejob.QueryType.stringValue
      },
      QuerySettings: {
        M: {}
      },
      Access: {
        L: []
      },
      Owners: {
        L: []
      },
      Active: {
        BOOL: true
      },
      Archive: {
        BOOL: false
      }
    },
    ReturnConsumedCapacity: 'TOTAL',
    TableName: DDBTableName
  }

  var i
  for (i = 0; i < Object.keys(QuerySettings).length; i++) {
    var Name = Object.keys(QuerySettings)[i]
    var Value = QuerySettings[Name]
    params.Item.QuerySettings.M[Name] = {
      S: Value
    }
  }

  for (var j = 0; j < TableOwners.length; j++) {
    var oneowner = {
      S: TableOwners[j]
    }
    params.Item.Owners.L.push(oneowner)
  }

  for (var k = 0; k < TableAccess.length; k++) {
    if (TableAccess[k] !== '') { // checking for empty string (Table access not set)
      var oneaccess = {
        S: TableAccess[k]
      }
      params.Item.Access.L.push(oneaccess)
    }
  }

  return await commonshared.putDDB(dynamodb, params)
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
    } else if (controller.environment.computeType === 'BUILD_GENERAL1_MEDIUM') {
      mediumcontrollers.push({
        projectName: controller.projectName
      })
    } else {
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
          } else {
            buildcontroller = null
            console.log('currently there are no available controller with selected allocation strategy.')
          }
          break
        case 'BUILD_GENERAL1_MEDIUM':
          if (mediumcontrollers.length >= 1) {
            buildcontroller = mediumcontrollers[0].projectName
          } else {
            buildcontroller = null
            console.log('currently there are no available controller with selected allocation strategy.')
          }
          break
        case 'BUILD_GENERAL1_LARGE':
          if (largecontrollers.length >= 1) {
            buildcontroller = largecontrollers[0].projectName
          } else {
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
          } else if (mediumcontrollers.length >= 1) {
            buildcontroller = mediumcontrollers[0].projectName
          } else {
            buildcontroller = null
            console.log('currently there are no available controller with selected allocation strategy.')
          }
          break
        case 'BUILD_GENERAL1_MEDIUM':
          if (mediumcontrollers.length >= 1) {
            buildcontroller = mediumcontrollers[0].projectName
          } else if (largecontrollers.length >= 1) {
            buildcontroller = largecontrollers[0].projectName
          } else {
            buildcontroller = null
            console.log('currently there are no available controller with selected allocation strategy.')
          }
          break
        case 'BUILD_GENERAL1_LARGE':
          if (largecontrollers.length >= 1) {
            buildcontroller = largecontrollers[0].projectName
          } else {
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
          } else if (mediumcontrollers.length >= 1) {
            buildcontroller = mediumcontrollers[0].projectName
          } else if (largecontrollers.length >= 1) {
            buildcontroller = largecontrollers[0].projectName
          } else {
            buildcontroller = null
            console.log('currently there are no available controller with selected allocation strategy.')
          }
          break
        case 'BUILD_GENERAL1_MEDIUM':
          if (mediumcontrollers.length >= 1) {
            buildcontroller = mediumcontrollers[0].projectName
          } else if (largecontrollers.length >= 1) {
            buildcontroller = largecontrollers[0].projectName
          } else {
            buildcontroller = null
            console.log('currently there are no available controller with selected allocation strategy.')
          }
          break
        case 'BUILD_GENERAL1_LARGE':
          if (largecontrollers.length >= 1) {
            buildcontroller = largecontrollers[0].projectName
          } else {
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

async function listavailablecontrollers (codebuild, cbbuildprojects) {
  var cbbuildprojects = _.compact(cbbuildprojects)
  var newcontrollers = cbbuildprojects
  var availablecontrollers = []

  var buildids = cbbuildprojects.map(
    CBProjectName => {
      var lastbuild = getlastbuildID(codebuild, CBProjectName)
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
    var newcontrollerproperties = await codebuild.batchGetProjects(params, function (err, data) {
      if (err) console.log(err, err.stack) // an error occurred
      // else     console.log(data);           // successful response
    }).promise()

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
    var cbstatus = codebuild.batchGetBuilds(params, function (err, data) {
      if (err) console.log(err, err.stack) // an error occurred
      // else     console.log(data);           // successful response
    }).promise()

    var lastbuildstatus = await cbstatus
    // console.log(lastbuildstatus.builds[0].currentPhase)
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

async function getlastbuildID (codebuild, CBProjectName) {
  var params = {
    projectName: CBProjectName,
    sortOrder: 'DESCENDING'
  }
  var buildprojectids = await codebuild.listBuildsForProject(params, function (err, data) {
    if (err) console.log(err, err.stack) // an error occurred
    // else     console.log(data);           // successful response
  }).promise()
  return buildprojectids.ids[0]
}

async function startbuild (codebuild, selectedcontroller, buildspecoverride, onejob, ComputeEnvironment, messagequeueurl, WorkerFunction) {
  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CodeBuild.html#startBuild-property
  var S3Properties = JSON.parse(onejob.S3Properties.stringValue)
  var ComputeEnvironment = JSON.parse(onejob.ComputeEnvironment.stringValue)
  var buildparams = {
    projectName: selectedcontroller,
    buildspecOverride: buildspecoverride,
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

  return codebuild.startBuild(buildparams, function (err, data2) {
    if (err) console.log(err, err.stack) // an error occurred
    else console.log(stringify(data2)) // successful response
  })
  // return codebuildresult
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getWeekNumber (d) {
  // Copy date so don't modify original
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  // Set to nearest Thursday: current date + 4 - current day number
  // Make Sunday's day number 7
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  // Get first day of year
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  // Calculate full weeks to nearest Thursday
  var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  // Return array of year and week number
  return [d.getUTCFullYear(), weekNo]
}

function getdayName (d) {
  var weekday = new Array(7)
  weekday[0] = 'Sun'
  weekday[1] = 'Mon'
  weekday[2] = 'Tue'
  weekday[3] = 'Wed'
  weekday[4] = 'Thu'
  weekday[5] = 'Fri'
  weekday[6] = 'Sat'
  return weekday[d.getDay()]
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

// async function sendSQSMessage (sqs, QueueURL, delay, MessageAttributes, MessageGroupId) {
//   var onejob
//   var MessageAttributes = {
//     ComputeEnvironment: {
//       DataType: 'String',
//       StringValue: onejob.ComputeEnvironment.stringValue
//     },
//     DatabaseParameters: {
//       DataType: 'String',
//       StringValue: onejob.DatabaseParameters.stringValue
//     },
//     S3Properties: {
//       DataType: 'String',
//       StringValue: onejob.S3Properties.stringValue
//     },
//     QueryString: {
//       DataType: 'String',
//       StringValue: onejob.QueryString.stringValue
//     },
//     Schema: {
//       DataType: 'String',
//       StringValue: onejob.Schema.stringValue
//     },
//     QueryType: {
//       DataType: 'String',
//       StringValue: onejob.QueryType.stringValue
//     },
//     TableParameters: {
//       DataType: 'String',
//       StringValue: onejob.TableParameters.stringValue
//     }
//   }

//   var params = {
//     MessageBody: '.',
//     QueueUrl: QueueURL,
//     DelaySeconds: delay,
//     MessageAttributes
//   }
//   if (MessageGroupId !== null) {
//     params.MessageGroupId = MessageGroupId
//   }

//   var promisedsendmessage = new Promise((resolve, reject) => {
//     sqs.sendMessage(params, function (err, data) {
//       if (err) {
//         console.log('Error', JSON.stringify(err))
//         reject(JSON.stringify(err))
//       } else {
//         //  var today = new Date();
//         //  var date = today.getFullYear()+'-'+(today.getMonth()+1)+'-'+today.getDate();
//         //  var time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();
//         //  var dateTime = date+' '+time;
//         // console.log("Sent SQS message "+dateTime+" "+data.MessageId )
//         resolve(data.MessageId)
//       }
//     })
//   })
//   var sendmessage = await promisedsendmessage
//   return sendmessage
// }
