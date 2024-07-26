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

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import { AutoScalingClient, paginateDescribeAutoScalingGroups } from '@aws-sdk/client-auto-scaling'
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { NodeHttpHandler } from '@smithy/node-http-handler'

import express from 'express'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import http from 'http'
import https from 'https'

import Peer from 'simple-peer'
// optionallly change to @roamhq/wrtc
import wrtc from 'wrtc'
import CryptoJS from 'crypto-js'
import { XMLParser } from 'fast-xml-parser'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'

import axios from 'axios'
import { Sequelize, QueryTypes, Op } from 'sequelize'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

var db = new loki('db.json', {
  autoupdate: true
})

const app = express()
http.createServer(app)
var sqlproxypath = ('file:///' + path.join(__dirname, './sqlproxy.mjs').replace(/\\/g, '/'))
var sqlproxy = await GetConfiguration(sqlproxypath, '*')
const execFile = promisify(execCb)
const portnumber = 80

if (process.env.Environment !== 'LocalDev') {
  // Prod lambda function settings
  var commonsharedpath = ('file:///' + path.join(__dirname, './shared/commonsharedv3.js').replace(/\\/g, '/'))
  var commonshared = await GetConfiguration(commonsharedpath, '*')
  var authenticationsharedpath = ('file:///' + path.join(__dirname, './shared/authenticationsharedv3.js').replace(/\\/g, '/'))
  var authenticationshared = await GetConfiguration(authenticationsharedpath, '*')
  var enginesharedpath = ('file:///' + path.join(__dirname, 'shared', 'enginesharedv3.mjs').replace(/\\/g, '/'))
  var engineshared = await GetConfiguration(enginesharedpath, '*')
  var region = process.env.AWS_REGION
  var heartbeatlocation = 'file:///usr/src/app/build/heartbeat.json'
  var ASGNAME = fs.readFileSync('/usr/src/app/build/ASGName').toString().replace(/\r|\n/g, '')
  var instanceId = JSON.parse(fs.readFileSync('/usr/src/app/build/identitydocument').toString().replace(/\r|\n/g, '')).instanceId
  var privateIp = JSON.parse(fs.readFileSync('/usr/src/app/build/identitydocument').toString().replace(/\r|\n/g, '')).privateIp
  var loglocation = '/usr/src/app/build/startupdelayorerror'
  var gotablepath = '/usr/src/app/gotable'
}
else {
  var directory = path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'webrtcproxy', 'mydev.mjs')
  const mydev = await import('file:///' + directory.replace(/\\/g, '/'))
  var engineshared = mydev.engineshared
  var authenticationshared = mydev.authenticationshared
  var commonshared = mydev.commonshared
  var region = mydev.region
  var instanceId = mydev.instanceId
  var privateIp = mydev.privateIp
  var ASGNAME = mydev.ASGNAME
  var heartbeatlocation = mydev.heartbeatlocation
  var loglocation = mydev.loglocation
  var gotablepath = mydev.gotablepath
}

const p2path = ('file:///' + path.join(__dirname, 'p2pconnection.js').replace(/\\/g, '/'))
const p2pconnection = await GetConfiguration(p2path, '*')

const localheartbeatfrequency = 1 // 1 min
let i = -1
const serverstarttime = Date.now()
console.log('Region: ' + region)

// https://aws.amazon.com/premiumsupport/knowledge-center/lambda-function-retry-timeout-sdk/
const lambdatimeout = 3600000

const agentOptions = {
  keepAlive: false,
  maxSockets: 100
}

const httpsAgent = new https.Agent(agentOptions)

var config = {
  region,
  maxRetries: 2,
  requestHandler: new NodeHttpHandler({
    httpsAgent
  }),
  requestTimeout: lambdatimeout
}

const ddclient = new DynamoDBClient(config)
const ssmclient = new SSMClient(config)
const docClient = DynamoDBDocumentClient.from(ddclient)
const cwclient = new CloudWatchClient(config)

app.locals.identities = db.addCollection('Logverz-Identities', {
  ttl: 20 * 60 * 1000
})
app.locals.queries = db.addCollection('Logverz-Queries', {
  ttl: 20 * 60 * 1000
})

app.locals.user = db.addCollection('User') // webrtc channel user mapping info.
app.locals.commonshared = commonshared
app.locals.authenticationshared = authenticationshared
app.locals.engineshared = engineshared
app.locals.docClient = docClient
app.locals.ddclient = ddclient
app.locals.PutItemCommand = PutItemCommand
app.locals.Peer = Peer
app.locals.wrtc = wrtc
app.locals.CryptoJS = CryptoJS
app.locals.XMLParser = XMLParser
app.locals.execFile = execFile
app.locals.jwt = jwt
app.locals.sqlproxy = sqlproxy
app.locals.axios = axios
app.locals.Sequelize = Sequelize
app.locals.QueryTypes = QueryTypes
app.locals.Op = Op
app.locals.QueryCommand = QueryCommand
app.locals.UpdateCommand = UpdateCommand
app.locals.lodash = _
app.locals.GetParameterCommand = GetParameterCommand
app.locals.ssmclient = ssmclient
app.locals.fs = fs
app.locals.path = path
app.locals.promisify = promisify
runmain().catch(error => console.error(error.stack))

async function runmain () {
  await timeout(1000)

  // Kudos:https://thecodebarbarian.com/introducing-await-js-express-async-support-for-express-apps.html
  const details = {
    source: 'proxyserver.js:runmain',
    message: ''
  }

  const params1 = {
    Name: '/Logverz/Settings/IdleTime',
    WithDecryption: false
  }

  const params2 = {
    Name: '/Logverz/Logic/WebRTCProxyKey',
    WithDecryption: true
  }

  const params3 = {
    Name: '/Logverz/Logic/PublicKey',
    WithDecryption: true
  }

  const params4 = {
    Name: '/Logverz/Database/Registry',
    WithDecryption: false
  }

  const [idletime, WebRTCProxyKey, cert, DBRegistry] = await Promise.all([
    commonshared.getssmparameter(ssmclient, GetParameterCommand, params1, ddclient, PutItemCommand, details),
    commonshared.getssmparameter(ssmclient, GetParameterCommand, params2, ddclient, PutItemCommand, details),
    commonshared.getssmparameter(ssmclient, GetParameterCommand, params3, ddclient, PutItemCommand, details),
    commonshared.getssmparameter(ssmclient, GetParameterCommand, params4, ddclient, PutItemCommand, details)
  ])

  await StartHeartBeat(db, ASGNAME, idletime.Parameter.Value)

  const staticMiddleware = function (req, res, next) {
    // Kudos: https://stackoverflow.com/questions/30005587/is-it-possible-to-use-validation-with-express-static-routes
    if (req.cookies.LogverzAuthToken === undefined) {
      res.send(401, '<br>LogverzAuthToken missing!<br><br> <i>To acces the site you need to provide a valid authentication token you can set that in developertools=>console=><br>document.cookie="LogverzAuthToken=valueoftoken" </i>')
    }
    else {
      const tokenobject = commonshared.ValidateToken(jwt, req, cert.Parameter.Value)

      if (tokenobject.state === true) {
        next()
      }
      else {
        res.send(401, 'LogverzAuthToken invalid')
      }
    }
  }

  app.use(function (req, res, next) {
    // kudos: https://stackoverflow.com/questions/18310394/no-access-control-allow-origin-node-apache-port-issue
    // needed for connection test app to be able to make cross site request.
    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin', `http://${privateIp}:80`)

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'POST')

    // Request headers you wish to allow
    // res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', true)

    // Pass to next layer of middleware
    next()
  })
  app.use(bodyParser.urlencoded({
    extended: true
  }))
  app.use(bodyParser.json())
  app.use(cookieParser())
  app.use(staticMiddleware, express.static('files'))
  app.use('/landingpage', express.static(path.join(__dirname, 'landingpage')))
  app.set('cert', cert.Parameter.Value)
  app.set('WebRTCProxyKey', WebRTCProxyKey)
  app.set('DBRegistry', DBRegistry)
  app.set('region', region)
  app.set('gotablepath', gotablepath)

  app.get('/', (req, res) => {
    // eslint-disable-next-line n/no-path-concat
    res.sendFile(__dirname + '/landingpage/index.html')
  })

  app.get('/stat', (req, res) => {
    // on client document.cookie="LogverzAuthToken=valueofcookie"
    res.json({
      session: app.locals.user.data
    })
  })

  app.get('/:name', (req, res) => {
    // eslint-disable-next-line n/no-path-concat
    res.sendFile(__dirname + '\\' + req.params.name)
  })

  app.post('/WebRTC/Signal', p2pconnection.p2pconnection) // /WebRTC/Signal

  app.listen(portnumber, () => {
    const newDate = new Date()
    newDate.setTime(serverstarttime)
    var dateString = newDate.toUTCString()
    console.log('started at: ' + dateString + '\n')
    console.log('listening on *:' + portnumber + '\n' + 'PublicKey:\n ' + cert.Parameter.Value)
  })
}

async function StartHeartBeat (db, ASGName, idletime) {
  // Run heartbeat the 1st time
  await heartbeatFunc(db, ASGName, JSON.parse(idletime), heartbeatlocation)
  // Run heartbeat consecutive (2nd,3rd etc) time
  setInterval(() => heartbeatFunc(db, ASGName, JSON.parse(idletime), heartbeatlocation), (localheartbeatfrequency * 60000)) // 1min
}

async function heartbeatFunc (db, ASGName, idletime, heartbeatlocation) {
  const usercollectionnumber = _.findKey(db.collections, function (c) {
    return c.name === 'User'
  })
  const userscollection = db.collections[usercollectionnumber]

  const currenttime = new Date()
  const currentunixtime = currenttime.getTime()
  const initgraceperiod = serverstarttime + (idletime.WebRTCProxy.Container * 60 * 1000)

  // check if user collection === 0, if true that means that are no connected users, initgrace period after instance started no users connected.
  if ((userscollection.data.length === 0) && (initgraceperiod < currentunixtime)) {
    var AutoScalingGroupNames = [ASGName]
    const asgsettings = await commonshared.ASGstatus(AutoScalingClient, paginateDescribeAutoScalingGroups, AutoScalingGroupNames)

    // const asgsettings = await commonshared.GetAsgSettings(autoscaling, {
    //   AutoScalingGroupNames: [ASGName]
    // })

    const asgminimum = asgsettings.AutoScalingGroups[0].Instances.length === (asgsettings.AutoScalingGroups[0].MinSize)
    var contentobject = updateHearthbeatfilecontent(heartbeatlocation, instanceId, userscollection, asgminimum)

    if (asgminimum) {
      console.log(instanceId + " @C: Autoscaling group Instance count is at the minium can't stop instance to scale back further.")
      i = ++i
      await writeHBfile(heartbeatlocation, contentobject)
    }
    else {
      if (asgsettings.AutoScalingGroups[0].Instances.length === (asgsettings.AutoScalingGroups[0].MinSize + 1)) {
        // determine if instance is the last downscalable instance (mincount+1) or not. If last the scaledown time can be longer.
        var idletimecontainer = timeagominutes(idletime.WebRTCProxy.LastContainer)
      }
      else {
        var idletimecontainer = timeagominutes(idletime.WebRTCProxy.Container)
      }
      // check last connection was more than X minutes (ssm idle time) ago if yes than idle time has passed.
      const instanceproperties = contentobject.Instances.filter(i => i.Name === instanceId)[0]

      if (idletimecontainer > instanceproperties.LastUserConnection) {
        // TODO handle non burstable instances with no CPU credit balance.
        const instances = [{
          InstanceId: instanceId
        }]

        const cwmetrics = await commonshared.GetEC2InstancesMetrics(cwclient, GetMetricDataCommand, instances, 10) // in minutes
        const CreditBalanceCollectionNumber = _.findKey(cwmetrics.MetricDataResults, function (cwm) {
          return cwm.Label === (instanceId + ':' + 'CPUCreditBalance')
        })
        const CreditBalance = cwmetrics.MetricDataResults[CreditBalanceCollectionNumber].Values

        // check cloudwatch metrics if more than 2 than do not update the HB which will lead to host stop
        if (commonshared.average(CreditBalance) > 2) {
          // we stop by adding command "stopserver" to the loglocation which will result in webrtcproxycontrol.ps1 stopping the instance
          console.log(instanceId + ' @E: all conditions met, stopping soon')
          fs.appendFileSync(loglocation, 'StopServer\n', {
            encoding: 'utf8'
          })
        }
        else {
          console.log(instanceId + ' @D: cpu credit balance low, waiting for it to replenish')
          i = ++i
          await writeHBfile(heartbeatlocation, contentobject)
        }
      }
      else {
        i = ++i
        await writeHBfile(heartbeatlocation, contentobject)
        console.log(instanceId + ' @B: No user connected, however last Connected time was less than the specified ' + idletimecontainer + ' idle time.')
      }
    }
  }
  else {
    i = ++i
    var contentobject = updateHearthbeatfilecontent(heartbeatlocation, instanceId, userscollection, null)
    await writeHBfile(heartbeatlocation, contentobject)
    const d = new Date()
    const minutes = d.getMinutes()
    if (minutes % 2 === 0) {
      // write out status at every 2 minutes
      console.log(instanceId + ' @A Status: User(s) connected or init grace period has not yet passed')
    }
  }
  // console.log("It's a live");
}

function updateHearthbeatfilecontent (heartbeatlocation, instanceId, userscollection, asgminimum) {
  const agounix = timeagominutes(10) // 10 minutes ago
  const lastupdate = Date.now()
  try {
    var contentobject = JSON.parse(fs.readFileSync(heartbeatlocation, {
      encoding: 'utf8',
      flag: 'r'
    }))
  }
  catch (error) {
    var contentobject = {
      Instances: [{
        Name: instanceId,
        OpenConnections: userscollection.data.length,
        LastUpdate: lastupdate,
        LastUserConnection: lastupdate
      }]
    }
  }

  const instancelocation = _.findKey(contentobject.Instances, function (i) {
    return i.Name === instanceId
  })

  if (userscollection.data.length !== 0) {
    var lastconnection = lastupdate
  }
  else if (instancelocation !== undefined) {
    var lastconnection = contentobject.Instances[instancelocation].LastUserConnection
  }
  else if (instancelocation === undefined) {
    var lastconnection = serverstarttime
  }
  else {
    console.error('unknown condition')
    console.log('usercollectionnumber: ' + userscollection.data.length + '\n' + 'Contentobject: ' + JSON.stringify(contentobject.Instances) + '\n' + 'Instanceid: ' + instanceId + '\n')
  }

  if (instancelocation === undefined) {
    // add instance
    contentobject.Instances.push({
      Name: instanceId,
      OpenConnections: userscollection.data.length,
      LastUpdate: lastupdate,
      LastUserConnection: lastconnection,
      ASGMinimum: asgminimum
    })
  }
  else {
    // update instance
    contentobject.Instances[instancelocation] = {
      Name: instanceId,
      OpenConnections: userscollection.data.length,
      LastUpdate: lastupdate,
      LastUserConnection: lastconnection,
      ASGMinimum: asgminimum
    }
  }
  // remove stale entries that are older than 10 minutes.
  const notstaleentries = contentobject.Instances.filter(i => i.LastUpdate > agounix)
  contentobject.Instances = notstaleentries

  return contentobject
}

async function writeHBfile (heartbeatlocation, contentobject) {
  // put heartbeat file to /usr/src/app/build
  var config = {
    encoding: 'utf8',
    flag: 'w'
  }
  fs.writeFileSync(fileURLToPath(heartbeatlocation), JSON.stringify(contentobject), config)
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function timeagominutes (number) {
  // kudos:https://coderatings.io/snippet/123/how-to-add-15-minutes-to-a-javascript-date-objece
  const now = new Date()
  const ago = new Date(now)
  ago.setMinutes(now.getMinutes() - number)
  const agounix = new Date(ago).getTime()
  return agounix
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
