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

import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { IAMClient, paginateGetAccountAuthorizationDetails } from '@aws-sdk/client-iam'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
var TableName = 'Logverz-Identities'
var updateidentities = []
var filename = 'AccountAuthorizationDetails.json'
var currentfilename = filename.replace('.json', 'Current.json')

var MaximumCacheTime = process.env.MaximumCacheTime
if (typeof db === 'undefined') {
  // the variable is defined
  var db = new loki('db.json', {
    autoupdate: true
  })
}

if (db.collections.length === 0) {
  if (MaximumCacheTime === undefined) {
    MaximumCacheTime = 1
  }

  var identity = db.addCollection('Logverz-Identities', {
    ttl: MaximumCacheTime * 60 * 1000
  })
}

export const handler = async (event, context) => {
  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    var arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var commonsharedpath = ('file:///' + path.join(__dirname, './shared/commonsharedv3.js').replace(/\\/g, '/'))
    var commonshared = await GetConfiguration(commonsharedpath, '*')
    var authenticationsharedpath = ('file:///' + path.join(__dirname, './shared/authenticationsharedv3.js').replace(/\\/g, '/'))
    var authenticationshared = await GetConfiguration(authenticationsharedpath, '*')
    var bucketname = process.env.InitBucket
    var currentDB = `file:///tmp/${currentfilename}`
    var cert = process.env.PublicKey
    // var invokedFunctionArn=context.invokedFunctionArn;
    var RestApiId = process.env.RestApiId
    var StartIdentitySync = process.env.StartIdentitySync
    var AllowedOrigins = process.env.AllowedOrigins
    var maskedevent = commonshared.masktoken(JSON.parse(JSON.stringify(event)))
    console.log('REQUEST RECEIVED: \n' + JSON.stringify(context) + '\n\n')
    console.log('THE EVENT: \n' + JSON.stringify(maskedevent) + '\n\n')
  }
  else {
    // Dev environment settings
    var directory = path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'identitysync', 'mydev.mjs')
    const mydev = await import('file:///' + directory.replace(/\\/g, '/'))
    var region = mydev.region
    var commonshared = mydev.commonshared
    var authenticationshared = mydev.authenticationshared
    var event = mydev.event
    var bucketname = mydev.bucketname
    var currentDB = 'file:///' + path.join(__dirname, currentfilename)
    var cert = mydev.cert
    var context = mydev.context
    var RestApiId = mydev.RestApiId
    var StartIdentitySync = mydev.StartIdentitySync
    var AllowedOrigins = mydev.AllowedOrigins
  }

  const ddclient = new DynamoDBClient({})
  const docClient = DynamoDBDocumentClient.from(ddclient)
  const s3client = new S3Client({})
  var message = 'ok'
  var reply = {}

  if (event.source === 'aws.events' || Object.keys(event).length === 0) {
    // empty event is for lambda execution, identiy sync post deployment case
    var apigateway = false
  }
  else if (event.resource === '/Start/IdentitySync') {
    var apigateway = true
    var tokenobject = commonshared.ValidateToken(jwt, event.headers, cert)
    console.log(tokenobject)
    if (tokenobject.state === true) {
      var username = tokenobject.value.Name
      var usertype = tokenobject.value.Type
      var userattributes = identity.chain().find({
        Type: usertype,
        Name: username
      }).collection.data[0] // ?.data()

      if (userattributes === undefined) {
        var userattributes = await authenticationshared.getidentityattributes(docClient, QueryCommand, username, usertype)
        userattributes = userattributes.Items[0]
        identity.insert(userattributes)
      }

      var Resource = 'undefined'
      if (event.requestContext.resourcePath === '/Start/IdentitySync') {
        Resource = 'arn:aws:apigateway:' + region + '::/restapis/' + RestApiId + '/resources/' + StartIdentitySync + '/methods/POST'
      }

      var action = {
        Resource,
        Operation: 'apigateway:POST'
      }
      var authorization = authenticationshared.authorize(_, commonshared, action, userattributes)
      if (authorization.status !== 'Allow') {
        // request not authorized
        message = authorization.Reason
        console.log(message)
      }
      // else message remains oke and execution continues;
    }
    else {
      // invalid token
      message = tokenobject.value
    }
  }

  if (message === 'ok') {
    // its comming from authorized source: aws events or api gateway
    console.log('Calling Main')
    var result = await Main(s3client, ddclient, docClient, commonshared, authenticationshared, currentDB, bucketname, region)
  }
  else {
    // its invalid token or unauthorized;
    console.error(message)
    var result = message
  }

  console.log('finished execution, sending reply')

  if (apigateway === false) {
    // context.succeed(result);
    return result
  }
  else if (message !== 'ok') {
    reply = {
      status: 400,
      data: message,
      header: {}
    }
    return commonshared.apigatewayresponse(reply, event.headers, AllowedOrigins)
  }
  else {
    reply = {
      status: 200,
      data: result,
      header: {}
    }
    return commonshared.apigatewayresponse(reply, event.headers, AllowedOrigins)
  }
}

async function Main (s3client, ddclient, docClient, commonshared, authenticationshared, currentDB, bucketname, region) {
  console.log('main Executed')
  // filename="temp/AAD.json" // remove once finished.
  var content = await commonshared.S3GET(s3client, GetObjectCommand, bucketname, filename)
  if (content.Code === 'NoSuchKey') {
    // for new runs when there is no previousDB data.
    var oldIAMDB = {
      GroupDetailList: {},
      Policies: {},
      UserDetailList: {}
    }
  }
  else {
    // var oldIAMDB= createlocalIAMDB(fs.readFileSync(previousDB, "utf8"));
    var bodycontent = Buffer.from(await content.Body.transformToByteArray()).toString('utf-8')
    var oldIAMDB = createlocalIAMDB(bodycontent)
  }

  await createiamidentitiesfile(currentDB)
  var newIAMDB = createlocalIAMDB(fs.readFileSync(fileURLToPath(currentDB), 'utf-8'))
  // var diff = jsonDiff.diffString(oldIAMDB, newIAMDB)

  var diffedresult = await rundiff(oldIAMDB, newIAMDB)
  console.log('\nOverview of removed Identities:\n')
  console.log(JSON.stringify(diffedresult.removed, null, 4))
  console.log('\nOverview of added or changed Identities:\n')
  console.log(JSON.stringify(diffedresult.neworchanged, null, 4))
  console.log('\n\n')

  await processidentitiesneworchanged(authenticationshared, commonshared, ddclient, docClient, TableName, newIAMDB, diffedresult, region)
  await processidentitiesremoved(authenticationshared, commonshared, ddclient, docClient, TableName, newIAMDB, diffedresult)

  // TODO perform reverse sync by comparing All AWS entries (in Dynamo DB) with entries in retrieved AccountAuthorizationDetails.json and remove orphaned items.
  await commonshared.s3putdependencies(currentDB, bucketname, s3client, PutObjectCommand, fs, fileURLToPath, filename)

  updateidentities = _.flatten(updateidentities)
  // https://medium.com/@xinyustudio/javascript-get-unique-array-elements-of-objects-remove-duplicates-in-one-line-code-yes-f54867ae2dd2
  updateidentities = _.uniqWith(updateidentities, _.isEqual)
  // remove null https://stackoverflow.com/questions/30812765/how-to-remove-undefined-and-null-values-from-an-object-using-lodash
  updateidentities = _.pickBy(updateidentities, _.identity)

  // udate non aws users if changed occured in the associated groups or policies.
  if (Object.keys(updateidentities).length !== 0) {
    await authenticationshared.UptadeAssociatedUserPolicy(_, docClient, QueryCommand, PutCommand, updateidentities)
  }

  var message = 'Finished IdentitySync'
  var details = {
    source: 'identitysync.js:Main',
    message
  }
  var loglevel = 'Info'
  await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'IdentitySync', loglevel, 'Infra', details, 'API')
  return message
}

async function processidentitiesremoved (authenticationshared, commonshared, ddclient, docClient, TableName, newIAMDB, diffedresult) {
  for (var i = 0; i < Object.keys(diffedresult.removed).length; i++) {
    var propertyname = Object.keys(diffedresult.removed)[i]
    var propertyvalue = diffedresult.removed[propertyname]
    var operator = '-'

    if (propertyname === 'UserDetailList') {
      for (var j = 0; j < propertyvalue.length; j++) {
        var Userentry = propertyvalue[j]
        var UserObject = {
          Name: Userentry.UserName
        }
        if (UserObject !== null) {
          // user object is null if its not eligible for syncing see syncablecheck for more details
          await PersistAWSUserChange(ddclient, docClient, TableName, UserObject, operator)
        }
      }
    }
    else if (propertyname === 'Policies') {
      for (var k = 0; k < propertyvalue.length; k++) {
        var Policyentry = propertyvalue[k]
        var PolicyObject = {
          Name: Policyentry.PolicyName
        }
        var changedidentites = await getlinkedidentities(_, authenticationshared, docClient, 'IAMPolicies', Policyentry.PolicyName, operator, newIAMDB)
        updateidentities.push(changedidentites)
        await PersistAWSPolicyChange(ddclient, docClient, TableName, PolicyObject, operator)
      }
    }
    else if (propertyname === 'GroupDetailList') {
      for (var l = 0; l < propertyvalue.length; l++) {
        var Groupentry = propertyvalue[l]
        var GroupObject = {
          Name: Groupentry.GroupName
        }
        var changedidentites = await getlinkedidentities(_, authenticationshared, docClient, 'IAMGroups', Groupentry.GroupName, operator, newIAMDB)
        updateidentities.push(changedidentites)
        await PersistAWSGroupChange(ddclient, docClient, TableName, GroupObject, operator)
      }
    }
  }
}

async function processidentitiesneworchanged (authenticationshared, commonshared, ddclient, docClient, TableName, newIAMDB, diffedresult, region) {
  for (var i = 0; i < Object.keys(diffedresult.neworchanged).length; i++) {
    var propertyname = Object.keys(diffedresult.neworchanged)[i]
    var propertyvalue = diffedresult.neworchanged[propertyname]
    var operator = '+'

    if (propertyname === 'UserDetailList') {
      for (var j = 0; j < propertyvalue.length; j++) {
        var Userentry = propertyvalue[j]
        var UserObject = createUserObject(newIAMDB, Userentry.UserName, region)
        if (UserObject !== null) {
          // user object is null if its not eligible for syncing see syncablecheck for more details
          await PersistAWSUserChange(ddclient, docClient, TableName, UserObject, operator)
        }
      }
    }
    else if (propertyname === 'Policies') {
      for (var k = 0; k < propertyvalue.length; k++) {
        var Policyentry = propertyvalue[k]
        var PolicyObject = createPolicyObject(Policyentry)
        var changedidentites = await getlinkedidentities(_, authenticationshared, docClient, 'IAMPolicies', Policyentry.PolicyName, operator, newIAMDB)
        if (changedidentites !== null) {
          var externalusers = changedidentites.filter(c => c.Type !== 'UserAWS')
          updateidentities.push(externalusers)
          var awsusers = changedidentites.filter(c => c.Type === 'UserAWS' && c.Operator === '+')
          for await (var oneuser of awsusers) {
            var UserObject = createUserObject(newIAMDB, oneuser.Name, region)
            await PersistAWSUserChange(ddclient, docClient, TableName, UserObject, operator)
          }
        }
        await PersistAWSPolicyChange(ddclient, docClient, TableName, PolicyObject, operator)
      }
    }
    else if (propertyname === 'GroupDetailList') {
      for (var l = 0; l < propertyvalue.length; l++) {
        var Groupentry = propertyvalue[l]
        var GroupObject = createGroupObject(newIAMDB, Groupentry)
        var changedidentites = await getlinkedidentities(_, authenticationshared, docClient, 'IAMGroups', Groupentry.GroupName, operator, newIAMDB)
        if (changedidentites !== null) {
          updateidentities.push(changedidentites)
        }
        await PersistAWSGroupChange(ddclient, docClient, TableName, GroupObject, operator)
      }
    }
  } // for
}

async function PersistAWSGroupChange (ddclient, docClient, TableName, GroupObject, operator) {
  if (operator === '+') {
    var params = {
      TableName,
      ReturnConsumedCapacity: 'TOTAL'
    }
    params.Item = GroupObject.Item

    const command = new PutItemCommand(params)
    var dynamodbresult = await ddclient.send(command)
  }
  else if (operator === '-') {
    var params = {
      TableName,
      Key: {
        Name: GroupObject.Name,
        Type: 'GroupAWS'
      }
    }

    const delcommand = new DeleteCommand(params)
    var dynamodbresult = await docClient.send(delcommand)
  }
  return dynamodbresult
}

async function PersistAWSPolicyChange (ddclient, docClient, TableName, PolicyObject, operator) {
  if (operator === '+') {
    var params = {
      TableName,
      ReturnConsumedCapacity: 'TOTAL'
    }
    params.Item = PolicyObject.Item

    const command = new PutItemCommand(params)
    var dynamodbresult = await ddclient.send(command)
  }
  else if (operator === '-') {
    var params = {
      TableName,
      Key: {
        Name: PolicyObject.Name,
        Type: 'PolicyAWS'
      }
    }

    const delcommand = new DeleteCommand(params)
    var dynamodbresult = await docClient.send(delcommand)
  }
  return dynamodbresult
}

async function PersistAWSUserChange (ddclient, docClient, TableName, UserObject, operator) {
  if (operator === '+') {
    // this is a new Logverz user or an updated user,we can replace whole record as source of truth is in IAM.
    var params = {
      ReturnConsumedCapacity: 'TOTAL',
      TableName
    }
    params.Item = UserObject.Item

    const command = new PutItemCommand(params)
    var dynamodbresult = await ddclient.send(command)
  }
  else if (operator === '-') {
    var params = {
      TableName,
      Key: {
        Name: UserObject.Name,
        Type: 'UserAWS'
      }
    }

    const delcommand = new DeleteCommand(params)
    var dynamodbresult = await docClient.send(delcommand)
  }

  return dynamodbresult
}

async function rundiff (oldIAMDB, newIAMDB) {
  var allnewandchangedentries = {}
  var allremovedentries = {}

  for (var h = 0; h < Object.keys(newIAMDB).length; h++) {
    var somenewentries = []
    var somechangedentries = []
    var propertyname = Object.keys(newIAMDB)[h]

    // check for new or changed items
    for (var i = 0; i < newIAMDB[propertyname].length; i++) {
      var entrychanged = false
      var entryexists = false
      var newitem = newIAMDB[propertyname][i]

      // Check if item exists in oldimadb, if not then new, if yes its either same or changed.
      for (var j = 0; j < oldIAMDB[propertyname].length; j++) {
        var olditem = oldIAMDB[propertyname][j]

        if (olditem.Arn === newitem.Arn) {
          entryexists = true
          if ((_.isEqual(olditem, newitem)) === false) {
            // checking changes if it is a not relevant change such as user tag or Policy attachmentcount filter that out.
            entrychanged = filterproperties(olditem, newitem)
            if (entrychanged === true) {
              console.log('changed identity: ' + newitem.Arn)
            }
            break
          }
          // console.log(" Existing identity: " +newitem.Arn )
          break
        }
      }

      if (entrychanged) {
        somechangedentries.push(newitem)
      }
      else if (entryexists === false) {
        somenewentries.push(newitem)
      }
    } // i

    if (somechangedentries.length !== 0 || somenewentries.length !== 0) {
      var someneworchangedentries = somenewentries.concat(somechangedentries)
      _.set(allnewandchangedentries, propertyname, someneworchangedentries)
    }
  } // h

  // check for deleted items
  for (var k = 0; k < Object.keys(oldIAMDB).length; k++) {
    var someremovedentries = []
    var propertyname = Object.keys(oldIAMDB)[k]

    for (var l = 0; l < oldIAMDB[propertyname].length; l++) {
      var olditem = oldIAMDB[propertyname][l]

      if (propertyname === 'UserDetailList') {
        var result = _.find(newIAMDB.UserDetailList, ['UserName', olditem.UserName])
      }
      if (propertyname === 'Policies') {
        var result = _.find(newIAMDB.Policies, ['PolicyName', olditem.PolicyName])
      }
      if (propertyname === 'GroupDetailList') {
        var result = _.find(newIAMDB.GroupDetailList, ['GroupName', olditem.GroupName])
      }

      if (result === undefined) {
        someremovedentries.push(olditem)
      }
    } // l

    if (someremovedentries.length !== 0) {
      _.set(allremovedentries, propertyname, someremovedentries)
    }
  } // k

  // update the IAM users with corresponding group change. Example  Logverz userschanged update users that are member of lisusers group
  if (allnewandchangedentries.GroupDetailList !== undefined && newIAMDB.UserDetailList !== undefined) {
    for (var l = 0; l < allnewandchangedentries.GroupDetailList.length; l++) {
      var GroupName = (allnewandchangedentries.GroupDetailList[l]).GroupName

      for (var m = 0; m < newIAMDB.UserDetailList.length; m++) {
        var user = newIAMDB.UserDetailList[m]
        var exists = user.GroupList.filter(g => g.includes(GroupName))

        var userallreadyinchangedlist = _.find(allnewandchangedentries.UserDetailList, ['UserName', user.UserName])
        // if not in changed list(value === undefined ) than add user to the changed list.
        if (exists.length === 1 && (userallreadyinchangedlist === undefined)) {
          if (allnewandchangedentries.UserDetailList === undefined) {
            allnewandchangedentries.UserDetailList = []
          }
          allnewandchangedentries.UserDetailList.push(user)
          // console.log(user.UserName +" is memmber of group"+GroupName);
        }
      }
    }
  }

  var allentries = {
    neworchanged: allnewandchangedentries,
    removed: allremovedentries
  }
  return allentries
}

function filterproperties (olditem, newitem) {
  var result = true

  if (_.isEqual(_.omit(olditem, 'AttachmentCount'), _.omit(newitem, 'AttachmentCount'))) {
    // olditem.AttachmentCount!==newitem.AttachmentCount&&(olditem.UpdateDate==newitem.UpdateDate)
    result = false
  }
  return result
}

function createUserObject (localIAMDB, IamUserName, region) {
  var User = _.find(localIAMDB.UserDetailList, ['UserName', IamUserName])
  var UserInlinePolicies = getuserinlinepolicies(User.UserPolicyList)

  var UserAttachedPolicyList = User.AttachedManagedPolicies
  var UserAttachedPolicies = getawsmanagedpolicies(UserAttachedPolicyList, localIAMDB)

  var UsersGroups = User.GroupList
  var GroupsInlinePolicies = getgroupsinlinepolicies(UsersGroups, localIAMDB)

  var GroupsAttachePolicyList = getgroupsmanagedpolicies(UsersGroups, localIAMDB)
  var GroupsAttachedPolicies = getawsmanagedpolicies(GroupsAttachePolicyList, localIAMDB)

  var issyncable = syncablecheck(UserAttachedPolicies, GroupsAttachedPolicies, UsersGroups, region)

  if (issyncable) {
    var params = {
      Item: {
        Name: {
          S: User.UserName
        },
        Type: {
          S: 'UserAWS'
        },
        IAM: {
          S: 'true'
        },
        IAMGroups: {
          L: []
        },
        Path: {
          S: User.Path
        },
        Arn: {
          S: User.Arn
        },
        Policies: {
          M: {
            UserInline: {
              L: []
            },
            UserAttached: {
              L: []
            },
            GroupInline: {
              L: []
            },
            GroupAttached: {
              L: []
            }
          }
        }
      }
    }

    const UserObject = {
      Policies: {
        UserInline: UserInlinePolicies,
        UserAttached: UserAttachedPolicies,
        GroupInline: GroupsInlinePolicies,
        GroupAttached: GroupsAttachedPolicies
      }
    }

    var i
    for (i = 0; i < Object.keys(UserObject.Policies).length; i++) {
      var result = []
      var PolicyGroupName = Object.keys(UserObject.Policies)[i]
      var PolicyRecords = UserObject.Policies[PolicyGroupName]
      _.forEach(PolicyRecords, function (Policy) {
        let p = JSON.stringify(Policy)
        p = p.replace(/(\r\n|\n|\r| |\\")/gm, "'")
        result.push({
          S: p
        })
      })
      params.Item.Policies.M[PolicyGroupName] = {
        L: result
      }
    }

    for (var j = 0; j < UsersGroups.length; j++) {
      var onegroup = {
        S: UsersGroups[j]
      }
      params.Item.IAMGroups.L.push(onegroup)
    }

    return params
  }
  else {
    return null
  }
}

function syncablecheck (UserAttachedPolicies, GroupsAttachedPolicies, UsersGroups, region) {
  // There are three types of users that are synced, One, regular users who are member of Logverz Users group, Two Logverz PowerUsers.
  // Three admin users who are member of group(s) that has AWS admin policy  attached, or have that directly attached.
  // Reminder: users with custom policies that have the same privilage as admin are not (yet) considered.
  var adminuser, adminGmember, LogverzUsersGmember, LogverzPowerUsersGmember, syncable
  adminuser = adminGmember = LogverzUsersGmember = false

  adminuser = (!_.isEmpty(_.find(UserAttachedPolicies, ['PolicyName', 'AdministratorAccess']))) // AdministratorAccess
  adminGmember = (!_.isEmpty(_.find(GroupsAttachedPolicies, ['PolicyName', 'AdministratorAccess']))) // AdministratorAccess
  LogverzUsersGmember = _.includes(UsersGroups, 'LogverzUsers' + '-' + region) // LogverzUsers
  LogverzPowerUsersGmember = _.includes(UsersGroups, 'LogverzPowerUsers' + '-' + region) // LogverzUsers

  if (adminuser === true || adminGmember === true || LogverzUsersGmember === true || LogverzPowerUsersGmember === true) {
    syncable = true
  }
  else {
    syncable = false
  }

  return syncable // || true
}

function createGroupObject (localIAMDB, Groupentry) {
  const InlinePolicies = []
  let AttachedPolicies = []

  _.forEach(Groupentry.GroupPolicyList, function (onepolicy) {
    const policy = {
      PolicyName: onepolicy.PolicyName,
      PolicyDocument: (decodeURIComponent(onepolicy.PolicyDocument)).replace(/(\r\n|\n|\r| )/gm, '')
    }
    InlinePolicies.push(policy)
  })
  AttachedPolicies = getawsmanagedpolicies(Groupentry.AttachedManagedPolicies, localIAMDB)
  var GroupObject = {
    GroupInline: InlinePolicies,
    GroupAttached: AttachedPolicies
  }

  var params = {
    Item: {
      Name: {
        S: Groupentry.GroupName
      },
      Type: {
        S: 'GroupAWS'
      },
      Path: {
        S: Groupentry.Path
      },
      GroupId: {
        S: Groupentry.GroupId
      },
      Arn: {
        S: Groupentry.Arn
      },
      Policies: {
        M: {
          GroupInline: {
            L: []
          },
          GroupAttached: {
            L: []
          }
        }
      }
    }
  }
  var i
  for (i = 0; i < Object.keys(GroupObject).length; i++) {
    var result = []
    var PolicyGroupName = Object.keys(GroupObject)[i]
    var PolicyRecords = GroupObject[PolicyGroupName]
    _.forEach(PolicyRecords, function (Policy) {
      let p = JSON.stringify(Policy)
      p = p.replace(/(\r\n|\n|\r| |\\")/gm, "'")
      result.push({
        S: p
      })
    })
    params.Item.Policies.M[PolicyGroupName] = {
      L: result
    }
  }

  return params
}

function createPolicyObject (Policyentry) {
  var params = {
    Item: {
      Name: {
        S: Policyentry.PolicyName
      },
      Type: {
        S: 'PolicyAWS'
      },
      Path: {
        S: Policyentry.Path
      },
      PolicyId: {
        S: Policyentry.PolicyId
      },
      Arn: {
        S: Policyentry.Arn
      },
      LatestVersion: {
        M: {}
      }
    }
  }

  var LatestVersion = Policyentry.PolicyVersionList[0]

  for (var j = 0; j < Object.keys(LatestVersion).length; j++) {
    var PropertyValue
    var PropertyName = Object.keys(LatestVersion)[j]

    if (PropertyName === 'Document') {
      let p = decodeURIComponent(LatestVersion[PropertyName])
      p = p.replace(/(\r\n|\n|\r|\t| )/gm, '').replace(/"/gm, "'") // p.replace(/(\r\n|\n|\r|\t )/gm,"")
      PropertyValue = {
        S: p
      }
    }
    else if (PropertyName === 'IsDefaultVersion') {
      PropertyValue = {
        BOOL: LatestVersion[PropertyName]
      }
    }
    else {
      PropertyValue = {
        S: LatestVersion[PropertyName]
      }
    }
    params.Item.LatestVersion.M[PropertyName] = PropertyValue
  }
  return params
}

async function createiamidentitiesfile (FileName) {
  const paginatorConfig = {
    client: new IAMClient({}),
    pageSize: 250 // default 100 max 1000
  }

  const paginator = paginateGetAccountAuthorizationDetails(paginatorConfig, { })
  const accountdetailsarray = []
  for await (const accountdetailspartial of paginator) {
    accountdetailsarray.push(accountdetailspartial)
  }

  fs.writeFileSync(fileURLToPath(FileName), (JSON.stringify(accountdetailsarray, 'utf8')))
  return accountdetailsarray
}

function createlocalIAMDB (fileContent) {
  // review for improvement.
  var accountdetails = {
    UserDetailList: [],
    GroupDetailList: [],
    Policies: []
  }
  var accountdetailsobject = JSON.parse(fileContent)

  _.forEach(accountdetailsobject, function (segment) {
    _.forEach(segment.UserDetailList, function (item) {
      accountdetails.UserDetailList.push(item)
    })
    _.forEach(segment.GroupDetailList, function (item) {
      accountdetails.GroupDetailList.push(item)
    })
    _.forEach(segment.Policies, function (item) {
      accountdetails.Policies.push(item)
    })
  })
  return accountdetails
}

function getgroupsmanagedpolicies (UsersGroups, localIAMDB) {
  var result = []
  _.forEach(UsersGroups, function (onegroup) {
    const OGProperties = _.find(localIAMDB.GroupDetailList, ['GroupName', onegroup])
    const OGAttachedManagedPolicies = OGProperties.AttachedManagedPolicies
    _.forEach(OGAttachedManagedPolicies, function (onepolicy) {
      result.push(onepolicy)
    })
  })
  // sort unique then return the result
  return result
}

function getgroupsinlinepolicies (UsersGroups, localIAMDB) {
  var result = []

  _.forEach(UsersGroups, function (onegroup) {
    const OGProperties = _.find(localIAMDB.GroupDetailList, ['GroupName', onegroup])
    const OGInlinePolicies = OGProperties.GroupPolicyList
    _.forEach(OGInlinePolicies, function (onepolicy) {
      const policy = {
        PolicyDocument: decodeURIComponent(onepolicy.PolicyDocument).replace(/(\r\n|\n|\r| )/gm, ''),
        PolicyName: onepolicy.PolicyName
      }
      result.push(policy)
    })
  })

  return result
}

function getuserinlinepolicies (UserPolicyList) {
  var result = []
  _.forEach(UserPolicyList, function (onepolicy) {
    const policy = {
      PolicyDocument: decodeURIComponent(onepolicy.PolicyDocument).replace(/(\r\n|\n|\r| )/gm, ''),
      PolicyName: onepolicy.PolicyName
    }
    result.push(policy)
  })
  return result
}

function getawsmanagedpolicies (PolicyList, localIAMDB) {
  const result = []

  _.forEach(PolicyList, function (onepolicy) {
    const policy = {
      PolicyName: onepolicy.PolicyName
    }
    const managedpolicy = _.find(localIAMDB.Policies, ['PolicyName', onepolicy.PolicyName])
    policy.PolicyDocument = decodeURIComponent(managedpolicy.PolicyVersionList[0].Document).replace(/(\r\n|\n|\r| )/gm, '')
    // console.log(policy)
    result.push(policy)
  })
  return result
}

async function getlinkedidentities (_, authenticationshared, docClient, identitytype, idetityvalue, operator, newIAMDB) {
  var result = []
  var data = await authenticationshared.retriveIAMidentities(_, docClient, QueryCommand, identitytype, idetityvalue, newIAMDB)

  if (data.length > 0) {
    for (var g = 0; g < Object.keys(data).length; g++) {
      var item = data[g]
      if (item.Type === 'UserAWS') {
        // only needto update non AWS users;
        continue
      }

      if (operator === '+') {
        result.push({
          Name: item.Name,
          Type: item.Type,
          Operator: operator
        })
      }
      else {
        result.push({
          Name: item.Name,
          Type: item.Type,
          Operator: operator,
          RemoveType: identitytype,
          RemoveValue: idetityvalue
        })
      }
    }
  }
  else {
    var result = null
  }

  return result
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

// function timeout (ms) {
//   return new Promise(resolve => setTimeout(resolve, ms))
// }
