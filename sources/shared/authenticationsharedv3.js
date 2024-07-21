/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

const allowdenyaction = (_, statements, userrequest) => {
  // get here the deny statements evaluate those first.
  const denystatments = []
  _.forEach(statements, onestatement => {
    const checkthis = _.omit(onestatement, 'PolicyName')
    const denystatement = _.filter(checkthis, {
      Effect: 'Deny'
    })
    if (denystatement.length !== 0) {
      denystatement.PolicyName = onestatement.PolicyName
      denystatments.push(denystatement)
    }
  })

  const matchingdenyaction = getmatchingaction(_, denystatments, userrequest)

  if (matchingdenyaction.length !== 0) {
    return {
      status: 'Deny',
      Reason: matchingdenyaction
    }
  }
  else {
    // there where no matching denies, first check if there is allow action
    const matchingallowaction = getmatchingaction(_, statements, userrequest)

    if (matchingallowaction.length !== 0 && userrequest.resource !== null) {
      // if there where allow actions check the resources match.
      var matchingresource = getmatchingresources(_, matchingallowaction, userrequest)
    }
    else if (matchingallowaction.length !== 0 && userrequest.resource === null) {
      var matchingresource = [1] // This is for when there is no resource such as a describe or list api call which by default is *.
    }
    else {
      var matchingresource = []
    }

    // send the final evaluation go or no go.

    if (matchingresource.length !== 0) { // if (matchingresource!==null){
      return {
        status: 'Allow',
        Reason: matchingresource
      }
    }
    else {
      return {
        status: 'Deny',
        Reason: 'Implicit, no matching allow statment was found.'
      }
    }
  }
}

function getmatchingresources (_, matchingactions, userrequest) {
  const requestedresource = userrequest.resource
  const matchingresource = []
  const actions = Object.keys(matchingactions)

  actions.forEach(function (action) {
    var action = matchingactions[action]
    const resourcewithtype = action[2]
    const type = resourcewithtype[0]
    const resource = resourcewithtype[1][0]
    const PolicyName = action[3]

    if ((type === 'Resource') && (resource !== '*')) {
      if (typeof (resource) === 'string') {
        const matchresult1 = resource.match(requestedresource)
        const matchresult2 = requestedresource.match(resource)
        if (matchresult1 || matchresult2) {
          matchingresource.push([action[0], action[1], {
            Resource: resource
          }, PolicyName])
        }
      }
      else {
        resource.forEach(function (oneresource) {
          const matchresult1 = oneresource.match(requestedresource)
          const matchresult2 = requestedresource.match(oneresource)
          if (matchresult1 || matchresult2) {
            matchingresource.push([action[0], action[1], {
              Resource: oneresource
            }, PolicyName])
          }
        })
      }
      // end of first block
    }
    else if ((type === 'Resource') && (resource === '*')) {
      matchingresource.push([action[0], action[1], {
        Resource: resource
      }, PolicyName]) // [onestatement.Action.split(":"),onestatement.Resource])/
    }
    else if ((type === 'NotResource') && (resource !== '*')) {
      let notresourcematch = false
      for (let i = 0; i < resource.length; i++) {
        const matchresult = resource[i].match(requestedresource)
        if (matchresult) {
          notresourcematch = true
          break
        }
      }
      // notresource not matches, hence its implicit allow
      if (notresourcematch === false) {
        matchingresource.push([action[0], action[1], {
          NotResource: resource
        }, PolicyName])
      }
    }
    else if ((type === 'NotResource') && (resource === '*')) {
      console.log('NotResouce: *, means not any resource, its a deny.')
    }
    else {
      console.error('unhandeledcase:\n\nResource:' + JSON.stringify(resource) + '\n\nuserrequest:' + userrequest)
    }
  })

  return matchingresource
}

function getmatchingaction (_, statements, userrequest) {
  const requestedservice = userrequest.serviceaction.split(':')[0]
  const requestedaction = userrequest.serviceaction.split(':')[1]
  const matchingaction = []

  statements.forEach(function (onestatement) {
    const PolicyName = onestatement.PolicyName
    const one = _.omit(onestatement, 'PolicyName')
    const sids = Object.keys(one)
    var arraylength

    sids.forEach(function (sid) {
      const actions = one[sid].Action
      if (actions !== '*' && actions !== undefined) {
        if (typeof (actions) !== 'string') { // it s an array
          actions.forEach(function (action) {
            const checkmatchresult = checkmatch(action, one, sid, PolicyName, requestedservice, requestedaction)
            if (checkmatchresult.length > 0) {
              matchingaction.push(checkmatchresult[0])
            };
          })
        }
        else {
          const action = actions
          const checkmatchresult = checkmatch(action, one, sid, PolicyName, requestedservice, requestedaction)
          if (checkmatchresult.length > 0) {
            matchingaction.push(checkmatchresult[0])
          };
        }
      }
      else if (actions === '*') {
        var iamservicepart = '*'
        var iamactionpart = '*'
        if (one[sid].Resource !== undefined) {
          var resourceornotresource = ['Resource', [one[sid].Resource]]
        }
        else {
          var resourceornotresource = ['NotResource', [one[sid].NotResource]]
        }

        matchingaction.push([iamservicepart, iamactionpart, resourceornotresource, PolicyName])
      }
      else if (one[sid].NotAction !== '*' && one[sid].Effect === 'Allow') {
        let notactionallowmatch = false
        if (typeof (one[sid].NotAction) === 'string') {
          arraylength = 1
        }
        else {
          arraylength = one[sid].NotAction.length
        }

        for (let i = 0; i < arraylength; i++) {
          var parts = one[sid].NotAction.split(':')
          var iamservicepart = parts[0].replace('*', '.*')
          var iamactionpart = parts[1].replace('*', '.*')
          var matchservice = requestedservice.match(iamservicepart)
          var matchaction = requestedaction.match(iamactionpart)
          if (matchservice === true && matchaction === true) {
            notactionallowmatch = true
            break
          }
        }
        // Allow + NotAction = if notaction does not match, than implicit allow.
        // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_notaction.html
        if (notactionallowmatch === false) {
          matchingaction.push([requestedaction, requestedservice, {
            NotAction: one[sid].NotAction
          }, PolicyName])
        }
      }
      else if (one[sid].NotAction === '*' && one[sid].Effect === 'Allow') {
        console.log('NotAction: *,with allow, means not allow any action, its a deny.')
      }
      else if (one[sid].NotAction !== '*' && one[sid].Effect === 'Deny') {
        let notactiondenymatch = true
        if (typeof (one[sid].NotAction) === 'string') {
          arraylength = 1
        }
        else {
          arraylength = one[sid].NotAction.length
        }

        for (let i = 0; i < arraylength; i++) {
          var parts = one[sid].NotAction.split(':')
          var iamservicepart = parts[0].replace('*', '.*')
          var iamactionpart = parts[1].replace('*', '.*')
          var matchservice = requestedservice.match(iamservicepart)
          var matchaction = requestedaction.match(iamactionpart)
          if (matchservice === null && matchaction === null) {
            notactiondenymatch = false
            break
          }
        }
        // Deny + NotAction = allow,if notaction does not match, than implicit deny.
        // https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_notaction.html
        if (notactiondenymatch === true) {
          matchingaction.push([requestedaction, requestedservice, {
            NotAction: one[sid].NotAction
          }, PolicyName])
        }
      }
      else if (one[sid].NotAction === '*' && one[sid].Effect === 'Deny') {
        console.log('Deny + NotAction: *, means not deny anything but dut does not explicitly allow anything either.')
      }
      else {
        console.error('unhandeledcase:\n\n' + JSON.stringify(one[sid]))
      }
    }) // foreach sids
  }) // statements

  return matchingaction
}

const getuserstatements = (userattributes) => {
  const statements = []
  const keys = Object.keys(userattributes.Policies)
  keys.forEach(function (key) {
    userattributes.Policies[key].forEach(function (policy) {
      const policytext = JSON.parse(policy).PolicyDocument.replace(/'/gm, '"')
      const object = JSON.parse(policytext).Statement
      object.PolicyName = JSON.parse(policy).PolicyName
      statements.push(object)
    })
  })
  return statements
}

function checkmatch (action, one, sid, PolicyName, requestedservice, requestedaction) {
  var result = []
  const parts = action.split(':')
  const iamservicepart = parts[0].replace('*', '.*')
  const iamactionpart = parts[1].replace('*', '.*')
  if ((iamservicepart.match(requestedservice)) && (iamactionpart.match(requestedaction) || requestedaction.match(iamactionpart))) { //
    if (one[sid].Resource !== undefined) {
      var resourceornotresource = ['Resource', [one[sid].Resource]]
    }
    else {
      var resourceornotresource = ['NotResource', [one[sid].NotResource]]
    }
    result.push([parts[0], parts[1], resourceornotresource, PolicyName])
  }
  return result
}

const getidentityattributes = async (docClient, QueryCommand, identityname, identitytype) => {
  if ((identityname === 'root') && (identitytype === 'UserAWS')) {
    var data = {}
    data.Count = 1
    data.Items = [{
      Policies: {
        UserInline: [],
        GroupInline: [],
        UserAttached: ["{\"PolicyName\":\"AdministratorAccess\",\"PolicyDocument\":\"{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':'*','Resource':'*'}]}\"}"],
        GroupAttached: []
      }
    }]
    return data
  }
  else {
    const params = {
      TableName: 'Logverz-Identities',
      ExpressionAttributeNames: {
        '#Name': 'Name',
        '#Type': 'Type'
      },
      KeyConditionExpression: '#Name = :identityname and #Type = :type',
      ExpressionAttributeValues: {
        ':identityname': identityname,
        ':type': identitytype
      }
    }
    const command = new QueryCommand(params)
    // var data = (await docClient.send(command)).Items[0];
    var data = await docClient.send(command)

    if (data.Count === 0) {
      const message = 'There is no identity ' + identityname + ':' + identitytype + " can't retrieve its permissions."
      console.log(message)
      var data = {
        status: 'Deny',
        Reason: message,
        Items: data.Items
      }
    }
    return data
  }
}

const authorize = (_, commonshared, queryStringParameters, userattributes) => {
  const Resource = commonshared.getquerystringparameter(queryStringParameters.Resource) // "Logverz-Identities"
  const Operation = commonshared.getquerystringparameter(queryStringParameters.Operation)
  const statements = getuserstatements(userattributes)
  const userrequest = {
    serviceaction: Operation,
    resource: Resource
  }

  const resultofuserrequest = allowdenyaction(_, statements, userrequest)

  return resultofuserrequest
}

const AssociateUserPolicies = async (docClient, QueryCommand, params) => {
  const groupinline = []
  const groupattached = []
  const userattached = []

  const IAMGroups = params.Item.IAMGroups
  const IAMPolicies = params.Item.IAMPolicies

  for (let j = 0; j < Object.keys(IAMGroups).length; j++) {
    const onegroup = IAMGroups[j]
    const grouppolicyquery = {
      TableName: 'Logverz-Identities',
      ExpressionAttributeNames: {
        '#Name': 'Name',
        '#Type': 'Type'
      },
      KeyConditionExpression: '#Name = :groupname and #Type = :type',
      ExpressionAttributeValues: {
        ':groupname': onegroup,
        ':type': 'GroupAWS'
      }
    }

    const command = new QueryCommand(grouppolicyquery)
    var data = await docClient.send(command)
    const Policies = data.Items[0].Policies

    for (let k = 0; k < Object.keys(Policies.GroupInline).length; k++) {
      var onepolicy = Policies.GroupInline[k]
      groupinline.push(onepolicy) // JSON.parse(onepolicy).PolicyDocument
    }

    for (let l = 0; l < Object.keys(Policies.GroupAttached).length; l++) {
      var onepolicy = Policies.GroupAttached[l]
      groupattached.push(onepolicy) // JSON.parse(onepolicy).PolicyDocument
    }
  }

  for (let m = 0; m < Object.keys(IAMPolicies).length; m++) {
    var onepolicy = IAMPolicies[m]
    const policyquery = {
      TableName: 'Logverz-Identities',
      ExpressionAttributeNames: {
        '#Name': 'Name',
        '#Type': 'Type'
      },
      KeyConditionExpression: '#Name = :policyname and #Type = :type',
      ExpressionAttributeValues: {
        ':policyname': onepolicy,
        ':type': 'PolicyAWS'
      }
    }

    const command = new QueryCommand(policyquery)
    var data = await docClient.send(command)

    const policystring = JSON.stringify({
      PolicyName: data.Items[0].Name,
      PolicyDocument: data.Items[0].LatestVersion.Document.replace(/"/g, "'")
    })
    userattached.push(policystring)
  }

  if (groupattached.length > 0) {
    params.Item.Policies.GroupAttached = groupattached
  }
  if (groupinline.length > 0) {
    params.Item.Policies.GroupInline = groupinline
  }
  if (userattached.length > 0) {
    params.Item.Policies.UserAttached = userattached
  }

  return params
}

const UptadeAssociatedUserPolicy = async (_, docClient, QueryCommand, PutCommand, updateidentities) => {
  const usernames = _.uniqWith(_.map(updateidentities, u => {
    return {
      Name: u.Name,
      Type: u.Type
    }
  }), _.isEqual)
  const results = []

  for (let i = 0; i < usernames.length; i++) {
    var username = usernames[i].Name // "ME";
    var usertype = usernames[i].Type // "UserGoogle"

    const originalparams = {
      TableName: 'Logverz-Identities',
      ExpressionAttributeNames: {
        '#Name': 'Name',
        '#Type': 'Type'
      },
      KeyConditionExpression: '#Name = :username and #Type = :type',
      ExpressionAttributeValues: {
        ':username': username,
        ':type': usertype
      }
    }

    const command = new QueryCommand(originalparams)
    var userproperties = await docClient.send(command)

    console.log('User properties befor change:\n' + JSON.stringify(userproperties))
    const removeitemslist = _.compact(_.map(updateidentities, (u) => {
      if (u.Name === username & u.Operator !== '+') {
        return {
          RemoveType: u.RemoveType,
          RemoveValue: u.RemoveValue
        }
      }
    }))
    // remove the removed identity references such as policies and groups from the user

    for (let j = 0; j < removeitemslist.length; j++) {
      const item = removeitemslist[j]
      _.pull(userproperties.Items[0][item.RemoveType], item.RemoveValue)
    }

    const params = {
      TableName: 'Logverz-Identities',
      Item: {
        Name: username,
        Type: usertype,
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
    if (userproperties.Items[0].IAMPolicies.length > 0) {
      params.Item.IAMPolicies = userproperties.Items[0].IAMPolicies
    }
    if (userproperties.Items[0].IAMGroups.length > 0) {
      params.Item.IAMGroups = userproperties.Items[0].IAMGroups
    }

    const modifiedparams = await AssociateUserPolicies(docClient, QueryCommand, params)
    console.log(modifiedparams)
    const putcommand = new PutCommand(modifiedparams)
    const data = await docClient.send(putcommand)
    results.push(data)
  }
  return results
}

const retriveIAMidentities = async (_, docClient, QueryCommand, identitytype, idetityvalue, newIAMDB) => {
  const dataarray = []

  if (identitytype === 'IAMPolicies') {
    const policy = idetityvalue
    var params = {
      TableName: 'Logverz-Identities',
      ExpressionAttributeNames: {
        '#IAM': 'IAM'
      },
      KeyConditionExpression: '#IAM = :iam',
      ExpressionAttributeValues: {
        ':iam': 'true',
        ':policy': policy
      },
      FilterExpression: 'contains(IAMPolicies, :policy)',
      IndexName: 'IAMIndex'
    }
    const command = new QueryCommand(params)
    var data = await docClient.send(command)
    data.Items.forEach(d => dataarray.push(d))

    // check if changed policy is attached to a group
    const groupsattached = []

    newIAMDB.GroupDetailList.forEach(g => {
      if (g.AttachedManagedPolicies.map(p => p.PolicyName)[0] === policy) {
        groupsattached.push(g.GroupName)
        console.log(g.GroupName + " has policy '" + policy + "' attached")
        return g.GroupName
      }
    })

    // if attached to one or more group than get the users of those group (for generating new set of permissions at a later stage)
    if (groupsattached.length > 0) {
      for await (var group of groupsattached) {
        var params = {
          TableName: 'Logverz-Identities',
          ExpressionAttributeNames: {
            '#IAM': 'IAM'
          },
          KeyConditionExpression: '#IAM = :iam',
          ExpressionAttributeValues: {
            ':iam': 'true',
            ':group': group
          },
          FilterExpression: 'contains(IAMGroups, :group)',
          IndexName: 'IAMIndex'
        }
        const command = new QueryCommand(params)
        var data = await docClient.send(command)
        data.Items.forEach(d => dataarray.push(d))
      }
    }
  }

  if (identitytype === 'IAMGroups') {
    var group = idetityvalue
    var params = {
      TableName: 'Logverz-Identities',
      ExpressionAttributeNames: {
        '#IAM': 'IAM'
      },
      KeyConditionExpression: '#IAM = :iam',
      ExpressionAttributeValues: {
        ':iam': 'true',
        ':group': group
      },
      FilterExpression: 'contains(IAMGroups, :group)',
      IndexName: 'IAMIndex'
    }
    const command = new QueryCommand(params)
    var data = await docClient.send(command)
    data.Items.forEach(d => dataarray.push(d))
  }

  return dataarray
}

const authorizeS3access = (_, commonshared, userattributes, S3Foldersarray) => {
  let message = 'ok'

  for (let i = 0; i < S3Foldersarray.length; i++) {
    const s3path = 'arn:aws:s3:::' + S3Foldersarray[i].replace('s3://', '')
    const action = {
      Resource: s3path,
      Operation: 's3:GetObject'
    }
    const authorization = authorize(_, commonshared, action, userattributes)
    if (authorization.status !== 'Allow') {
      // request not authorized message is not "ok"
      message = authorization.Reason + ' for ' + S3Foldersarray[i]
      console.log(message)
      break
    }
  }

  return message
}

const retrieveresourcepolicy = async (docClient, QueryCommand, clientrequest, mode) => {
  if (clientrequest.TableName !== undefined && clientrequest.DatabaseName !== undefined) { // && clientrequest.DataType!==null
    var params = {
      TableName: 'Logverz-Queries',
      ExpressionAttributeNames: {
        '#TableName': 'TableName',
        '#DatabaseName': 'DatabaseName'
      },
      KeyConditionExpression: '#TableName = :TableValue and #DatabaseName = :DatabaseValue',
      ExpressionAttributeValues: {
        ':TableValue': clientrequest.TableName,
        ':DatabaseValue': clientrequest.DatabaseName
      }, //, ":DataType":clientrequest.DataType
      // FilterExpression: "contains(DataType, :DataType)",
      IndexName: 'TableName'
    }
  }
  else if (clientrequest.UnixTime !== undefined && clientrequest.UsersQuery !== undefined) {
    var params = {
      TableName: 'Logverz-Queries',
      ExpressionAttributeNames: {
        '#UnixTime': 'UnixTime',
        '#UsersQuery': 'UsersQuery'
      },
      KeyConditionExpression: '#UnixTime = :UnixTime and #UsersQuery = :UsersQuery',
      ExpressionAttributeValues: {
        ':UnixTime': clientrequest.UnixTime,
        ':UsersQuery': clientrequest.UsersQuery
      }
    }
  }
  else {
    console.error('parameters missing in the client request')
  }

  const command = new QueryCommand(params)
  const data = await docClient.send(command)

  // get the latest item.
  if (mode === 'Latest') {
    for (let i = 0; i < data.Items.length; i++) {
      const current = data.Items[i]
      if (i === 0) {
        var latest = current
      }
      else if (current.UnixTime > latest.UnixTime) {
        var latest = current
      }
    }
    var result = latest
  }
  else {
    var result = data
  }

  return result
}

const resourceaccessauthorization = async (_, docClient, QueryCommand, identities, queries, clientrequest, requestoridentity, region) => {
  var isowner = false
  var isadmin = false
  var ispoweruser = false
  var hasaccess = false
  const resourcepolicy = await getresourcepolicy(docClient, QueryCommand, queries, clientrequest)

  if (resourcepolicy !== null && resourcepolicy.length !== 0) {
    const Owners = resourcepolicy[0].Owners // .Owners.split(",");
    const Access = resourcepolicy[0].Access // .Access.split(",");
    var TableName = resourcepolicy[0].TableName

    var [isowner, hasaccess] = await Promise.all([
      userpermissionlookup(_, docClient, QueryCommand, Owners, identities, requestoridentity),
      userpermissionlookup(_, docClient, QueryCommand, Access, identities, requestoridentity)
    ])
  }
  else {
    var messagetablemissing = ' ' + clientrequest.TableName + ' tablename for ' + clientrequest.DatabaseName + ' database server, does not exists in the permission database.'
    // TODO add message to events that there is a table in the database that is not present in the permission db. stale or manually created etc.
  }

  if (isowner === false && clientrequest.Operation !== 'dynamodb:Query') {
    var [isadmin, ispoweruser] = await Promise.all([
      admincheck(_, docClient, QueryCommand, identities, requestoridentity),
      powerusercheck(_, docClient, QueryCommand, identities, requestoridentity, region)
    ])
  }

  // allow Logverz user to create Analysis record providing they have access/is owner to underlying table.
  if ((clientrequest.Payload !== undefined && clientrequest.Payload.QueryType !== undefined && clientrequest.Payload.QueryType === 'A') && (!(ispoweruser || isadmin))) {
    var isowner = await analysispermissioncheck(_, docClient, QueryCommand, identities, requestoridentity, clientrequest)
  }

  if ((clientrequest.Operation === 'dynamodb:Query') && (hasaccess || isowner || isadmin || ispoweruser)) {
    return {
      status: 'Allow',
      Reason: JSON.stringify(requestoridentity) + ' is owner,admin or poweruser or hasaccess to entry matching ' + JSON.stringify(clientrequest) + ' on TableName ' + TableName,
      TableName: clientrequest.TableName,
      DBName: clientrequest.DatabaseName
    }
  }
  else if ((clientrequest.Operation === 'dynamodb:DeleteItem' || clientrequest.Operation === 'dynamodb:PutItem') && (isowner || isadmin || ispoweruser)) {
    return {
      status: 'Allow',
      Reason: JSON.stringify(requestoridentity) + ' is owner, admin or poweruser to entry matching ' + JSON.stringify(clientrequest) + ' on TableName ' + TableName,
      TableName: clientrequest.TableName,
      DBName: clientrequest.DatabaseName
    }
  }
  else {
    return {
      status: 'Deny',
      Reason: JSON.stringify(requestoridentity) + '  not owner,admin,poweruser or hasaccess to entry matching the following request: ' + JSON.stringify(clientrequest) + '.' + messagetablemissing,
      TableName: clientrequest.TableName,
      DBName: clientrequest.DatabaseName
    }
  }
}

async function userpermissionlookup (_, docClient, QueryCommand, list, identities, requestoridentity) {
  let match = false

  for (let j = 0; j < list.length; j++) {
    const item = list[j]
    if (item.match('Group*')) {
      const Type = item.split(':')[1]
      const Identity = item.split(':')[0]
      var groupattributes = identities.chain().find({
        Type,
        Name: Identity
      }).data() // collection.data[0];
      if (groupattributes.length === 0) {
        var groupattributes = await getidentityattributes(docClient, QueryCommand, Identity, Type)
        groupattributes = groupattributes.Items[0]
        let groupmembers = await retriveIAMidentities(_, docClient, QueryCommand, 'IAMGroups', groupattributes.Name, '+')
        groupmembers = groupmembers.map(u => {
          return {
            Name: u.Name,
            Type: u.Type
          }
        })
        groupattributes.Members = groupmembers
        identities.insert(groupattributes)
      }
      else {
        groupattributes = groupattributes[0]
      }

      const result = _.find(groupattributes.Members, ['Name', requestoridentity.Name])
      if (result !== undefined) {
        match = true
        break
      }
    }
    else {
      const requestor = requestoridentity.Name + ':' + requestoridentity.Type
      if (requestor === item) {
        match = true
        break
      }
    }
  }
  return match
}

const admincheck = async (_, docClient, QueryCommand, identities, requestoridentity) => {
  var userattributes = identities.chain().find(requestoridentity).data()

  if (userattributes.length === 0) {
    var userattributes = await getidentityattributes(docClient, QueryCommand, requestoridentity.Name, requestoridentity.Type) // "admin"
    userattributes = userattributes.Items[0]
    identities.insert(userattributes)
  }
  else {
    userattributes = userattributes[0]
  }

  if (userattributes.Policies.UserAttached.length !== 0) {
    var adminuser = userattributes.Policies.UserAttached.map(p => JSON.parse(p).PolicyName === 'AdministratorAccess').includes(true)
  }
  if (userattributes.Policies.GroupAttached.length !== 0) {
    var adminGmember = userattributes.Policies.GroupAttached.map(p => JSON.parse(p).PolicyName === 'AdministratorAccess').includes(true)
  }

  if (adminuser === true || adminGmember === true) {
    var result = true
  }
  else {
    result = false
  }

  return result
}

const powerusercheck = async (_, docClient, QueryCommand, identities, requestoridentity, region) => {
  var userattributes = identities.chain().find(requestoridentity).data()

  if (userattributes.length === 0) {
    var userattributes = await getidentityattributes(docClient, QueryCommand, requestoridentity.Name, requestoridentity.Type) // "admin"
    userattributes = userattributes.Items[0]
    identities.insert(userattributes)
  }
  else {
    userattributes = userattributes[0]
  }
  // true or false
  return userattributes.IAMGroups.includes('LogverzPowerUsers' + '-' + region)
}

const usercheck = async (_, docClient, QueryCommand, identities, requestoridentity, region) => {
  var userattributes = identities.chain().find(requestoridentity).data()

  if (userattributes.length === 0) {
    var userattributes = await getidentityattributes(docClient, QueryCommand, requestoridentity.Name, requestoridentity.Type) // "admin"
    userattributes = userattributes.Items[0]
    identities.insert(userattributes)
  }
  else {
    userattributes = userattributes[0]
  }
  // true or false
  return userattributes.IAMGroups.includes('LogverzUsers' + '-' + region)
}

async function analysispermissioncheck (_, docClient, QueryCommand, identities, requestoridentity, clientrequest) {
  // analysis can only be created  if user has right to the table, Logverz users do not, and record with Permission attributes does not exists yet.
  // For Logverz Users we check if they have permission for the table that they wish to analyse if yes they can do so if not, then no.
  var result = false
  var clientrequest = {
    TableName: clientrequest.Payload.TableName,
    DatabaseName: clientrequest.Payload.DatabaseName,
    Operation: clientrequest.Operation
  }
  const resourcepolicy = await retrieveresourcepolicy(docClient, QueryCommand, clientrequest, 'Latest')

  if (resourcepolicy !== null && resourcepolicy.length !== 0) {
    const Owners = resourcepolicy.Owners // .split(",");
    const Access = resourcepolicy.Access // .split(",");
    const [isowner, hasaccess] = await Promise.all([
      userpermissionlookup(_, docClient, QueryCommand, Owners, identities, requestoridentity),
      userpermissionlookup(_, docClient, QueryCommand, Access, identities, requestoridentity)
    ])
    if (isowner || hasaccess) {
      var result = true
    }
  }

  return result
}

const getresourcepolicy = async (docClient, QueryCommand, queries, clientrequest) => {
  var resourcepolicy = queries.chain().find(clientrequest).data()

  if (resourcepolicy.length === 0) {
    const retrievedresourcepolicy = await retrieveresourcepolicy(docClient, QueryCommand, clientrequest, 'Latest')
    var resourcepolicy = []
    if (retrievedresourcepolicy !== undefined) {
      resourcepolicy.push(retrievedresourcepolicy)
      queries.insert(retrievedresourcepolicy)
    }
  }
  return resourcepolicy
}

const setIAMresource = (apicall, parameters, region, accountnumber) => {
  if (apicall.match('ListBucket')) {
    var resource = 'arn:aws:s3:::' + JSON.parse(parameters).Path.replace('s3://', '')
  }
  else if (apicall.match('Describe') || apicall.match('List') || apicall.match('GetGroup')) {
    var resource = null
  }
  else if (apicall.match('GetParameter')) {
    // arn:aws:ssm:ap-southeast-2:accountnumber:parameter/Logverz/*
    var ssmparameter = (JSON.parse(parameters)).Name
    var resource = `arn:aws:ssm:${region}:${accountnumber}:parameter` + ssmparameter
  }
  else if (apicall.match('StartDBInstance') || apicall.match('StopDBInstance')) {
    // arn:aws:rds:ap-southeast-2:accountnumber:db:llu8dvl0nswrom
    var ssmparameter = (JSON.parse(parameters)).DBInstanceIdentifier
    var resource = `arn:aws:rds:${region}:${accountnumber}:db:` + ssmparameter
  }
  else if (apicall.match('StartDBCluster') || apicall.match('StopDBCluster')) {
    // arn:aws:rds:ap-southeast-2:accountnumber:cluster:logverz-serverlessdb
    var ssmparameter = (JSON.parse(parameters)).DBClusterIdentifier
    var resource = `arn:aws:rds:${region}:${accountnumber}:cluster:` + ssmparameter
  }
  else if (apicall.match('SetDesiredCapacity')) {
    // Logverz-WebRTC-M84ERFHFUB6L-LogverzTurnSrvMultiITASG-5VZ4L629K4VY
    var ssmparameter = (JSON.parse(parameters)).AutoScalingGroupName
    var resource = ssmparameter
  }
  else {
    console.log('ERROR: setIAMresource: not specified api call (modify authenticationshared.js)')
  }

  return resource
}

export {
  getidentityattributes, authorize, AssociateUserPolicies, UptadeAssociatedUserPolicy, getuserstatements, allowdenyaction,
  retriveIAMidentities, retrieveresourcepolicy, authorizeS3access, resourceaccessauthorization, admincheck, powerusercheck,
  usercheck, setIAMresource
}

// export {
//   getidentityattributes
// }
// refactor httprelay to remove getuserstatements
// refactor httprelay to remove allowdenyaction
