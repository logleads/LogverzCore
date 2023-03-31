/* eslint-disable no-redeclare */
/* eslint-disable no-var */
var AWS = require('aws-sdk')
const fs = require('fs')
const Sequelize = require('sequelize')
// const { Op } = require('sequelize')
const axios = require('axios')
var _ = require('lodash')
const { QueryTypes } = require('sequelize')
// var requireFromString = require('require-from-string');
// Module exports options: https://www.sitepoint.com/understanding-module-exports-exports-node-js/

const query = async (clientrequest, Registry, commonshared, engineshared) => {
  if (process.env.Environment !== 'LocalDev') {
    var symbols = require('./symbols')
    var region = process.env.AWS_REGION
    if (region === null || region === '' || region === undefined) {
      var httpresponse = await axios({
        method: 'GET',
        port: 80,
        url: 'http://169.254.169.254:80/latest/dynamic/instance-identity/document'
      })
      region = httpresponse.data.region
    }
    var ModelsPath = './build/' // './build/SelectedModel.js'
  } else {
    // Dev environment settings
    var symbols = require('./symbols')
    var region = 'ap-southeast-2'
    var ModelsPath = './sources/webrtcproxy/build/' // './build/SelectedModel.js'
  }

  AWS.config.update({
    region,
    maxRetries: 2,
    httpOptions: {
      timeout: 3600000 // https://aws.amazon.com/premiumsupport/knowledge-center/lambda-function-retry-timeout-sdk/
    }
  })
  var SSM = new AWS.SSM()
  const dynamodb = new AWS.DynamoDB()
  const docClient = new AWS.DynamoDB.DocumentClient()

  return await main(SSM, engineshared, commonshared, dynamodb)

  async function main (SSM, engineshared, commonshared, dynamodb) {
    var details = {
      source: 'signal.js:handler',
      message: ''
    }
    var connectionstringsarray = _.reject(Registry.split('[[DBDELIM]]'), _.isEmpty)
    var dbp = engineshared.DBpropertylookup(connectionstringsarray, clientrequest.LogverzDBFriendlyName)
    // TODO store the value in memory, so its not to retrieve at every execution.
    var DBPassword = (await commonshared.getssmparameter(SSM, {
      Name: dbp.DBSecretRef,
      WithDecryption: true
    })).Parameter.Value
    var Mode = clientrequest.Mode // "findAll";

    const DBName = 'Logverz'
    const sequelize = new Sequelize(`${dbp.DBEngineType}://${dbp.DBUserName}:${DBPassword}@${dbp.DBEndpointName}:${dbp.DBEndpointPort}/${DBName}`)
    sequelize.options.logging = false // Disable logging

    try {
      await engineshared.InitiateSQLConnection(sequelize)
      console.log('Connection has been established successfully.')
    } catch (e) {
      var message = 'Error establishing SQL connection. Further details: \n'
      console.error(message + e)
      var details = {
        source: 'webrtcproxy.js:InitiateSQLConnection',
        message: message + e
      }
      await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'SQLConnect', 'Error', 'Infra', details, 'API')
    }

    if (Mode === 'Native') {
      try {
        var sqlresult = await sequelize.query(clientrequest.QueryParams, {
          type: QueryTypes.SELECT
        })
      } catch (error) {
        console.log('SQL query error ' + error.message)
        var sqlresult = []
      }
    } else if (Mode === 'ListTables') {
      var QueryParameters = symbols.symbolise(clientrequest.QueryParams)
      var sqlresult = await sequelize.queryInterface.showAllTables()

      if (typeof sqlresult[0] === 'object' && sqlresult[0] !== null) {
        // the output of showAllTables() in case of MSSQL is an array of objects not an array of strings hence we convert it.
        // [{"tableName":"Invocations","schema":"dbo"},,{"tableName":"ProcessingErrors","schema":"dbo"}] vs ["Invocations","ProcessingErrors"]
        sqlresult = sqlresult.map(r => r.tableName)
      }

      if (clientrequest.QueryParams !== null && Object.getOwnPropertySymbols(QueryParameters.where['Table Name'])[0].toString() === 'Symbol(like)') {
        var pattern = QueryParameters.where['Table Name'][Object.getOwnPropertySymbols(QueryParameters.where['Table Name'])[0]]
        var sqlresult = sqlresult.filter(result => result.match(pattern))
      }
    } else if (Mode === 'describeTable') {
      var DBTableName = clientrequest.DBTableName
      var sqlresult = await sequelize.queryInterface.describeTable(DBTableName)
    } else if (Mode.match('DeleteTable') !== null) {
      var DBTableName = clientrequest.DBTableName

      const Model = Sequelize.Model
      class Query extends Model {}
      Query.init({}, {
        sequelize,
        tableName: DBTableName
      })

      try {
        console.log('Deleting table: ' + DBTableName)
        await Query.drop()
        await commonshared.deactivatequery(commonshared, docClient, dbp.DBFriendlyName, DBTableName, false)
        var sqlresult = 'Deleted table ' + DBTableName + ' succesfully'
      } catch (e) {
        var sqlresult = 'Error while trying to delete table ' + DBTableName
      }

      console.log(sqlresult)
    } else if (Mode.match('find.*') !== null) {
      var DBTableName = clientrequest.DBTableName
      var QueryType = clientrequest.QueryType
      var QueryParameters = symbols.symbolise(clientrequest.QueryParams) // request.QueryParams;
      const Model = Sequelize.Model
      var SelectedModel = await SelectModel(SSM, commonshared, engineshared, QueryType, dbp.DBEngineType, ModelsPath)
      var sqlresult = await engineshared.SelectSQLTable(sequelize, Model, SelectedModel, QueryType, DBTableName, Mode, QueryParameters)
      var sqlresult = sqlresult.map(el => el.get({
        plain: true
      }))
    } else if (Mode === 'Transaction') {
      const t = await sequelize.transaction()

      try {
        var sqlresult = await sequelize.query(clientrequest.QueryParams, { transaction: t })
        await t.rollback()
      } catch (error) {
        console.log('SQL query error ' + error.message)
        var sqlresult = []
      }
    }

    var connectionstate = await engineshared.CloseSQLConnection(sequelize)
    console.log(connectionstate)

    var sqlresultstring = JSON.stringify(sqlresult)
    return sqlresultstring
  }
} // module exports

async function SelectModel (SSM, commonshared, engineshared, QueryType, DBEngineType, ModelsPath) {
  var file = QueryType + '_' + DBEngineType + '.js'
  var filefullpath = ModelsPath + file

  try {
    // check if schema file exists or not.
    await fs.promises.access(filefullpath)
  } catch (e) {
    var message = 'Schema File ' + filefullpath + 'dose not exists creating it. \n'
    console.log(e)
    console.log(message)
    if (QueryType !== 'ProcessingErrors' && QueryType !== 'Invocations') {
      var SchemaObject = await commonshared.getssmparameter(SSM, {
        Name: '/Logverz/Engine/Schemas/' + QueryType
      })
      var SchemaArray = JSON.parse(SchemaObject.Parameter.Value).Schema
      var Schema = ('{' + SchemaArray.map(e => e + '\n') + '}').replace(/,'/g, '"').replace(/'/g, '"')
      Schema = engineshared.convertschema(Schema, DBEngineType)
      await fs.promises.writeFile(filefullpath, engineshared.constructmodel(Schema, 'proxyserver'))
    }
  }

  if (QueryType === 'ProcessingErrors' || QueryType === 'Invocations') {
    var SelectedModel = (engineshared[QueryType + 'Model'])
  } else {
    var SelectedModel = require('./build/' + file)
  }
  return SelectedModel
}

exports.sqlproxy = query
