/* eslint-disable no-redeclare */
/* eslint-disable no-var */
const AWS = require('./node_modules/aws-sdk')
const s3 = new AWS.S3()
const fs = require('fs')
const path = require('path')
const { promisify } = require('util')
const writeFileAsync = promisify(fs.writeFile)
const _ = require('./node_modules/lodash')
const { TaskTimer } = require('./node_modules/tasktimer')
const Sequelize = require('./node_modules/sequelize')
const { performance } = require('perf_hooks')
let rdsinsertsuccess = false
let t0
// var appLBfiles=path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment','events','worker','appLBfiles.json');
// var prefixarray =require(appLBfiles);

module.exports.handler = async function (event, context) {
  if (process.env.Environment !== 'LocalDev') {
    // Prod lambda function settings
    var engineshared = require('./shared/engineshared')
    var commonshared = require('./shared/commonshared')
    const arnList = (context.invokedFunctionArn).split(':')
    var region = arnList[3]
    var FileName = '/tmp/SelectedModel.js'
    var TestingTimeout = process.env.TestingTimeout
    console.log('REQUEST RECEIVED: ' + JSON.stringify(context))
  } else {
    // Dev environment settings
    const mydev = require(path.join(__dirname, '..', '..', 'settings', 'LogverzDevEnvironment', 'configs', 'worker', 'mydev.js'))
    var engineshared = mydev.engineshared
    var commonshared = mydev.commonshared
    var region = mydev.region
    var FileName = mydev.FileName
    var context = mydev.context
    var TestingTimeout = mydev.TestingTimeout
  }

  const DBName = 'Logverz'
  const DBAvalue = context.clientContext.DatabaseParameters.split('<!!>')
  let DBEngineType = DBAvalue.filter(s => s.includes('LogverzEngineType'))[0].split('=')[1]
  DBEngineType = (DBEngineType.match('sqlserver-') ? 'mssql' : DBEngineType)
  const DBUserName = DBAvalue.filter(s => s.includes('LogverzDBUserName'))[0].split('=')[1] // "LogverzAdmin"
  const DBEndpointName = DBAvalue.filter(s => s.includes('LogverzDBEndpointName'))[0].split('=')[1]
  const DBEndpointPort = DBAvalue.filter(s => s.includes('LogverzDBEndpointPort'))[0].split('=')[1]
  const DBFrendlyName = DBAvalue.filter(s => s.includes('LogverzDBFriendlyName'))[0].split('=')[1]
  const QueueURL = context.clientContext.QueueURL
  const S3SelectQuery = context.clientContext.S3SelectQuery
  const S3SelectParameter = JSON.parse(context.clientContext.S3SelectParameter) // .replace("\\","")
  const QueryType = context.clientContext.QueryType
  const DBTableName = context.clientContext.DBTableName
  var Schema = context.clientContext.Schema
  const Model = Sequelize.Model

  var header = true
  if (S3SelectParameter.InputSerialization.JsonType !== undefined) {
    var type = 'JSON'
  } else if (S3SelectParameter.InputSerialization.CSV.FileHeaderInfo === 'USE') {
    var type = 'CSV'
  } else {
    var type = 'CSV'
    var header = false
  }

  AWS.config.update({
    region
  })

  const SSM = new AWS.SSM()
  const sqs = new AWS.SQS({
    apiVersion: '2012-11-05'
  })
  const dynamodb = new AWS.DynamoDB()
  const details = {
    source: 'signal.js:handler',
    message: ''
  }

  if (Schema === '') {
    // It only retrieves schema parameter if the client context does not have it. Which happenes if the schema is big + query is big so the
    // total client context is close to or more than 3583bytes.https://docs.aws.amazon.com/lambda/latest/dg/API_Invoke.html#API_Invoke_RequestSyntax
    var [DBPassword, SchemaObject] = await Promise.all([
      commonshared.getssmparameter(SSM, {
        Name: '/Logverz/Database/DefaultDBPassword',
        WithDecryption: true
      }, dynamodb, details),
      commonshared.getssmparameter(SSM, {
        Name: ('/Logverz/Engine/Schemas/' + QueryType)
      }, dynamodb, details)
    ])
    const SchemaArray = JSON.parse(SchemaObject.Parameter.Value).Schema
    var Schema = ('{' + SchemaArray.map(e => e + '\n') + '}').replace(/,'/g, '"').replace(/'/g, '"') // TODO add engineshared.convertschema()
    DBPassword = DBPassword.Parameter.Value
  } else {
    var DBPassword = await commonshared.getssmparameter(SSM, {
      Name: `/Logverz/Database/${DBFrendlyName}Password`,
      WithDecryption: true
    }, dynamodb, details)
    DBPassword = DBPassword.Parameter.Value
  }

  await writeFileAsync(FileName, engineshared.constructmodel(Schema, 'worker'))
  var SelectedModel = require(FileName)

  const connectionstring = `${DBEngineType}://${DBUserName}:${DBPassword}@${DBEndpointName}:${DBEndpointPort}/${DBName}`

  try {
    var sequelize = await InitiateConnection(DBEngineType, connectionstring) // sequelize,
    console.log('SQL Server Connection has been established successfully.')
  } catch (e) {
    console.log('Error establishing SQL Server connection. Further details: \n')
    console.error(e)
    process.exit()
  }

  t0 = performance.now()
  const finished = await loop(dynamodb, sequelize, context, TestingTimeout, sqs, engineshared, commonshared, S3SelectParameter, QueryType, QueueURL, S3SelectQuery, Model, SelectedModel, DBTableName, DBEngineType, type, header)

  return {
    statusCode: 200,
    body: finished
  }
} // module exports

async function loop (dynamodb, sequelize, context, TestingTimeout, sqs, engineshared, commonshared, S3SelectParameter, QueryType, QueueURL, S3SelectQuery, Model, SelectedModel, DBTableName, DBEngineType, type, header) {
  // two actions are run in parallel:
  // 1.) reporting lambda state to sql database,
  // 2.) processing sqs messages via TASK function
  let i = 0

  //  invocationsquery(sequelize,context,"STARTING")

  const timer = new TaskTimer(2000)
  timer.on('tick', () => {
    console.log(`Reporting state of instance ${context.clientContext.invocationid} at ${new Date().toLocaleString()} : RUNNING`)

    const updatedfields = {
      status: 'RUNNING',
      loggroup: context.logGroupName,
      logstream: context.logStreamName
    }
    const conditions = {
      where: {
        invocationid: context.clientContext.invocationid
      }
    }
    engineshared.UpdateSqlEntry(sequelize, Model, engineshared.InvocationsModel, 'Invocation', 'Invocations', updatedfields, conditions)
  })
  timer.start()

  try {
    let exitcondition = false
    do {
      if (TestingTimeout > 0) {
        console.log('testing timeout of: ' + TestingTimeout / 1000 + ' seconds where applied.')
        await timeout(TestingTimeout) // for testing log running lambdas
      }
      const t1 = performance.now()
      var finished = await Task(dynamodb, sqs, engineshared, commonshared, S3SelectParameter, QueryType, QueueURL, S3SelectQuery, sequelize, Model, SelectedModel, DBTableName, DBEngineType, context, type, header)
      const t2 = performance.now()
      const processingtime = (t2 - t1)
      const ellipsedtime = (t2 - t0)
      console.log('ellipsedtime ' + ellipsedtime)

      if (process.env.Environment === 'Windows') { // for local test environment
        var remainingtime = context.getRemainingTimeInMillis() - ellipsedtime
      } else {
        var remainingtime = context.getRemainingTimeInMillis()
      }

      i = i + 1
      console.log('Lambda instance :' + context.awsRequestId + ' @ iteration ' + i + ' had processing time ' + (processingtime / 1000) + ' second(s).')
      // End the loop execution when the conditions are meet.
      if ((remainingtime < (processingtime * 2)) || (remainingtime < 10000)) {
        exitcondition = true
        console.log('exit condition met, the Lambdafunctions remaining time ' + remainingtime / 1000 + 'sec last iteration time ' + processingtime / 1000 + 'sec')
      }
    } while (!exitcondition)
  } catch (err) {
    console.log(err)
  }
  timer.stop()

  const conditions = {
    where: {
      invocationid: context.clientContext.invocationid
    }
  }
  await engineshared.UpdateSqlEntry(sequelize, Model, engineshared.InvocationsModel, 'Invocation', 'Invocations', {
    status: 'COMPLETED'
  }, conditions)

  console.log(`Reporting state of instance ${context.clientContext.invocationid} at ${new Date().toLocaleString()} : COMPLETED`)
  await sequelize.close()
  return finished
}

async function Task (dynamodb, sqs, engineshared, commonshared, S3SelectParameter, QueryType, QueueURL, S3SelectQuery, sequelize, Model, SelectedModel, DBTableName, DBEngineType, context, type, header) {
  const sqsmessages = await commonshared.receiveSQSMessage(QueueURL, sqs)
  // TODO test and consider raising the MaxNumberOfMessages.

  try {
    var prefixarray = JSON.parse(sqsmessages[0].Body)
    var ReceiptHandle = sqsmessages[0].ReceiptHandle
  } catch (e) {
    console.log('Error parsing Message retrieved from SQS. Further details: \n')
    console.error(e)
    process.exit()
  }

  const s3results = await processS3data(dynamodb, prefixarray, S3SelectQuery, S3SelectParameter, context, DBEngineType, engineshared, commonshared, sequelize, Model, type, header)
  const Transformeddata = DatatoSchemaTransformation(s3results, SelectedModel, S3SelectParameter, DBEngineType, type, header)

  // Only call InsertData if Transformed data is not null;
  if (Transformeddata.length !== 0) {
    await InsertData(sequelize, Model, SelectedModel, QueryType, DBTableName, Transformeddata)
    await deleteSQSMessage(QueueURL, ReceiptHandle, sqs, rdsinsertsuccess)
  } else {
    rdsinsertsuccess = true
    var result = await deleteSQSMessage(QueueURL, ReceiptHandle, sqs, rdsinsertsuccess)
  }
  return result
}

async function InsertData (sequelize, Model, SelectedModel, QueryType, DBTableName, Transformeddata) {
  return sequelize.transaction(t => {
    class Entry extends Model {}
    Entry.init(SelectedModel, {
      sequelize,
      modelName: QueryType,
      tableName: DBTableName,
      freezeTableName: true
    })

    return Entry.bulkCreate(Transformeddata, {
      transaction: t
    })
      .then(result => {
        rdsinsertsuccess = true
        console.log('SQL Server BulkEntry  has been completed successfully. Number of items: ' + Transformeddata.length)
        // Transaction has been committed
        // result is whatever the result of the promise chain returned to the transaction callback
      }).catch(err => {
        console.log(err)
        rdsinsertsuccess = false
        // Transaction has been rolled back
        // err is whatever rejected the promise chain returned to the transaction callback
        t.rollback()
      })
  }) // return sequlize
} // insert data function

async function processS3data (dynamodb, prefixarray, S3SelectQuery, S3SelectParameter, context, DBEngineType, engineshared, commonshared, sequelize, Model, type, header) {
  // source: https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#selectObjectContent-property

  const s3parameters = {
    Bucket: '',
    Key: '',
    ExpressionType: 'SQL',
    Expression: S3SelectQuery,
    InputSerialization: {
      CompressionType: S3SelectParameter.InputSerialization.Compression
    },
    OutputSerialization: {}
  }

  if (type === 'JSON') {
    s3parameters.InputSerialization.JSON = {}
    s3parameters.InputSerialization.JSON.Type = S3SelectParameter.InputSerialization.JsonType
    s3parameters.OutputSerialization.JSON = {}
    s3parameters.OutputSerialization.JSON.RecordDelimiter = ','
  } else if (type === 'CSV') {
    if (header === false) {
      s3parameters.InputSerialization.CSV = {}
      s3parameters.OutputSerialization.CSV = S3SelectParameter.OutputSerialization.CSV
    } else {
      s3parameters.OutputSerialization.JSON = {}
      s3parameters.OutputSerialization.JSON.RecordDelimiter = ','
    }
    s3parameters.InputSerialization.CSV = S3SelectParameter.InputSerialization.CSV
  } else if (S3SelectParameter.InputSerialization.Parquet !== undefined) {
    console.log('Parquet support to be done!')
  }

  const promises = prefixarray.map(prefix => {
    s3parameters.Key = prefix[0]
    s3parameters.Bucket = prefix[1]
    const params = s3parameters
    return FilteredS3data(params, context, dynamodb, engineshared, commonshared, sequelize, Model, DBEngineType, type, header)
  }) // prefixarray.map

  const resolved = await Promise.all(promises)
  let results = _.compact(_.flatten(resolved))

  if ((S3SelectParameter.InputSerialization.RootElement !== undefined) && (typeof results[0][S3SelectParameter.InputSerialization.RootElement] === 'object')) {
    // its a list of elements
    const combined = []
    results.map(r => combined.push(r.Records))
    results = _.flatten(combined)
  }

  console.log('Number of keys ' + results.length + ' \n')
  return results
}

async function FilteredS3data (params, context, dynamodb, engineshared, commonshared, sequelize, Model, DBEngineType, type, header) {
  const filtereresult = new Promise((resolve) => {
    // sources: https://thetrevorharmon.com/blog/how-to-use-s3-select-to-query-json-in-node-js ,https://github.com/aws/aws-sdk-js/issues/1682
    // Alternative: https://www.pluralsight.com/guides/javascript-callbacks-variable-scope-problem
    const req = s3.selectObjectContent(params, function (err, data) {
      if (err) {
        console.log('error:\n')
        console.log(JSON.stringify(err))
        // an error occurred
      } else {
        const results = []
        const eventStream = data.Payload

        eventStream.on('data', ({
          Records,
          End
        }) => {
          if (Records) {
            results.push(Records.Payload)
          } else if (End) {
            const plainstring = Buffer.concat(results).toString('utf8')
            var result = []
            if (type === 'JSON') {
              var result = convertrawdata(plainstring)
              resolve(result)
            } else if (type === 'CSV' && header === true) {
              var result = convertrawdata(plainstring)
              resolve(result)
            } else if (type === 'CSV' && header === false) {
              result.push(plainstring)
              resolve({
                Result: 'PASS',
                Data: result
              })
            }
          }
        }) // eventstream on data
      } // successful response
    })

    req.on('complete', (response) => {
      if (response.error !== null) {
        const errorstring = response.httpResponse.stream.req._header
        const file = errorstring.match(/POST.*?select.*/g)
        const bucket = errorstring.match(/Host:.*/g)
        // this is the compacted errormessage
        const errormessagedatabase = 'Error Processing request: \n' + file + '\n' + bucket + '\nReason:\n' + Buffer.from(response.httpResponse.body).toString('utf8')
        // this is the full errormessage:
        let errormessageconsole = 'Error Processing request: \n' + errorstring + '\n------------------------------------------------------------------\n'
        errormessageconsole += Buffer.from(response.httpResponse.body).toString('utf8')
        console.log(errormessageconsole)
        resolve({
          Result: 'Fail',
          Data: errormessagedatabase
        })
      }
    })
  }) // new promise

  const result = await filtereresult
  if (result.Result === 'PASS') {
    return result.Data
  } else {
    const mydata = {
      jobid: context.clientContext.jobid,
      invocationid: context.clientContext.invocationid,
      updateunixtime: Date.now(),
      path: 'worker.js:FilteredS3data.req.on.complete',
      loggroup: context.logGroupName,
      logstream: context.logStreamName,
      errormessage: result.Data
    }
    const AddSQLEntryresult = await engineshared.AddSqlEntry(sequelize, Model, engineshared.ProcessingErrorsModel(DBEngineType), 'ProcessingError', 'ProcessingErrors', mydata)

    // checks for SQL insert success/failure if failed records it in DynamoDb.
    if (AddSQLEntryresult.Result !== 'PASS') {
      const details = {
        source: 'Worker.js:AddSqlEntry',
        message: 'failed to insert processing errors to SQL table, because: ' + result.Data,
        jobid: context.clientContext.jobid
      }
      await commonshared.AddDDBEntry(dynamodb, 'Logverz-Invocations', 'SQLInsert', 'Error', 'Infra', details, 'API')
    }
  }
} // FilteredS3data

async function InitiateConnection (DBEngineType, connectionstring) { // sequelize,
  if (DBEngineType === 'mssql') {
    var config = {
      dialect: 'mssql',
      logging: false,
      dialectOptions: {
        options: {
          validateBulkLoadParameters: true,
          loginTimeout: 15
        }
      },
      pool: {
        max: 1,
        min: 0,
        idle: 5000,
        acquire: 30000
      }
    }
    var sequelize = new Sequelize(connectionstring, config)
  } else {
    var config = {
      pool: {
        max: 1,
        min: 0,
        idle: 5000,
        acquire: 30000
      }
    }
    var sequelize = new Sequelize(connectionstring, config)
    sequelize.options.logging = false // Disable logging
  }

  sequelize.authenticate()

  return sequelize
}

function DatatoSchemaTransformation (s3results, SelectedModel, S3SelectParameter, DBEngineType, type, header) {
  if (type === 'JSON') {
    var finalarray = convertdatatosqlschema(s3results, SelectedModel, DBEngineType)
  } else if (type === 'CSV' && header === true) {
    var finalarray = convertdatatosqlschema(s3results, SelectedModel, DBEngineType)
  } else if (type === 'CSV' && header === false) {
    var intermediatearray = []
    const headers = Object.keys(SelectedModel)

    _.forEach(s3results, onefile => {
      const temparray = []
      let entries = []
      entries = onefile.split(S3SelectParameter.OutputSerialization.CSV.RecordDelimiter)
      for (let i = 0; i < entries.length; i++) {
        if (S3SelectParameter.OutputSerialization.CSV.FieldDelimiter === ' ') {
          var oneentry = entries[i].match(/(?:[^\s"]+|"[^"]*")+/g)
        } else {
          var oneentry = entries[i].split(S3SelectParameter.OutputSerialization.CSV.FieldDelimiter)
        }

        if (oneentry !== '' && oneentry !== null) {
          oneentry = oneentry.map(oe => {
            if (oe.match(/^".*"$/)) {
              oe = oe.substring(1, oe.length - 1) // remove starting " and ending " charchters...
            }
            return oe
          })
          temparray.push(_.zipObject(headers, oneentry))
        } // if oneentry not empty
      } // for i entries
      intermediatearray.push(temparray)
    })
    var intermediatearray = _.compact(_.flatten(intermediatearray))
    var finalarray = convertdatatosqlschema(intermediatearray, SelectedModel, DBEngineType)
  } else {
    console.log('Parquet filetype not yet supported')
  }

  return finalarray
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function deleteSQSMessage (QueueURL, ReceiptHandle, sqs, rdsinsertsuccess) {
  const deleteParams = {
    QueueUrl: QueueURL,
    ReceiptHandle
  }
  return new Promise((resolve, reject) => {
    if (rdsinsertsuccess) {
      sqs.deleteMessage(deleteParams, function (err, data) {
        if (err) {
          console.log('Delete Error', err)
          reject(err)
        } else {
          console.log('Message Deleted:', JSON.stringify(data))
          resolve(JSON.stringify(data))
        }
      })
      rdsinsertsuccess = false
    } else {
      console.log('Database insert of the contents of the message failed not deleting sqs message')
    }
  }) // new promise
}

function convertdatatosqlschema (s3results, SelectedModel, DBEngineType) {
  const array = []
  const themodel = SelectedModel
  _.forEach(s3results, existingentry => {
    for (const Modelskey in SelectedModel) {
      let value = existingentry[Modelskey]
      const type = (themodel[Modelskey]).type.key
      if ((DBEngineType === 'mssql') && (typeof (value) === 'object')) {
        // convert data from json to string as mssql does not have JSON datatype
        // https://sequelize.org/master/manual/other-data-types.html#mssql
        try {
          value = JSON.stringify(value)
        } catch (error) {
          console.log('Could not stringify json')
          console.log(JSON.stringify(error))
          value = 'error processingfield'
        }
        existingentry[Modelskey] = value
      } else if ((type === 'INTEGER' || type === 'BIGINT') && (value !== undefined)) {
        // convert non number value such as '-' to NULL
        // Note value can be undefined if the processed file does not contain same number of fields as schema example "ELBAccessLogTestFile" vs generic ELB AccessLogs
        if (value.match(/^[0-9]*$/) === null) {
          value = null
          existingentry[Modelskey] = value
        } else {
          try {
            value = parseInt(value)
          } catch (err) {
            console.log('The key: \n' + Modelskey + '\nThe Value: \n' + value + '\nThe error: \n' + err)
          };
          existingentry[Modelskey] = value
        }
      } else if (value === 'null' || value === undefined) {
        value = null
        existingentry[Modelskey] = value
      }
    }
    array.push(existingentry)
  })
  return array
}

function convertrawdata (plainstring) {
  // eslint-disable-next-line no-useless-escape
  plainstring = plainstring.replace(/\,$/, '')
  // Add into JSON 'array'
  plainstring = `[${plainstring}]`
  try {
    const JSONobject = JSON.parse(plainstring)
    var result = {
      Result: 'PASS',
      Data: JSONobject
    } // encapsulating state of data to PASS/FAIL JSON object.
  } catch (e) {
    console.log(e)
    var result = {
      Result: 'Fail',
      Data: e
    }
  }

  return result
}
