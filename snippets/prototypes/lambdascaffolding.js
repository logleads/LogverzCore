const AWS = require('aws-sdk')
const _ = require('lodash')

module.exports.handler = async function (event, context) {
  // Dev environment settings
  if (process.env.Environment === 'Windows') {
    var region = 'ap-southeast-2'
    var commonshared = require('../shared/commonshared')
    var event = require('./events/scaledown').event
    var context = require('./events/context').context
  } else {
    const arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var commonshared = require('./shared/commonshared')
    console.log('Event RECEIVED: ' + JSON.stringify(event))
    console.log('context RECEIVED: ' + JSON.stringify(context))
  }

  AWS.config.update({
    region
  })
  const SSM = new AWS.SSM()
  const dynamodb = new AWS.DynamoDB()
  const docClient = new AWS.DynamoDB.DocumentClient()

// return response(event, context, "SUCCESS", {})
}

function response (event, context, status, responseData) {
  return new Promise(() => sendResponse(event, context, status, responseData))
}

function sendResponse (event, context, responseStatus, responseData) {
  // Send response to the pre-signed S3 URL
  const responseBody = JSON.stringify({
    Status: responseStatus,
    Reason: 'See the details in CloudWatch Log Stream: ' + context.logStreamName,
    PhysicalResourceId: context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: responseData
  })

  // console.log("RESPONSE BODY:\n", responseBody); //removed the log so that password is not logged in CloudTrail.

  const https = require('https')
  const url = require('url')
  //depricated use axios as seen in setconnectionparamsdb.js
  const parsedUrl = url.URL(event.ResponseURL)
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'content-type': '',
      'content-length': responseBody.length
    }
  }

  console.log('SENDING RESPONSE...\n')

  const request = https.request(options, function (response) {
    console.log('STATUS: ' + response.statusCode)
    console.log('HEADERS: ' + JSON.stringify(response.headers))
    // Tell AWS Lambda that the function execution is done
    context.done()
  })

  request.on('error', function (error) {
    console.log('sendResponse Error:' + error)
    // Tell AWS Lambda that the function execution is done
    context.done()
  })

  // write data to request body
  request.write(responseBody)
  request.end()
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
