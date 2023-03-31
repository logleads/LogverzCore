/* eslint-disable no-redeclare */
/* eslint-disable no-var */
const _ = require('lodash')
const app = require('express')()
const express = require('express')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const http = require('http').createServer(app)
const p2pconnection = require('./p2pconnection')
const path = require('path')
const fs = require('fs')
const AWS = require('aws-sdk')
const jwt = require('jsonwebtoken')
const db = require('./db').db
const portnumber = 80

if (process.env.Environment !== 'LocalDev') {
  // Prod lambda function settings
  var commonshared = require('./shared/commonshared')
  var authenticationshared = require('./shared/authenticationshared')
  var engineshared = require('./shared/engineshared')
  var region = process.env.AWS_REGION
  var heartbeatlocation = '/usr/src/app/build/heartbeat.json'
  var ASGNAME = fs.readFileSync('/usr/src/app/build/ASGName').toString().replace(/\r|\n/g, '')
  var instanceId = JSON.parse(fs.readFileSync('/usr/src/app/build/identitydocument').toString().replace(/\r|\n/g, '')).instanceId
  var privateIp = JSON.parse(fs.readFileSync('/usr/src/app/build/identitydocument').toString().replace(/\r|\n/g, '')).privateIp
  var loglocation = '/usr/src/app/build/startupdelayorerror'
  var mssqlqueryplanspath = '/usr/src/app/mssqlqueryplanspath/'
  var gotablepath = '/usr/src/app/gotable'
} else {
  const mydev = require(path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'webrtcproxy', 'mydev.js'))
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
  var mssqlqueryplanspath = mydev.mssqlqueryplanspath
}

const localheartbeatfrequency = 1 // 1 min
let i = -1
const serverstarttime = Date.now()
console.log('Region: ' + region)
AWS.config.update({
  region,
  maxRetries: 2,
  httpOptions: {
    timeout: 3600000 // https://aws.amazon.com/premiumsupport/knowledge-center/lambda-function-retry-timeout-sdk/
  }
})

const SSM = new AWS.SSM()
const dynamodb = new AWS.DynamoDB()
const autoscaling = new AWS.AutoScaling()
const cloudwatch = new AWS.CloudWatch()
const docClient = new AWS.DynamoDB.DocumentClient()

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
app.locals.dynamodb = dynamodb
app.locals.SSM = SSM

runmain().catch(error => console.error(error.stack))

async function runmain () {
  await timeout(1000)

  // Kudos:https://thecodebarbarian.com/introducing-await-js-express-async-support-for-express-apps.html
  const details = {
    source: 'proxyserver.js:runmain',
    message: ''
  }

  const [idletime, WebRTCProxyKey, cert, DBRegistry] = await Promise.all([
    commonshared.getssmparameter(SSM, {
      Name: '/Logverz/Settings/IdleTime',
      WithDecryption: false
    }, dynamodb, details),
    commonshared.getssmparameter(SSM, {
      Name: '/Logverz/Logic/WebRTCProxyKey',
      WithDecryption: true
    }, dynamodb, details),
    commonshared.getssmparameter(SSM, {
      Name: '/Logverz/Logic/PublicKey',
      WithDecryption: true
    }, dynamodb, details),
    commonshared.getssmparameter(SSM, {
      Name: '/Logverz/Database/Registry',
      WithDecryption: false
    }, dynamodb, details)
  ])

  await StartHeartBeat(db, ASGNAME, idletime.Parameter.Value)

  const staticMiddleware = function (req, res, next) {
    // Kudos: https://stackoverflow.com/questions/30005587/is-it-possible-to-use-validation-with-express-static-routes
    if (req.cookies.LogverzAuthToken === undefined) {
      res.send(401, '<br>LogverzAuthToken missing!<br><br> <i>To acces the site you need to provide a valid authentication token you can set that in developertools=>console=><br>document.cookie="LogverzAuthToken=valueoftoken" </i>')
    } else {
      const tokenobject = commonshared.ValidateToken(jwt, req, cert.Parameter.Value)

      if (tokenobject.state === true) {
        next()
      } else {
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
  app.set('mssqlqueryplanspath', mssqlqueryplanspath)

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

  http.listen(portnumber, () => {
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
    const asgsettings = await commonshared.GetAsgSettings(autoscaling, {
      AutoScalingGroupNames: [ASGName]
    })
    const asgminimum = asgsettings.AutoScalingGroups[0].Instances.length === (asgsettings.AutoScalingGroups[0].MinSize)
    var contentobject = updateHearthbeatfilecontent(heartbeatlocation, instanceId, userscollection, asgminimum)

    if (asgminimum) {
      console.log(instanceId + " @C: Autoscaling group Instance count is at the minium can't stop instance to scale back further.")
      i = ++i
      await writeHBfile(heartbeatlocation, contentobject)
    } else {
      if (asgsettings.AutoScalingGroups[0].Instances.length === (asgsettings.AutoScalingGroups[0].MinSize + 1)) {
        // determine if instance is the last downscalable instance (mincount+1) or not. If last the scaledown time can be longer.
        var idletimecontainer = timeagominutes(idletime.WebRTCProxy.LastContainer)
      } else {
        var idletimecontainer = timeagominutes(idletime.WebRTCProxy.Container)
      }
      // check last connection was more than X minutes (ssm idle time) ago if yes than idle time has passed.
      const instanceproperties = contentobject.Instances.filter(i => i.Name === instanceId)[0]

      if (idletimecontainer > instanceproperties.LastUserConnection) {
        // TODO handle non burstable instances with no CPU credit balance.

        const cwmetrics = await commonshared.GetEC2InstancesMetrics(cloudwatch, [{
          InstanceId: instanceId
        }], 10) // in minutes
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
        } else {
          console.log(instanceId + ' @D: cpu credit balance low, waiting for it to replenish')
          i = ++i
          await writeHBfile(heartbeatlocation, contentobject)
        }
      } else {
        i = ++i
        await writeHBfile(heartbeatlocation, contentobject)
        console.log(instanceId + ' @B: No user connected, however last Connected time was less than the specified ' + idletimecontainer + ' idle time.')
      }
    }
  } else {
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
  } catch (error) {
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
  } else if (instancelocation !== undefined) {
    var lastconnection = contentobject.Instances[instancelocation].LastUserConnection
  } else if (instancelocation === undefined) {
    var lastconnection = serverstarttime
  } else {
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
  } else {
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
  fs.writeFileSync(heartbeatlocation, JSON.stringify(contentobject), {
    encoding: 'utf8',
    flag: 'w'
  })
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

// document.cookie="LogverzAuthToken=eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoiQVdTOmFwcGVsbG8xIiwiaWF0IjoxNjE0MDI0NDM1LCJleHAiOjE2MTQwNTMyMzV9.AvNkGZmq0DWY5COlsSt_79JhOtL3lai_pT71tVjc-R-g-F4LHH9UNY9wAd8aK3S5z6A-5SOTfyqn-fYP4dBdu6aDr9VZYkwsIhzpyhVdnz9bC2N9PomxplM43m0XUmSAO4kP3RA6TALp-jRDpp-CTmWNanxB9soaI32E-r0fXqEA2PApS7oW75oh6MJlQoSh0XoPuHy74wWBftnaqyJfGeWrpi8qZhXpdJG89xtADntp5348M6UvNyjLvj1ZKtzJBEiiH7FyvDMGF93OiJOfnJExIR30qs9ANIKd7TEbE3e72mtu9Hn1g504rv3Xj5xOHpz_kmjf_sUoCZ-5-1hHG1YDF3eWWQkzBI15kB6P4SfKKpJyF28cmCfSgxwE-eKqROGOOz2kXsgJVry5I5wOQXk1LKysH5pX1NQ5o87YoS50f-2RIHxw1N4aJ1g5OjEcImb7UKC36MXdoLCc1Hsjxz0IcmCP4C3Jre76PbIgIA82vpXaMnrJSFnhidItTEb-xBCttM7WOQVCbGq_-XlsnkMTfrta0rNR4sYxyGBI8JTVaKnE0_htNYyDTqM8cUJEEMfLOykNqSi-vF19s5ooFDBjaeqRYka2lKBSoBEtWjpMNp5dGqdXBY16-kFyPi8zlAfd_2-_lm65LRkZeTSuF9dcQov6xIANCvpUUs-fkBA; Path=/V3;"
