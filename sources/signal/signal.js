/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import _ from 'lodash'
import qs from 'qs'
import jwt from 'jsonwebtoken'
import axios from 'axios'
import CryptoJS from 'crypto-js'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import { AutoScalingClient, SetDesiredCapacityCommand, paginateDescribeAutoScalingGroups } from '@aws-sdk/client-auto-scaling'
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2'
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// need to determine the optimal instance/container for connection routing.
// Rules:
// if instance count == asg minum (no scale down) route to least utilised instance
// if instance count > asg minimum, ASG utilisation is mid (70<X>40)or high(70+): least utilised
// if instance count > asg minimum, ASG utilisation is low (>40%): check utilisation of 2nd least utilised instance (for auto draining),
//					providing that instance is not over avg 50 %, otherwise select first instance, as having instances: i1:5% i2:75%  avg 40%, hence the 50% part.

// docker container is run on the scaled instance, host without running containers  will shut down in 3 minutes.
// Once instance is Selected connect to container with axios, timeout 3 seconds if timed out check if there is another host/task avilable than use that,

export const handler = async (event, context) => {
  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    var commonsharedpath = ('file:///' + path.join(__dirname, 'shared', 'commonsharedv3.js').replace(/\\/g, '/'))
    var commonshared = await GetConfiguration(commonsharedpath, '*')
    const arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var ASGName = process.env.ASGName
    var cert = process.env.PublicKey
    var AllowedOrigins = process.env.AllowedOrigins
    const maskedevent = commonshared.masktoken(JSON.parse(JSON.stringify(event)))
    console.log('REQUEST RECEIVED: \n' + JSON.stringify(context) + '\n\n')
    console.log('THE EVENT: \n' + JSON.stringify(maskedevent) + '\n\n')
  }
  else {
    // Dev environment settings
    var directory = path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'signal', 'mydev.mjs')
    const mydev = await import('file:///' + directory.replace(/\\/g, '/'))
    var commonshared = mydev.commonshared
    var region = mydev.region
    var event = mydev.event
    var ASGName = mydev.ASGName
    var cert = mydev.cert
    var AllowedOrigins = mydev.AllowedOrigins
  }

  const asgclient = new AutoScalingClient({})
  const ddclient = new DynamoDBClient({})
  const ssmclient = new SSMClient({})
  const cwclient = new CloudWatchClient({})
  const ec2client = new EC2Client({})
  const mininstancecountreached = false
  const maxinstancecountreached = false

  const tokenobject = commonshared.ValidateToken(jwt, event.headers, cert)
  if (tokenobject.state === true) {
    var response = await main(event, commonshared, ssmclient, ddclient, asgclient, cwclient, ec2client, mininstancecountreached, maxinstancecountreached, ASGName, AllowedOrigins)
  }
  else {
    var message = tokenobject.value
    console.error(message)
    var reply = {
      status: 400,
      data: message,
      header: {}
    }
    var response = commonshared.apigatewayresponse(reply, event.headers, AllowedOrigins)
  } // not valid token
  return response
}

async function main (event, commonshared, ssmclient, ddclient, asgclient, cwclient, ec2client, mininstancecountreached, maxinstancecountreached, ASGName, AllowedOrigins) {
  console.log('main')
  const details = {
    source: 'signal.js:handler',
    message: ''
  }

  const webrtcparam = {
    Name: '/Logverz/Logic/WebRTCProxyKey',
    WithDecryption: true
  }

  var [asgsettings, WebRTCProxyKey] = await Promise.all([
    commonshared.ASGstatus(AutoScalingClient, paginateDescribeAutoScalingGroups, [ASGName]),
    commonshared.getssmparameter(ssmclient, GetParameterCommand, webrtcparam, ddclient, PutItemCommand, details)
    // TODO check TurnServerASG as well, if none running increase desired count +1
  ])

  var WebRTCProxyKey = WebRTCProxyKey.Parameter.Value
  var instances = commonshared.GroupAsgInstances(asgsettings)

  if (instances.all.length === 0) {
    var reply = {
      status: 500,
      data: 'no instances are available, check status and either start or wait depending on their settings and DB server state.',
      header: {}
    }
  }
  else {
    if (asgsettings[0].Instances.length === asgsettings[0].MinSize) {
      mininstancecountreached = true
    }
    if (asgsettings[0].Instances.length === asgsettings[0].MaxSize) {
      maxinstancecountreached = true
    }

    const cwmetrics = await commonshared.GetEC2InstancesMetrics(cwclient, GetMetricDataCommand, instances.eligable, 10) // in minutes
    const utilisation = ConvertEC2InstanceMetrics(commonshared, cwmetrics)

    // check utilisation here if high (and max instance count is not reached) than scale up...
    if ((utilisation.averageusage === 'high') && (maxinstancecountreached === false)) {
      const params = {
        AutoScalingGroupName: ASGName,
        DesiredCapacity: instances.all.length + 1,
        HonorCooldown: true
      }
      const command = new SetDesiredCapacityCommand(JSON.parse(params))
      await asgclient.send(command)
    }

    // Select instance for connection.
    let SelectedInstance = false
    if (instances.eligable.length === 0) {
      // there are no valid instances, wait here 3x5 seconds for it to be ELIGIBLE if not than inform requestor that no eligible instance have been found.
      const max = 4
      for (let index = 1; index < max; index++) {
        // get instances current state
        var asgsettings = commonshared.ASGstatus(AutoScalingClient, paginateDescribeAutoScalingGroups, [ASGName])
        var instances = commonshared.GroupAsgInstances(asgsettings)

        if (instances.eligable.length === 0) {
          console.log('Waiting for instance to become available, current state of instances:')
          var current = instances.all.map(instance => ('Instance: "' + instance.InstanceId + '", LifecycleState: ' + instance.LifecycleState + ', Draining: ' + instances.draining.includes(instance.InstanceId) + ', Health Status: ' + instance.HealthStatus))
          console.log(current)
          await timeout(5000)
        }
        else {
          SelectedInstance = instances.eligable[0].InstanceId
          break
        }
      }

      if (SelectedInstance === false) {
        const message = {}
        message.data = current
        message.text = 'please wait a mintue or so for the instanc(s) to become available.'
      }
    }
    else if (instances.eligable.length === 1) {
      SelectedInstance = instances.eligable[0].InstanceId
    }
    else if (instances.eligable.length > 1) {
      if ((utilisation.averageusage === 'low') && mininstancecountreached) {
        // we cant scale down further because mininstancecountreached, hence just select the lowest utilised if the same than most cpu credit avilable.
        SelectedInstance = AptInstance(utilisation, false)
      }
      else if (utilisation.averageusage === 'low') {
        // check utilisation of 2nd least utilised instance (for auto draining), providing that instance is not over avg 50 %,
        SelectedInstance = AptInstance(utilisation, true)
      }
      else {
        // utilisation is mid or high select lowest utilised if the same than most cpu credit avilable.
        SelectedInstance = AptInstance(utilisation, false)
      }
    }

    const instancesettings = await GetInstanceProperties(ec2client, [SelectedInstance]) // (instances.all.map(instance=>instance.InstanceId))

    const endpoint = instancesettings[Object.keys(instancesettings)[0]].PrivateIpAddress
    const ciphertext = CryptoJS.AES.encrypt(event.body, WebRTCProxyKey).toString()
    console.log(ciphertext)
    const offer = ciphertext

    const AuthObject = {}

    if (event.headers.Authorization !== undefined) {
      var token = event.headers.Authorization.split(' ')[1]
      _.set(AuthObject, 'headers.Cookie', 'LogverzAuthToken=' + token)
    }
    else if (typeof (event.headers.cookie) !== 'object') {
      const cookiearray = event.headers.cookie.split(';')
      const LogverzAuthCookie = cookiearray.filter(i => i.includes('LogverzAuthToken'))
      var token = LogverzAuthCookie[0].split('=')[1]
      _.set(AuthObject, 'headers.Cookie', 'LogverzAuthToken=' + token)
    }
    else {
      // cookies parsed by webrtcproxy are object.
      var token // = cookies.LogverzAuthToken
      _.set(AuthObject, 'headers.Cookie', 'LogverzAuthToken=' + token)
    }

    var reply = await connecttocontainer(AuthObject, endpoint, offer, WebRTCProxyKey)

    const result = commonshared.apigatewayresponse(reply, event.headers, AllowedOrigins)
    console.log(result)
    return result
  }
}

async function connecttocontainer (AuthObject, endpoint, offer, WebRTCProxyKey) {
  // Connect to the selected instance/container using cryptoJS, with axios, timeout 5 seconds if timed out check retry connection n number of times (15seconds).
  var reply = {}
  const requestconfig = {
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    method: 'POST',
    port: 80,
    timeout: 5000,
    url: 'http://' + endpoint + '/WebRTC/Signal', // /
    data: qs.stringify({
      ec: {
        offer
      }
    })
  }
  _.merge(requestconfig, AuthObject)

  for (let i = 0; i < 1; i++) {
    try {
      var response = await axios(requestconfig)
      // console.log(response)
    }
    catch (e) {
      console.error(e)
      await timeout(5000)
    }
  }

  if (response.status === 200) {
    const bytes = CryptoJS.AES.decrypt(response.data, WebRTCProxyKey)
    const originalText = bytes.toString(CryptoJS.enc.Utf8)
    reply = {
      status: 200,
      data: originalText,
      header: {}
    }
  }
  else {
    reply = {
      status: 500,
      data: response.message,
      header: {}
    }
  }
  console.log(reply)
  return reply
}

function AptInstance (utilisation, secondinstance) {
  const instaceutilisation = _.omit(utilisation, 'averageusage')
  let cpuusage = Object.keys(instaceutilisation).map(instance => utilisation[instance].CPUUtilization).sort()

  // https://levelup.gitconnected.com/filter-unique-in-javascript-226007247354
  const unique = (x, i, a) => a.indexOf(x) === i
  cpuusage = cpuusage.filter(unique)

  var maxcredits = null
  if (secondinstance === true) {
    // above the minimum instance count, and cpu usage is low so we use the second lowest utilisedinstance
    // so that the connections are drained from the lowest utilised and will auto scale away.
    if ((cpuusage[1]) < 50) {
      var selectedinstancescpuutilisation = cpuusage[1]
    }
    else {
      var selectedinstancescpuutilisation = cpuusage[0]
    }
    var Aptinstance = _.findKey(instaceutilisation, function (i) {
      return i.CPUUtilization === selectedinstancescpuutilisation
    })
  }
  else if (cpuusage.length !== 1) {
    const mincpuusage = Math.min(...cpuusage)
    var Aptinstance = _.findKey(instaceutilisation, function (i) {
      return i.CPUUtilization === mincpuusage
    })
  }
  else {
    // There are multiple instances Cpu usage unique returned 1 value, multiple instances have the same cpu usage hence selecting the one with more CPU credits
    const CPUCreditBalances = Object.keys(instaceutilisation).map(instance => utilisation[instance].CPUCreditBalance)
    var maxcredits = Math.max(...CPUCreditBalances)

    var Aptinstance = _.findKey(instaceutilisation, function (i) {
      return i.CPUCreditBalance === maxcredits
    })
  }

  return Aptinstance
}

async function GetInstanceProperties (ec2client, instances) {
  const params = {
    InstanceIds: instances
  }

  const command = new DescribeInstancesCommand(params)
  const settings = await ec2client.send(command)

  const requestedsettings = {}
  settings.Reservations.forEach(reservation => {
    const instance = reservation.Instances[0].InstanceId
    const PrivateIpAddress = reservation.Instances[0].PrivateIpAddress
    // var InstanceType= reservation.Instances[0].InstanceType
    _.set(requestedsettings, (instance + '.PrivateIpAddress'), PrivateIpAddress)
    // _.set(requestedsettings,(instance+".InstanceType"),InstanceType);
  })

  return requestedsettings
}

function ConvertEC2InstanceMetrics (commonshared, data) {
  const instances = {}

  for (const item in data.MetricDataResults) {
    const MetricDataResults = data.MetricDataResults[item]
    const instance = MetricDataResults.Label.split(':')[0]
    const metric = MetricDataResults.Label.split(':')[1]
    _.set(instances, (instance + '.' + metric), commonshared.average(MetricDataResults.Values))
  }
  const averageusage = commonshared.average(Object.keys(instances).map(instance => instances[instance].CPUUtilization))
  if (averageusage < 40) {
    instances.averageusage = 'low'
  }
  else if ((averageusage < 70) && (averageusage > 40)) {
    instances.averageusage = 'mid'
  }
  else {
    instances.averageusage = 'high'
  }
  return instances
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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
// aws cloudwatch get-metric-statistics --metric-name CPUUtilization --start-time 2021-08-12T04:56:00Z --end-time 2021-08-12T05:06:00Z --period 600 --namespace AWS/EC2 --statistics Average --dimensions Name=InstanceId,Value=i-0c17f68805f787ac8
// aws cloudwatch get-metric-statistics --metric-name CPUCreditBalance --start-time 2021-08-12T04:56:00Z --end-time 2021-08-12T05:06:00Z --period 600 --namespace AWS/EC2 --statistics Maximum --dimensions Name=InstanceId,Value=i-0c17f68805f787ac8
// aws rds describe-db-instances  --db-instance-identifier inrn65kvmj
