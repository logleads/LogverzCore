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

export {
  constructmodel, SelectSQLTable, CloseSQLConnection, InvocationsModel, 
  ProcessingErrorsModel, convertschema, ConfigureSequalize
}
