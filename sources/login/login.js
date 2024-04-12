/* eslint-disable camelcase */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
const axios = require('axios')
var jwt = require('jsonwebtoken')
var jwkToPem = require('jwk-to-pem')
var AWS = require('aws-sdk')
const fs = require('fs')
const path = require('path')
const {
  promisify
} = require('util')
const DeleteFile = promisify(fs.unlink)
var _ = require('lodash')
const {
  // parse,
  stringify
} = require('flatted')

var db = require('./db').db
var MaximumCacheTime=process.env.MaximumCacheTime

if (db.collections.length === 0) {
  
  if (MaximumCacheTime === undefined){
    MaximumCacheTime =1
  }

  var identities = db.addCollection('Logverz-Identities', {
    ttl: MaximumCacheTime * 60 * 1000
  })
}

var params = {}
module.exports.handler = async function (event, context) {
  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    var arnList = (context.invokedFunctionArn).split(':')
    params.region = arnList[3]
    params.functionName = arnList[6]
    var commonshared = require('./shared/commonshared')
    var authenticationshared = require('./shared/authenticationshared')
    params.configfilelocation = '/tmp/config.json'
    params.UserPoolId = process.env.UserPoolId
    params.UserPoolPubKey = process.env.UserPoolPubKey
    params.APIGatewayURL = event.headers.Host
    params.logicbucket = process.env.LogicBucket
    params.client_id = process.env.UserPoolClient
    params.UserPoolDomain = process.env.UserPoolDomain
    params.ScaleFunction = (process.env.ScaleFunction).split(':').slice(-1)[0]
    params.AllowedOrigins = process.env.AllowedOrigins
    params.AllowedAccounts = process.env.AllowedAccounts
  } else {
    // Dev environment settings
    const mydev = require(path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'login', 'mydev.js'))
    var commonshared = mydev.commonshared
    var authenticationshared = mydev.authenticationshared
    var context = mydev.context
    var event = mydev.event
    params.region = mydev.params.region
    params.functionName = mydev.params.functionName
    params.configfilelocation = mydev.params.configfilelocation
    params.UserPoolId = mydev.params.UserPoolId
    params.UserPoolPubKey = mydev.params.UserPoolPubKey
    params.tokensdata = mydev.params.tokensdata
    params.APIGatewayURL = mydev.params.APIGatewayURL
    params.logicbucket = mydev.params.logicbucket
    params.client_id = mydev.params.client_id
    params.UserPoolDomain = mydev.params.UserPoolDomain
    params.ScaleFunction = mydev.params.ScaleFunction
    params.AllowedAccounts = mydev.params.AllowedAccounts
    params.AllowedOrigins = mydev.params.AllowedOrigins
  }

  var maskedevent = maskcredentials(JSON.parse(JSON.stringify(event))) // TODO move it to commonshared.json
  console.log('REQUEST RECEIVED: \n' + JSON.stringify(context) + '\n\n')
  console.log('THE EVENT: \n' + JSON.stringify(maskedevent) + '\n\n')
  // console.log("Scalefunction:\n" + params.ScaleFunction);
  params.accountnumber = commonshared.eventpropertylookup(event, 'account', 'queryStringParameters')
  params.accesskey = commonshared.eventpropertylookup(event, 'accesskey', 'queryStringParameters')
  params.secretkey = decodeURIComponent(commonshared.eventpropertylookup(event, 'secretkey', 'queryStringParameters'))
  params.password = commonshared.eventpropertylookup(event, 'password', 'queryStringParameters')
  params.username = commonshared.eventpropertylookup(event, 'user', 'queryStringParameters')
  params.stagename = determinestagename(JSON.parse(JSON.stringify(event)))

  AWS.config.update({
    region: params.region
  })

  var SSM = new AWS.SSM()
  var lambda = new AWS.Lambda()
  var cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider()
  const dynamodb = new AWS.DynamoDB()
  var docClient = new AWS.DynamoDB.DocumentClient()

  console.log('start')
  var result = await main(event, SSM, lambda, cognitoidentityserviceprovider, dynamodb, docClient, commonshared, authenticationshared, params)
  console.log('end')

  return result
  // JSON object sent to API GW to relay it to requestor
}

async function main (event, SSM, lambda, cognitoidentityserviceprovider, dynamodb, docClient, commonshared, authenticationshared, params) {
  if ((params.accountnumber !== undefined) && (!params.AllowedAccounts.includes(params.accountnumber))) {
    var message = `Provided accountnumber ${params.accountnumber} is not on the AllowedAccounts list. Access denied.`
    params = {
      status: 401,
      data: message,
      header: {}
    }
    var response = commonshared.apigatewayresponse(params, event.headers, params.AllowedOrigins)
    return response
  }

  var details = {
    source: 'login.js:main',
    message: ''
  }
  var [privateKey, passphrase] = await Promise.all([
    commonshared.getssmparameter(SSM, {
      Name: '/Logverz/Logic/PrivateKey',
      WithDecryption: true
    }, dynamodb, details),
    commonshared.getssmparameter(SSM, {
      Name: '/Logverz/Logic/Passphrase',
      WithDecryption: true
    }, dynamodb, details)
  ])

  if ((event.resource.match('/Auth') !== null) && (event.httpMethod === 'POST') && event.queryStringParameters.apicall !== undefined) {
    // Logoff owerwriting existing token plus redirect
    var message = JSON.stringify({
      Redirect: `https://${params.APIGatewayURL + params.stagename}/HTTP/S3/LB/public/index.html`
    })
    var payload = {
      status: 200,
      data: message,
      header: {
        'Set-Cookie': 'LogverzAuthToken=' + null + ';Secure;',
        'Content-Type': 'application/json'
      }
    } /// text/html //;TODO add back  -> HttpOnly;  <- once build is done. //// ??'Access-Control-Allow-Origin' : '*'
    var response = commonshared.apigatewayresponse(payload, event.headers, params.AllowedOrigins)

    return response
  } else if ((event.resource.match('/Auth') !== null) && (event.httpMethod === 'POST') && (event.queryStringParameters.user !== undefined)) {
    // function is invoked via API GW for AWS IAM USER AUTH
    var response = await AwsIamUserAuth(params.accountnumber, params.username, params.password, event.queryStringParameters.mfavalue, event.queryStringParameters.mfaType)
    var message = await createIAMAuthresponse(commonshared, authenticationshared, dynamodb, docClient, response.data.state, 'AWS', params.username, privateKey.Parameter.Value, passphrase.Parameter.Value, event.headers, params.AllowedOrigins)
  } else if ((event.resource.match('/Auth') !== null) && (event.httpMethod === 'POST') && (event.queryStringParameters.accesskey !== undefined)) {
    // function is invoked via API GW for AWS IAM KEY AUTH
    if (event.queryStringParameters.serialnumber !== undefined) {
      var configcontent = {
        accessKeyId: params.accesskey,
        secretAccessKey: params.secretkey,
        region: params.region,
        serialnumber: event.queryStringParameters.serialnumber,
        tokencode: event.queryStringParameters.tokencode
      }
    } else {
      var configcontent = {
        accessKeyId: params.accesskey,
        secretAccessKey: params.secretkey,
        region: params.region
      }
    }

    fs.writeFileSync(params.configfilelocation, JSON.stringify(configcontent))
    var response = await AwsIamKeyAuth(params, commonshared, dynamodb)
    var message = await createIAMAuthresponse(commonshared, authenticationshared, dynamodb, docClient, response.state, 'AWS', response.username, privateKey.Parameter.Value, passphrase.Parameter.Value, event.headers, params.AllowedOrigins)
  } else if (event.resource.match('/Auth') !== null && event.httpMethod === 'GET') {
    // function is invoked by cognito external identity provider (Google,Okta etc), Authorization code grant flow.
    // more info: https://aws.amazon.com/blogs/mobile/understanding-amazon-cognito-user-pool-oauth-2-0-grants/

    var result = await CognitoAuth(event, jwt, lambda, cognitoidentityserviceprovider, SSM, commonshared, dynamodb, params)
    console.log('auth result: ' + JSON.stringify(result))

    if (result) {
      var domain = result.identities[0].providerName
      var username = result.email.split('@')[0]
      var requestoridentity = {
        Name: username, // first part of the e-mail
        Type: 'User' + domain
      }

      var authorization = await ValidateUserAccess(commonshared, authenticationshared, docClient, requestoridentity, params)
      if (authorization === true) {
        // Authentication success, Authorizatin success, user exits in database
        var token = createtoken(jwt, domain, username, privateKey.Parameter.Value, passphrase.Parameter.Value)
        var message = cognitosuccess(token, params, username, result)
      } else {
        // Authentication success, Authorization failure, user does not exist in database
        var message = cognitounuthorized
      }
    } else {
      // Authentication failure, user provided invalid credentials
      var message = errorresponse
    }
  } else {
    // catch all for request that do not match specified conditions
    message = errorresponse
    console.log('\nSomekind of error or other auth method\n')
  }

  var lambdaresult = await InvokeScale(lambda, params)
  console.log('Invoke scale result ' + JSON.stringify(lambdaresult.StatusCode))

  return message
} // main

async function ValidateUserAccess (commonshared, authenticationshared, docClient, requestoridentity, params) {
  // get the identity once and use in the checks
  var userattributes = await authenticationshared.getidentityattributes(commonshared, docClient, requestoridentity.Name, requestoridentity.Type) // "admin"

  if (userattributes.Items.length !== 0) {
    // with cognito users the user is valid but not authorized to login (does not have permissions associated in Admin module).
    userattributes = userattributes.Items[0]
    identities.insert(userattributes)

    var [isadmin, ispoweruser, isuser] = await Promise.all([
      authenticationshared.admincheck(_, commonshared, docClient, identities, requestoridentity),
      authenticationshared.powerusercheck(_, commonshared, docClient, identities, requestoridentity, params.region),
      authenticationshared.usercheck(_, commonshared, docClient, identities, requestoridentity, params.region)
    ])
  }

  if (isadmin || ispoweruser || isuser) {
    var isallallowed = true
  } else {
    isallallowed = false
  }

  return isallallowed
}

async function CognitoAuth (event, jwt, lambda, cognitoidentityserviceprovider, SSM, commonshared, dynamodb, params) {
  var url = event.requestContext.domainName
  var redirect_uri = 'https://' + url + event.requestContext.path
  params.UserPoolDomain = 'https://' + params.UserPoolDomain + '.auth.' + params.region + '.amazoncognito.com/oauth2/token'
  var type = 'authorization_code'

  if (params.UserPoolId === params.UserPoolPubKey) {
    // the JSON webkey has not been retrieved yet, downloading now
    // https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html
    params.UserPoolPubKey = await SaveUserPoolPubKey(lambda, params)
  }

  var details = {
    source: 'login.js:CognitoAuth',
    message: ''
  }
  try {
    params.client_secret = await commonshared.getssmparameter(SSM, {
      Name: '/Logverz/Logic/CognitoSecret',
      WithDecryption: true
    }, dynamodb, details)
  } catch (err) {
    console.error(err)
  }

  if (typeof (params.client_secret.Parameter) === 'undefined') {
    params.client_secret = await SaveAppclientSecret(cognitoidentityserviceprovider, SSM, params)
  } else {
    params.client_secret = params.client_secret.Parameter.Value
  }

  // Exchange Authroization code with Tokens.
  var code = event.queryStringParameters.code // var code="28b0af7a-a3a1-4934-946c-01fb52bc3f08";
  var FormData = createrequestbody(type, 'accountnumber', 'username', 'password', 'mfavalue', 'mfaType', code, params.client_id, redirect_uri)
  var tokensdata = await GetUsersToken(FormData, params)

  if (tokensdata !== null) {
    var headerstring = tokensdata.id_token.split('.')[0]
    var headerobject = JSON.parse(base64decode(headerstring))
    var keys = JSON.parse(params.UserPoolPubKey).keys
    var jwk = _.find(keys, ['kid', headerobject.kid])
    var pem = jwkToPem(jwk)
    var result = jwt.verify(tokensdata.id_token, pem, {
      algorithms: ['RS256']
    })
  } else {
    // cognito token invalid
    var result = false
  }

  return result
}

async function GetUsersToken (FormData, params) {
  axios.defaults.headers.post['Content-Type'] = 'application/x-www-form-urlencoded'

  var config = {
    method: 'post',
    url: params.UserPoolDomain,
    data: FormData,
    auth: {
      username: params.client_id,
      password: params.client_secret
    }
  }
  try {
    var tokens = await axios(config)
    // console.log(tokens.data)
    var result = tokens.data
  } catch (err) {
    console.error('Error exchanging code to token\n' + 'Config:\n' + JSON.stringify(config) + '\n Please check that SSM /Logverz/Logic/CognitoSecret value matches Logverz-Logic user pool -> App Integration -> App clients and analytics -> appclient client name-> Show client secret toggle')
    result = null
  }
  return result
}

async function SaveAppclientSecret (cognitoidentityserviceprovider, SSM, params) {
  // Function retrieves Cognito Appclientsecret and save it to ssm

  var client_secret
  var upparams = {
    ClientId: params.client_id,
    UserPoolId: params.UserPoolId
  }

  try {
    var result = await cognitoidentityserviceprovider.describeUserPoolClient(upparams).promise()
    client_secret = result.UserPoolClient.ClientSecret
  } catch (err) {
    console.log('Lambda function Logverz-Authentiation has ' + params.UserPoolId + ' a resource policy associated to it, where:' + err)
  }

  var ssmparams = {
    Name: '/Logverz/Logic/CognitoSecret',
    Value: client_secret,
    Description: 'Cognito App client secret',
    Tier: 'Standard',
    Type: 'SecureString'
  }
  var promisedresult = new Promise((resolve, reject) => {
    SSM.putParameter(ssmparams, function (err, data) {
      if (err) {
        console.log(err, err.stack)
        reject(err)
        // an error occurred
      } else resolve(data) // console.log(data); // successful response
    })
  })
  await promisedresult

  return client_secret
}

async function SaveUserPoolPubKey (lambda, params) {
  var jwksurl = `https://cognito-idp.${params.region}.amazonaws.com/${params.UserPoolId}/.well-known/jwks.json`
  // params.UserPoolId.split('_')[0]

  var jwksvalue = await axios({
    method: 'get',
    url: jwksurl
  })
  var functionname = params.functionName
  var UserPoolPubKey = JSON.stringify(jwksvalue.data)
  var data = {
    AttributeName: 'UserPoolPubKey',
    AttributeValue: UserPoolPubKey
  }

  await updatelambdaenvironmentvariables(lambda, functionname, data)
  return UserPoolPubKey
}

async function InvokeScale (lambda, params) {
  // Client context is empty for async invocations as pare https://github.com/aws/aws-sdk-js/issues/1388#issuecomment-403466618
  // var invocationparameters=`{"logonevent":"true","username":"${params.username}","Domain":"${params.domain}"}`;
  // var clientcontext = Buffer.from(invocationparameters).toString('base64') ;

  // TODO get idletime ssm key and only invoke scale if the StartAtUserLogin parameter is set to true in any of the components

  var lambdaparams = {
    // ClientContext: clientcontext,//.toString('base64'),
    FunctionName: params.ScaleFunction,
    InvocationType: 'Event', // "RequestResponse" || "Event" // bydefault Requestreponse times out after 120 sec, hence the timout 900 000 value
    LogType: 'None'
  }

  // return await
  var lambdapromise = new Promise((resolve, reject) => {
    lambda.invoke(lambdaparams, function (err, data) {
      if (err) {
        console.log(err, err.stack)
        reject(err)
        // an error occurred
      } else resolve(data) // console.log(data);// successful response
    })
  })
  var lambdaresult = await lambdapromise
  return lambdaresult
}

async function AwsIamUserAuth (accountnumber, username, password, mfavalue, mfaType) {
  var type = 'iam-user-authentication'
  var FormData = createrequestbody(type, accountnumber, username, password)
  var response = await authrequest(FormData)

  if (response.data.properties.result === 'MFA') {
    // var response0=response
    // console.log("The standard auth response:\n")
    // console.log(response0);

    var type = 'iam-user-authentication-SWMFA'
    var FormData = createrequestbody(type, accountnumber, username, password, mfavalue, mfaType)
    var response = await authrequest(FormData)

    console.log(stringify(response))
  }
  return response
}

async function authrequest (FormData) {
  axios.defaults.headers.common.Referer = 'https://us-east-1.signin.aws.amazon.com/'
  axios.defaults.headers.post['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
  var response = await axios({
    method: 'post',
    url: 'https://us-east-1.signin.aws.amazon.com/authenticate',
    data: FormData
    // ,proxy: {
    //   host: '127.0.0.1',
    //   port: 8888
    // }
  })
  return response
}

function createrequestbody (type, accountnumber, username, password, mfavalue, mfaType, code, client_id, redirect_uri) {
  if (type === 'iam-user-authentication-SWMFA') {
    var formparameters = ['action=iam-user-authentication', `account=${encodeURIComponent(accountnumber)}`, `username=${encodeURIComponent(username)}`, `password=${encodeURIComponent(password)}`, `client_id=${encodeURIComponent('arn:aws:iam::015428540659:user/homepage')}`, `redirect_uri=${encodeURIComponent('https://console.aws.amazon.com/console/home?nc2=h_ct&src=header-signin&state=hashArgs#&isauthcode=true')}`, `mfa_otp_1=${encodeURIComponent(mfavalue)}`, `mfaType=${encodeURIComponent(mfaType)}`]
  } else if (type === 'iam-user-authentication') {
    var formparameters = ['action=iam-user-authentication', `account=${encodeURIComponent(accountnumber)}`, `username=${encodeURIComponent(username)}`, `password=${encodeURIComponent(password)}`, `client_id=${encodeURIComponent('arn:aws:iam::015428540659:user/homepage')}`, `redirect_uri=${encodeURIComponent('https://console.aws.amazon.com/console/home?nc2=h_ct&src=header-signin&state=hashArgs#&isauthcode=true')}`]
  } else if (type === 'authorization_code') {
    var formparameters = ['grant_type=authorization_code', `client_id=${client_id}`, `code=${code}`, `redirect_uri=${encodeURIComponent(redirect_uri)}`]
  }

  var i; var body = ''
  for (i = 0; i < formparameters.length; i++) {
    body += formparameters[i] + '&'
  }
  // To remove trailing "&"
  var FormData = body.substring(0, body.length - 1)
  return FormData
}

function createtoken (jwt, domain, username, privateKey, passphrase) {
  var token = jwt.sign({
    user: (domain + ':' + username)
  }, {
    key: privateKey,
    passphrase
  }, {
    algorithm: 'RS512',
    expiresIn: '8h'
  })
  return token
}

async function createIAMAuthresponse (commonshared, authenticationshared, dynamodb, docClient, state, domain, username, privateKey, passphrase, headers, AllowedOrigins) {
  console.log('Authentication status: ' + state + ', User: ' + username)

  if (state === 'SUCCESS') {
    var requestoridentity = {
      Name: username,
      Type: 'User' + domain // UserAWS
    }

    var authorization = await ValidateUserAccess(commonshared, authenticationshared, docClient, requestoridentity, params)
    console.log('Autorization status: ' + authorization)

    if (authorization === true) {
      var loglevel = 'Info'
      var message = `{"user" : "${username}","status":"Authenticated"}`
      var token = createtoken(jwt, domain, username, privateKey, passphrase)
      params = {
        status: 200,
        data: message,
        header: {
          'Set-Cookie': 'LogverzAuthToken=' + token + ';Secure;'
        }
      } // ;TODO add back  -> HttpOnly;  <- once build is done. //// ??'Access-Control-Allow-Origin' : '*'
      var response = commonshared.apigatewayresponse(params, headers, AllowedOrigins)
    } else {
      var loglevel = 'Error'
      var message = `{"user" : "${username}","status":"Authorization  Failed"}`
      params = {
        status: 403,
        data: message,
        header: {}
      }
      var response = commonshared.apigatewayresponse(params, headers, AllowedOrigins)
    }
  } else {
    var loglevel = 'Error'
    var message = `{"user" : "${username}","status":"Authentication Failed"}`
    params = {
      status: 401,
      data: message,
      header: {}
    }

    var response = commonshared.apigatewayresponse(params, headers, AllowedOrigins)
  }
  var details = {
    source: 'login.js:main',
    message
  }
  await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'LoginIAM', loglevel, 'User', details, 'API')
  return response
}

async function AwsIamKeyAuth (params, commonshared, dynamodb) {
  var configfilelocation = params.configfilelocation

  var configjson = fs.readFileSync(configfilelocation, 'utf8')
  var configobject = JSON.parse(configjson)

  AWS.config.loadFromPath(configfilelocation)
  var sts = new AWS.STS()

  // eslint-disable-next-line no-prototype-builtins
  if (configobject.hasOwnProperty('serialnumber')) { // configobject.serialnumber.length!==0
    var result = AwsIamKeyMFA(sts, commonshared, dynamodb, configobject, params)
  } else {
    var result = await AwsIamKeynoneMFA(sts, commonshared, dynamodb, configobject, params)
  }

  await DeleteFile(configfilelocation)

  AWS.config = new AWS.Config()
  // reverting to the default aws lambda role.
  AWS.config.accessKeyId = process.env.AWS_ACCESS_KEY_ID
  AWS.config.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  AWS.config.region = process.env.AWS_DEFAULT_REGION
  return result
}

async function AwsIamKeynoneMFA (sts, commonshared, dynamodb, configobject, params) {
  var identityerror = ''
  try {
    var paramsidentity = {}
    var promisedidentity = new Promise((resolve, reject) => {
      sts.getCallerIdentity(paramsidentity, function (err, data) {
        if (err) {
          console.log(err, err.stack)
          reject(err)
          // an error occurred
        } else resolve(data) // console.log(data);           // successful response
      })
    })
    var identity = await promisedidentity
  } catch (error) {
    AWS.config = new AWS.Config()
    // reverting to the default aws lambda role.
    AWS.config.accessKeyId = process.env.AWS_ACCESS_KEY_ID
    AWS.config.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
    AWS.config.region = process.env.AWS_DEFAULT_REGION
    console.error(error)
    identityerror = error
    var details = {
      source: 'login.js:AwsIamKeyAuth',
      message: JSON.stringify(error)
    }
    await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'LoginIAM', 'Error', 'User', details, 'API')
  }

  try {
    if (params.AllowedAccounts.includes(identity.Account)) {
      var result = {
        username: identity.Arn.split('/')[1],
        state: 'SUCCESS',
        account: identity.Account
      }
    } else {
      var e = new Error('accountnumber ' + identity.Account + ' is not on the allowedlist!')
      throw e
    }
  } catch (error) {
    var message = `IAM key based authenitcation failed for access key: ${configobject.accessKeyId} \n` + identityerror + '\n' + error
    console.error(message)
    var result = {
      username: message,
      state: 'FAIL'
    }
  }

  return result
}

async function AwsIamKeyMFA (sts, commonshared, dynamodb, configobject, params) {
  var identityerror = ''

  try {
    var paramsidentity = {
      DurationSeconds: 900,
      SerialNumber: configobject.serialnumber,
      TokenCode: configobject.tokencode
    }
    var promisedidentitymfa = new Promise((resolve, reject) => {
      sts.getSessionToken(paramsidentity, function (err, data) {
        if (err) {
          reject(err)
          // console.log(err, err.stack);  an error occurred
        } else {
          resolve(data)
        } // console.log(data);           // successful response
      })
    })
    var identitymfa = await promisedidentitymfa
  } catch (error) {
    AWS.config = new AWS.Config()
    // reverting to the default aws lambda role.
    AWS.config.accessKeyId = process.env.AWS_ACCESS_KEY_ID
    AWS.config.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
    AWS.config.region = process.env.AWS_DEFAULT_REGION
    console.error(error.message)
    identityerror = error
    var details = {
      source: 'login.js:AwsIamKeyAuth',
      message: JSON.stringify(error)
    }
    await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'LoginIAM', 'Error', 'User', details, 'API')
  }

  if (identityerror === '') {
    try {
      AWS.config = new AWS.Config()
      // setting temporary credential
      AWS.config.accessKeyId = identitymfa.Credentials.AccessKeyId
      AWS.config.secretAccessKey = identitymfa.Credentials.secretAccessKey
      AWS.config.region = identitymfa.Credentials.region
      AWS.config.sessionToken = identitymfa.Credentials.SessionToken

      // do sts get caller identity to determine the users name and accountnumber
      var promisedidentity = new Promise((resolve, reject) => {
        sts.getCallerIdentity({}, function (err, data) {
          if (err) {
            console.log(err, err.stack)
            reject(err)
            // an error occurred
          } else resolve(data) // console.log(data);           // successful response
        })
      })
      var identity = await promisedidentity

      if (params.AllowedAccounts.includes(identity.Account)) {
        var result = {
          username: identity.Arn.split('/')[1],
          state: 'SUCCESS',
          account: identity.Account
        }
      } else {
        var e = new Error('accountnumber ' + identity.Account + ' is not on the allowedlist!')
        throw e
      }
    } catch (error) {
      var message = `IAM key based authenitcation failed for access key: ${configobject.accessKeyId} \n` + identityerror + '\n' + error
      console.error(message)
      // reverting to the default aws lambda role.
      AWS.config.accessKeyId = process.env.AWS_ACCESS_KEY_ID
      AWS.config.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
      AWS.config.region = process.env.AWS_DEFAULT_REGION
      console.error(error)
      identityerror = error
      var result = {
        username: message,
        state: 'FAIL'
      }
    }
  } else {
    var message = `IAM key based authenitcation failed,details: ${identityerror.message} `
    var result = {
      username: message,
      state: 'FAIL'
    }
  }

  return result
}

function base64decode (input) {
  var buff = Buffer.from(input, 'base64')
  var text = buff.toString('ascii')
  return text
}

function maskcredentials (mevent) {
  if (mevent.queryStringParameters.password !== undefined) {
    mevent.queryStringParameters.password = '****'
    mevent.multiValueQueryStringParameters.password[0] = '****'
  } else if (mevent.queryStringParameters.secretkey !== undefined) {
    mevent.queryStringParameters.secretkey = '****'
    mevent.multiValueQueryStringParameters.secretkey[0] = '****'
  }

  return mevent
}

function determinestagename (apigwevent) {
  // stagename is empty if used with custom domain name otherwise it needs to be populated
  // apigwevent.
  var result
  if ((apigwevent.headers.referer !== undefined) && apigwevent.headers.referer.match('.amazonaws.com') && apigwevent.headers.referer.match('execute-api')) {
    // regular api gw provided domain name is in use need stage name
    result = '/' + apigwevent.requestContext.stage
  } else {
    // custom domain name, no need for stagename
    result = ''
  }

  return result
}

function cognitosuccess (token, params, username, result) {
  var json = {
    statusCode: 302,
    headers: {
      'Content-Type': 'text/html', // "text/html"
      'Set-Cookie': 'LogverzAuthToken=' + token + ';Secure; HttpOnly;',
      'Access-Control-Allow-Origin': '*'
    },
    body: `
  <html>
      <head>
        <meta http-equiv="refresh" content="3;url='${params.stagename}/HTTP/S3/${params.logicbucket}/ui/index.html?${username}'"/>
      </head>
      <style>
      body {background: #F7F7F7 url("${params.stagename}/HTTP/S3/${params.logicbucket}/public/images/background.png") no-repeat center;}
      </style>
      <body>
          <br><br>
          <h1>Success! You will be redirected to the main page in 3 seconds.</h1> <br>
          <h5>identity:${JSON.stringify(result)}</h5>
      </body>
  </html>
  `
  }
  return json
}

async function updatelambdaenvironmentvariables (lambda, functionname, data){
 
  var configparams = {
    FunctionName: functionname
  }

  var configpromise = new Promise((resolve, reject) => {
    lambda.getFunctionConfiguration(configparams, function (err, data) {
      if (err) reject(err) // console.log(err, err.stack); // an error occurred
      else resolve(data) // console.log(data);           // successful response
    })
  })
  var lambdaconfig = await configpromise
  var environmentvariables = lambdaconfig.Environment.Variables
  environmentvariables[data.AttributeName] = data.AttributeValue

  var updateparams = {
    FunctionName: functionname,
    Environment: {
      Variables: environmentvariables
    }
  }
  var updatepromise = new Promise((resolve, reject) => {
    lambda.updateFunctionConfiguration(updateparams, function (err, data) {
      if (err) reject(err) // console.log(err, err.stack); // an error occurred
      else resolve(data) // console.log(data);           // successful response
    })
  })
  var updateresult = await updatepromise
  console.log(updateresult)
}

var errorresponse = {
  statusCode: 302,
  headers: {
    'Content-Type': 'text/html'
  },
  body: `
  <html>
      <head>
        <meta http-equiv="refresh" content="8;url='${params.stagename}/HTTP/S3/public/${params.logicbucket}/index.html'"/>
      </head>
      <style>
            body {background: #F7F7F7 url("${params.stagename}/HTTP/S3/${params.logicbucket}/public/images/background.png") no-repeat center;}
      </style>
      <body>
          <h1>ERROR your token is invalid or internal error.</h1>. <br>More details are available in in Logverz-Login cloudwatch logs and Logverz-Invocations DynamoDB table.
          <br>You will be redirected to the login page automatically in 8 seconds
      </body>
  </html>
  `
}

var cognitounuthorized = {
  statusCode: 401,
  headers: {
    'Content-Type': 'text/html',
    'Set-Cookie': 'LogverzAuthToken=' + null + ';Secure; HttpOnly;',
    'Access-Control-Allow-Origin': '*'
  },
  body: `
  <html>
      <head>
        <meta http-equiv="refresh" content="8;url='${params.stagename}/HTTP/S3/${params.logicbucket}/public/index.html'"/>
      </head>
      <style>
      body {background: #F7F7F7 url("${params.stagename}/HTTP/S3/${params.logicbucket}/public/images/background.png") no-repeat center;}
      </style>
      <body>
          <h1>ERROR administrator has not yet enabled your account.</h1>. <br>Please contact the administrator for access.
      </body>
  </html>
  `
}
