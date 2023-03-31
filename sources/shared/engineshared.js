/* eslint-disable no-redeclare */
/* eslint-disable no-var */
if (process.env.Environment !== 'LocalDev') {
  var modulespath = '../node_modules/'
} else {
  var modulespath = '../controller/node_modules/'
}

const Sequelize = require(modulespath + 'sequelize')

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
  } else {
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
    var FileContent = 'const Sequelize = require("sequelize");\n'
  } else if ((usage === 'worker') && (process.env.Environment === 'LocalDev')) {
    var FileContent = 'const Sequelize = require("../node_modules/sequelize");\n'
  } else { // lambda function directory
    // console.log("Linux model");
    var FileContent = 'const Sequelize = require("/var/task/node_modules/sequelize");\n'
  }

  FileContent += 'var SelectedModel =' + schema
  FileContent += '\nmodule.exports = SelectedModel;'
  return FileContent
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

const AddSqlEntry = async (sequelize, Model, SelectedModel, QueryType, DBTableName, mydata) => {
  return new Promise((resolve, reject) => {
    class DBEntry extends Model {}
    DBEntry.init(SelectedModel, {
      sequelize,
      modelName: QueryType,
      tableName: DBTableName,
      freezeTableName: true
    })

    DBEntry.create(mydata)
      .then(result => {
        console.log('SQL Entry ' + JSON.stringify(result) + 'has been added.')
        // Transaction has been committed
        // resolve(result)
        resolve({
          Result: 'PASS',
          Data: result
        })
      }).catch(err => {
        console.log(err)
        resolve({
          Result: 'Fail',
          Data: err
        })
        // reject(err)
      })
  })
}

const UpdateSqlEntry = async (sequelize, Model, SelectedModel, QueryType, DBTableName, updatedfields, conditions) => {
  return new Promise((resolve, reject) => {
    class DBEntry extends Model {}
    DBEntry.init(SelectedModel, {
      sequelize,
      modelName: QueryType,
      tableName: DBTableName,
      freezeTableName: true
    })

    DBEntry.update(updatedfields, conditions)
      .then(result => {
        console.log('SQL Entry ' + JSON.stringify(result) + 'has been updated.')
        // Transaction has been committed
        resolve(result)
      }).catch(err => {
        console.log(err)
        reject(err)
        // err is whatever rejected the promise chain returned to the transaction callback
      })
  })
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
  } else if (Mode === 'findAll') {
    return await Query.findAll(QueryParameters)
  } else {
    return await Query.findByPk(QueryParameters)
  }
  // Todo: add here "raw" mode for regular sql queries
}

const InitiateSQLConnection = async (sequelize) => {
  var result = sequelize.authenticate()
  return result
}

const CloseSQLConnection = async (sequelize) => {
  var result
  try {
    await sequelize.close()
    result = 'connection was closed'
  } catch (err) {
    result = JSON.stringify(err)
  }
  return result
}

const DBpropertylookup = (connectionstringsarray, LogverzDBFriendlyName) => {
  // TODO move this to commonshared so that sequelize package can be removed from scale.js.

  for (var i = 0; i < connectionstringsarray.length; i++) {
    var connectionstring = connectionstringsarray[i].split(',')
    var CSLogverzDBFriendlyName = connectionstring.filter(s => s.includes('LogverzDBFriendlyName'))[0].split('=')[1]
    
    if (CSLogverzDBFriendlyName === LogverzDBFriendlyName) {
      var DBEngineType = connectionstring.filter(s => s.includes('LogverzEngineType'))[0].split('=')[1]
      var DBUserName = connectionstring.filter(s => s.includes('LogverzDBUserName'))[0].split('=')[1]
      var DBEndpointName = connectionstring.filter(s => s.includes('LogverzDBEndpointName'))[0].split('=')[1]
      var DBEndpointPort = connectionstring.filter(s => s.includes('LogverzDBEndpointPort'))[0].split('=')[1]
      var DBSecretRef = connectionstring.filter(s => s.includes('LogverzDBSecretRef'))[0].split('=')[1]
      var DBFriendlyName = connectionstring.filter(s => s.includes('LogverzDBFriendlyName'))[0].split('=')[1]

      var LogverzDBClusterID = connectionstring.filter(s => s.includes('LogverzDBClusterID'))[0]
      
      if (DBEngineType.match('sqlserver')) {
        // SQL server comes in many flavours express web standard enterprise and developer, we normalize it as mssql name convention defined by sequilize
        DBEngineType = 'mssql'
      }

      if (LogverzDBClusterID !== undefined) {
        var DBClusterID =LogverzDBClusterID.split('=')[1]
      }
      break
    }
  }

  var result = {
    DBEngineType,
    DBUserName,
    DBEndpointName,
    DBEndpointPort,
    DBSecretRef,
    DBFriendlyName
  }

  if (typeof DBClusterID !== 'undefined') {
    // if DBclusterid exists its a serverless database so we add it to the results 
    //result['DBClusterID']+=DBClusterID
     Object.defineProperty(result, 'DBClusterID', {
       'value': DBClusterID
    });
  }

  return result
}

exports.constructmodel = constructmodel
exports.AddSqlEntry = AddSqlEntry
exports.UpdateSqlEntry = UpdateSqlEntry
exports.SelectSQLTable = SelectSQLTable
exports.InitiateSQLConnection = InitiateSQLConnection
exports.CloseSQLConnection = CloseSQLConnection
exports.DBpropertylookup = DBpropertylookup
exports.InvocationsModel = InvocationsModel
exports.ProcessingErrorsModel = ProcessingErrorsModel
exports.convertschema = convertschema

// syntax info:
// https://stackoverflow.com/questions/16631064/declare-multiple-module-exports-in-node-js
// https://stackoverflow.com/questions/10554241/can-i-load-multiple-files-with-one-require-statement/10554457
