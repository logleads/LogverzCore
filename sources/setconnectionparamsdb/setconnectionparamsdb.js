/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import _ from 'lodash'
import { generateKeyPairSync } from 'node:crypto'
import generator from 'generate-password'

import { SSMClient, GetParameterCommand, DeleteParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm'
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

var finalresult = {}
var results = []

const ListOfSSMKeys = {
  // these are the secure keys
  WebRTCProxyKey: '/Logverz/Logic/WebRTCProxyKey',
  DBpassword: 'LogverzDBSecretRef',
  TokenSigningPassphrase: [
    '/Logverz/Logic/Passphrase',
    '/Logverz/Logic/PrivateKey'
  ]
}

const ListOfSSMStandardKeys = {
  // these are the non secure keys
  RegistryName: '/Logverz/Database/Registry',
  TokenSigningPassphrase: [
    '/Logverz/Logic/PublicKey'
  ],
  TurnSrvPassword: '/Logverz/Settings/TurnSrvPassword'
}
const ListOftandardKeyNames = _.flatten(Object.values(ListOfSSMStandardKeys))

// Merge the secure keys and the non secure keys into one
_.mergeWith(ListOfSSMKeys, ListOfSSMStandardKeys, customizer)

console.log('start')

export const handler = async (event, context) => {
  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    var arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var commonsharedpath = ('file:///' + path.join(__dirname, './shared/commonsharedv3.js').replace(/\\/g, '/'))
    var commonshared = await GetConfiguration(commonsharedpath, '*')
    var LogverzDBSecretRef = requestpropertylookup(event, 'LogverzDBSecretRef')
    var Mode = requestpropertylookup(event, 'Mode')
    var RegistryNewValue = requestpropertylookup(event, 'RegistryNewValue')
    var RegistryName = requestpropertylookup(event, 'RegistryName')
    var requesttype = event.RequestType
    var maskedevent = commonshared.maskcredentials(JSON.parse(JSON.stringify(event)))
    console.log('THE EVENT: \n' + JSON.stringify(maskedevent) + '\n\n')
    console.log('context RECEIVED: ' + JSON.stringify(context))
  }
  else {
    // Dev environment settings
    var directory = path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'setconnectionparamsdb', 'mydev.mjs')
    const mydev = await import('file:///' + directory.replace(/\\/g, '/'))
    var region = mydev.region
    var commonshared = mydev.commonshared
    var LogverzDBSecretRef = mydev.LogverzDBSecretRef
    var event = mydev.event
    var context = mydev.context
    var requesttype = event.RequestType // Create,Update,Delete
    var Mode = requestpropertylookup(event, 'Mode') // "RegistryRequest"//"RetrieveSecret" ||"RegisterSecret"
    var RegistryNewValue = requestpropertylookup(event, 'RegistryNewValue')
    var RegistryName = requestpropertylookup(event, 'RegistryName') // "/Logverz/Database/Registry"
  }

  console.log('Mode: ' + Mode)
  console.log('RequestType: ' + requesttype)

  const ddclient = new DynamoDBClient({ region })
  const docClient = DynamoDBDocumentClient.from(ddclient)
  const ssmclient = new SSMClient({})

  if (Mode === 'RetrieveSecret') {
    var details = {
      source: 'setconnectionparamsdb.js:RetrieveSecret/getssmparameter',
      message: ''
    }
    var param = {
      Name: LogverzDBSecretRef,
      WithDecryption: true
    }

    try{
      var result = await commonshared.getssmparameter(ssmclient, GetParameterCommand, param, ddclient, PutItemCommand, details)
      finalresult = {
        Name: result.Parameter.Name,
        Value: result.Parameter.Value
      } 
    }
    catch(error){
      //happens eg at DB creation the value is not (yet) retrievable, that can be igonored  
      finalresult = {
        Nochange: 'Parameter retrieval failed'
      }
    }

  }
  else if (requesttype === 'Delete' && Mode === 'StackDelete') {
    // Enable code to run only in case of event of DB stack delete.
    var registrynewobject = convertstringtoobject(RegistryNewValue)
    var databases = await getdbRegistryentries(ssmclient, GetParameterCommand, ddclient, PutItemCommand, commonshared, RegistryName)
    var LogverzDBSecretRef = ''
    var found = false
    for (const item in databases) {
      var db = databases[item]
      var dbobject = convertstringtoobject(db)

      if ((dbobject.LogverzDBFriendlyName === registrynewobject.LogverzDBFriendlyName) && (dbobject.LogverzDBEndpointName === registrynewobject.LogverzDBEndpointName)) {
        var found = true
        var indexToRemove = item
        var numberToRemove = 1
        databases.splice(indexToRemove, numberToRemove)
        console.log('\n\nDeleting Registry value: ' + JSON.stringify(dbobject))
        // Deleting here the secret reference
        LogverzDBSecretRef = dbobject.LogverzDBSecretRef

        var details = {
          source: 'setconnectionparamsdb.js:StackDelete/getssmparameter',
          message: ''
        }
        var param = {
          Name: LogverzDBSecretRef,
          WithDecryption: true
        }
        var result = await commonshared.getssmparameter(ssmclient, GetParameterCommand, param, ddclient, PutItemCommand, details)

        if (typeof (result) === 'object') {
          // if exists deleting corresponding password //DELETE
          await SetSSMParameter(commonshared, ddclient, ssmclient, 'null', LogverzDBSecretRef, requesttype)
          console.log('\n\nDeleted Password key: ' + LogverzDBSecretRef)
        }

        // TODO add here code to list and  remove the associated users from the IAM group of the database:
        // example Logverz-DBGroup-DBNAME-REGION as if group contains members CloudFormation stack deletion fails.

        break
      }
    } // end of for in cycle

    if (found === true) {
      var parametervalue = ''
      for (const item in databases) {
        parametervalue += databases[item] + '[[DBDELIM]]'
      }

      console.log('\n\nFinal Registry value: ' + parametervalue)
      var parametername = RegistryName
      if (parametervalue !== '') {
        // deleting individual entries from the DB registry
        var result = await SetSSMParameter(commonshared, ddclient, ssmclient, parametervalue, parametername, 'Update')
        console.log("Parameter '" + parametername + "' request '" + requesttype + "' has been completed.\nNewVersion: " + result.Version)
        finalresult = {
          Parameter: parametername,
          NewVersion: result.Version,
          Request: requesttype
        }
      }
      else {
        // in case the last (default db) delete the parameter can be deleted
        var result = await SetSSMParameter(commonshared, ddclient, ssmclient, parametervalue, parametername, 'Delete')
        console.log("Parameter '" + parametername + "' request '" + requesttype + "' has been completed.\nOutput: " + JSON.stringify(result))
        finalresult = {
          Parameter: parametername,
          NewVersion: JSON.stringify(result),
          Request: requesttype
        }
      }
    }
    else {
      finalresult = {
        Nochange: 'Parameter has been deleted/updated prior'
      }
    }
  }
  else if (requesttype === 'Delete' && Mode === 'RegistryRequest') {
    //console.log(RegistryNewValue + '\n\nresource was deleted. Either due to scalling activity or cloudformation stack delete.')
    console.log('Cloudformation replacing SetDBConnectionResource')
    finalresult = {
      Nochange: 'Parameter has been deleted/updated prior'
    }
  }
  else if (requesttype === 'Delete' && Mode === 'RegisterSecret') {
    console.log('Cloudformation replacing SetDBConnectionResource')
    finalresult = {
      Nochange: 'Parameter has been deleted/updated prior'
    }
  }
  else if (Mode === 'RegistryRequest') {
    // Create and update  SSM DB Registry value(s).
    var registrynewobject = convertstringtoobject(RegistryNewValue)
    _.unset(registrynewobject, '[[DBDELIM]]')
    var databases = await getdbRegistryentries(ssmclient, GetParameterCommand, ddclient, PutItemCommand, commonshared, RegistryName)

    var missing = true
    for (const item in databases) {
      var db = databases[item]
      var dbobject = convertstringtoobject(db)
      var changed = false

      if (dbobject.LogverzDBFriendlyName === registrynewobject.LogverzDBFriendlyName) {
        var missing = false
        if (Object.keys(dbobject).length !== Object.keys(registrynewobject).length) {
          // in case a new property is introduced in the DB connectionstring.
          changed = true
          var result = compareobjectprops(registrynewobject, dbobject, [])
          console.log(result)
        }
        else {
          for (const property in dbobject) {
            var newvalue = registrynewobject[property]
            var oldvalue = dbobject[property]

            if (oldvalue !== newvalue) {
              console.log(property + ' old: ' + oldvalue + '     new: ' + newvalue + ' <=CHANGED')
              changed = true
              dbobject[property] = newvalue
            }
          }
        }
      }

      if (changed === true) {
        var newdbstring = convertobjecttostring(dbobject)
        databases[item] = newdbstring
      }
    } // end of for in cycle

    if (missing) {
      // if db does not exists in the registry.
      var connectionstringsarray = RegistryNewValue.split('[[DBDELIM]]')
      var RegistryNewValue = _.reject(connectionstringsarray, _.isEmpty)
      var dbobject = convertstringtoobject(RegistryNewValue[0])
      console.log('\n\nNew Registry value: ' + JSON.stringify(dbobject))
      databases.push(RegistryNewValue[0])
      await createsystemtablepermission(docClient, PutCommand, 'ProcessingErrors', dbobject.LogverzDBFriendlyName, region)
      await createsystemtablepermission(docClient, PutCommand, 'Invocations', dbobject.LogverzDBFriendlyName, region)
    }

    var parametervalue = ''
    for (const item in databases) {
      parametervalue += databases[item] + '[[DBDELIM]]'
      // parametervalue+=databases[item]+","+"[[DBDELIM]]" one version of ui fix
    }
    console.log('\n\nFinal Registry value: ' + parametervalue)
    var parametername = RegistryName

    var result = await SetSSMParameter(commonshared, ddclient, ssmclient, parametervalue, parametername, requesttype)
    console.log("Parameter '" + parametername + "' request '" + requesttype + "' has been completed.\nNewVersion: " + result.Version)
    finalresult = {
      Parameter: parametername,
      NewVersion: result.Version,
      Request: requesttype
    }
  }
  else if (Mode === 'RegisterSecret') {
    var actionitems = []

    for (const property in event.ResourceProperties) {
      var propertyvalue = event.ResourceProperties[property]

      if (ListOfSSMKeys[property] === undefined) {
        // its not an SSM propert but something else like  ServiceToken or Mode.
        continue
      }
      else if (property === 'DBpassword') {
        var Names = [event.ResourceProperties.LogverzDBSecretRef]
      }
      else {
        var Names = _.flatten([ListOfSSMKeys[property]])
      }

      var parametercheckresults = await checkparameters(ssmclient, GetParameterCommand, ddclient, PutItemCommand, commonshared, Names)

      if ((parametercheckresults.InvalidParameters.length !== 0) && (requesttype !== 'Delete')) {
        // generate all missing parameters
        actionitems.push(generateSSMkeys(property, propertyvalue, event.ResourceProperties))
      }
      else if (parametercheckresults.Parameters.length !== 0) {
        // compare the two and if new propertychanged update it
        var propertycomparisonresult = ispropertysame(event, property, parametercheckresults)

        if ((propertyvalue !== 'autogeneratedkey') && (propertycomparisonresult !== true)) {
          console.log(`${property} property has changed.`)

          if (property === 'TokenSigningPassphrase') {
            actionitems.push(generateSSMkeys(property, propertyvalue, event.ResourceProperties))
          }
          else {
            var changedobject = {}
            var ssmkey = ListOfSSMKeys[property]
            if (ssmkey === 'LogverzDBSecretRef') {
              ssmkey = event.ResourceProperties.LogverzDBSecretRef
              changedobject[ssmkey] = event.ResourceProperties.DBpassword
            }
            else {
              changedobject[ssmkey] = generateSSMkeys(property, propertyvalue, event.ResourceProperties)
            }
            actionitems.push(changedobject)
          }
        }
      }
    }

    actionitems = _.flatten(actionitems)
    for await (var variable of actionitems) {
      var parametername = Object.keys(variable)[0]
      var parametervalue = variable[parametername]

      var details = {
        source: 'setconnectionparamsdb.js:RegisterSecret/setssmparameter',
        message: ''
      }
      var ssmparams = {
        Name: parametername,
        Value: parametervalue,
        Tier: 'Standard',
        Type: 'SecureString',
        Overwrite: true
      }

      if (ListOftandardKeyNames.includes(parametername)) {
        ssmparams.Type = 'String'
      }

      var result = await commonshared.setssmparameter(ssmclient, PutItemCommand, PutParameterCommand, ssmparams, ddclient, details)

      console.log("Parameter '" + parametername + "' Add/Modify request has been completed.")
      var object = {}
      object[parametername] = {
        Parameter: parametername,
        NewVersion: result.Version
      }
      results.push(object)
    }

    finalresult = convertresultstoobject(results)
  }

  var i = 1
  var waittime = 1000
  var exitcondition = false
  do {
    await timeout(waittime)

    console.log('waiting for data retrieval/operation ' + (i * (waittime / 1000)) + ' sec.')

    if (context.getRemainingTimeInMillis() < 5000) {
      // send this before function timeout.
      console.log('the remaining time:' + context.getRemainingTimeInMillis())
      /* eslint brace-style: ["error", "stroustrup"] */
      return await commonshared.newcfnresponse(event, context, 'FAILED', {})
    }
    // eslint-disable-next-line eqeqeq
    else if (finalresult != {}) {
      exitcondition = true
      // return response(event, context, 'SUCCESS', finalresult)
      return await commonshared.newcfnresponse(event, context, 'SUCCESS', {})
    }
    i++
  }
  while (!exitcondition)
}

async function createsystemtablepermission (docClient, PutCommand, type, DBName, region) {
  var tableentry = {
    UsersQuery: 'Logverz:System',
    UnixTime: (Date.now() / 1000 | 0 + Math.floor(Math.random() * 100)), // ading few random seconds so that the two tables are not created at the same time
    DataType: type,
    Owners: [
      'LogverzPowerUsers' + '-' + region + ':GroupAWS'
    ],
    DatabaseName: DBName,
    Access: [
      'LogverzUsers' + '-' + region + ':GroupAWS'
    ],
    QueryName: type,
    QueryType: 'C',
    TableName: type,
    QuerySettings: {
      ComputeEnvironment: '',
      Description: '',
      QueryString: '',
      JobID: '',
      StgFolders: ''
    },
    Active: true
  }

  var params = {
    TableName: 'Logverz-Queries',
    Item: {}
  }
  params.Item = tableentry

  const putcommand = new PutCommand(params)
  const dynamodbresult = await docClient.send(putcommand)
  return dynamodbresult
}

async function checkparameters (ssmclient, GetParameterCommand, ddclient, PutItemCommand, commonshared, Names) {
  // check here if value exists if missing,put parameter to new variables list if exists check if new value is different or not if different then update it.
  var details = {
    source: 'setconnectionparamsdb.js:RegisterSecret/getssmparameter',
    message: ''
  }
  var parametercheckresults = {
    InvalidParameters: [],
    Parameters: []
  }
  for await (var OneName of Names) {
    var param = {
      Name: OneName,
      WithDecryption: true
    }

    var result = await commonshared.getssmparameter(ssmclient, GetParameterCommand, param, ddclient, PutItemCommand, details)
    if (typeof (result) === 'string') {
      // there was an error retrieving the parameter
      parametercheckresults.InvalidParameters.push(OneName)
      console.log('The parameter will be created.')
    }
    else {
      parametercheckresults.Parameters.push(result)
    }
  }

  return parametercheckresults
}

async function getdbRegistryentries (ssmclient, GetParameterCommand, ddclient, PutItemCommand, commonshared, RegistryName) {
  var details = {
    source: 'setconnectionparamsdb.js:getdbRegistryentries/getssmparameter',
    message: ''
  }

  var param = {
    Name: RegistryName,
    WithDecryption: false
  }
  var existingssmparameter = await commonshared.getssmparameter(ssmclient, GetParameterCommand, param, ddclient, PutItemCommand, details)
  var registrycurrentvalue = existingssmparameter.Parameter.Value.replace('placeholder', '')
  var connectionstringsarray = registrycurrentvalue.split('[[DBDELIM]]')
  var databases = _.reject(connectionstringsarray, _.isEmpty)
  return databases
}

function generateSSMkeys (property, propertyvalue, ResourceProperties) {
  var newvariables = []

  if (property === 'WebRTCProxyKey') {
    if (propertyvalue === 'autogeneratedkey') {
      var randomnumber = randomIntFromInterval(26, 34)
      var WebRTCProxyKey = generator.generate({
        length: randomnumber,
        numbers: true,
        symbols: true,
        lowercase: true,
        uppercase: true
      })
    }
    else {
      WebRTCProxyKey = propertyvalue
    }
    newvariables.push({
      '/Logverz/Logic/WebRTCProxyKey': WebRTCProxyKey
    })
  }
  else if (property === 'DBpassword') {
    // Add here auto generate mode.
    if (propertyvalue === 'autogeneratedkey') {
      var randomnumber = randomIntFromInterval(26, 34)
      var DBpassword = generator.generate({
        length: randomnumber,
        numbers: true,
        symbols: true,
        lowercase: true,
        uppercase: true
      })
    }
    else {
      DBpassword = propertyvalue
    }

    var obj = {}
    var LogverzDBSecretRef = ResourceProperties.LogverzDBSecretRef
    obj[LogverzDBSecretRef] = DBpassword
    console.log('Configuring new database ssm password parameter.  Adding it to the list of added/modified keys.')
    newvariables.push(obj)
  }
  else if (property === 'TokenSigningPassphrase') {
    var TokenSigningPassphrase
    if (propertyvalue === 'autogeneratedkey') {
      // generate random number between intervall:
      var randomnumber = randomIntFromInterval(26, 34)
      var password = generator.generate({
        length: randomnumber,
        numbers: true,
        symbols: true,
        lowercase: true,
        uppercase: true,
        // eslint-disable-next-line no-useless-escape
        exclude: "`$&()\|\";'<>?"
        // https://community.arubanetworks.com/browse/articles/blogviewer?blogkey=63217b24-a024-4e71-977b-e9f8c338b509
      })
      TokenSigningPassphrase = password
    }
    else {
      TokenSigningPassphrase = propertyvalue
    }

    var autogeneratedkeys = generateKeys(TokenSigningPassphrase)
    console.log('Configuring new keypair with the provided TokenSigningPassphrase. Adding those to the list of added/modified keys.')

    newvariables.push({
      '/Logverz/Logic/Passphrase': TokenSigningPassphrase
    })
    newvariables.push({
      '/Logverz/Logic/PrivateKey': autogeneratedkeys.private
    })
    newvariables.push({
      '/Logverz/Logic/PublicKey': autogeneratedkeys.public
    })
  }
  else if (property === 'TurnSrvPassword') {
    // Add here auto generate mode.
    if (propertyvalue === 'autogeneratedkey') {
      var randomnumber = randomIntFromInterval(26, 34)
      var TurnSrvPassword = generator.generate({
        length: randomnumber,
        numbers: true,
        symbols: true,
        lowercase: true,
        uppercase: true
      })
    }
    else {
      TurnSrvPassword = propertyvalue
    }
    newvariables.push({
      '/Logverz/Settings/TurnSrvPassword': TurnSrvPassword
    })
  }
  return newvariables
}

function convertstringtoobject (string) {
  var propertyarray = _.reject(string.split(','), _.isEmpty)
  var propertyobject = {}

  // Objectifiy string for easier handling. 'LogverzDBSecretRef=/Logverz/Database/DefaultDBPassword'  => '{"LogverzDBSecretRef":"/Logverz/Database/DefaultDBPassword"}'
  for (const item in propertyarray) {
    var property = propertyarray[item]
    var oname = property.split('=')[0]
    var ovalue = property.split('=')[1]
    propertyobject[oname] = ovalue
  }
  return propertyobject
}

function convertobjecttostring (dbobject) {
  var propertystring = ''
  for (const item in dbobject) {
    propertystring += item + '=' + '' + dbobject[item] + ','
  }

  // TODO fix ui connection indicator server  list not to require the trailing ',' ,after that bellow can be uncommented.
  // propertystring=propertystring.substring(0, propertystring.length - 1);

  // console.log(propertystring)
  return propertystring
}

function convertresultstoobject (results) {
  // lambda custom resource does not accept array as a response only objects
  // Invalid Response object: Value of property Data must be an object

  finalresult = {}
  // eslint-disable-next-line array-callback-return
  results.map(r => {
    var key = Object.keys(r)[0]
    finalresult[key] = r[key]
  })
  return finalresult
}

function generateKeys (passphrase) {
  // generating public and private key:
  // kudos: https://stackoverflow.com/questions/8750780/encrypting-data-with-public-key-in-node-js
  const {
    privateKey,
    publicKey
  } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: {
      type: 'pkcs1',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs1',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase
    }
  })

  // console.log("The public key is:\n\n", publicKey);
  // console.log("The private key is:\n\n",privateKey);
  var keys = {
    private: privateKey,
    public: publicKey
  }
  return keys
}

async function SetSSMParameter (commonshared, ddclient, ssmclient, parametervalue, parametername, requesttype) {
  parametervalue = parametervalue.replace(/"/g, '')
  parametername = parametername.replace(/"/g, '')
  requesttype = requesttype.replace(/"/g, '')

  var isstandardstring = _.includes(_.flatten(Object.values(ListOfSSMStandardKeys)), parametername)

  if (requesttype === 'Delete') {
    var params = {
      Name: parametername
    }

    const command = new DeleteParameterCommand(params)
    return await ssmclient.send(command)
  }
  else {
    if (isstandardstring === false) {
      var params = {
        Name: parametername,
        Type: 'SecureString',
        Value: parametervalue,
        Description: '.',
        Overwrite: true,
        Tier: 'Standard'
      }
    }
    else {
      var params = {
        Name: parametername,
        Type: 'String',
        Value: parametervalue,
        Description: '.',
        Overwrite: true,
        Tier: 'Standard'
      }
    }

    var details = {
      source: 'setconnectionparamsdb.js:main/setssmparameter',
      message: ''
    }
    return await commonshared.setssmparameter(ssmclient, PutItemCommand, PutParameterCommand, params, ddclient, details)
  }
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function randomIntFromInterval (min, max) { // min and max included
  // kudos: https://stackoverflow.com/questions/4959975/generate-random-number-between-two-numbers-in-javascript
  return Math.floor(Math.random() * (max - min + 1) + min)
}

function compareobjectprops (newData, oldData, result) {
  // kudos:  https://stackoverflow.com/questions/41981969/javascript-lodash-deep-comparison-of-two-objects
  Object.keys(newData).forEach(function (k) {
    if (typeof newData[k] !== 'object') {
      if (newData[k] !== oldData[k]) {
        this.push({
          new: newData[k],
          old: oldData[k]
        })
      }
    }
    else {
      compareobjectprops(newData[k], oldData[k], this)
    }
  }, result)

  return result
}

function customizer (objValue, srcValue) {
  if (_.isArray(objValue)) {
    return objValue.concat(srcValue)
  }
}

function requestpropertylookup (event, property) {
  var value
  try {
    value = event.ResourceProperties[property]
  }
  catch (err) {
    console.log('error at function requestproperty lookup:')
    console.error(err)
  }
  return value
}

function ispropertysame (event, property, parametercheckresults) {
  var result = false
  // if its an update the OldResourceProperties will exists
  if (event.OldResourceProperties !== undefined) {
    var oldpropertyvalue = event.OldResourceProperties[property]

    if (oldpropertyvalue === event.ResourceProperties[property]) {
      result = true
    }
  }
  else {
    // sometime there is property left over (example failed previous deplyoment) than we need to check the parameter store results
    result = parametercheckresults.Parameters.map(p => {
      return Object.values(p.Parameter).includes(event.ResourceProperties[property])
    })[0]
    console.log(result)
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
