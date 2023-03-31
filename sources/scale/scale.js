/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */
const AWS = require('aws-sdk')
var jwt = require('jsonwebtoken')
const path = require('path')
var _ = require('lodash')
var db = require('./db').db
// eslint-disable-next-line no-unused-vars
const Sequelize = require('sequelize') // dependency for engineshared.dblookup.
var MaximumCacheTime=process.env.MaximumCacheTime

if (db.collections.length === 0) {
  
  if (MaximumCacheTime === undefined){
    MaximumCacheTime =1
  }

  var identity = db.addCollection('Logverz-Identities', {
    ttl: MaximumCacheTime * 60 * 1000
  })
}

module.exports.handler = async function (event, context) {
  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    var arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var accountnumber = arnList[4]
    var commonshared = require('./shared/commonshared')
    var authenticationshared = require('./shared/authenticationshared')
    var engineshared = require('./shared/engineshared')
    var cert = process.env.PublicKey
    var AllowedOrigins = process.env.AllowedOrigins
    var maskedevent = commonshared.masktoken(JSON.parse(JSON.stringify(event)))
    console.log('REQUEST RECEIVED: \n' + JSON.stringify(context) + '\n\n')
    console.log('THE EVENT: \n' + JSON.stringify(maskedevent) + '\n\n')
  }
  else {
    // Dev environment settings
    const mydev = require(path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'scale', 'mydev.js'))
    var region = mydev.region
    var accountnumber = mydev.accountnumber
    var commonshared = mydev.commonshared
    var authenticationshared = mydev.authenticationshared
    var engineshared = mydev.engineshared
    var event = mydev.event
    var context = mydev.context
    var cert = mydev.cert
    var AllowedOrigins = mydev.AllowedOrigins
  }
  var arnList = (context.invokedFunctionArn).split(':')

  AWS.config.update({
    region
  })

  var rds = new AWS.RDS({
    apiVersion: '2014-10-31'
  })

  var autoscaling = new AWS.AutoScaling()
  const dynamodb = new AWS.DynamoDB()
  var docClient = new AWS.DynamoDB.DocumentClient()
  var SSM = new AWS.SSM()
  var cloudwatch = new AWS.CloudWatch()
  var message = 'ok'
  var RequestType = 'events'

  if ((Object.keys(event).length === 0) || (event.source === 'aws.events')) {
    // For starting and stoping RDS and starting ASG resources at specific times or at logon.
    // When directly invoked example @ login the event is empty.As described in https://github.com/aws/aws-sdk-js/issues/1388#issuecomment-403466618
    // When invoked by Cloudwatch Scheduled trigger eventsource aws.events.
    if (Object.keys(event).length === 0) {
      RequestType = 'useractivity'
    }

    // Get parameters of infrastructure
    var details = {
      source: 'login.js:main',
      message: ''
    }
    var [IdleTime, AutoScalingGroupList, DBRegistry] = await Promise.all([
      commonshared.getssmparameter(SSM, {
        Name: '/Logverz/Settings/IdleTime',
        WithDecryption: false
      }, dynamodb, details),
      commonshared.getssmparameter(SSM, {
        Name: '/Logverz/Engine/AutoScalingGroupList',
        WithDecryption: false
      }, dynamodb, details),
      commonshared.getssmparameter(SSM, {
        Name: '/Logverz/Database/Registry',
        WithDecryption: false
      }, dynamodb, details)
    ])

    IdleTime = JSON.parse(IdleTime.Parameter.Value)
    AutoScalingGroupList = JSON.parse(AutoScalingGroupList.Parameter.Value)
    var AutoScalingGroupNames = Object.values(AutoScalingGroupList)
    var connectionstringsarray = _.reject(DBRegistry.Parameter.Value.split('[[DBDELIM]]'), _.isEmpty)
    var dbpropertiesarray = JoinDBinstanceproperties(engineshared, IdleTime, connectionstringsarray)

    // describe status of asg and rds instances.
    var [dbstatearray, StateofASGs] = await Promise.all([
      GetRDSinstanceproperties(rds, commonshared, dbpropertiesarray),
      commonshared.ASGstatus(autoscaling, AutoScalingGroupNames)
    ])

    var activedbinstances = dbstatearray.filter(dbs => dbs.DBInstanceStatus !== 'stopped' && dbs.DBInstanceStatus !== 'stopping').map(a => a.DBInstanceIdentifier)

    // Get RDS performance metrics and events (start time);
    if (activedbinstances.length > 0) {
      var [RDSCWmetrics, activedbevents] = await Promise.all([
        commonshared.GetRDSInstancesMetrics(cloudwatch, activedbinstances, dbpropertiesarray),
        GetRDSinstanceEvents(rds, activedbinstances, dbpropertiesarray)
      ])
    }

    // stop or start rds if its time.
    await VerifyRDSDesiredState(rds, dynamodb, commonshared, RDSCWmetrics, activedbevents, activedbinstances, dbpropertiesarray, RequestType)

    // start asg if its time. When starting make sure that it only applies with in max 2 the time of the lambda run period.
    await VerifyASGDesiredState(autoscaling, AutoScalingGroupList, StateofASGs, IdleTime, RequestType)

    var reply = {
      status: 200,
      data: "RDS and ASGs are in desired states as configured in '/Logverz/Settings/IdleTime'",
      header: {}
    }
    console.log(JSON.stringify(reply))
    var result = commonshared.apigatewayresponse(reply, {}, AllowedOrigins)
    return result
  }
  else {
    // API GW execution.
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
        var userattributes = await authenticationshared.getidentityattributes(commonshared, docClient, username, usertype)
        userattributes = userattributes.Items[0]
        identity.insert(userattributes)
      }
    } else {
      // invalid token
      message = tokenobject.value
    }
  }

  if (message === 'ok') {
    // its comming from authorized source: aws events or api gateway
    console.log('Calling Main')
    var reply = await main(autoscaling, rds, dynamodb, event, commonshared, authenticationshared, _, userattributes, region, accountnumber)
  }
  else {
    // send invalid token message
    console.error(message)
    reply = {
      status: 400,
      data: message,
      header: {}
    }
  }

  console.log('at the end')
  var result = commonshared.apigatewayresponse(reply, event.headers, AllowedOrigins)
  return result
}

async function main (autoscaling, rds, dynamodb, event, commonshared, authenticationshared, _, userattributes, region, accountnumber) {
  console.log('main')
  const service = commonshared.getquerystringparameter(event.queryStringParameters.service)
  var apicall = commonshared.getquerystringparameter(event.queryStringParameters.apicall)
  var parameters = commonshared.getquerystringparameter(event.queryStringParameters.Parameters)
  var resource = authenticationshared.setIAMresource(apicall, parameters, region, accountnumber)

  var action = {
    Resource: resource,
    Operation: service + ':' + apicall
  } // "lambda:InvokeFunction"
  var authorization = authenticationshared.authorize(_, commonshared, action, userattributes)
  if (authorization.status !== 'Allow') {
    // request not authorized
    var reply = {
      status: 400,
      data: authorization.Reason,
      header: {}
    }
    console.log(authorization)
  }
  else {
    switch (service) {
      case 'rds':
        
        var DBstate = await SetRDSDesiredState(rds,dynamodb, commonshared, parameters, apicall)
        var reply=DBstate.clientreply
        console.log(DBstate.apiresponse)

        break
      case 'autoscaling':
        try {
          var result = await SetAsgSettings(autoscaling, 'DesiredCapacity', JSON.parse(parameters))
          console.log('Changing Autoscaling group ' + JSON.parse(parameters).AutoScalingGroupName + ' desired count to ' + JSON.parse(parameters).DesiredCapacity + ' was succesfull.')
          var reply = {
            status: 200,
            data: JSON.stringify(result),
            header: {}
          }
        }
        catch (error) {
          var message = 'Error changing ASG desiredcount for ' + JSON.parse(parameters).AutoScalingGroupName + '. Further details: \n'
          console.error(message)
          console.error(error)
          var details = {
            source: 'scale.js:SetAsgSettings',
            message: message + error,
            jobid: '-'
          }
          await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'ScaleSystem', 'Error', 'Infra', details, 'API')
          var reply = {
            status: 500,
            data: error.message,
            header: {}
          }
        }
        break
      default:
        var reply = {
          status: 500,
          data: 'unknown service',
          header: {}
        }
    }
  }

  return reply
} // main

async function SetRDSDesiredState (rds,dynamodb, commonshared, parameters, apicall) {
  
  var parametersobject= JSON.parse(parameters)
  
  if (parametersobject.hasOwnProperty("DBInstanceIdentifier")){
    var rdsinstancename = parametersobject.DBInstanceIdentifier
    var DBtype="Server"
  }
  else {
    var rdsclustername = parametersobject.DBClusterIdentifier
    var DBtype="Serverless"
  }

  switch (DBtype) {
    case 'Server':
      if (apicall === 'StartDBInstance') {
        var apiresult = await StartDBInstance(rds, dynamodb, commonshared, {
          DBInstanceIdentifier: rdsinstancename
        })
      }
      else if (apicall === 'StopDBInstance') {
        var apiresult = await StopDBInstance(rds, dynamodb, commonshared,{
          DBInstanceIdentifier: rdsinstancename
        })
      }
      break
    case 'Serverless':
     
        var apiresult = await StartStopDBCluster(rds, dynamodb, commonshared, apicall, {
          DBClusterIdentifier: rdsclustername
        })

      break
  }

  var DBstate={
    "clientreply": apiresult.reply,
    "apiresponse": apiresult.status
  }

  return DBstate
}

async function StartStopDBCluster (rds, dynamodb, commonshared, apicall, params) {

  if (apicall === "StartDBCluster") {
    var message = 'Staring DB cluster ' + params.DBClusterIdentifier + ' was succesfull.'
    var sourceid ='scale.js:StartDBCluster'
    var errormsg ='Error Starting DB Cluster. Further details: \n'
    var action = 'ScaleUpRDS'
  }
  else{
    var message = 'Stopping DB cluster ' + params.DBClusterIdentifier + ' was succesfull.'
    var sourceid ='scale.js:StopDBCluster'
    var errormsg ='Error Stopping DB Cluster. Further details: \n'
    var action = 'ScaleDownRDS'
  }

  var promisedrdssettings = new Promise((resolve, reject) => {

    if (apicall === "StartDBCluster") {
      rds.startDBCluster(params, function(err, data) {
        if (err) {
          console.log(err, err.stack);
          reject(err) // console.log(err, err.stack); // an error occurred
        }
        else{
          console.log(data);
          resolve(data) // console.log(data);           // successful response
        }
      })
    }
    else{
      rds.stopDBCluster(params, function(err, data) {
        if (err) {
          console.log(err, err.stack);
          reject(err) // console.log(err, err.stack); // an error occurred
        }
        else{
          //console.log(data);
          resolve(data) // console.log(data);           // successful response
        }
      })
    }
  })

  try {
    var settings = await promisedrdssettings
    console.log(message)
    var clientreply = {
      status: 200,
      data: JSON.stringify(result),
      header: {}
    }
    var details = {
      source: sourceid,
      message
    }
    await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations',action , 'Info', 'User', details, 'API')
  }
  catch (error) {
    console.error(errormsg)
    console.error(error)
    var details = {
      source: sourceid,
      message: errormsg + error,
      jobid: '-'
    }
    await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'ScaleSystem', 'Error', 'Infra', details, 'API')
    var clientreply = {
      status: 500,
      data: error.message,
      header: {}
    }
  }

  var result = {
    "status": settings.DBCluster,
    "reply": clientreply
  }

  return result
}

async function StartDBInstance (rds, dynamodb, commonshared, params) {


  var promisedrdssettings = new Promise((resolve, reject) => {
    rds.startDBInstance(params, function (err, data) {
      if (err) reject(err) // console.log(err, err.stack); // an error occurred
      else resolve(data) // console.log(data);           // successful response
    })
  })

  try {
    var settings = await promisedrdssettings
    var message = 'Staring DB instance ' + params.DBInstanceIdentifier + ' was succesfull.'
    console.log(message)
    var clientreply = {
      status: 200,
      data: JSON.stringify(result),
      header: {}
    }
    var details = {
      source: 'scale.js:StartDBInstance',
      message
    }
    await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'ScaleUpRDS', 'Info', 'User', details, 'API')
  }
  catch (error) {
    var message = 'Error Starting DB Instance. Further details: \n'
    console.error(message)
    console.error(error)
    var details = {
      source: 'scale.js:StartDBInstance',
      message: message + error,
      jobid: '-'
    }
    await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'ScaleSystem', 'Error', 'Infra', details, 'API')
    var clientreply = {
      status: 500,
      data: error.message,
      header: {}
    }
  }

  var result = {
    "status": settings.DBInstance,
    "reply": clientreply
  }

  return result
}

async function StopDBInstance (rds, dynamodb, commonshared, params) {
  
  var promisedrdssettings = new Promise((resolve, reject) => {
    rds.stopDBInstance(params, function (err, data) {
      if (err) reject(err) // console.log(err, err.stack); // an error occurred
      else resolve(data) // console.log(data);           // successful response
    })
  })
  
  try {

    var settings = await promisedrdssettings
    var message = 'Stopping DB instance ' + params.DBClusterIdentifier + ' was succesfull.'
    console.log(message)
    var clientreply = {
      status: 200,
      data: JSON.stringify(result),
      header: {}
    }
    var details = {
      source: 'scale.js:StopDBInstance',
      message
    }
    await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'ScaleDownRDS', 'Info', 'User', details, 'API')
  }
  catch (error) {
    var message = 'Error Stopping DB Instance. Further details: \n'
    console.error(message)
    console.error(error)
    var details = {
      source: 'scale.js:StopDBInstance',
      message: message + error,
      jobid: '-'
    }
    await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'ScaleSystem', 'Error', 'Infra', details, 'API')
    var clientreply = {
      status: 500,
      data: error.message,
      header: {}
    }
  }

  var result = {
    "status": settings.DBInstance,
    "reply": clientreply
  }

  return result
}

async function SetAsgSettings (autoscaling, type, params) {
  // TODO move to commonshared
  if (type === 'DesiredCapacity') {
    var promisedasgsettings = new Promise((resolve, reject) => {
      autoscaling.setDesiredCapacity(params, function (err, data) {
        if (err) reject(err) // console.log(err, err.stack); // an error occurred
        else resolve(data) // console.log(data);           // successful response
      })
    })
  }
  var settings = await promisedasgsettings
  return settings
}

async function GetRDSinstanceproperties (rds, commonshared, dbpropertiesarray) {
  var dbstatearray = []
  var promises = dbpropertiesarray.map(db => {
    var dbinstanceidentifier = {
      DBInstanceIdentifier: db.DBEndpointName.split('.')[0]
    }
    var dbstate = commonshared.GetRDSSettings(rds, dbinstanceidentifier)
    return dbstate
  })
  var resolved = await Promise.all(promises)
  resolved.map(rdb => {
    rdb.DBInstances.map(dbi => {
      dbstatearray.push(dbi)
    })
  })
  return dbstatearray
}

function JoinDBinstanceproperties (engineshared, IdleTime, connectionstringsarray) {
  var dbpropertiesarray = []

  var listofmanageddbs = IdleTime.Database.map(mdb => mdb.DBName)
  listofmanageddbs.map((dbp) => {
    var dbproperties = engineshared.DBpropertylookup(connectionstringsarray, dbp)
    var idlesettings = IdleTime.Database.filter(db => db.DBName === dbproperties.DBFriendlyName)[0]
    dbproperties.DBInstanceIdentifier = dbproperties.DBEndpointName.split('.')[0]
    dbproperties.IdleConfiguration = idlesettings.Configuration
    dbproperties.IdlePeriodMin = idlesettings.Period
    dbproperties.IdleTreshold = idlesettings.Threshold
    dbproperties.CWMetrics = {
      'AWS/RDS:CPUUtilization': 'Average',
      'AWS/RDS:DatabaseConnections': 'Maximum'
    }
    dbproperties.StartAfter = idlesettings.StartAfterUTC
    dbproperties.StartAtUserLogin = idlesettings.StartAtUserLogin
    dbpropertiesarray.push(dbproperties)
  })
  return dbpropertiesarray
}

async function VerifyRDSDesiredState (rds, dynamodb, commonshared, RDSCWmetrics, activedbevents, activedbinstances, dbpropertiesarray, RequestType) {
  
  var runningdbinstances = dbpropertiesarray.filter(dbpa => {
    if (activedbinstances.includes(dbpa.DBInstanceIdentifier)) {
      return dbpa
    }
  })
  
  var stoppeddbinstances = dbpropertiesarray.filter(dbpa => {
    if (!activedbinstances.includes(dbpa.DBInstanceIdentifier)) {
      return dbpa
    }
  })

  if (runningdbinstances.length > 0) {
      
      var runningdbpromises = runningdbinstances.map(async (rdbi) => {
      var starttime = FindDBStartuptime(activedbevents, rdbi.DBInstanceIdentifier)
      var performancemetrics = ConvertRDSInstanceMetrics(RDSCWmetrics, rdbi)
      var cpumetricname = Object.keys(rdbi.IdleTreshold).filter(k => k.match(/.*cpu.*/i))[0]
      var sessionmetricname = Object.keys(rdbi.IdleTreshold).filter(k => k.match(/.*session.*/i))[0]
      var stopdbinstance = false
      var idletimehaspassed = false // we need to have saveguard as a db started 10 min ago does not have 60 min of metrics.
      var timeago = 60 * rdbi.IdlePeriodMin * 1000

      switch (rdbi.IdleConfiguration) {
        case 'CAS':
          if ((performancemetrics.CpuUtilisation < rdbi.IdleTreshold[cpumetricname]) && (performancemetrics.SessionCount < rdbi.IdleTreshold[sessionmetricname])) {
            stopdbinstance = true
          }
          break
        case 'COS':
          if ((performancemetrics.CpuUtilisation < rdbi.IdleTreshold[cpumetricname]) || (performancemetrics.SessionCount < rdbi.IdleTreshold[sessionmetricname])) {
            stopdbinstance = true
          }
          break
        case 'C':
          if ((performancemetrics.CpuUtilisation < rdbi.IdleTreshold[cpumetricname])) {
            stopdbinstance = true
          }
          break
        case 'S':
          if (performancemetrics.SessionCount < rdbi.IdleTreshold[sessionmetricname]) {
            stopdbinstance = true
          }
          break
        default:
          console.log(`Unknown Idle Configuration for database ${rdbi.DBFriendlyName} + please make sure that its one of the following CAS,COS,C or S`)
      } // end of switch

      if (starttime < (Date.now() - timeago)) {
        idletimehaspassed = true
      }

      if (stopdbinstance === true && idletimehaspassed) {
        
        if (rdbi.DBClusterID !== undefined){
          var rdsparams = {
            DBClusterIdentifier: rdbi.DBClusterID
          }
          var apiresult= await StartStopDBCluster (rds, dynamodb, commonshared, "StopDBCluster", rdsparams)
        }
        else{
          var rdsparams = {
            DBInstanceIdentifier: rdbi.DBInstanceIdentifier
          }
          var apiresult= await  StopDBInstance(rds, dynamodb, commonshared, rdsparams)
        }

        return apiresult
      }
      else if (idletimehaspassed) {
        console.log('Idletime has passed, other conditions not met to stop the DB instance.')
        console.log('details')
        return 'done'
      }
      else {
        // TODO: make detailed overview of scaling decision. IdleConfiguration,  performance metrics and write it to console in all cases.
        // if there is mutuable event instance start, db start, db stop than write to DynamoDB as well.
        console.log('details...')
        return 'done'
      }
    })
  }

  if (stoppeddbinstances.length > 0) {
    var stoppeddbpromises = stoppeddbinstances.map(async (sdbi) => {
      var eligableforstart = CheckStartConditions(sdbi.StartAfter, sdbi.IdlePeriodMin, sdbi.DBInstanceIdentifier, RequestType, sdbi.StartAtUserLogin)

      if (eligableforstart) {

        if (sdbi.DBClusterID !== undefined){
          var rdsparams = {
            DBClusterIdentifier: sdbi.DBClusterID
          }
          console.log('starting ' + sdbi.DBEngineType + ' DB cluster ' + sdbi.DBClusterID + ', DBFriendlyName "' + sdbi.DBFriendlyName + '"')
          var apiresult= await StartStopDBCluster (rds, dynamodb, commonshared, "StartDBCluster", rdsparams)
        }
        else{
          var rdsparams = {
            DBInstanceIdentifier: sdbi.DBInstanceIdentifier
          }
          console.log('starting ' + sdbi.DBEngineType + ' DB instance ' + sdbi.DBInstanceIdentifier + ', DBFriendlyName "' + sdbi.DBFriendlyName + '"')
          var apiresult= await  StartDBInstance(rds, dynamodb, commonshared, rdsparams)
        }

        return apiresult

      }
    })
  }

  if ((runningdbinstances.length > 0) && (stoppeddbinstances.length > 0)) {
    var resolved = await Promise.all(runningdbpromises, stoppeddbpromises)
  }
  else if (runningdbinstances.length > 0) {
    var resolved = await Promise.all(runningdbpromises)
  }
  else if (stoppeddbinstances.length > 0) {
    var resolved = await Promise.all(stoppeddbpromises)
  }
  return resolved
}

function ConvertRDSInstanceMetrics (RDSCWmetrics, runninginstanceproperties) {
  var metric = {}
  // Filter the time to the appropiate value of the DB instance.
  // Intervall covered by CW mtrics may be 60 min, and current DBidle time period 45 min. Slice oldest 15 min.
  // var timeago = 60 * 45 * 1000;
  var timeago = 60 * runninginstanceproperties.IdlePeriodMin * 1000
  var inperiod = (RDSCWmetrics.MetricDataResults[0].Timestamps.filter(ts => {
    if (Date.parse(ts) > (Date.now() - timeago)) {
      return ts
    }
  })).length
  if ((runninginstanceproperties.IdleConfiguration).includes('C')) {
    var cpuutilisation = (RDSCWmetrics.MetricDataResults.filter(cwm => cwm.Label === (runninginstanceproperties.DBInstanceIdentifier + ':' + 'CPUUtilization')))[0].Values.slice(0, inperiod)
    var idlethresholdtype = Object.keys(runninginstanceproperties.IdleTreshold).filter(k => k.match(/.*cpu.*/i))[0]
    if (idlethresholdtype.match(/.*avg.*/i)) {
      var cpuavg = _.mean(cpuutilisation)
      metric.CpuUtilisation = cpuavg
    }

    if (idlethresholdtype.match(/.*max.*/i)) {
      var cpumax = Math.max(...cpuutilisation)
      metric.CpuUtilisation = cpumax
    }
  }

  if ((runninginstanceproperties.IdleConfiguration).includes('S')) {
    var sessioncount = (RDSCWmetrics.MetricDataResults.filter(cwm => cwm.Label === (runninginstanceproperties.DBInstanceIdentifier + ':' + 'DatabaseConnections')))[0].Values.slice(0, inperiod)
    var idlethresholdtype = Object.keys(runninginstanceproperties.IdleTreshold).filter(k => k.match(/.*session.*/i))[0]
    if (idlethresholdtype.match(/.*avg.*/i)) {
      var sessionavg = _.mean(sessioncount)
      metric.SessionCount = sessionavg
    }
    if (idlethresholdtype.match(/.*max.*/i)) {
      var sessionmax = Math.max(...sessioncount)
      metric.SessionCount = sessionmax
    }
  }

  return metric
}

async function GetRDSinstanceEvents (rds, activedbinstances, dbpropertiesarray) {
  var runningdbinstances = dbpropertiesarray.filter(dbpa => {
    if (activedbinstances.includes(dbpa.DBInstanceIdentifier)) {
      return dbpa
    }
  })

  var runningdbpromises = runningdbinstances.map(rdbi => {
    var params = {
      Duration: (rdbi.IdlePeriodMin * 3),
      EventCategories: [
        'notification', // see sample bellow
        'recovery'
      ],
      SourceIdentifier: rdbi.DBInstanceIdentifier,
      SourceType: 'db-instance'
    }

    var promisedrdsevent = new Promise((resolve, reject) => {
      rds.describeEvents(params, function (err, data) {
        if (err) reject(err) // console.log(err, err.stack); // an error occurred
        else resolve(data) // console.log(data);           // successful response
      })
    })
    return promisedrdsevent
  })

  var resolved = await Promise.all(runningdbpromises)
  var Events = _.flatten(resolved.map(r => r.Events))

  return Events
}

function FindDBStartuptime (activedbevents, DBInstanceIdentifier) {
  var specificdbevents = activedbevents.filter(ev => ev.SourceIdentifier === DBInstanceIdentifier)
  var eventsarray = []
  specificdbevents.map(evst => {
    eventsarray.push({
      DateTime: Date.parse(evst.Date),
      Message: evst.Message,
      DBInstanceIdentifier: evst.SourceIdentifier
    })
  })

  if (eventsarray.filter(ea => ea.Message === 'DB instance started').length > 0) {
    var allstartuptime = eventsarray.filter(ea => ea.Message === 'DB instance started')
    // selecting last/latest of potentially multiple starts.
    var startuptime = (_.maxBy(allstartuptime, 'DateTime')).DateTime
  }
  else if (eventsarray.filter(ea => ea.Message.match('Recovery.*')).length > 0) {
    // the instance is in recovery mode (before started state)
    var startuptime = Date.now()
  }
  else {
    // if the instance is active, does not have startup and recovery events in the period that means its been running longtime.
    var startuptime = 1
  }

  return startuptime
}

function ValidateTimeToStart (StartAfter, IdlePeriodMin, InstanceIdentifier) {
  // Get current time in HH:MM format
  var d = new Date()
  var hours = ('0' + d.getUTCHours()).substr(-2)
  var minutes = d.getUTCMinutes()
  var currenttimestring = hours + ':' + minutes

  // Get Starttime + IDleperiodX2 in HH:MM format
  // kudos:https://stackoverflow.com/questions/17446466/add-15-minutes-to-string-in-javascript/17446649

  var timeToadd = '00:' + (IdlePeriodMin * 2) // Time to be added in min
  var timeToAddArr = timeToadd.split(':')
  var ms = (60 * 60 * parseInt(timeToAddArr[0]) + 60 * (parseInt(timeToAddArr[1]))) * 1000
  var newTime = new Date('1970-01-01T' + StartAfter).getTime() + ms
  var finalTime = new Date(newTime).toLocaleString('en-GB').slice(12, 17)

  if (StartAfter !== 'null' && StartAfter !== undefined) {
    if (currenttimestring > StartAfter && currenttimestring < finalTime) {
      console.log('DBInstance/AutosclaingGroup ' + InstanceIdentifier + ' is eligible to start because it is set to start after UTC ' + StartAfter + ' in the time period ending at ' + finalTime + ', which is X2 the idle time: ' + IdlePeriodMin + ' min.')
      return true
    }
    else {
      console.log('Current time is not eligable for automatic start of instance ' + InstanceIdentifier)
      return false
    }
  }
  else {
    return false
  }
}

function CheckStartConditions (StartAfter, IdlePeriodMin, InstanceIdentifier, RequestType, StartAtUserLogin) {
  var usercondition = false
  var timecondition = ValidateTimeToStart(StartAfter, IdlePeriodMin, InstanceIdentifier)

  if ((RequestType === 'useractivity') && (StartAtUserLogin === true)) {
    usercondition = true
  }

  if (timecondition || usercondition) {
    // validate if either the time is right to startdb instance /scale up ASG because
    // 1.) the configured schedule or 2.) the request is because of a user activity (login) and startat login is true
    return true
  }
  else {
    return false
  }
}

async function VerifyASGDesiredState (autoscaling, AutoScalingGroupList, StateofASGs, IdleTime, RequestType) {
  var ASGsettings = []
  var TurnServerASG = IdleTime[Object.keys(IdleTime)[Object.keys(IdleTime).findIndex(k => k.match(/Turns/i))]]
  TurnServerASG.AutoScalingGroupName = AutoScalingGroupList.TurnServerASG
  ASGsettings.push(TurnServerASG)

  var WebRTCProxyASG = IdleTime[Object.keys(IdleTime)[Object.keys(IdleTime).findIndex(k => k.match(/WebRTCProxy/i))]]
  WebRTCProxyASG.AutoScalingGroupName = AutoScalingGroupList.WebRTCProxyASG
  ASGsettings.push(WebRTCProxyASG)

  var asgpromises = StateofASGs.map(asg => {
    var SpecificIdleSettings = ASGsettings.filter(asgs => asgs.AutoScalingGroupName === asg.AutoScalingGroupName)[0]

    if (SpecificIdleSettings.LastContainer === undefined) {
      var idleperiod = SpecificIdleSettings.Period
    }
    else {
      var idleperiod = SpecificIdleSettings.LastContainer
    }

    var eligableforstart = CheckStartConditions(SpecificIdleSettings.StartAfterUTC, idleperiod, SpecificIdleSettings.AutoScalingGroupName, RequestType, SpecificIdleSettings.StartAtUserLogin)

    // For ASGs besides checkstartcondition verify that current instance count is lower than the desired instance count, to initiate the scale up action.
    if ((asg.Instances.length < SpecificIdleSettings.StartDesiredCount) && eligableforstart) {
      var type = 'DesiredCapacity'
      var asgparams = {
        AutoScalingGroupName: asg.AutoScalingGroupName,
        DesiredCapacity: SpecificIdleSettings.StartDesiredCount
      }
      return SetAsgSettings(autoscaling, type, asgparams)
    }
    else {
      return 'done'
    }
  })
  var resolved = await Promise.all(asgpromises)
  return resolved
}
