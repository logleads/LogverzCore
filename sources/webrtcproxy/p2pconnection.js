/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

// kudos: https://levelup.gitconnected.com/send-files-over-a-data-channel-video-call-with-webrtc-step-6-d38f1ca5a351
const MAXIMUM_MESSAGE_SIZE = 196608 // 131070;
const END_OF_FILE_MESSAGE = 'EOF'

// https://www.npmjs.com/package/object-sizeof

const p2pconnection = async (req, res) => {
  const user = req.app.locals.user
  const commonshared = req.app.locals.commonshared
  const authenticationshared = req.app.locals.authenticationshared
  const engineshared = req.app.locals.engineshared
  const identities = req.app.locals.identities
  const queries = req.app.locals.queries
  const cert = req.app.settings.cert
  const docClient = req.app.locals.docClient
  const ddclient = req.app.locals.ddclient
  const PutItemCommand = req.app.locals.PutItemCommand
  const Peer = req.app.locals.Peer
  const wrtc = req.app.locals.wrtc
  const CryptoJS = req.app.locals.CryptoJS
  const XMLParser = req.app.locals.XMLParser
  const execFile = req.app.locals.execFile
  const jwt = req.app.locals.jwt
  const sqlproxy = req.app.locals.sqlproxy
  const Sequelize = req.app.locals.Sequelize
  const QueryTypes = req.app.locals.QueryTypes
  const Op = req.app.locals.Op
  const QueryCommand = req.app.locals.QueryCommand
  const UpdateCommand = req.app.locals.UpdateCommand
  const _ = req.app.locals.lodash
  const GetParameterCommand = req.app.locals.GetParameterCommand
  const ssmclient = req.app.locals.ssmclient
  const axios = req.app.locals.axios
  const fs = req.app.locals.fs
  const path = req.app.locals.path
  const promisify = req.app.locals.promisify

  const Registry = req.app.settings.DBRegistry
  const region = req.app.settings.region
  const gotablepath = req.app.settings.gotablepath

  const peer2 = new Peer({
    initiator: false,
    wrtc,
    objectMode: false
  })

  try {
    // check if request can be decrypted or not.
    const bytes = CryptoJS.AES.decrypt(req.body.ec.offer, req.app.settings.WebRTCProxyKey.Parameter.Value)
    const offer = bytes.toString(CryptoJS.enc.Utf8)
    peer2.signal(offer)
  }
  catch (e) {
    const loglevel = 'Error'
    const message = 'HTTP Request decrytion failed possible reason wrong key was used. Further details \n' + e
    console.log(message)
    const details = {
      source: 'p2pconnection.js:main',
      message
    }
    await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'WEBRTC', loglevel, 'Infra', details, 'API')
  }

  peer2.on('signal', data => {
    // send back the ok answer
    if (data.type === 'answer') {
      // console.log(JSON.stringify(data))
      const ciphertext = CryptoJS.AES.encrypt(JSON.stringify(data), req.app.settings.WebRTCProxyKey.Parameter.Value).toString() // key
      res.send(ciphertext)
    }
  })

  peer2.on('connect', async () => {
    // console.log(stringify(req))
    const tokenobject = commonshared.ValidateToken(jwt, req, cert)
    const channelvalue = await getchannelname(peer2)

    user.insert({
      User: tokenobject.value.user,
      ChannelName: channelvalue.label,
      Initiated: Math.floor(Date.now() / 1000)
    })
    const text = 'CONNECTED!!'
    for (let i = 0; i < text.length; i++) {
      await timeout(200)
      peer2.send(Uint8Array.from(text[i], x => x.charCodeAt(0)))
      peer2.send(END_OF_FILE_MESSAGE)
    }
    peer2.send(Uint8Array.from(success, x => x.charCodeAt(0))) // success
    peer2.send(END_OF_FILE_MESSAGE)
  })

  peer2.on('data', async (data) => {
    // got a data channel message
    console.log('got a message from the browser: ' + data)
    try {
      var clientrequest = JSON.parse(Buffer.from(data).toString('utf8'))
    }
    catch (err) {
      clientrequest = data
    }

    if (clientrequest.echo != null) {
      var message = clientrequest.echo + clientrequest.echo + clientrequest.echo
      // console.log("The Received Request:\n\n"+clientrequest)

      var arraybuffer = Uint8Array.from(message, x => x.charCodeAt(0))
      for (let i = 0; i < arraybuffer.length; i += MAXIMUM_MESSAGE_SIZE) {
        peer2.send(arraybuffer.slice(i, i + MAXIMUM_MESSAGE_SIZE))
      }
      peer2.send(END_OF_FILE_MESSAGE)
    }
    else if (clientrequest.query != null) {
      console.log('The Received Request:\n\n')
      const receivedrequest = Buffer.from(data).toString('utf8')
      console.log(receivedrequest)

      clientrequest = JSON.parse(clientrequest.query)
      // end users may use the escapes \" incorrectly, if thats the case we parse it again.
      // eslint-disable-next-line no-useless-escape
      if (clientrequest.query != null && clientrequest.query.includes('\"')) {
        clientrequest = JSON.parse(clientrequest.query)
      }

      const requestor = user.chain().find({
        ChannelName: peer2.channelName
      }).collection.data[0].User

      const requestoridentity = {
        Name: requestor.split(':')[1],
        Type: 'User' + requestor.split(':')[0]
      }

      var userattributes = identities.chain().find({
        Type: requestoridentity.Type,
        Name: requestoridentity.Name
      }).collection.data[0]

      if (userattributes === undefined) {
        userattributes = await authenticationshared.getidentityattributes(docClient, QueryCommand, requestoridentity.Name, requestoridentity.Type)
        userattributes = userattributes.Items[0]
        identities.insert(userattributes)
      }

      const [isadmin, ispoweruser] = await Promise.all([
        authenticationshared.admincheck(_, commonshared, docClient, identities, requestoridentity),
        authenticationshared.powerusercheck(_, commonshared, docClient, identities, requestoridentity, region)
      ])

      switch (clientrequest.Mode) {
        case 'Native': {
          let TablePermissions = []
          const tableList = await gettablesofquery(commonshared, engineshared, Registry, clientrequest, XMLParser, gotablepath, execFile, _, sqlproxy, ddclient, docClient, ssmclient, GetParameterCommand, PutItemCommand, QueryCommand, Sequelize, Op, QueryTypes, UpdateCommand, axios, fs, path, promisify)

          if ((isadmin || ispoweruser) && tableList.length > 0) {
            // we only allow Select statments for every one, if not select was issued the table list will be empty
            var isallallowed = true
          }
          else if (tableList.length > 0) {
            // console.log("TablePermissions"+ JSON.stringify(TablePermissions))
            TablePermissions = await gettablepermissions(tableList, authenticationshared, _, QueryCommand, docClient, identities, queries, clientrequest, requestoridentity, region)
            var isallallowed = (!TablePermissions.map(p => p.status === 'Allow').includes(false))
          }
          else {
            // tablelist is null when the query provided was not a select or mallformed either way no permission info could be gathered
            isallallowed = false
            TablePermissions.push({
              status: 'Cloud not retrieve tablepermissions for query, make sure you only execute select statements'
            })
          }

          if (isallallowed) {
            var loglevel = 'Info'
            var details = {
              source: 'p2pconnection.js:OnData',
              message: JSON.stringify({
                user: requestor,
                query: clientrequest.QueryParams
              })
            }
            await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'WEBRTC', loglevel, 'User', details, 'SQL')
            var sqlresult = await sqlproxy.query(clientrequest, Registry.Parameter.Value, commonshared, engineshared, ddclient, docClient, ssmclient, GetParameterCommand, PutItemCommand, _, QueryCommand, Sequelize, Op, QueryTypes, UpdateCommand, axios, fs, path, promisify)
            message = sqlresult
          }
          else {
            console.log(tableList)
            message = {
              status: 400,
              data: JSON.stringify(TablePermissions.filter(t => t.status !== 'Allow'))
            }
          }
          break
        }
        case 'ListTables':{
          // Listing of database tables, any authenticated user can list table names
          loglevel = 'Info'
          details = {
            source: 'p2pconnection.js:OnData',
            message: JSON.stringify({
              user: requestor,
              query: clientrequest.QueryParams
            })
          }
          await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'WEBRTC', loglevel, 'User', details, 'SQL')
          const alltableList = await sqlproxy.query(clientrequest, Registry.Parameter.Value, commonshared, engineshared, ddclient, docClient, ssmclient, GetParameterCommand, PutItemCommand, _, QueryCommand, Sequelize, Op, QueryTypes, UpdateCommand, axios, fs, path, promisify)

          if ((isadmin || ispoweruser) && JSON.parse(alltableList).length > 0) {
            message = alltableList
          }
          else {
            let allTablePermissions = await gettablepermissions(JSON.parse(alltableList), authenticationshared, _, QueryCommand, docClient, identities, queries, clientrequest, requestoridentity, region)
            allTablePermissions = allTablePermissions.filter((table) => table.status === 'Allow').map(t => t.TableName)
            const allowedtables = JSON.parse(alltableList).filter(element => allTablePermissions.includes(element))
            // let allowedtables= _.intersection( JSON.parse(alltableList), allTablePermissions )
            message = JSON.stringify(allowedtables)
          }

          break
        }
        case 'describeTable': {
          // Describing of database tables only Admins and poweruser can describe tables
          if (isadmin || ispoweruser) {
            const loglevel = 'Info'
            const details = {
              source: 'p2pconnection.js:OnData',
              message: JSON.stringify({
                user: requestor,
                query: clientrequest
              })
            }
            await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'WEBRTC', loglevel, 'User', details, 'SQL')
            sqlresult = await sqlproxy.query(clientrequest, Registry.Parameter.Value, commonshared, engineshared, ddclient, docClient, ssmclient, GetParameterCommand, PutItemCommand, _, QueryCommand, Sequelize, Op, QueryTypes, UpdateCommand, axios, fs, path, promisify)
            message = sqlresult
          }
          else {
            message = {
              status: 400,
              data: 'Unauthorized, only admins and powerusers can describe tables.'
            }
          }
          break
        }
        case 'DeleteTable': {
          var clientinputparams = {
            TableName: clientrequest.DBTableName,
            DatabaseName: clientrequest.LogverzDBFriendlyName,
            Operation: 'dynamodb:DeleteItem'
          }
          var authorization = await authenticationshared.resourceaccessauthorization(_, docClient, QueryCommand, identities, queries, clientinputparams, requestoridentity, region)

          if (authorization.status === 'Allow') {
            const loglevel = 'Info'
            const details = {
              source: 'p2pconnection.js:OnData',
              message: JSON.stringify({
                user: requestor,
                query: clientrequest
              })
            }
            await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'WEBRTC', loglevel, 'User', details, 'SQL')
            sqlresult = await sqlproxy.query(clientrequest, Registry.Parameter.Value, commonshared, engineshared, ddclient, docClient, ssmclient, GetParameterCommand, PutItemCommand, _, QueryCommand, Sequelize, Op, QueryTypes, UpdateCommand, axios, fs, path, promisify)
            message = sqlresult
          }
          else {
            message = JSON.stringify(authorization)
          }
          break
        }
        default: {
          // Sequalise style Table queries
          clientinputparams = {
            TableName: clientrequest.DBTableName,
            DatabaseName: clientrequest.LogverzDBFriendlyName,
            DataType: clientrequest.QueryType,
            Operation: 'dynamodb:Query'
          }
          authorization = await authenticationshared.resourceaccessauthorization(_, docClient, QueryCommand, identities, queries, clientinputparams, requestoridentity, region)

          if (authorization.status === 'Allow') {
            sqlresult = await sqlproxy.query(clientrequest, Registry.Parameter.Value, commonshared, engineshared, ddclient, docClient, ssmclient, GetParameterCommand, PutItemCommand, _, QueryCommand, Sequelize, Op, QueryTypes, UpdateCommand, axios, fs, path, promisify)
            message = sqlresult
          }
          else {
            message = JSON.stringify(authorization)
          }
        }
      }

      arraybuffer = Uint8Array.from(message, x => x.charCodeAt(0))
      for (let i = 0; i < arraybuffer.length; i += MAXIMUM_MESSAGE_SIZE) {
        peer2.send(arraybuffer.slice(i, i + MAXIMUM_MESSAGE_SIZE))
      }
      peer2.send(END_OF_FILE_MESSAGE)
    }
  })

  peer2.on('close', () => {
    const username = user.chain().find({
      ChannelName: peer2.channelName
    }).collection.data[0].User
    console.log('The server connection closed:\n' + 'username:' + username + '\nChannelname:' + peer2.channelName)
    user.chain().find({
      ChannelName: peer2.channelName
    }).remove()
  })

  peer2.on('error', (err) => {
    if (err.message === 'Ice connection failed') {
      console.log('Warning:' + err + '\nConnection id:' + peer2._id + '\nChannelname:' + peer2.channelName + '.\nNote that Ice Connection failure occures if user closed browser,with out logging out.')
    }
    else {
      console.log('Error:' + err + '\nConnection id:' + peer2._id + '\nChannelname:' + peer2.channelName + '.\n')
    }
  })
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getchannelname (peer2) {
  const stats = await peer2._pc.getStats()
  const objectkeys = []
  stats.forEach((value, key) => {
    // console.log(`${key}: ${value}`);
    objectkeys.push(key)
  })

  const channelname = objectkeys.filter(k => k.includes('RTCDataChannel'))[0]
  const channelvalue = stats.get(channelname)
  return channelvalue
}

async function gettablesofquery (commonshared, engineshared, Registry, clientrequest, XMLParser, gotablepath, execFile, _, sqlproxy, ddclient, docClient, ssmclient, GetParameterCommand, PutItemCommand, QueryCommand, Sequelize, Op, QueryTypes, UpdateCommand, axios, fs, path, promisify) {
  const connectionstringsarray = _.reject(Registry.Parameter.Value.split('[[DBDELIM]]'), _.isEmpty)
  const dbp = commonshared.DBpropertylookup(connectionstringsarray, clientrequest.LogverzDBFriendlyName)

  if (dbp.DBEngineType === 'postgres') {
    // By using SQL Explain statement for postgres we ensure that only Select statements can be executed.
    const validationrequest = {
      Mode: 'Native',
      LogverzDBFriendlyName: clientrequest.LogverzDBFriendlyName,
      QueryParams: 'Explain(FORMAT JSON)(' + clientrequest.QueryParams + ')'
    }
    var executionplan = await sqlproxy.query(validationrequest, Registry.Parameter.Value, commonshared, engineshared, ddclient, docClient, ssmclient, GetParameterCommand, PutItemCommand, _, QueryCommand, Sequelize, Op, QueryTypes, UpdateCommand, axios, fs, path, promisify)
    if (executionplan !== '[]') { // postgres type
      const Plans = JSON.parse(executionplan)[0]['QUERY PLAN'][0].Plan.Plans
      var tables = _.flatten(Plans.map(p => p['Relation Name']))
    }
    else {
      // empty response no permission, wrong syntax or not Select statement
      var tables = []
    }
  }
  else if (dbp.DBEngineType.match('mssql')) {
    // Evaulation logic
    // 0 check if query contains commit if yes stop.
    // 1 check if query plan is retrievable
    // 2a if not than use a transaction to run the query go to 2b
    // 2b retrive query plan,
    // 3 check if it is the execution plan or only plan handle
    // 4 if only plan handle run second query to retrieve the execution plan
    // Native SQL query example: {"LogverzDBFriendlyName":"MSSQL","Mode":"Native","QueryParams":"SELECT * FROM Logverz.dbo.Invocations WHERE id BETWEEN 0 AND 500"}

    if (clientrequest.QueryParams.includes('commit') === true) {
      tables = []
      console.log('commit not allowed in the query string')
    }
    else {
      // 1 check if query plan is retrievable
      let QueryParams = "with xmlnamespaces (default 'http://schemas.microsoft.com/sqlserver/2004/07/showplan') "
      QueryParams += "SELECT cplan.usecounts, cplan.objtype, qtext.text, qplan.query_plan, query_plan.value('(/ShowPlanXML/BatchSequence/Batch/Statements/StmtSimple/@ParameterizedPlanHandle)[1]', 'varchar(max)') as plan_handle FROM sys.dm_exec_cached_plans AS cplan "
      QueryParams += 'CROSS APPLY sys.dm_exec_sql_text(plan_handle) AS qtext '
      QueryParams += 'CROSS APPLY sys.dm_exec_query_plan(plan_handle) AS qplan '
      QueryParams += `WHERE text = '${clientrequest.QueryParams.replaceAll("'", "''")}' ` // OR text ='BEGIN TRANSACTION ${clientrequest.QueryParams} ROLLBACK TRANSACTION'
      QueryParams += 'ORDER BY cplan.usecounts DESC'

      const validationrequest = {
        Mode: 'Native',
        LogverzDBFriendlyName: clientrequest.LogverzDBFriendlyName,
        QueryParams
      }

      var executionplan = JSON.parse(await sqlproxy.query(validationrequest, Registry.Parameter.Value, commonshared, engineshared, ddclient, docClient, ssmclient, GetParameterCommand, PutItemCommand, _, QueryCommand, Sequelize, Op, QueryTypes, UpdateCommand, axios, fs, path, promisify))

      if (executionplan.length === 0) {
        const transactionrequest = {
          Mode: 'Transaction',
          LogverzDBFriendlyName: clientrequest.LogverzDBFriendlyName,
          QueryParams: clientrequest.QueryParams
        }

        // 2a if not than use a transaction to run the query go to 2b
        await sqlproxy.query(transactionrequest, Registry.Parameter.Value, commonshared, engineshared, ddclient, docClient, ssmclient, GetParameterCommand, PutItemCommand, _, QueryCommand, Sequelize, Op, QueryTypes, UpdateCommand, axios, fs, path, promisify)
        // 2b retrive query plan
        var executionplan = JSON.parse(await sqlproxy.query(validationrequest, Registry.Parameter.Value, commonshared, engineshared, ddclient, docClient, ssmclient, GetParameterCommand, PutItemCommand, _, QueryCommand, Sequelize, Op, QueryTypes, UpdateCommand, axios, fs, path, promisify))
      }

      // 3 check if it is the execution plan or only plan handle
      if (executionplan[0].plan_handle !== 'NULL' && executionplan[0].plan_handle != null) {
        let planHandleQuery = 'SELECT plan_handle,text, query_plan,query_hash,query_plan_hash FROM sys.dm_exec_query_stats AS qstats '
        planHandleQuery += 'CROSS APPLY sys.dm_exec_query_plan(qstats.plan_handle) AS qplan '
        planHandleQuery += 'CROSS apply sys.dm_exec_sql_text(qstats.plan_handle) as qtext '
        planHandleQuery += `WHERE plan_handle =${executionplan[0].plan_handle}`
        validationrequest.QueryParams = planHandleQuery
        // 3 if only plan handle run second query to retrieve the execution plan
        var executionplan = JSON.parse(await sqlproxy.query(validationrequest, Registry.Parameter.Value, commonshared, engineshared, ddclient, docClient, ssmclient, GetParameterCommand, PutItemCommand, _, QueryCommand, Sequelize, Op, QueryTypes, UpdateCommand, axios, fs, path, promisify))
      }
      var executionplan = executionplan[0].query_plan
    }

    // process XML results
    const options = {
      ignoreAttributes: false,
      attributeNamePrefix: 'Attr_',
      attributesGroupName: 'Attr_'
    }

    const parser = new XMLParser(options)
    const jObj = parser.parse(executionplan)
    const statements = jObj.ShowPlanXML.BatchSequence.Batch.Statements.StmtSimple
    const statementtype = statements.Attr_.Attr_StatementType

    // Evaluate execution plan
    if (statementtype === 'SELECT') {
      const ColumnReference = deepSearchByKey(jObj, 'ColumnReference')
      const Attr = (deepSearchByKey(ColumnReference, 'Attr_Table')).map(a => a.Attr_Table)
      tables = [...new Set(Attr)].map(t => t.replace('[', '').replace(']', ''))
    }
    else {
      tables = []
    }
  }
  else if (dbp.DBEngineType === 'mysql') {
    // Use mysql query explain to validate the only SELECT statements are made.
    let isselect = true
    const validationrequest = {
      Mode: 'Native',
      LogverzDBFriendlyName: clientrequest.LogverzDBFriendlyName,
      QueryParams: 'Explain format=json ' + clientrequest.QueryParams
    }
    const executionplan = await sqlproxy.query(validationrequest, Registry.Parameter.Value, commonshared, engineshared, ddclient, docClient, ssmclient, GetParameterCommand, PutItemCommand, _, QueryCommand, Sequelize, Op, QueryTypes, UpdateCommand, axios, fs, path, promisify)
    const queryblock = JSON.parse(JSON.parse(executionplan)[0].EXPLAIN)
    console.log(queryblock)

    const del = (deepSearchByKey(queryblock, 'delete'))[0]
    const upd = (deepSearchByKey(queryblock, 'update'))[0]
    const rep = (deepSearchByKey(queryblock, 'replace'))[0]
    const ins = (deepSearchByKey(queryblock, 'insert'))[0]
    if (del || upd || rep || ins) {
      isselect = false
    }

    // Use external library to mitigate MYSQL bug reported in 2006!!
    // https://bugs.mysql.com/bug.php?id=24693
    const tablesstring = await run(gotablepath, [clientrequest.QueryParams], execFile)

    if ((isselect) && (tablesstring.length >= 1)) {
      tables = [...new Set(tablesstring.replace('[', '').replace(']', '').split(' '))]
    }
    else {
      // empty response wrong syntax and or not Select statement
      tables = []
    }
  }

  return tables
}

async function gettablepermissions (tableList, authenticationshared, _, QueryCommand, docClient, identities, queries, clientrequest, requestoridentity, region) {
  const promises = tableList.map(onetable => {
    const tablepermissionpromise = new Promise((resolve, reject) => {
      const clientinputparams = {
        TableName: onetable,
        DatabaseName: clientrequest.LogverzDBFriendlyName,
        Operation: 'dynamodb:Query'
      }
      resolve(authenticationshared.resourceaccessauthorization(_, docClient, QueryCommand, identities, queries, clientinputparams, requestoridentity, region))
    })
    return tablepermissionpromise
  })
  var TablePermissions = await Promise.all(promises)
  return TablePermissions
}

async function run (gotablepath, QueryParams, execFile) {
  // kudos: https://medium.com/deno-the-complete-reference/two-common-ways-to-run-child-process-in-node-js-fa3d8986be52
  const {
    stdout,
    stderr
  } = await execFile(gotablepath, QueryParams)
  // console.log('stdout:', stdout);

  if (stderr) {
    console.log('stderr:', stderr)
  }
  return stdout
}

function deepSearchByKey (object, originalKey, matches = []) {
  // kudos: https://stackoverflow.com/questions/15523514/find-by-key-deep-in-a-nested-array
  // let result = deepSearchByKey(arrayOrObject, 'table_name')
  // alternative: https://jsfiddle.net/S2hsS
  if (object != null) {
    if (Array.isArray(object)) {
      for (const arrayItem of object) {
        deepSearchByKey(arrayItem, originalKey, matches)
      }
    }
    else if (typeof object === 'object') {
      for (const key of Object.keys(object)) {
        if (key === originalKey) {
          matches.push(object)
        }
        else {
          deepSearchByKey(object[key], originalKey, matches)
        }
      }
    }
  }

  return matches
}

export { p2pconnection }

var success = `
+88_________________+880_______
_+880_______________++80_______
_++88______________+880________
_++88_____________++88________
__+880___________++88_________
__+888_________++880__________
__++880_______++880___________
__++888_____+++880____________
__++8888__+++8880++88_________
__+++8888+++8880++8888________
___++888++8888+++888888+80____
___++88++8888++8888888++888___
___++++++888888fx88888888888___
____++++++88888888888888888___
____++++++++000888888888888___
_____+++++++00008f8888888888___
______+++++++00088888888888___
_______+++++++0888f8888888
`
// Kudos:https://textart4u.blogspot.com/2012/03/victory-sign-text-art-ascii-art.html?m=0
