/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */
var AWS = require('aws-sdk')
const s3 = new AWS.S3()
var path = require('path')
var jp = require('jsonpath')
// const { toString, result } = require('lodash');
var _ = require('lodash')
const { filter } = require('lodash')

module.exports.handler = async function (event, context) {

  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    console.log('REQUEST RECEIVED: \n' + JSON.stringify(context) + '\n\n')
    console.log('THE EVENT: \n' + JSON.stringify(event) + '\n\n')
    var arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var commonshared = require('./shared/commonshared')
    var InitBucket = process.env.InitBucket
    // var cert =process.env.PublicKey;
  }
  else {
    // Dev environment settings
    const mydev = require(path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'transform', 'mydev.js'))
    var region = mydev.region //"ap-south-2" hyderabad does not support serverless at present 
    var commonshared = mydev.commonshared
    var event = mydev.event
    var InitBucket = mydev.InitBucket
  }

  var InfoPolicySid = "DenySSMSecureStringAccessUsingKMS" 

  AWS.config.update({
    region
  }) 

  var rds = new AWS.RDS({
    apiVersion: '2014-10-31'
  })

  var kms = new AWS.KMS();

  var template = await main(event, rds, kms, commonshared, InitBucket, InfoPolicySid)

  var result = {
    requestId: event.requestId,
    status: 'success',
    fragment: template
  }

  return result
}

async function main (event, rds, kms, commonshared, InitBucket,InfoPolicySid) {
  console.log('main')

  // TODO refactor/ parameterise use cases
  if (event.fragment.Metadata.stackname === 'Logverz-Engine') {
    var [enginecontent, customcontent] = await Promise.all([
      await commonshared.S3GET(s3, InitBucket, 'templates/Logverz-Engine.json'),
      await commonshared.S3GET(s3, InitBucket, 'templates/Logverz-CustomConfig.json')
    ])

    var engine = JSON.parse(enginecontent.Body.toString('utf8'))
    var engine = setcontrollersandqueue(event, engine)

    if (customcontent.code !== 'NoSuchKey') {
      var customconfig = JSON.parse(customcontent.Body.toString('utf8'))
      if (customconfig.Metadata.Merge.LogverzEngine !== undefined) {
        var customconfigmerge = customconfig.Metadata.Merge.LogverzEngine
        var engine = mergecustomproperties(engine, customconfigmerge)
      }
      if ((customconfig.Metadata.Remove !== undefined) && (customconfig.Metadata.Remove.LogverzEngine !== undefined)) {
        var customconfig = customconfig.Metadata.Remove.LogverzEngine
        var engine = removecustomproperties(engine, customconfig)
      }
    }
    console.log('The resulting template:\n')
    console.log(JSON.stringify(engine))

    var result = engine
    return result
  }
  else if (event.fragment.Metadata.stackname === 'Logverz-Logic') {

    var [logiccontent, customcontent,specifickeymskeys] = await Promise.all([
      await commonshared.S3GET(s3, InitBucket, 'templates/Logverz-Logic.json'),
      await commonshared.S3GET(s3, InitBucket, 'templates/Logverz-CustomConfig.json'),
      await getspecifickeyalias(kms)
    ])
    
    //Looks up KMS default key for aws/ssm and set resource id in Logverz-Logic.json LogverzInfoPolicy resource:
    //DenySSMSecureStringAccessUsingKMS sid. So that it only blocks that resource usage. 

    var awsssmkey=specifickeymskeys.filter(a => a.AliasName === "alias/aws/ssm")[0]
    var arn=awsssmkey.AliasArn.replace(awsssmkey.AliasName,"")+"key/"+awsssmkey.TargetKeyId

    var logic = JSON.parse(logiccontent.Body.toString('utf8'))
    var InfoPolicystatements=logic.Resources.LogverzInfoPolicy.Properties.PolicyDocument.Statement
    var DenySSMIndex = InfoPolicystatements.findIndex(x =>x.Sid ===InfoPolicySid)
    var originalstatement=InfoPolicystatements[DenySSMIndex]
        originalstatement.Resource = arn
        logic.Resources.LogverzInfoPolicy.Properties.PolicyDocument.Statement[DenySSMIndex]=originalstatement
    
    if (customcontent.code !== 'NoSuchKey') {
      var customconfig = JSON.parse(customcontent.Body.toString('utf8'))

      if (customconfig.Metadata.Merge.LogverzLogic !== undefined) {
        var customconfigmerge = customconfig.Metadata.Merge.LogverzLogic
        var logic = mergecustomproperties(logic, customconfigmerge)
      }
      if ((customconfig.Metadata.Remove !== undefined) && (customconfig.Metadata.Remove.LogverzLogic !== undefined)) {
        var customconfig = customconfig.Metadata.Remove.LogverzLogic
        var logic = removecustomproperties(logic, customconfig)
      }
    }
    console.log('The resulting template:\n')
    console.log(JSON.stringify(logic))

    var result = logic
    return result
  }
  else if (event.fragment.Metadata.stackname === 'Logverz-ExternalDB' || event.fragment.Metadata.stackname === 'Logverz-DefaultDB') {
    

    var DBInstanceClass = event.templateParameterValues.DBInstanceClass
    var DBEngineType = event.templateParameterValues.DBEngineType
    var DBdeploymentMethod = event.templateParameterValues.DBDeploymentMethod
    var DBPrincipalProperty=event.templateParameterValues.DBPrincipalProperty

    var dbconfig = await verifydeploymentconfigavailability(rds,event, DBdeploymentMethod, DBEngineType, DBInstanceClass, DBPrincipalProperty)

    if (DBEngineType === 'postgres' || DBEngineType === 'mysql') {
 
      mergedbproperties(event,dbconfig)
      
      event.fragment.Transform = ['LogverzTransform', 'AWS::Serverless-2016-10-31']
      return event.fragment
    }
    else if (DBEngineType.match('sqlserver-')) {
      
      var storagesize = event.templateParameterValues.DBAllocatedStorage

      if (storagesize < 20) {
        var storagesize = 20
        console.log('for MSSQL the minimum storage size is 20GB, bumping to 20GB')
      }

      mergedbproperties(event,dbconfig)
      event.templateParameterValues.DBAllocatedStorage = storagesize
      event.fragment.Transform = ['LogverzTransform', 'AWS::Serverless-2016-10-31']
      return event.fragment
    }
    else {
      console.log('unknown case not postgres, sqlserver-XX, or mysql')
      return event.fragment
    }
    
  }
  else if (event.fragment.Metadata.stackname === 'Logverz-TurnSrv') {
    var [adsrvcontent, customcontent] = await Promise.all([
      await commonshared.S3GET(s3, InitBucket, 'templates/Logverz-TurnSrv.json'),
      await commonshared.S3GET(s3, InitBucket, 'templates/Logverz-CustomConfig.json')
    ])

    var turnsrv = JSON.parse(adsrvcontent.Body.toString('utf8'))
    if (customcontent.code !== 'NoSuchKey') {
      var customconfig = JSON.parse(customcontent.Body.toString('utf8'))

      if (customconfig.Metadata.Merge.LogverzTurn !== undefined) {
        var customconfigmerge = customconfig.Metadata.Merge.LogverzTurn
        var turnsrv = mergecustomproperties(turnsrv, customconfigmerge)
      }
      if ((customconfig.Metadata.Remove !== undefined) && (customconfig.Metadata.Remove.LogverzTurn !== undefined)) {
        var customconfig = customconfig.Metadata.Remove.LogverzTurn
        var turnsrv = removecustomproperties(turnsrv, customconfig)
      }
    }
    console.log('The resulting template:\n')
    console.log(JSON.stringify(turnsrv))

    var result = turnsrv
    return result
  }
  else {
    console.log('The resulting template:\n')
    console.log(JSON.stringify(event.fragment))

    var result = event.fragment
    return result
  }
}

function removecustomproperties (template, customconfig) {
  for (var i = 0; i < Object.keys(customconfig).length; i++) {
    var resourcename = Object.keys(customconfig)[i]

    // TODO make this recursive to work with any number of depth.
    if (Object.keys(customconfig[resourcename]).length > 0) {
      for (var j = 0; j < Object.keys(customconfig[resourcename]).length; j++) {
        var propertyname = Object.keys(customconfig[resourcename])[j]
        delete template.Resources[resourcename][propertyname]
      }
    }
    else {
      delete template.Resources[resourcename]
    }
  }
  console.log('finished with removing resources')
  return template
}

function mergecustomproperties (template, customconfig) {
  for (var i = 0; i < Object.keys(customconfig).length; i++) {
    var resourcename = Object.keys(customconfig)[i]
    if (template.Resources[resourcename] !== undefined) {
      // resource exists merge properties
      // _.merge(template.Resources[resourcename],customconfig[resourcename]);
      _.mergeWith(template.Resources[resourcename], customconfig[resourcename], customizer)
    }
    else {
      // resource does not exists add properties
      jp.value(template, `$.Resources.${resourcename}`, customconfig[resourcename])
    }
  }
  console.log('finished with merging custom changes')
  return template
}

function setcontrollersandqueue (event, engine) {
  // ads number of controllers, sqs queues and configures the SSMControllersList parameter.
  var NumberOfControllers = event.templateParameterValues.NumberOfControllers
  var queuepolicies = []
  var substituted = ''
  var subsituter = {}
  var fnsub = []

  for (var i = 0; i < NumberOfControllers.split('/').length; i++) {
    var controllernumber = NumberOfControllers.split('/')[i]
    if (i === 0) {
      var type = 'S'
      var size = 'BUILD_GENERAL1_SMALL'
    }
    else if (i === 1) {
      var type = 'M'
      var size = 'BUILD_GENERAL1_MEDIUM'
    }
    else if (i === 2) {
      var type = 'L'
      var size = 'BUILD_GENERAL1_LARGE'
    }

    for (var j = 0; j < controllernumber; j++) {
      const controllername = 'LogverzController' + type + j
      const messagequename = 'LogverzMessageQueue' + type + j
      // use blueprint to create new resource and modify resource names
      const LogverzMessageQueue = engine.Metadata.ResourceBluePrint.LogverzMessageQueue
      const LogverzController = engine.Metadata.ResourceBluePrint.LogverzController
      // eslint-disable-next-line no-template-curly-in-string
      LogverzController.Properties.Name['Fn::Sub'] = '${AWS::StackName}-Controller-' + type + j
      LogverzController.Properties.Environment.ComputeType = size
      LogverzMessageQueue.Properties.QueueName = messagequename + '.fifo'

      // Add new controller and queue to the template
      // Kudos:https://stackoverflow.com/questions/56052352/javascript-variable-changing-value-after-changes-in-original-variable
      engine.Resources[controllername] = JSON.parse(JSON.stringify(LogverzController))
      engine.Resources[messagequename] = JSON.parse(JSON.stringify(LogverzMessageQueue))

      // add new queue to the list to be added at then end of function.
      queuepolicies.push({
        Ref: messagequename
      })

      // Create the SSMControllersList components
      substituted += '${' + controllername + '}=${' + messagequename + '}<!!>'
      subsituter[controllername] = {
        Ref: controllername
      }
      subsituter[messagequename] = {
        Ref: messagequename
      }
    } // j
  } // i

  engine.Resources.LogverzQueuesPolicy.Properties.Queues = engine.Resources.LogverzQueuesPolicy.Properties.Queues.concat(queuepolicies)

  substituted = substituted.substring(0, substituted.lastIndexOf('<!!>'))

  fnsub.push(substituted)
  fnsub.push(subsituter)

  engine.Resources.SSMControllersList.Properties.Value['Fn::Sub'] = fnsub

  return engine
}

async function DescribeDBEngineVersions (rds, rdsParams) {
  var promisedresult = new Promise((resolve, reject) => {
    rds.describeDBEngineVersions(rdsParams, function (err, data) {
      if (err) {
        console.error(err)
        reject(err)
      }
      else {
        console.log('Successfully retrieved rds versions')
        resolve(data)
      }
    })
  })

  var result = await promisedresult
  return result
}

async function DescribeOrderableDBInstanceOptions (rds, rdsParams) {
  var promisedresult = new Promise((resolve, reject) => {
    rds.describeOrderableDBInstanceOptions(rdsParams, function(err, data) {
      if (err) {
        console.log(err, err.stack); // an error occurred
        reject(err)
      }
      else{
        //console.log(data);           // successful response
        console.log('Successfully retrieved rds instance options')
        resolve(data)
      }
    });
  })

  var result = await promisedresult
  return result
}

async function getvalidmssqlconfig (rds, DBInstanceClass, DBEngineType) {

  //Microsoft SQL server has various version and editions combined with various AWS AWS instance families and generations in each family results in a lot of exceptions. 
  //Bellow are the cases found sofare.

  switch (DBEngineType) {
    case 'sqlserver-ex':

      switch (DBInstanceClass) {
        case (DBInstanceClass.match(/db.t2.micro|db.t2.small|db.t2.medium/) || {}).input:
          console.log('Express edition on T2 micro/small/medium instances are only suported with SQL 2017, (not SQL 2019), setting SQL2017')
          console.log('https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_SQLServer.html#SQLServer.Concepts.General.VersionSupport')
          
          var rdsParams = {
            DefaultOnly: true,
            Engine: DBEngineType,
            Filters: [
              {
                Name: 'engine-version', 
                Values: [
                  '14.00'
                ]
              }
            ]
          }
          break
        case (DBInstanceClass.match(/db.t2.large|db.t2.xlarge/) || {}).input:

          console.log('Express edition on T2 large and xlarge instances are not supported at all. switching to T3')
          console.log('https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_SQLServer.html#SQLServer.Concepts.General.VersionSupport')
          
          var rdsParams = {
            DefaultOnly: true, // || false
            Engine: DBEngineType
          }
          var DBInstanceClass = DBInstanceClass.replace('t2', 't3')
          
          break
        case (DBInstanceClass.match(/db.t3.micro|db.t3.small|db.t3.medium|db.t3.large|db.t3.2xlarge/) || {}).input:
          
          if (DBInstanceClass.match('db.t3.2xlarge')) {
            var DBInstanceClass = DBInstanceClass.replace('2xlarge', 'large')
            console.log('instance size 2xlarge is not supported with express edition, demoting to large')
            console.log('https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_SQLServer.html#SQLServer.Concepts.General.VersionSupport')
          }

          var rdsParams = {
            DefaultOnly: true,
            Engine: DBEngineType
          }

          break
      }
      break
    case 'sqlserver-web':
      switch (DBInstanceClass) {
        case (DBInstanceClass.match(/db.t2.micro|db.t2.small|db.t2.medium/) || {}).input:

          if (DBInstanceClass.match('micro')) {
            var DBInstanceClass = DBInstanceClass.replace('micro', 'small')
            console.log('instance size micro is not supported, bumping micro to small')
            console.log('Web edition only support T2 small/medium instances with SQL 2017, (not SQL 2019) setting SQL 2017')
            console.log('https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_SQLServer.html#SQLServer.Concepts.General.VersionSupport')
          }
  
          var rdsParams = {
            DefaultOnly: true,
            Engine: DBEngineType,
            Filters: [
              {
                Name: 'engine-version', 
                Values: [
                  '14.00'
                ]
              }
            ]
          }
          break

        case (DBInstanceClass.match(/db.t2.large|db.t2.xlarge/) || {}).input:

          console.log('Web edition on T2 large and xlarge instances are not supported at all. switching to T3')
          console.log('https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_SQLServer.html#SQLServer.Concepts.General.VersionSupport')
          var rdsParams = {
            DefaultOnly: true, // || false
            Engine: DBEngineType
          }
          var DBInstanceClass = DBInstanceClass.replace('t2', 't3')
          break

        case (DBInstanceClass.match(/db.t3.micro/) || {}).input:

          var DBInstanceClass = DBInstanceClass.replace('micro', 'small')
          console.log('instance size micro is not supported, bumping micro to small')
          console.log('https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_SQLServer.html#SQLServer.Concepts.General.VersionSupport')

          var rdsParams = {
            DefaultOnly: true,
            Engine: DBEngineType
          }
          
          break
    }
    break
    case (DBEngineType.match(/sqlserver-se|sqlserver-ee/ || {})).input:

      switch (DBInstanceClass) {
        case (DBInstanceClass.match(/db.t2.*/) || DBInstanceClass.match(/db.t3.micro|db.t3.small|db.t3.medium|db.t3.large/)).input:
          console.log('instance size less than t3.xlarge is not supported by this edition, upgrading to t3.xlarge')
          console.log('https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_SQLServer.html#SQLServer.Concepts.General.VersionSupport')
          
          DBInstanceClass="t3.xlarge"

          var rdsParams = {
            DefaultOnly: true,
            Engine: DBEngineType
          }

        break
      }
      break
  }

  var engineversions = await DescribeDBEngineVersions(rds,rdsParams)
  var latestengineversion = engineversions.DBEngineVersions[0].EngineVersion
  console.log(latestengineversion)
  
  var conf = {
    "EngineVersion": latestengineversion,
    "DBInstanceClass": DBInstanceClass,
  }

  return conf
}

async function verifydeploymentconfigavailability (rds, event, DBdeploymentMethod, DBEngineType, DBInstanceClass, DBPrincipalProperty) {

  var validconfig=false
  
  do{
  
    //trying to get regular config
    if (DBdeploymentMethod === "Serverless" && DBEngineType === "mysql"){
      var DBEngineType = "aurora-mysql"
      
      var rdsParams = {
        DefaultOnly: true, //true || false
        Engine: DBEngineType,
        IncludeAll: false, //true || false,
        Filters: [
          {
            Name: 'engine-version', /* required engine-version '8.0.mysql_aurora.3.02.2' n*/ 
            Values: [ /* required */
              '8.0'
            ]
          }
        ]
      }
      
      var latestengineversion = await DescribeDBEngineVersions(rds, rdsParams)
      latestengineversion=latestengineversion.DBEngineVersions[0].EngineVersion
      console.log('Latest version: ' + latestengineversion)

      var rdsInstanceParams = {
        Engine: DBEngineType,      
        EngineVersion: latestengineversion,
        DBInstanceClass: "db.serverless"
      };
      var instances = await DescribeOrderableDBInstanceOptions(rds, rdsInstanceParams)
      
      if (latestengineversion.length > 0 && instances.OrderableDBInstanceOptions.length > 0){
        validconfig=true
      }
      
    }
    else if (DBdeploymentMethod === "Serverless" && DBEngineType === "postgres"){
      var DBEngineType = "aurora-postgresql"
      var rdsParams = {
        DefaultOnly: true, //true || false
        Engine: DBEngineType,
        IncludeAll: false //true || false,
      }
      var latestengineversion = await DescribeDBEngineVersions(rds, rdsParams)
      latestengineversion=latestengineversion.DBEngineVersions[0].EngineVersion
      console.log('Latest version: ' + latestengineversion)

      var rdsInstanceParams = {
        Engine: DBEngineType,      
        EngineVersion: latestengineversion,
        DBInstanceClass: "db.serverless"
      };
      var instances = await DescribeOrderableDBInstanceOptions(rds, rdsInstanceParams)
      
      if (latestengineversion.length > 0 && instances.OrderableDBInstanceOptions.length > 0){
        validconfig=true
      }

    }
    else if (DBdeploymentMethod === "Server" && DBEngineType === 'postgres'){

      var rdsParams = {
        DefaultOnly: true, // || false
        Engine: event.templateParameterValues.DBEngineType
      }

      if (DBInstanceClass.match('db.t2..*') !== null){
        // check if parameters match if so change engine type to postgres 12.X as db.t2.XXX is not supported on postgres 13.X and newer
        rdsParams['EngineVersion']='12'
      }
      var latestengineversion = await DescribeDBEngineVersions(rds, rdsParams)
      //var latestengineversion = result.DBEngineVersions.map(dbe => dbe.EngineVersion)[0]
      latestengineversion=latestengineversion.DBEngineVersions[0].EngineVersion
      console.log('Latest version: ' + latestengineversion)
      if (latestengineversion.length > 0){
        validconfig=true
      }

    }
    else if (DBdeploymentMethod === "Server" && DBEngineType.match('sqlserver-')){

        // https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_SQLServer.html#SQLServer.Concepts.General.VersionSupport
        var supportedconfig = await getvalidmssqlconfig(rds, DBInstanceClass, DBEngineType)

        var latestengineversion = supportedconfig.EngineVersion
        var DBInstanceClass = supportedconfig.DBInstanceClass

        if (latestengineversion.length > 0){
          validconfig=true
        }
    }
    else if (DBdeploymentMethod === "Server" && DBEngineType === 'mysql'){
      
      var rdsParams = {
        DefaultOnly: true, // || false
        Engine: event.templateParameterValues.DBEngineType
      }

      var latestengineversion = await DescribeDBEngineVersions(rds, rdsParams)
      latestengineversion=latestengineversion.DBEngineVersions[0].EngineVersion
      console.log('Latest version: ' + latestengineversion)
      if (latestengineversion.length > 0){
        validconfig=true
      }

    }
    else{
      console.log("unhandled case unsupported/incorrect parameters")
    }

    //if getting config fails, no enginetype/deployment method combo exists
    if (validconfig === false){
      // The requested deployment method engine type combination was not available so modifying input parameters according to DB principal property. 
      switch (DBPrincipalProperty) {
        case 'EngineType':
          //if engine type is the most important (and requested deployment method was not available) than we need to change deployment method
          if( DBdeploymentMethod === "Serverless"){
            DBdeploymentMethod = "Server"
          }
          else if(DBdeploymentMethod === "Server"){
            DBdeploymentMethod = "Serverless"
          }
          break

        case 'DeploymentMethod':
          //if deploymentmethod is the most important (and requested engine type was not available) than we need to change engine type
          
          if( DBEngineType === "aurora-mysql"){
            //Validating the available instance types, aurora-mysql was not available so checking aurora-postgresql.
         
            DBEngineType = "aurora-postgresql"
            var rdsInstanceParams = {
              Engine: DBEngineType,      
              DBInstanceClass: "db.serverless"
            };
            var instances = await DescribeOrderableDBInstanceOptions(rds, rdsInstanceParams)
            
            // if Serverless instances are not available at all change deployment method and to server irrespective of client selecting prefering serverless.
            if  (instances.OrderableDBInstanceOptions.length === 0 ){
              DBEngineType="mysql"
              DBdeploymentMethod="Server"
              DBInstanceClass="t3.medium"
            }

          }
          else if(DBEngineType === "aurora-postgresql"){
            //Validating the available instance types, aurora-postgresql was not available so checking aurora-mysql.
            DBEngineType = "aurora-mysql"
            var rdsInstanceParams = {
              Engine: DBEngineType,      
              DBInstanceClass: "db.serverless"
            };
            var instances = await DescribeOrderableDBInstanceOptions(rds, rdsInstanceParams)
            
            // if Serverless instances are not available at all change deployment method and to server irrespective of client selecting prefering serverless.
            if  (instances.OrderableDBInstanceOptions.length === 0 ){
              DBEngineType="postgres"
              DBdeploymentMethod="Server"
              DBInstanceClass="t3.medium"
            }

          }
          else if(DBEngineType.match('sqlserver-')){
            DBEngineType = "postgres"
          }
          break
      }


    }

  }while (validconfig === false) 

  var config={
   "EngineVersion": latestengineversion,   //
   "DBEngineType": DBEngineType,          //
   "DBInstanceClass": DBInstanceClass,    //
   "DBdeploymentMethod": DBdeploymentMethod //
  }

  return config
}

function mergedbproperties(event,dbconfig){
  //set DB configuration to equal generated values also set cloudformation database type condition to appopiate DB type

  var EngineVerProperty = {
    EngineVersion: dbconfig.EngineVersion
  }

  var EngineTypeProperty = {
    Engine: dbconfig.DBEngineType
  }

  if (dbconfig.DBdeploymentMethod === "Server"){
    _.merge(event.fragment.Resources.LogverzDB.Properties, EngineVerProperty)
    _.merge(event.fragment.Resources.LogverzDB.Properties, EngineTypeProperty)
    event.fragment.Mappings.DeploymentType.Serverless.Value = "false"
    event.fragment.Mappings.DeploymentType.Server.Value = "true" 
  }
  else if (dbconfig.DBdeploymentMethod === "Serverless"){
    _.merge(event.fragment.Resources.LogverzDBServerless.Properties, EngineVerProperty)
    _.merge(event.fragment.Resources.LogverzDBServerless.Properties, EngineTypeProperty)
    event.fragment.Resources.LogverzDBServerlessInstance.Properties.Engine=dbconfig.DBEngineType
    event.fragment.Mappings.DeploymentType.Serverless.Value = "true"
    event.fragment.Mappings.DeploymentType.Server.Value = "false" 
  }

  event.templateParameterValues.DBInstanceClass = dbconfig.DBInstanceClass

  return event
}

async function getspecifickeyalias(kms){

  var filterconfig={
    "keys":[
      //"alias/aws/acm",
      "alias/aws/ssm"
    ]
  }
  var specifickmskeyalias = []
  var NextMarker

  do {
    var kmskeyaliasespartial = await getkmskeyaliasbatch(kms, NextMarker)
    
    kmskeyaliasespartial.Aliases.filter (a => {
      
      if (filterconfig.keys.includes(a.AliasName)){
        specifickmskeyalias.push(a)
        
        if (specifickmskeyalias.length === filterconfig.keys.length) {
          //removing NextMarker property, finishing cycle
          Reflect.deleteProperty(kmskeyaliasespartial, "NextMarker")
        }

      }
    })

    if (kmskeyaliasespartial.NextMarker !== undefined) {
      NextMarker = kmskeyaliasespartial.NextMarker
    }

  } while (kmskeyaliasespartial.NextMarker !== undefined)

  //console.log(specifickmskeyalias.length)
  return  specifickmskeyalias

}

async function getkmskeyaliasbatch (kms, NextMarker) {

  if (NextMarker) {
    var params = {
      "Marker": NextMarker
      //,Limit: 4
    }
  }
  else {
    var params = {
      //Limit: 4
    }
  }

  return new Promise(function (resolve, reject) {
    kms.listAliases(params, function (err, data) {
      if (err) {
        console.log(err, err.stack)
        reject(err)
        // an error occurred
      } else resolve(data) // successful response
    })
  })
}

function customizer (objValue, srcValue) {
  if (_.isArray(objValue)) {
    return objValue.concat(srcValue)
  }
}

// update one value
// var portvalue = jp.query(Logverz, '$.Resources.DBSecGroup4MSSQL.Properties.ToPort');
//     console.log(portvalue);
//     await timeout(1500);
//     jp.value(Logverz, '$.Resources.DBSecGroup4MSSQL.Properties.ToPort', 1435)
//     await timeout(1500);
//     var portvalue = jp.query(Logverz, '$.Resources.DBSecGroup4MSSQL.Properties.ToPort');
//     console.log(portvalue);

// update multiple objects
// var myconfig=[{"GroupId":{"Ref":"DBSecGroupx"},"IpProtocol":"TXP","FromPort":"1432","ToPort":1445,"SourceSecurityGroupId":{"Ref":"DBSecGroupx"}}]
// jp.value(Logverz, '$.Resources.DBSecGroup4MSSQL.Properties', myconfig)

// remove properties:
// var Logverz = fs.readFileSync(path.join(__dirname, '..', '..', 'infrastructure', 'Logverz.json')).toString('utf8');
// var Logverz=JSON.parse(Logverz)
// console.log(Logverz)
// _.omit(Logverz.Resources, ['DBSecGroup4MSSQL']);
