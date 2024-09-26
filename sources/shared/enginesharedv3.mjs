/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

if (process.env.CODEBUILD_SRC_DIR !== undefined) {
  // codebuild environment (controller.js) path is dynamic.
  var sequelizepath = 'file:///' + process.env.CODEBUILD_SRC_DIR + '/node_modules/sequelize/lib/index.mjs'
}
else {
  // production lambda (and local dev) paths are static, env vars can be used.
  var sequelizepath = process.env.sequalisepath
}

const Sequelize = await import(sequelizepath)

const InvocationsModel = {
  jobid: {
    type: Sequelize.STRING
  },
  invocationid: {
    type: Sequelize.STRING
  },
  updateunixtime: {
    type: Sequelize.BIGINT
  },
  status: {
    type: Sequelize.STRING
  },
  loggroup: {
    type: Sequelize.STRING
  },
  logstream: {
    type: Sequelize.STRING
  }
}

const ProcessingErrorsModel = (DBEngineType) => {
  if (DBEngineType === 'mssql') {
    var model = {
      jobid: {
        type: Sequelize.STRING
      },
      invocationid: {
        type: Sequelize.STRING
      },
      updateunixtime: {
        type: Sequelize.BIGINT
      },
      errormessage: {
        type: Sequelize.TEXT
      }, // <= mssql supports char length up to 8000:https://stackoverflow.com/questions/45937174/how-to-define-an-nvarcharmax-field-with-sequelize
      path: {
        type: Sequelize.STRING
      },
      loggroup: {
        type: Sequelize.STRING
      },
      logstream: {
        type: Sequelize.STRING
      }
    }
  }
  else {
    var model = {
      jobid: {
        type: Sequelize.STRING
      },
      invocationid: {
        type: Sequelize.STRING
      },
      updateunixtime: {
        type: Sequelize.BIGINT
      },
      errormessage: {
        type: Sequelize.STRING(8192)
      },
      path: {
        type: Sequelize.STRING
      },
      loggroup: {
        type: Sequelize.STRING
      },
      logstream: {
        type: Sequelize.STRING
      }
    }
  }
  return model
}

const constructmodel = (schema, usage) => {
  if ((usage === 'controller') || (usage === 'proxyserver')) {
    // var FileContent = 'const Sequelize = require("sequelize");\n'
    var FileContent = 'const Sequelize = await import("sequelize");\n'
  }
  else { // lambda function directory
    // console.log("Linux model");
    // var FileContent = 'const Sequelize = require("/var/task/node_modules/sequelize");\n'
    var FileContent = 'const Sequelize = await import("' + sequelizepath + '")\n'
  }

  FileContent += 'var SelectedModel =' + schema
  // FileContent += '\nmodule.exports = SelectedModel;'
  FileContent += '\nexport { SelectedModel }'

  return FileContent
}

const SelectSQLTable = async (sequelize, Model, SelectedModel, QueryType, DBTableName, Mode, QueryParameters) => {
  class Query extends Model {}
  Query.init(SelectedModel, { // SelectedModel
    sequelize,
    modelName: QueryType,
    tableName: DBTableName
  })

  if (Mode === 'findOne') {
    return await Query.findOne(QueryParameters)
  }
  else if (Mode === 'findAll') {
    return await Query.findAll(QueryParameters)
  }
  else {
    return await Query.findByPk(QueryParameters)
  }
  // Todo: add here "raw" mode for regular sql queries
}

const CloseSQLConnection = async (sequelize) => {
  var result
  try {
    await sequelize.close()
    result = 'connection was closed'
  }
  catch (err) {
    result = JSON.stringify(err)
  }
  return result
}

const ConfigureSequalize = (DBEngineType) => {
  var sequaliseconfig = {
    pool: {
      max: 20,
      min: 2,
      idle: 15000,
      acquire: 120000
    },
    dialectOptions: {
    }
  }

  if (DBEngineType === 'postgres') {
    sequaliseconfig.dialectOptions = {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  }
  else if (DBEngineType === 'mssql'){
    sequaliseconfig.pool.idle = 30000
    sequaliseconfig.dialectOptions = {
      options: { 

        //https://stackoverflow.com/questions/57032706/sequelize-tedious-create-update-records-with-long-string-error-read-econnreset
        //packetSize: 32768,
        //https://stackoverflow.com/questions/63496622/node-js-mssql-error-tedious-deprecated-the-default-value-for-config-options-en
        //enableArithAbort: false
        
        //Disable encryption as with encrypted connections there are random Unhandled rejection SequelizeDatabaseError: read ECONNRESET
        // info: https://github.com/tediousjs/tedious/issues/923 , not using encryption seems to lesser the issue.
        encrypt: true

       }
    }
  }
  return sequaliseconfig
}

const convertschema = (schema, DBEngineType) => {
  if (DBEngineType === 'mssql') {
    // sequalize mssql modul tedious.js does not support JSON type values, hence need to change the model from json to string.
    schema = schema.replace(/Sequelize.JSON/g, 'Sequelize.STRING')
    // MSSQL has a 8000 char limit.
    schema = schema.replace(/Sequelize.STRING\(.*\)/g, 'Sequelize.TEXT')
    // default string by default is 255 chat. By changing to text it uses nvarcharmax datatype.
    schema = schema.replace(/Sequelize.STRING/g, 'Sequelize.TEXT')
  }

  return schema
}

 const ConnectDBserver = async (sequelize, Sequelize, Schema, dbparams, fs, fileURLToPath, SelectedModelPath, ddclient, engineshared, commonshared, usage) => {

  Schema = convertschema(Schema, dbparams.DBEngineType)
  fs.writeFileSync(fileURLToPath(SelectedModelPath), engineshared.constructmodel(Schema, usage))
  // console.log("\nSelectedModelPath:"+SelectedModelPath)
  // console.log(".....foldercontents.....")
  // var directorycontents=fs.readdirSync("/tmp")
  const DBName = 'Logverz'
  const connectionstring = `${dbparams.DBEngineType}://${dbparams.DBUserName}:${dbparams.DBPassword}@${dbparams.DBEndpointName}:${dbparams.DBEndpointPort}/${DBName}`
  const sequaliseconfig = engineshared.ConfigureSequalize(dbparams.DBEngineType)
  sequelize = new Sequelize(connectionstring, sequaliseconfig)
  sequelize.options.logging = false // Disable logging

  try {
    await InitiateSQLConnection(sequelize, dbparams.DBEngineType, connectionstring, DBName)
    console.log('Connection has been established successfully.\n')
  }
  catch (e) {
    const message = 'Error establishing SQL connection. Further details: \n'
    console.error(message + e)
    var details = {
      source: 'controller.js:InitiateSQLConnection',
      message: message + e,
      jobid
    }
    await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'SQLConnect', 'Error', 'Infra', details, 'API')
    process.exit(1)
  }

  return sequelize

}

const ConfigureDBCreateTables = async (sequelize, engineshared, dbparams, Model, SelectedModelPath, QueryType)=> {

  // Verify that Invocations table exists, if not create it and the processing errors table,
  try {
    const initatequery = initiatetablesquery(dbparams.DBEngineType)
    await sequelize.query(initatequery)
  }
  catch (err) {
    console.log('Invocations table does not exists creating it and Processingerrors table.')
    await CreateSQLTable(sequelize, Model, engineshared.InvocationsModel, 'Invocation', 'Invocations')
    await CreateSQLTable(sequelize, Model, engineshared.ProcessingErrorsModel(dbparams.DBEngineType), 'ProcessingError', 'ProcessingErrors')
  }

  // console.log("\nSelectedModelPath:"+SelectedModelPath)
  // console.log(".....foldercontents.....")
  // var directorycontents=fs.readdirSync("/tmp")
  // console.log (directorycontents+ "\n\n\n\n")
  const SelectedModel = (await import(SelectedModelPath)).SelectedModel //.replace(/\\/g, '/')

  try {
    await CreateSQLTable(sequelize, Model, SelectedModel, QueryType, dbparams.DBTableName)
    console.log('Table ' + dbparams.DBTableName + ' for "' + QueryType + '" data type queries has been created.')
  }
  catch (e) {
    console.error(e)
  }

}

const InitiateSQLConnection = async  (sequelize, DBEngineType, connectionstring, DBName) => {

  if (DBEngineType === 'mssql') {
    // by default mssql does not have a Logverz database, so at first execution it needs to be created.

    sequelize.options.validateBulkLoadParameters = true
    sequelize.options.loginTimeout = 15

    try {
      await sequelize.authenticate()
    }
    catch (err) {
      if (err.name === 'SequelizeAccessDeniedError') {

        // At first execution Logverz DB is not present need to connect to a different db to verify credentials
        // than create  Logverz DB and if successfull return authenticated true.
        sequelize = new Sequelize(connectionstring)
        sequelize.connectionManager.config.database = 'master'
        sequelize.options.logging = false

        // trying to authenticate a 2nd time either works (case of 1st execution) or errors (wrong credential).
        // This error is caught in the main try catch
        await sequelize.authenticate()

        // connection succeeded creating mssql database
        await sequelize.query('CREATE DATABASE ' + DBName)

        // connectioning to newly created DB
        sequelize = new Sequelize(connectionstring)
        await sequelize.authenticate()

      }
      else {
        console.log(err)
      }
    }
  }
  else {
    //non mssql DB
    await sequelize.authenticate()
  }

}

function initiatetablesquery (DBEngineType) {
//const initiatetablesquery = (DBEngineType) =>{  
  if (DBEngineType === 'postgres') {
    var initiatetables = 'SELECT 1 FROM public."Invocations"'
  }
  else if (DBEngineType === 'mysql') {
    var initiatetables = 'SELECT 1 FROM Invocations'
  }
  else if (DBEngineType.match('mssql')) {
    var initiatetables = 'SELECT 1 FROM dbo.Invocations'
  }
  else {
    var initiatetables = 'null'
    console.error('unknown unsupported DB option')
  }
  return initiatetables
}

async function CreateSQLTable (sequelize, Model, SelectedModel, QueryType, DBTableName) {
  return new Promise((resolve, reject) => {
    class Entry extends Model {}
    Entry.init(SelectedModel, {
      sequelize,
      modelName: QueryType,
      freezeTableName: true,
      tableName: DBTableName
    }).then(
      resolve(Entry.sync({
        force: true
      }))
    ).catch(err => {
      console.log(err)
      reject(err)
    })
  })
}

const authorizecollection =async (_, docClient, QueryCommand, ddclient, PutItemCommand, commonshared, authenticationshared, S3Folders, username) => {
  const S3Foldersarray = _.compact(S3Folders.split(';'))
  
  // if not match Logverz-MasterController than check user authorization for given s3 folders.
  if (username.match('Logverz-MasterController') === null) {
    const usertype = 'UserAWS'
    console.log("Checking authorization of '" + username + "'." + "Type:'UserAWS'.")
    let userattributes = await authenticationshared.getidentityattributes(docClient, QueryCommand, username, usertype)
    userattributes = userattributes.Items[0]
    var S3authresult = authenticationshared.authorizeS3access(_, commonshared, userattributes, S3Foldersarray)
  }
  else {
    // if match than authorization is granted. TODO , perform authoriation check on MasterController as well.
    var S3authresult = 'ok'
  }

  if (S3authresult !== 'ok') {
    const message = 'User not allowed to access one or more S3 locations. Further details: \n' + S3authresult.toString()
    console.error(message)
    const details = {
      source: 'controller.js:authorizeS3access',
      message,
      jobid
    }
    await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'S3Access', 'Error', 'User', details, 'API')
    process.exit(1)
  }
  else {
    console.log(username + ' can access folders ' + S3Foldersarray)
  }
  
}

const LookupDBParameters = async (DatabaseParameters, TableParameters, commonshared, ssmclient, ddclient, GetParameterCommand, PutItemCommand) => {
  const DBAvalue = DatabaseParameters.split('<!!>')

  let DBEngineType = DBAvalue.filter(s => s.includes('LogverzEngineType'))[0].split('=')[1]
  const DBUserName = DBAvalue.filter(s => s.includes('LogverzDBUserName'))[0].split('=')[1]
  const DBEndpointName = DBAvalue.filter(s => s.includes('LogverzDBEndpointName'))[0].split('=')[1]
  const DBEndpointPort = DBAvalue.filter(s => s.includes('LogverzDBEndpointPort'))[0].split('=')[1]
  const DBSecretRef = DBAvalue.filter(s => s.includes('LogverzDBSecretRef'))[0].split('=')[1]
  const DBTableName = TableParameters.split('<!!>').filter(s => s.includes('TableName'))[0].split('=')[1]
  const DBInstanceClass = DBAvalue.filter(s => s.includes('LogverzDBInstanceClass'))[0].split('=')[1]
        DBEngineType = (DBEngineType.match('sqlserver-') ? 'mssql' : DBEngineType)
  const DatabaseName = DBAvalue.filter(s => s.includes('LogverzDBFriendlyName'))[0].split('=')[1]
  

  var details = {
    source: 'controller.js:main/getssmparameter',
    message: ''
  }
  var params = {
    Name: DBSecretRef,
    WithDecryption: true
  }

  const DBPassword = (await commonshared.getssmparameter(ssmclient, GetParameterCommand, params, ddclient, PutItemCommand, details)).Parameter.Value

  var response = {
    DBEngineType,
    DBUserName,
    DBEndpointName,
    DBEndpointPort,
    DBTableName,
    DBInstanceClass,
    DBPassword,
    DatabaseName
  }
  return response
}

const ConfigureDBDeleteTables = async (commonshared, event, identityresult, sequelize, Model, TableName, docClient, PutItemCommand, QueryCommand, UpdateCommand, ddclient, DBServerAlias ) => {

  class Query extends Model {}
  Query.init({}, {
    sequelize,
    tableName: TableName
  })

  try {
    console.log('Deleting table: ' + TableName)
    await Query.drop()
    await commonshared.deactivatequery(docClient, QueryCommand, UpdateCommand, DBServerAlias, TableName, false)
    var sqlresult = 'Deleted table ' + TableName + ' succesfully'
  }
  catch (e) {
    var sqlresult = 'Error while trying to delete table ' + TableName + "\n"+e
  }
  console.log(sqlresult)
  
  const details = {
    source: 'collection.js:RequestDelete',
    message: JSON.stringify({
      user: identityresult,
      query: event.StackId
    })
  }
  const loglevel = 'Info'
  //adding user action to event history
  await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'WEBRTC', loglevel, 'User', details, 'SQL')
}

export {
  constructmodel, SelectSQLTable, CloseSQLConnection, InvocationsModel, ProcessingErrorsModel,
  convertschema, ConfigureSequalize, ConnectDBserver, ConfigureDBCreateTables, InitiateSQLConnection,
  ConfigureDBDeleteTables, LookupDBParameters, authorizecollection
}
