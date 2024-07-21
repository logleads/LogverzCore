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
        // console.log('SQL Entry ' + JSON.stringify(result) + 'has been added.')
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
      max: 10,
      min: 0,
      idle: 5000,
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
  return sequaliseconfig
}

export {
  constructmodel, AddSqlEntry, UpdateSqlEntry, SelectSQLTable, CloseSQLConnection, 
  InvocationsModel, ProcessingErrorsModel, convertschema, ConfigureSequalize
}
