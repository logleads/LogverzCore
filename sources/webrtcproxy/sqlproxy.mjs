/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

const query = async (clientrequest, Registry, commonshared, engineshared, ddclient, docClient, ssmclient, GetParameterCommand, PutItemCommand, _, QueryCommand, Sequelize, Op, QueryTypes, UpdateCommand, axios, fs, path, promisify) => {
  if (process.env.Environment !== 'LocalDev') {
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
  }
  else {
    // Dev environment settings
    var region = 'ap-southeast-2'
    var ModelsPath = './sources/webrtcproxy/build/' // './build/SelectedModel.js'
  }

    var details = {
      source: 'signal.js:handler',
      message: ''
    }
    var connectionstringsarray = _.reject(Registry.split('[[DBDELIM]]'), _.isEmpty)
    // var dbp = engineshared.DBpropertylookup(connectionstringsarray, clientrequest.LogverzDBFriendlyName)
    var dbp = commonshared.DBpropertylookup(connectionstringsarray, clientrequest.LogverzDBFriendlyName)

    var details = {
      source: 'webrtcproxy.js:main/getssmparameter',
      message: ''
    }

    var params = {
      Name: dbp.DBSecretRef,
      WithDecryption: true
    }

    const DBPassword = (await commonshared.getssmparameter(ssmclient, GetParameterCommand, params, ddclient, PutItemCommand, details)).Parameter.Value
    var Mode = clientrequest.Mode // "findAll";

    const DBName = 'Logverz'
    dbp.DBEngineType = (dbp.DBEngineType.match('sqlserver-') ? 'mssql' : dbp.DBEngineType)
    const connectionstring = `${dbp.DBEngineType}://${dbp.DBUserName}:${DBPassword}@${dbp.DBEndpointName}:${dbp.DBEndpointPort}/${DBName}`
    const sequaliseconfig = engineshared.ConfigureSequalize(dbp.DBEngineType)
    const sequelize = new Sequelize(connectionstring, sequaliseconfig)
    sequelize.options.logging = false // Disable logging

    try {
      await sequelize.authenticate()
      console.log('Connection has been established successfully.')
    }
    catch (e) {
      var message = 'Error establishing SQL connection. Further details: \n'
      console.error(message + e)

      var details = {
        source: 'webrtcproxy.js:InitiateSQLConnection',
        message: message + e
      }
      await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'SQLConnect', 'Error', 'Infra', details, 'API')
    }

    if (Mode === 'Native') {
      try {
        var sqlresult = await sequelize.query(clientrequest.QueryParams, {
          type: QueryTypes.SELECT
        })
      }
      catch (error) {
        console.log('SQL query error ' + error.message)
        var sqlresult = []
      }
    }
    else if (Mode === 'ListTables') {
      // var QueryParameters = symbols.symbolise(clientrequest.QueryParams)
      var QueryParameters = symbolise(Op, _, clientrequest.QueryParams)
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
    }
    else if (Mode === 'describeTable') {
      var DBTableName = clientrequest.DBTableName
      var sqlresult = await sequelize.queryInterface.describeTable(DBTableName)
    }
    else if (Mode.match('DeleteTable') !== null) {
      var DBTableName = clientrequest.DBTableName
      // TODO replace this with engineshared.ConfigureDBDeleteTables
      const Model = Sequelize.Model
      class Query extends Model {}
      Query.init({}, {
        sequelize,
        tableName: DBTableName
      })

      try {
        console.log('Deleting table: ' + DBTableName)
        await Query.drop()
        await commonshared.deactivatequery(docClient, QueryCommand, UpdateCommand, dbp.DBFriendlyName, DBTableName, false)
        var sqlresult = 'Deleted table ' + DBTableName + ' succesfully'
      }
      catch (e) {
        var sqlresult = 'Error while trying to delete table ' + DBTableName
      }

      console.log(sqlresult)
    }
    else if (Mode.match('find.*') !== null) {
      var DBTableName = clientrequest.DBTableName
      var QueryType = clientrequest.QueryType
      // var QueryParameters = symbols.symbolise(clientrequest.QueryParams) // request.QueryParams;
      var QueryParameters = symbolise(Op, _, clientrequest.QueryParams) // request.QueryParams;

      const Model = Sequelize.Model
      var SelectedModel = await SelectModel(ssmclient, commonshared, engineshared, ddclient, QueryType, dbp.DBEngineType, ModelsPath, fs, path, promisify, GetParameterCommand, PutItemCommand)
      var sqlresult = await engineshared.SelectSQLTable(sequelize, Model, SelectedModel, QueryType, DBTableName, Mode, QueryParameters)
      var sqlresult = sqlresult.map(el => el.get({
        plain: true
      }))
    }
    else if (Mode === 'Transaction') {
      const t = await sequelize.transaction()

      try {
        var sqlresult = await sequelize.query(clientrequest.QueryParams, { transaction: t })
        await t.rollback()
      }
      catch (error) {
        console.log('SQL query error ' + error.message)
        var sqlresult = []
      }
    }

    var connectionstate = await engineshared.CloseSQLConnection(sequelize)
    console.log(connectionstate)
    //https://stackoverflow.com/questions/14432165/error-uncaught-syntaxerror-unexpected-token-with-json-parse
    //Remove all controll characthers such as: https://codepoints.net/U+0019?lang=en
    //var sqlresultstring = JSON.stringify(sqlresult).replace(/[\u0000-\u001F]+/g,"")
    //https://stackoverflow.com/questions/20856197/remove-non-ascii-character-in-string
    var sqlresultstring = JSON.stringify(sqlresult).replace(/[\u{0080}-\u{FFFF}]/gu,"")
    return sqlresultstring
}

async function SelectModel (ssmclient, commonshared, engineshared, ddclient, QueryType, DBEngineType, ModelsPath, fs, path, promisify, GetParameterCommand, PutItemCommand) {
  var file = QueryType + '_' + DBEngineType + '.js'
  var filefullpath = ModelsPath + file

  try {
    // check if schema file exists or not.
    await fs.promises.access(filefullpath)
  }
  catch (e) {
    var message = 'Schema File ' + filefullpath + 'dose not exists creating it. \n'
    console.log(e)
    console.log(message)
    if (QueryType !== 'ProcessingErrors' && QueryType !== 'Invocations') {
      var details = {
        source: 'webrtcproxy.js:SelectModel/getssmparameter',
        message: ''
      }

      var params = {
        Name: '/Logverz/Engine/Schemas/' + QueryType
      }
      var SchemaObject = (await commonshared.getssmparameter(ssmclient, GetParameterCommand, params, ddclient, PutItemCommand, details)).Parameter.Value

      var SchemaArray = JSON.parse(SchemaObject.Parameter.Value).Schema
      var Schema = ('{' + SchemaArray.map(e => e + '\n') + '}').replace(/,'/g, '"').replace(/'/g, '"')
      Schema = engineshared.convertschema(Schema, DBEngineType)
      await fs.promises.writeFile(filefullpath, engineshared.constructmodel(Schema, 'proxyserver'))
    }
  }

  if (QueryType === 'ProcessingErrors' || QueryType === 'Invocations') {
    var SelectedModel = (engineshared[QueryType + 'Model'])
  }
  else {
    var SelectedModel = ('file:///' + path.join(__dirname, 'build', file).replace(/\\/g, '/'))
    // require('./build/' + file)
  }
  return SelectedModel
}

function symbolise (Op, _, clientrequest) {
  var paths = iterate(clientrequest)
  const partsarray = []
  let onepart = {}

  let maxpathlength = 0
  for (let g = 0; g < paths.length; g++) {
    var path = paths[g].substr(1)
    const numberofsymbols = path.match(/<[a-z]*>/g).length
    if (numberofsymbols > maxpathlength) {
      maxpathlength = numberofsymbols
    }
  }
  maxpathlength = parseInt(maxpathlength)

  for (let i = 0; i < maxpathlength; i++) {
    for (let j = 0; j < paths.length; j++) {
      var path = paths[j].substr(1)
      const symbols = path.match(/<[a-z]*>/g).reverse()
      var justpath = path.split('=')[0]
      var justvalue = path.split('=')[1]
      for (let k = i; k < i + 1; k++) {
        const currentsymbol = symbols[k]
        const CurrentSymPath = path.substr(0, path.lastIndexOf(currentsymbol)) + currentsymbol
        const temp = justpath.substring(0, justpath.lastIndexOf(currentsymbol) - 1)
        const revpath = temp.split('.').reverse().toString().replace(/[,]/g, '.')

        if ((i === 0) && (symbols.length === 1)) {
          // example matches : ".where.<or>.0.id=12",".where.<or>.1.id=13"
          var computedvalue = {}
          for (var m = 0; m < paths.length; m++) {
            var path = paths[m].substr(1)
            var justpath = path.split('=')[0]
            var justvalue = path.split('=')[1]
            var subpath = justpath.substring(justpath.lastIndexOf(currentsymbol)).replace(currentsymbol + '.', '')
            if (subpath === currentsymbol) {
              var computedvalue = justvalue
            }
            else {
              _.set(computedvalue, subpath, justvalue)
            }
          }
        }
        else if (i === 0) {
          var computedvalue = justvalue
        }
        else {
          const partsarraylvli = _.filter(partsarray, {
            level: i
          })
          var searchpatt = new RegExp(CurrentSymPath + '.*')
          const childelements = _.filter(partsarraylvli, obj => searchpatt.test(obj.path))
          // var temparray=[]
          var computedvalue = {}
          const tempobject = {}
          if (childelements.length > 1) {
            for (var l = 0; l < childelements.length; l++) {
              var p = childelements[l].revpath
              var subpath = p.substring(0, p.lastIndexOf(currentsymbol) - 1).split('.').reverse().toString().replace(/[,]/g, '.')

              if (subpath === '') {
                tempobject[Object.getOwnPropertySymbols(childelements[l].value)[0]] = childelements[l].value
              }
              else {
                _.set(tempobject, subpath, childelements[l].value)
              }
              _.remove(partsarray, childelements[l])
            }
            computedvalue = tempobject
          }
          else if (childelements.length !== 0) {
            var p = childelements[l].revpath
            var subpath = p.substring(0, p.lastIndexOf(currentsymbol) - 1).split('.').reverse().toString().replace(/[,]/g, '.')
            _.set(computedvalue, subpath, childelements[l].value)
            _.remove(partsarray, childelements[l])
          }
        } // else

        if (!(_.isEmpty(computedvalue)) || (Object.getOwnPropertySymbols(computedvalue).length > 0)) {
          const onepartvalue = symbolconverter(Op, currentsymbol, computedvalue)
          onepart = {
            level: parseInt(k + 1), // 1
            sign: currentsymbol, // <lt>
            value: onepartvalue, // sym(lt):10
            revpath, // '<lt>.<or>.rank.where'
            path: CurrentSymPath
          }

          const itemcheck = _.find(partsarray, {
            sign: currentsymbol,
            level: (k + 1),
            path: CurrentSymPath
          }) //
          if (itemcheck === undefined) {
            partsarray.push(onepart)
          }
        }
      } // for internal
    } // for middle
  } // for external

  const object = {}
  const beenthere = []
  for (var m = 0; m < paths.length; m++) {
    var path = paths[m]
    const firstsymbol = path.match(/<[a-z]*>/g)[0]

    const objectpath = path.substr(0, path.lastIndexOf(firstsymbol) - 1)
    var fromIndex = 0
    if (!(_.includes(beenthere, objectpath, [fromIndex]))) {
      beenthere.push(objectpath)
      const searchpath = objectpath.substr(1) + '.' + firstsymbol

      const symbolvalue = _.find(partsarray, {
        sign: firstsymbol,
        path: searchpath
      }).value
      _.set(object, objectpath.substring(1), symbolvalue)
    }
  }
  console.log(object)
  return object
}

function symbolconverter (Op, key, value) {
  if ((typeof (value) === 'object') || (typeof (value) === 'undefined')) {
    console.log(value)
  }
  else if ((value === "'null'") || (value === "'null'")) {
    value = null
  }
  else if ((value.match('^[0-9]*$')) != null) {
    value = parseInt(value)
  }
  else if ((value.match(/^[+-]?\d+(\.\d+)?$/) != null)) {
    value = parseFloat(value)
  }
  // TODO ADD all operators
  switch (key) {
    case '<and>':
      var symbol = {
        [Op.and]: value
      }
      break
    case '<ne>':
      var symbol = {
        [Op.ne]: value
      }
      break
    case '<notLike>':
      var symbol = {
        [Op.notLike]: value
      }
      break
    case '<is>':
      var symbol = {
        [Op.is]: value
      }
      break
    case '<not>':
      var symbol = {
        [Op.not]: value
      }
      break
    case '<startsWith>':
      var symbol = {
        [Op.startsWith]: value
      }
      break
    case '<gt>':
      var symbol = {
        [Op.gt]: value
      }
      break
    case '<lt>':
      var symbol = {
        [Op.lt]: value
      }
      break
    case '<or>':
      var symbol = {
        [Op.or]: value
      }
      break
    case '<eq>':
      var symbol = {
        [Op.eq]: value
      }
      break
    case '<like>':
      var symbol = {
        [Op.like]: value
      }
      break
    default:
      console.error('unknown sequelize operator: ' + key + '\n')
  }
  return symbol
}

function iterate (obj) {
  // kudos: https://stackoverflow.com/questions/15690706/recursively-looping-through-an-object-to-build-a-property-list/53620876#53620876
  const walked = []
  const stack = [{
    obj,
    stack: ''
  }]
  const result = []

  while (stack.length > 0) {
    const item = stack.pop()
    var obj = item.obj
    for (const property in obj) {
      // eslint-disable-next-line no-prototype-builtins
      if (obj.hasOwnProperty(property)) {
        if (typeof obj[property] === 'object') {
          let alreadyFound = false
          for (let i = 0; i < walked.length; i++) {
            if (walked[i] === obj[property]) {
              alreadyFound = true
              break
            }
          }
          if (!alreadyFound) {
            walked.push(obj[property])
            stack.push({
              obj: obj[property],
              stack: item.stack + '.' + property
            })
          }
        }
        else {
          console.log(item.stack + '.' + property + '=' + obj[property])
          result.push(item.stack + '.' + property + '=' + obj[property])
        }
      }
    }
  }
  return result
}

export { query }
