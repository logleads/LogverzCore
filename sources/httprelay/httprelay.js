/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import _ from 'lodash'
import jwt from 'jsonwebtoken'
import axios from 'axios'

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// import {region, LogicBucket} from './mydev.mjs';
// import { name } from './mydev.mjs';

// note to self environment variable size is limited.
// Request must be smaller than 5120 bytes for the UpdateFunctionConfiguration operation (Service: AWSLambda; Status Code: 413; Error Code: RequestEntityTooLargeException;)
// Also Lambda was unable to configure your environment variables because the environment variables you have provided exceeded the 4KB limit.
// Possible workarround of sharingmore paths, is lambda layers: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-layerversion.html

// User,           Access key ID,      Secret access key,                       Password

export const handler = async (event, context) => {
  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    const arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var LogicBucket = process.env.LB
    var WRTCB = process.env.WRTCB
    var commonsharedpath = ('file:///' + path.join(__dirname, './shared/commonsharedv3.js').replace(/\\/g, '/'))
    var commonshared = await GetConfiguration(commonsharedpath, '*')
    var authenticationsharedpath = ('file:///' + path.join(__dirname, './shared/authenticationsharedv3.js').replace(/\\/g, '/'))
    var authenticationshared = await GetConfiguration(authenticationsharedpath, '*')
    var cert = process.env.PublicKey
    var TestPath = process.env.TestPath.toLowerCase()
    var AllowedOrigins = process.env.AllowedOrigins
    // var RestApiId = process.env.RestApiId
    // var StageName = process.envStageName
    const maskedevent = commonshared.masktoken(JSON.parse(JSON.stringify(event)))
    console.log('REQUEST RECEIVED: \n' + JSON.stringify(context) + '\n\n')
    console.log('THE EVENT: \n' + JSON.stringify(maskedevent) + '\n\n')
  }
  else {
    // Dev environment settings
    var directory = path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'httprelay', 'mydev.mjs')
    const mydev = await import('file:///' + directory.replace(/\\/g, '/'))
    var region = mydev.region
    var LogicBucket = mydev.LogicBucket
    var WRTCB = mydev.WRTCB
    var cert = mydev.cert
    var event = mydev.event
    var context = mydev.context
    var commonshared = mydev.commonshared
    var authenticationshared = mydev.authenticationshared
    var TestPath = mydev.TestPath
    var AllowedOrigins = mydev.AllowedOrigins
    // var RestApiId = mydev.RestApiId
    // var StageName = mydev.StageName
  }

  const ddclient = new DynamoDBClient({})
  const docClient = DynamoDBDocumentClient.from(ddclient)
  const s3client = new S3Client({})

  // var apigwurl="https://"+RestApiId+".execute-api."+region+".amazonaws.com/"+StageName+"/public/index.html"
  // const docClient = new aws.DynamoDB.DocumentClient()
  const result = await main(s3client, GetObjectCommand, event, commonshared, authenticationshared, docClient, LogicBucket, WRTCB, AllowedOrigins, cert, TestPath)

  return result
}

async function main (s3client, GetObjectCommand, event, commonshared, authenticationshared, docClient, LogicBucket, WRTCB, AllowedOrigins, cert, TestPath) {
  console.log('main')
  var resultobject = {}
  // Send public assets to unauthenticated users. //||((event.path).toLocaleUpperCase()).match("/favicon.ico$")
  if (event.path.match('/HTTP/S3/' + LogicBucket + '/public/*') || ((event.path).toLocaleUpperCase()).match('/HTTP/S3/LB/PUBLIC/.*')) {
    var response = await S3Process(s3client, GetObjectCommand, event, commonshared, LogicBucket)
    resultobject = {
      status: response.statusCode,
      data: response.body,
      header: response.headers,
      base64: response.isBase64Encoded
    }
  }
  else {
    // Validate received token.
    const tokenobject = commonshared.ValidateToken(jwt, event.headers, cert)
    if (tokenobject.state === true) {
      // TODO s3 authorization here.
      var response = await ProcessValidrequests(s3client, GetObjectCommand, tokenobject, event, LogicBucket, WRTCB, commonshared, authenticationshared, docClient, TestPath)
      resultobject = {
        status: response.statusCode,
        data: response.body,
        header: response.headers,
        base64: response.isBase64Encoded
      }
    }
    else {
      resultobject = redirecttologin(tokenobject, LogicBucket)
    } // not valid token
  } // not public assets,

  var response = commonshared.apigatewayresponse(resultobject, event.headers, AllowedOrigins)
  return response
}

async function ProcessValidrequests (s3client, GetObjectCommand, tokenobject, event, LogicBucket, WRTCB, commonshared, authenticationshared, docClient, TestPath) {
  if (
    ((event.path.match('/HTTP/S3/' + LogicBucket + '.*')) || (event.path.toLocaleUpperCase().match('HTTP/S3/LB/.*'))) &&
        ((event.path.toLocaleUpperCase().match('.*LS$') == null) && (event.path.toLocaleUpperCase().match('.*DIR$') == null))) {
    // Authenticated users access to UI.
    var response = await S3Process(s3client, GetObjectCommand, event, commonshared, LogicBucket)
  }
  else if (((event.path.match('/HTTP/S3/' + WRTCB + '.*')) || (event.path.toLocaleUpperCase().match('HTTP/S3/WRTCB/.*'))) && ((event.path.toLocaleUpperCase().match('.*LS$') == null) && (event.path.toLocaleUpperCase().match('.*DIR$') == null))) {
    // Logverz-webrtcbucket-1mnq140wp5tjb
    var response = await S3Process(s3client, GetObjectCommand, event, commonshared, WRTCB)
  }
  else if (event.path.match('/HTTP/S3/.*LS$' || '/HTTP/S3/.*DIR$')) {
    // TODO:here comes the listing of the buckets and their contents.
    // using commonshared.walkfolders()

  }
  else if (event.path.match('/HTTP/TEST/.*')) {
    // Container ui test access page.
    if (TestPath === 'enabled' || TestPath === 'true') {
      var response = await OWSProcess(event)
    }
    else {
      var response = {
        statusCode: 401,
        headers: {
          'Content-Type': 'text/html'
        },
        body: 'The WebRtC connection testing relay is not enabled. Open lambda \'Logverz-HTTPRelay\' and change environment variable.'
      }
    }
  }
  else {
    // here come all other bucket access
    const requestcheck = await AuthorizeRequest(tokenobject, authenticationshared, docClient, event, LogicBucket, TestPath)
    if (requestcheck.status !== 'Allow' || requestcheck.status === 'Deny') {
      // the request was invalid for some reason, send the reason back to the requester.
      var response = {
        statusCode: 403,
        headers: {
          'Content-Type': 'text/html'
        },
        body: `Unauthorised. Reason: ${JSON.stringify(requestcheck)}`
      }
    }
    else {
      var response = await S3Process(s3client, GetObjectCommand, event, commonshared, '')
    }
  }
  return response
}

async function OWSProcess (event) {
  // Other Web Server such as container
  if (event.path.split('/').slice(4) === '') {
    var requestedfile = '/'
  }
  else {
    var requestedfile = '/' + event.path.split('/').slice(4).join().replace(/,/g, '/')
  }
  const url = 'http://' + event.path.split('/')[3] + requestedfile
  const cookie = event.headers.cookie
  const filecontent = await GetFile(url, cookie)

  if (filecontent.status !== 200) {
    var response = {
      statusCode: filecontent.status,
      headers: {
        'Content-Type': 'text/html'
      },
      body: `${filecontent.message}.`
    }
  }
  else {
    const content = {}
    content.Body = filecontent.data
    _.set(content, '$response.httpResponse.statusCode', filecontent.status)
    content.ContentType = filecontent.headers['content-type']
    var response = await Send(content, requestedfile)
  }
  return response
}

async function GetFile (url, cookie) {
  var config = {
    method: 'get',
    // withCredentials: true,
    headers: {
      cookie
    },
    timeout: 5000,
    url
    // ,proxy: {
    //    host: '127.0.0.1',
    //    port: 8888
    // }
  }

  try {
    var response = await axios(config)
    console.log(response)
  }
  catch (err) {
    var response = {}
    var config = _.omit(config, 'headers')
    const message = `Details: ${err}/\n\nGetting response using+ config:\n+${JSON.stringify(config)}`
    console.error(message)
    // TODO add error to Dynamo DB.
    response.message = message
    response.status = err.Code
  }

  return response
}

async function AuthorizeRequest (tokenobject, authenticationshared, docClient, event, LogicBucket, TestPath) {
  const requesttype = (event.path.split('/')[2]).toLowerCase() // one of S3,Test,Adv

  if (requesttype === 's3') {
    const requestedfile = decodeURIComponent(event.path.split('/').slice(4).join().replace(/,/g, '/'))
    const requestbucket = ((event.path.split('/')[3]).toLowerCase()).replace(/^lb$/, LogicBucket)

    const username = tokenobject.value.user.split(':')[1]
    const usertype = 'User' + tokenobject.value.user.split(':')[0] 
    const data = await authenticationshared.getidentityattributes(docClient, QueryCommand, username, usertype)
    const statements = authenticationshared.getuserstatements(data.Items[0])

    const userrequest = {
      serviceaction: 's3:GetObject',
      resource: `arn:aws:s3:::${requestbucket}/${requestedfile}`
    }
    var decision = authenticationshared.allowdenyaction(_, statements, userrequest)
    // TODO refactor  authenticationshared.getusersstatements and authenticationshared.allowdeny action
    // to use authenticationshared.authorizeS3access
    console.log(decision)
  }
  else if (requesttype === 'Test' && (TestPath !== 'enabled' || TestPath !== 'true')) {
    var decision = true
  }

  return decision
}

async function S3Process (s3client, GetObjectCommand, event, commonshared, ProvidedBucket) {
  // happy path sending the requester the file, if exists.
  if (event.path.match('^/V3.*') === null) {
    // in case it is called by the apigateway autogenerated name the event.path will not contain the stage name (V3), example: HTTP/S3/LB/public/index.html
    var requestedfile = decodeURIComponent(event.path.split('/').slice(4).join().replace(/,/g, '/'))
    if (ProvidedBucket !== '') {
      var requestbucket = ProvidedBucket
    }
    else {
      var requestbucket = ((event.path.split('/')[3]).toLowerCase())
    }
  }
  else if (event.path.match('^/V3.*') !== null) {
    // in case its called by the apiGW custom domain name it needs to contain the /V3 path
    var requestedfile = decodeURIComponent(event.path.split('/').slice(5).join().replace(/,/g, '/'))
    if (ProvidedBucket !== '') {
      var requestbucket = ProvidedBucket
    }
    else {
      var requestbucket = ((event.path.split('/')[4]).toLowerCase())
    }
  }

  var content = await commonshared.S3GET(s3client, GetObjectCommand, requestbucket, requestedfile)
  if (content.Code === 'NoSuchKey') {
    var response = {
      statusCode: 404,
      headers: {
        'Content-Type': 'text/html'
      },
      body: `Details:${content.message}. Please check for typo and or capitalisation of letters.`
    }
  }
  else {
    var response = await Send(content, requestedfile, event.headers)
  }
  return response
}

async function Send (content, requestedfile, headers) {
  const extension = requestedfile.substring(requestedfile.lastIndexOf('.') + 1)
  const type = isbinary(extension)

  if (content.statusCode) {
    // Error path
    var responseCode = content.statusCode
    var contenttype = 'text/html'
  }
  else if (extension === 'ttf' || extension === 'woff' || extension === 'woff2') {
    var contenttype = `font/${extension}`
    //var responseCode = content.$response.httpResponse.statusCode
    var responseCode = content.$metadata.httpStatusCode
  }
  else {
    // Happy path
    var contenttype = content.ContentType
    //var responseCode = content.$response.httpResponse.statusCode
    var responseCode = content.$metadata.httpStatusCode
  }

  if (type) {
    // if its binary
    //var content = content.Body
    var content = Buffer.from(await content.Body.transformToByteArray())
    var response = {
      statusCode: responseCode,
      headers: {
        'Content-Type': contenttype
        //, "content-disposition": "attachment; filename=index.png" // key of success
      },
      body: content.toString('base64'),
      isBase64Encoded: true
    }
  }
  else {
    //var content = content.Body.toString('utf-8')
    var content = Buffer.from(await content.Body.transformToByteArray()).toString('utf-8')
    var response = {
      statusCode: responseCode,
      headers: {
        // "x-custom-header" : "my custom header value",
        'Content-Type': contenttype
      },
      body: content
    }
  }

  return response
}

function isbinary (extension) {
  let decision
  if ((extension === 'png') || (extension === 'jpeg') || (extension === 'pdf') || (extension === 'ttf') || (extension === 'svg') || (extension === 'woff') || (extension === 'woff2') || (extension === 'x-icon')) {
    decision = true
  }
  else {
    decision = false
  }
  return decision
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

function redirecttologin (tokenobject, LogicBucket) {
  const json = {
    status: 401,
    header: {
      'Content-Type': 'text/html', // "text/html"
      'Set-Cookie': 'LogverzAuthToken=' + null + ';Secure; HttpOnly;',
      'Access-Control-Allow-Origin': '*'
    },
    data: `
        <html>
            <head>
              <meta http-equiv="refresh" content="5;url='/V3/HTTP/S3/${LogicBucket}/public/index.html'"/>
            </head>
            <style>
            body {background: #F7F7F7 url("/V3/HTTP/S3/${LogicBucket}/public/images/background.png") no-repeat center;}
            </style>
            <body>
                <h2>ERROR:</h2> <br> <i>${tokenobject.value.message}</i>.
            </body>
        </html>
        `
  }
  return json
}
