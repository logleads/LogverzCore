/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */


import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
import _ from 'lodash';
import jwt from 'jsonwebtoken';
import loki from 'lokijs';

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

var MaximumCacheTime=process.env.MaximumCacheTime
console.log('start')
if (typeof db === 'undefined') {
  // the variable is defined
  var db = new loki('db.json', {
    autoupdate: true
});
}

if (db.collections.length === 0) {

  if (MaximumCacheTime === undefined){
    MaximumCacheTime =1
  }

  var identity = db.addCollection('Logverz-Identities', {
    ttl: MaximumCacheTime * 60 * 1000
  })

  var queries = db.addCollection('Logverz-Queries', {
    ttl: 20 * 60 * 1000
  })
}

export const handler = async (event, context) => {
  
  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    var arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var commonsharedpath=('file:///'+path.join(__dirname, './shared/commonsharedv3.js').replace(/\\/g, "/"))
    var commonshared=await GetConfiguration(commonsharedpath,'*')
    var authenticationsharedpath=('file:///'+path.join(__dirname, './shared/authenticationsharedv3.js').replace(/\\/g, "/"))
    var authenticationshared=await GetConfiguration(authenticationsharedpath,'*')
    var cert = process.env.PublicKey
    var AllowedOrigins = process.env.AllowedOrigins
    var maskedevent = commonshared.masktoken(JSON.parse(JSON.stringify(event)))
    console.log('REQUEST RECEIVED: \n' + JSON.stringify(context) + '\n\n')
    console.log('THE EVENT: \n' + JSON.stringify(maskedevent) + '\n\n')
  }
  else {
    // Dev environment settings
    var directory = path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'nosql', 'mydev.mjs')
    const mydev = await import('file:///' + directory.replace(/\\/g, '/'))
    var region = mydev.region
    var commonshared = mydev.commonshared
    var authenticationshared = mydev.authenticationshared
    var cert = mydev.cert
    var event = mydev.event
    var AllowedOrigins = mydev.AllowedOrigins
  }

  const ddclient = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(ddclient);

  var tokenobject = commonshared.ValidateToken(jwt, event.headers, cert)
  var reply = {}

  if (tokenobject.state === true) {
    var username = tokenobject.value.user.split(':')[1]
    var usertype = 'User' + tokenobject.value.user.split(':')[0]
    var requestoridentity = {
      Type: usertype,
      Name: username
    }
    var userattributes = identity.chain().find(requestoridentity).collection.data[0]

    if (userattributes === undefined) {
      var userattributes = await authenticationshared.getidentityattributes(docClient, QueryCommand, username, usertype)
      userattributes = userattributes.Items[0]
      identity.insert(userattributes)
    }

    var Operation = event.queryStringParameters.Operation
    var Resource = event.queryStringParameters.Resource

    if ((Operation === 'dynamodb:DeleteItem' || Operation === 'dynamodb:PutItem') && (Resource.match('Logverz-Queries') || Resource.match('Logverz-Preferences'))) {
      // doing Resource based check here.Resource allows specific User specific actions update/delete if they are owners of particular item.
      var Parameters = JSON.parse(commonshared.getquerystringparameter(event.queryStringParameters.Parameters))
      var clientrequest = getrequestattributes(Parameters) // {};
      clientrequest.Operation = Operation
      var Payload = _.find(Parameters, 'Payload').Payload
      if (Payload !== null) {
        clientrequest.Payload = Payload
      }

      var authorization = await authenticationshared.resourceaccessauthorization(_, docClient, QueryCommand, identity, queries, clientrequest, requestoridentity, region)
    }
    else { // all other api call user based check
      // Performing request and token user name match if the two does not match than NASTY thing is happening.....
      var validate = validateprovidedusername(commonshared, requestoridentity, event)

      if (validate.status !== 'Allow') {
        var authorization = validate
      }
      else {
        var action = {
          Resource,
          Operation
        }
        var authorization = authenticationshared.authorize(_, commonshared, action, userattributes)
      }
    }

    if (authorization.status === 'Allow') {
      var data = await issuerequest(commonshared, authenticationshared, docClient, event.queryStringParameters, userattributes, region)
      reply = {
        status: 200,
        data: JSON.stringify(data.Items),
        header: {}
      }
      // console.log(reply)
    }
    else {
      // request not authorized
      reply = {
        status: 400,
        data: JSON.stringify(authorization),
        header: {}
      }
      console.log(JSON.stringify(authorization))
    }
  }
  else {
    // invalid token
    reply = {
      status: 400,
      data: tokenobject.value.message,
      header: {}
    }
    // console.log(tokenobject.value);
  }

  var result = commonshared.apigatewayresponse(reply, event.headers, AllowedOrigins)
  // console.log(result)
  return result
}

async function issuerequest (commonshared, authenticationshared, docClient, queryStringParameters, userattributes, region) {
  var Parameters = JSON.parse(commonshared.getquerystringparameter(queryStringParameters.Parameters))
  var Resource = commonshared.getquerystringparameter(queryStringParameters.Resource) // "Logverz-Identities"
  var Operation = commonshared.getquerystringparameter(queryStringParameters.Operation)
  var TableName = Resource.split('/')[1]

  switch (Operation) {
    case (Operation.match(/dynamodb:BatchGetItem|dynamodb:GetItem/) || {}).input:
      // code block
      break

    case (Operation.match(/dynamodb:ListTables/) || {}).input:
      // code block
      break

    case (Operation.match(/dynamodb:DeleteItem/) || {}).input:

      if (TableName === 'Logverz-Identities') {
        // determines identity to be removed from the request parameters.
        var identity = getidentityparams(Parameters)
        var params = {
          TableName,
          Key: {
            Name: identity.Name,
            Type: identity.Type
          }
        }
      }
      else if (TableName === 'Logverz-Queries') {
        var params = {
          TableName,
          Key: {}
        }
        params.Key[Parameters[0].AttributeName] = Parameters[0].AttributeValue
        params.Key[Parameters[1].AttributeName] = Parameters[1].AttributeValue
      }
      else {
        console.log('TODO: Generic DynamoDB delete.')
      }
      // delete identity      
      const delcommand = new DeleteCommand(params)
      var data = await docClient.send(delcommand)
      break

    case (Operation.match(/dynamodb:PutItem/) || {}).input:

      if (TableName === 'Logverz-Identities') {
        console.log('updating identities')
        var data = await createupdateidentities(docClient, authenticationshared, identity, Parameters, TableName)
      }
      else if (TableName === 'Logverz-Queries') {
        console.log('updating queries')
        var data = await createupdatequeries(docClient, queries, Parameters, TableName)
      }
      else {
        console.log('TODO: Generic DynamoDB PUT item.')
      }

      break

    case (Operation.match(/dynamodb:Query/) || {}).input:

      var params = AddQueryParams(Parameters, TableName)
      const command = new QueryCommand(params)
      var data = (await docClient.send(command)).Items
      var queryfilters = getqueryfilters(Parameters, 'PostQuery')

      if (queryfilters.length !== 0 && (queryfilters.map(f => f.FilterExpression.AttributeName === 'sharedquery').includes(true))) {
        data = sharedqueryfiltering(data, userattributes, region)
        // console.log(data)
      }
      else if (queryfilters.length !== 0) {
        var filterexpression = queryfilters[0].FilterExpression
        data = postqueryfiltering(data, filterexpression)
      }

      // data filter out Archive true records.
      data = data.filter(d => d.Archive !== true)

      break

    default:
      var e = new Error('Operation: ' + Operation + ' not recognised')
      throw e
  }
  var result = {}
  result.Items = data
  return result
}

function sharedqueryfiltering (data, userattributes, region) {
  var IAMGroups = userattributes.IAMGroups.map(g => g + ':GroupAWS')
  var self = userattributes.Name + ':' + userattributes.Type
  var isadminuser = false
  var isadminGmember = false
  var ispoweruser = userattributes.IAMGroups.includes('LogverzPowerUsers' + '-' + region)

  if (userattributes.Policies.UserAttached.length !== 0) {
    isadminuser = userattributes.Policies.UserAttached.map(p => JSON.parse(p).PolicyName === 'AdministratorAccess').includes(true)
  }
  if (userattributes.Policies.GroupAttached.length !== 0) {
    isadminGmember = userattributes.Policies.GroupAttached.map(p => JSON.parse(p).PolicyName === 'AdministratorAccess').includes(true)
  }

  if (ispoweruser || isadminuser || isadminGmember) {
    // if user is  powerusers or admin than no need to filter can see all data
    var haspermission = data
  }
  else {
    // else check if user directly or trough being member of a group is owner or hasaccess
    var haspermission = data.filter((query) => {
      var result = false

      if (query.Owners.length > 0) {
        result = (query.Owners.map(o => self.includes(o))).includes(true)
      }

      if (result === false && query.Access.length > 0) {
        result = (query.Access.map(a => self.includes(a))).includes(true)
      }

      if (result === false) {
        result = (query.Owners.map(o => IAMGroups.includes(o))).includes(true)
      }

      if (result === false) {
        result = (query.Access.map(a => IAMGroups.includes(a))).includes(true)
      }

      if (result !== false) {
        return result
      }
    })
  }
  return haspermission
}

function postqueryfiltering (data, filterexpression) {
  if (filterexpression.Expression === 'desc') {
    data = _.orderBy(data, [filterexpression.AttributeName], ['desc'])
  }
  else if (filterexpression.Expression === 'asc') {
    data = _.orderBy(data, [filterexpression.AttributeName], ['asc'])
  }
  else {
    console.log('Some kind of malformed request at present we only support asc/desc and limit post query filters')
  }

  if (filterexpression.Limit !== null) {
    data = data.slice(0, filterexpression.Limit)
  }

  return data
}

async function createupdatequeries (docClient, queries, Parameters, TableName) {
  var params = {
    TableName,
    Item: {}
  }

  var payloadobject = _.find(Parameters, 'Payload').Payload
  var HashandSort = getrequestattributes(Parameters) // {};
  var Keys = Object.keys(HashandSort)

  var cachedquery = queries.chain().find(HashandSort).collection.data[0]
  cachedquery = _.omit(cachedquery, '$loki')
  cachedquery = _.omit(cachedquery, 'meta')

  if (cachedquery !== undefined && cachedquery.QueryType === 'C') {
    // the query exists and of type "C" => update collection parameters, ensuring that DatabaseName and TableName fields
    // are not overwritten during update as that results in privilege escalation.
    var DatabaseName = cachedquery.DatabaseName
    TableName = cachedquery.TableName

    params.Item = cachedquery
    _.assign(params.Item, payloadobject)

    params.Item.DatabaseName = DatabaseName
    params.Item.TableName = TableName
    // params.Item.QueryType="C"
  }
  else {
    // the query does not exists or exists with type "A" than create or update analysis respectively.
    // analysis can only be added/modified if user has permissions to the underlying collection "C" type query.

    params.Item = cachedquery
    _.assign(params.Item, payloadobject)
  }

  // Database Hash and sort keys in the root of the request attributes are validated hence using that, not the one came as part of the payload.
  // eslint-disable-next-line no-return-assign
  Keys.map(k => params.Item[k] = HashandSort[k])
  // console.log(params)

  const putcommand = new PutCommand(params)
  const data = await docClient.send(putcommand)
  // remove table properties as it is now stale
  queries.chain().find(HashandSort).remove()
  return data
}

async function createupdateidentities (docClient, authenticationshared, identity, Parameters, TableName) {
  var identity = getidentityparams(Parameters)
  var Payload = _.filter(Parameters, 'Payload')[0].Payload
  var params = AdduserParams(identity, Payload, TableName)
  var params = await authenticationshared.AssociateUserPolicies(docClient, QueryCommand, params)
  const putcommand = new PutCommand(params)
  const data = await docClient.send(putcommand)

  return data
}

function AdduserParams (identity, Payload, TableName) {
  // for non AWS users.
  var params = {
    TableName,
    Item: {
      Name: identity.Name,
      Type: identity.Type,
      IAM: 'true',
      IAMGroups: [],
      IAMPolicies: [],
      Policies: {
        GroupAttached: [],
        GroupInline: [],
        UserAttached: []
      }
    }
  }
  if (Payload.IAMGroups !== undefined) {
    params.Item.IAMGroups = Payload.IAMGroups
  }
  if (Payload.IAMPolicies !== undefined) {
    params.Item.IAMPolicies = Payload.IAMPolicies
  }

  return params
}

function AddQueryParams (Parameters, TableName) {
  var params = {
    TableName
  }

  // if (Parameters.length ===1){
  if (_.filter(Parameters, 'KeyConditionExpression').length === 0) {
    var AttributeName = Parameters[0].AttributeName
    var AttributeNames = AttributeName
    var ExpressionAttributeNames = {
      '#AN': AttributeName
    }
    var ExpressionAttributeValues = {
      ':AttributeValue': Parameters[0].AttributeValue
    }
    var KeyConditionExpression = `#AN ${Parameters[0].Expression} :AttributeValue`
    params.KeyConditionExpression = KeyConditionExpression
  }
  else {
    // if its array than it will have multiple object containing the key value pairs and keykondition expressions possibly filter expressions.
    var KeyConditionExpression = _.filter(Parameters, 'KeyConditionExpression')[0].KeyConditionExpression
    var ExpressionAttributeNames = {}
    var ExpressionAttributeValues = {}
    var FilteredParams = _.filter(Parameters, 'AttributeName')
    var AttributeNames = FilteredParams.map(fp => fp.AttributeName)

    for (var i = 0; i < Object.keys(FilteredParams).length; i++) {
      var currentattributevalue = FilteredParams[i].AttributeValue
      var currentattributename = FilteredParams[i].AttributeName

      if (currentattributename !== undefined) {
        ExpressionAttributeNames[`#${currentattributename}`] = currentattributename
      }

      if (currentattributevalue !== undefined && (typeof currentattributevalue === 'string')) {
        var escapedvalue = currentattributevalue.replace(':', '').replace('.', '')
        ExpressionAttributeValues[`:${escapedvalue}`] = currentattributevalue
      }
      else if (currentattributevalue !== undefined) {
        var escapedvalue = currentattributevalue
        ExpressionAttributeValues[`:${escapedvalue}`] = currentattributevalue
      }

      if (i === 0) {
        KeyConditionExpression = `#${currentattributename}` + ` ${FilteredParams[i].Expression} ` + `:${escapedvalue}` + ' ' + KeyConditionExpression + ' '
      }
      else if (FilteredParams[i].Expression.match(/^[a-z0-9_]+$/i) !== null) {
        // in case expression contains 'begins_with' or 'between', regex matches A-Z, a-z, 0-9, and _
        KeyConditionExpression += ` ${FilteredParams[i].Expression}(` + `#${currentattributename},` + `:${escapedvalue})`
      }
      else {
        KeyConditionExpression += `#${currentattributename}` + ` ${FilteredParams[i].Expression} ` + `:${escapedvalue}`
      }
    }
    params.KeyConditionExpression = KeyConditionExpression
  }

  var queryfilters = getqueryfilters(Parameters, '')

  if (queryfilters.length !== 0) {
    var FilterExpression = _.filter(Parameters, 'FilterExpression')[0].FilterExpression

    var AVescaped = FilterExpression.AttributeValue
    if ((typeof (FilterExpression.AttributeValue) === 'string') && ((FilterExpression.AttributeValue.includes(':')) || (FilterExpression.AttributeValue.includes('-')))) {
      AVescaped = FilterExpression.AttributeValue.replace(/:/g, '').replace(/-/g, '').replace('.', '')
    }

    var ANescaped = FilterExpression.AttributeName
    if ((typeof (FilterExpression.AttributeName) === 'string') && ((FilterExpression.AttributeValue.includes(':')) || (FilterExpression.AttributeName.includes('-')))) {
      ANescaped = FilterExpression.AttributeValue.replace(/:/g, '').replace(/-/g, '').replace('.', '')
    }

    var FilterExpressionAttributeName = {
      '#FAN': ANescaped
    }
    var FilterExpressionAttributeValue = {
      ':FAttributeValue': AVescaped
    } // FilterExpression.AttributeValue

    if (FilterExpression.Expression.match(/^[a-z0-9_]+$/i) !== null) {
      // in case expression contains 'begins_with' or 'between' or 'contains', regex matches A-Z, a-z, 0-9, and _
      params.FilterExpression = `${FilterExpression.Expression}(` + `#${FilterExpressionAttributeName['#FAN']},` + `:${FilterExpressionAttributeValue[':FAttributeValue']})`
    }
    else {
      params.FilterExpression = `#${FilterExpressionAttributeName['#FAN']}` + ` ${FilterExpression.Expression} ` + `:${FilterExpressionAttributeValue[':FAttributeValue']}`
    }
    ExpressionAttributeNames[`#${FilterExpressionAttributeName['#FAN']}`] = ANescaped
    ExpressionAttributeValues[`:${FilterExpressionAttributeValue[':FAttributeValue']}`] = FilterExpression.AttributeValue
  }
  else {
    // we do post query filtering
  }
  params.ExpressionAttributeNames = ExpressionAttributeNames
  params.ExpressionAttributeValues = ExpressionAttributeValues
  var params = AddQueryindex(TableName, AttributeNames, params)
  return params
}

function AddQueryindex (TableName, AttributeNames, params) {
  // need a function to retrieve Primary and sort keys for allDynamoDB Table and corresponding indexes .
  // compare that with the query if needed add index, if no match is found use scan operation.

  if ((TableName === 'Logverz-Identities') && (AttributeNames === 'Type')) {
    params.IndexName = 'TypeIndex'
  }
  else if ((TableName === 'Logverz-Identities') && (AttributeNames === 'IAM')) {
    params.IndexName = 'IAMIndex'
  }
  else if ((TableName === 'Logverz-Invocations') && (AttributeNames.includes('Severity'))) {
    params.IndexName = 'Severity'
  }
  else if ((TableName === 'Logverz-Invocations') && (AttributeNames.includes('Category'))) {
    params.IndexName = 'Category'
  }
  else if ((TableName === 'Logverz-Invocations') && (AttributeNames.includes('Type'))) {
    params.IndexName = 'Type'
  }
  else if ((TableName === 'Logverz-Queries') && (AttributeNames.includes('DataType') || AttributeNames.includes('QueryName'))) {
    params.IndexName = 'QueryName'
  }
  else if ((TableName === 'Logverz-Queries') && (AttributeNames.includes('DatabaseName') || AttributeNames.includes('TableName'))) {
    params.IndexName = 'TableName'
  }
  else if ((TableName === 'Logverz-Queries') && (AttributeNames.includes('QueryType'))) {
    params.IndexName = 'QueryType'
  }
  return params
}

function getidentityparams (Parameters) {
  var namelocation = _.findKey(Parameters, function (p) {
    return p.AttributeName === 'Name'
  })
  var typelocation = _.findKey(Parameters, function (p) {
    return p.AttributeName === 'Type'
  })
  var name = Parameters[namelocation].AttributeValue
  var type = Parameters[typelocation].AttributeValue

  return {
    Name: name,
    Type: type
  }
}

// function timeout (ms) {
//   return new Promise(resolve => setTimeout(resolve, ms))
// }

function getrequestattributes (Parameters) {
  var result = {}
  var HashandSort = []
  var FilterExpression = []
  for (var i = 0; i < Parameters.length; i++) {
    if (Parameters[i].AttributeName !== undefined) {
      HashandSort.push(i)
    }
    if (Parameters[i].FilterExpression !== undefined) {
      FilterExpression.push(i)
    }
  }

  for (var j = 0; j < HashandSort.length; j++) {
    var key = HashandSort[j]
    result[Parameters[key].AttributeName] = Parameters[key].AttributeValue
  }

  for (var k = 0; k < FilterExpression.length; k++) {
    var index = FilterExpression[k]
    var key = Parameters[index].FilterExpression
    result[key.AttributeName] = key.AttributeValue
  }

  return result
}

function getqueryfilters (Parameters, Type) {
  var FilterExpression = _.filter(Parameters, 'FilterExpression')
  if (Type === 'PostQuery') {
    var FilterExpression = FilterExpression.map(f => {
      if (f.FilterExpression.Type === 'PostQuery') {
        return f
      }
    })
  }
  else {
    var FilterExpression = FilterExpression.map(f => {
      if (f.FilterExpression.Type === undefined) {
        return f
      }
    })
  }
  return _.compact(FilterExpression)
}

function validateprovidedusername (commonshared, requestoridentity, event) {
  var Parameters = JSON.parse(commonshared.getquerystringparameter(event.queryStringParameters.Parameters))
  var clientrequest = getrequestattributes(Parameters)
  var requestoridentityshort = requestoridentity.Name + ':' + requestoridentity.Type

  if (clientrequest.UsersQuery !== undefined && clientrequest.UsersQuery !== requestoridentityshort) {
    var reason = 'Something Nasty is happening! \nThe request contained: ' + clientrequest.UsersQuery + ' \nWhile the token contained ' + requestoridentityshort
    console.log(reason)
    return {
      status: 'Deny',
      Reason: reason
    }
  }
  else {
    return {
      status: 'Allow',
      Reason: "Request either did not have username parameter or provided username matches token's value"
    }
  }
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

/*
WORKING CLI:
aws dynamodb query --table-name usertable --expression-attribute-names "#UN=UserName" --expression-attribute-values file://qstring.json --key-condition-expression "#UN = :username"
aws dynamodb query --table-name usertable --expression-attribute-names "#UN=UserName" --expression-attribute-values "{\":username\":{\"S\":\"alice\"}}" --key-condition-expression "#UN = :username"
aws dynamodb query --table-name usertable --expression-attribute-names "#PT=Path" --expression-attribute-values "{\":path\":{\"S\":\"abc\"}}" --key-condition-expression "#PT = :path" --index-name "Path-index"
aws dynamodb query --table-name usertable --expression-attribute-names "#PT=Path" --expression-attribute-values "{\":path\":{\"S\":\"/\"}}" --key-condition-expression "#PT= :path" --index-name "Path-index"
*/

// API GW test
// Query Strings
// Resource=arn:aws:dynamodb:ap-southeast-2:accountnumber:table/Logverz-Identities&Parameters=%5b%7b%22AttributeName%22%3a%22IAM%22%2c%22AttributeValue%22%3a%22true%22%2c%22Expression%22%3a%22%3d%22%7d%5d&Operation=dynamodb:Query

// headers
// Authorization: Bearer
