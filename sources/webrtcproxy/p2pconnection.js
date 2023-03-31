var Peer = require('simple-peer');
var wrtc = require('wrtc');
var sqlproxy = require('./sqlproxy');
var CryptoJS = require("crypto-js"); //Kudos:https://dev.to/halan/4-ways-of-symmetric-cryptography-and-javascript-how-to-aes-with-javascript-3o1b
var jwt = require('jsonwebtoken');
//const {parse, stringify} = require('flatted');
var _ = require('lodash');
var uuid = require('uuid');
const util = require('util');
const execFile = util.promisify(require('child_process').execFile);
const fsPromises = require('fs').promises;
const {
    XMLParser
} = require('fast-xml-parser');

//kudos: https://levelup.gitconnected.com/send-files-over-a-data-channel-video-call-with-webrtc-step-6-d38f1ca5a351
const MAXIMUM_MESSAGE_SIZE = 196608; //131070;
const END_OF_FILE_MESSAGE = 'EOF';

//https://www.npmjs.com/package/object-sizeof

exports.p2pconnection = async function (req, res) {

    var user = req.app.locals.user;
    var commonshared = req.app.locals.commonshared;
    var authenticationshared = req.app.locals.authenticationshared;
    var engineshared = req.app.locals.engineshared
    var identities = req.app.locals.identities;
    var queries = req.app.locals.queries;
    var cert = req.app.settings.cert;
    var docClient = req.app.locals.docClient;
    var dynamodb = req.app.locals.dynamodb;
    var SSM = req.app.locals.SSM;
    var Registry = req.app.settings.DBRegistry;
    var region = req.app.settings.region;
    var gotablepath = req.app.settings.gotablepath;
    var mssqlqueryplanspath = req.app.settings.mssqlqueryplanspath;

    var peer2 = new Peer({
        initiator: false,
        wrtc: wrtc,
        objectMode: false
    });

    try {
        //check if request can be decrypted or not.
        var bytes = CryptoJS.AES.decrypt(req.body.ec.offer, req.app.settings.WebRTCProxyKey.Parameter.Value);
        var offer = bytes.toString(CryptoJS.enc.Utf8);
        peer2.signal(offer);
    } catch (e) {
        var loglevel = "Error";
        var message = 'HTTP Request decrytion failed possible reason wrong key was used. Further details \n' + e
        console.log(message)
        var details = {
            "source": "p2pconnection.js:main",
            "message": message
        };
        await commonshared.AddDDBEntry(dynamodb, "Logverz-Invocations", "WEBRTC", loglevel, "Infra", details, "API");
    }

    peer2.on('signal', data => {

        //send back the ok answer
        if (data.type == "answer") {
            //console.log(JSON.stringify(data))
            var ciphertext = CryptoJS.AES.encrypt(JSON.stringify(data), req.app.settings.WebRTCProxyKey.Parameter.Value).toString(); //key
            res.send(ciphertext);
        }
    })

    peer2.on('connect', async () => {
        //console.log(stringify(req))
        var tokenobject = commonshared.ValidateToken(jwt, req, cert);
        var channelvalue = await getchannelname(peer2);

        user.insert({
            User: tokenobject.value.user,
            ChannelName: channelvalue.label,
            Initiated: Math.floor(Date.now() / 1000)
        });
        var text = "CONNECTED!!";
        for (var i = 0; i < text.length; i++) {
            await timeout(200);
            peer2.send(Uint8Array.from(text[i], x => x.charCodeAt(0)));
            peer2.send(END_OF_FILE_MESSAGE);

        }
        peer2.send(Uint8Array.from(success, x => x.charCodeAt(0))); //success
        peer2.send(END_OF_FILE_MESSAGE);
    })

    peer2.on('data', async (data) => {
        // got a data channel message
        console.log('got a message from the browser: ' + data)
        try {
            var clientrequest = JSON.parse(Buffer.from(data).toString('utf8'));
        } catch (err) {
            var clientrequest = data
        }

        if (clientrequest.echo != null) {
            var message = clientrequest.echo + clientrequest.echo + clientrequest.echo;
            //console.log("The Received Request:\n\n"+clientrequest)

            var arraybuffer = Uint8Array.from(message, x => x.charCodeAt(0));
            for (let i = 0; i < arraybuffer.length; i += MAXIMUM_MESSAGE_SIZE) {
                peer2.send(arraybuffer.slice(i, i + MAXIMUM_MESSAGE_SIZE));
            }
            peer2.send(END_OF_FILE_MESSAGE);
        } else if (clientrequest.query != null) {
            console.log("The Received Request:\n\n")
            var receivedrequest = Buffer.from(data).toString('utf8');
            console.log(receivedrequest);

            clientrequest = JSON.parse(clientrequest.query);
            //end users may use the escapes \" incorrectly, if thats the case we parse it again.
            if (clientrequest.query != null && clientrequest.query.includes('\"')) {
                clientrequest = JSON.parse(clientrequest.query)
            }

            var requestor = user.chain().find({
                'ChannelName': peer2.channelName
            }).collection.data[0].User;
            var requestoridentity = {
                "Name": requestor.split(":")[1],
                "Type": "User" + requestor.split(":")[0]
            };

            if (clientrequest.Mode == "Native") {

                var TablePermissions = []
                var tableList = await gettablesofquery(commonshared, engineshared, SSM, Registry, clientrequest, mssqlqueryplanspath, gotablepath);
                var userattributes = identities.chain().find({
                    'Type': requestoridentity.Type,
                    'Name': requestoridentity.Name
                }).collection.data[0];

                if (userattributes == undefined) {
                    var userattributes = await authenticationshared.getidentityattributes(commonshared, docClient, requestoridentity.Name, requestoridentity.Type);
                    userattributes = userattributes.Items[0];
                    identities.insert(userattributes);
                }
                var [isadmin, ispoweruser] = await Promise.all([
                    authenticationshared.admincheck(_, commonshared, docClient, identities, requestoridentity),
                    authenticationshared.powerusercheck(_, commonshared, docClient, identities, requestoridentity, region)
                ]);

                if ((isadmin || ispoweruser) && tableList.length > 0) {
                    // we only allow Select statments for every one, if not select was issued the table list will be empty 
                    var isallallowed = true
                    //console.log("isallallowed: " +isallallowed )
                } else if (tableList.length > 0) {

                    var promises = tableList.map(onetable => {
                        var tablepermissionpromise = new Promise((resolve, reject) => {
                            var clientinputparams = {
                                'TableName': onetable,
                                'DatabaseName': clientrequest.LogverzDBFriendlyName,
                                "Operation": "dynamodb:Query"
                            };
                            resolve(authenticationshared.resourceaccessauthorization(_, commonshared, docClient, identities, queries, clientinputparams, requestoridentity, region));
                        });
                        return tablepermissionpromise;
                    });
                    TablePermissions = await Promise.all(promises);
                    //console.log("TablePermissions"+ JSON.stringify(TablePermissions))
                    var isallallowed = (!TablePermissions.map(p => p.status == 'Allow').includes(false));
                } else {
                    //tablelist is null when the query provided was not a select or mallformed either way no permission info could be gathered
                    isallallowed = false
                    TablePermissions.push({
                        status: "Cloud not retrieve tablepermissions for query, make sure you only execute select statements"
                    })
                }

                if (isallallowed) {
                    var loglevel = "Info";
                    var details = {
                        "source": "p2pconnection.js:OnData",
                        "message": JSON.stringify({
                            "user": requestor,
                            "query": clientrequest.QueryParams
                        })
                    };
                    await commonshared.AddDDBEntry(dynamodb, "Logverz-Invocations", "WEBRTC", loglevel, "User", details, "SQL");
                    var sqlresult = await sqlproxy.sqlproxy(clientrequest, Registry.Parameter.Value, commonshared, engineshared);
                    var message = sqlresult;
                } else {
                    console.log(tableList)
                    var message = {
                        "status": 400,
                        "data": JSON.stringify(TablePermissions.filter(t => t.status != "Allow"))
                    };
                }


            } else if (clientrequest.Mode == "ListTables") {
                //Listing of database tables, any authenticated user can list table names 
                var loglevel = "Info";
                var details = {
                    "source": "p2pconnection.js:OnData",
                    "message": JSON.stringify({
                        "user": requestor,
                        "query": clientrequest.QueryParams
                    })
                };
                await commonshared.AddDDBEntry(dynamodb, "Logverz-Invocations", "WEBRTC", loglevel, "User", details, "SQL");

                var sqlresult = await sqlproxy.sqlproxy(clientrequest, Registry.Parameter.Value, commonshared, engineshared);
                var message = sqlresult;
            } else if (clientrequest.Mode == "describeTable") {
                //Describing of database tables only Admins and poweruser can describe tables

                var userattributes = identities.chain().find({
                    'Type': requestoridentity.Type,
                    'Name': requestoridentity.Name
                }).collection.data[0];

                if (userattributes == undefined) {
                    var userattributes = await authenticationshared.getidentityattributes(commonshared, docClient, requestoridentity.Name, requestoridentity.Type);
                    userattributes = userattributes.Items[0];
                    identities.insert(userattributes);
                }
                var [isadmin, ispoweruser] = await Promise.all([
                    authenticationshared.admincheck(_, commonshared, docClient, identities, requestoridentity),
                    authenticationshared.powerusercheck(_, commonshared, docClient, identities, requestoridentity, region)
                ]);
                if (isadmin || ispoweruser) {
                    var loglevel = "Info";
                    var details = {
                        "source": "p2pconnection.js:OnData",
                        "message": JSON.stringify({
                            "user": requestor,
                            "query": clientrequest
                        })
                    };
                    await commonshared.AddDDBEntry(dynamodb, "Logverz-Invocations", "WEBRTC", loglevel, "User", details, "SQL");

                    var sqlresult = await sqlproxy.sqlproxy(clientrequest, Registry.Parameter.Value, commonshared, engineshared);
                    var message = sqlresult;
                } else {
                    var message = {
                        "status": 400,
                        "data": "Unauthorized, only admins and powerusers can describe tables."
                    }
                }
            } else if (clientrequest.Mode == "DeleteTable") {

                var clientinputparams = {
                    'TableName': clientrequest.DBTableName,
                    'DatabaseName': clientrequest.LogverzDBFriendlyName,
                    "Operation": "dynamodb:DeleteItem"
                };
                var authorization = await authenticationshared.resourceaccessauthorization(_, commonshared, docClient, identities, queries, clientinputparams, requestoridentity, region);
                if (authorization.status == "Allow") {
                    var loglevel = "Info";
                    var details = {
                        "source": "p2pconnection.js:OnData",
                        "message": JSON.stringify({
                            "user": requestor,
                            "query": clientrequest
                        })
                    };
                    await commonshared.AddDDBEntry(dynamodb, "Logverz-Invocations", "WEBRTC", loglevel, "User", details, "SQL");

                    var sqlresult = await sqlproxy.sqlproxy(clientrequest, Registry.Parameter.Value, commonshared, engineshared);
                    var message = sqlresult;
                } else {
                    var message = JSON.stringify(authorization);
                }
            } else {
                //Sequalise style Table queries
                var clientinputparams = {
                    'TableName': clientrequest.DBTableName,
                    'DatabaseName': clientrequest.LogverzDBFriendlyName,
                    'DataType': clientrequest.QueryType,
                    "Operation": "dynamodb:Query"
                };
                var authorization = await authenticationshared.resourceaccessauthorization(_, commonshared, docClient, identities, queries, clientinputparams, requestoridentity, region);

                if (authorization.status == "Allow") {
                    var sqlresult = await sqlproxy.sqlproxy(clientrequest, Registry.Parameter.Value, commonshared, engineshared);
                    var message = sqlresult;
                } else {
                    var message = JSON.stringify(authorization);
                }
            }

            var arraybuffer = Uint8Array.from(message, x => x.charCodeAt(0));
            for (let i = 0; i < arraybuffer.length; i += MAXIMUM_MESSAGE_SIZE) {
                peer2.send(arraybuffer.slice(i, i + MAXIMUM_MESSAGE_SIZE));
            }
            peer2.send(END_OF_FILE_MESSAGE);
        }
    })

    peer2.on('close', () => {

        var username = user.chain().find({
            'ChannelName': peer2.channelName
        }).collection.data[0].User
        console.log('The server connection closed:\n' + 'username:' + username + '\nChannelname:' + peer2.channelName);
        user.chain().find({
            'ChannelName': peer2.channelName
        }).remove();

    })

    peer2.on('error', (err) => {
        if (err.message == 'Ice connection failed') {
            console.log('Warning:' + err + '\nConnection id:' + peer2._id + '\nChannelname:' + peer2.channelName + '.\nNote that Ice Connection failure occures if user closed browser,with out logging out.');
        } else {
            console.log('Error:' + err + '\nConnection id:' + peer2._id + '\nChannelname:' + peer2.channelName + '.\n');
        }
    })
};

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getchannelname(peer2) {

    var stats = await peer2._pc.getStats();
    var objectkeys = []
    stats.forEach((value, key) => {
        //console.log(`${key}: ${value}`);
        objectkeys.push(key)
    });

    var channelname = objectkeys.filter(k => k.includes('RTCDataChannel'))[0];
    var channelvalue = stats.get(channelname);
    return channelvalue
}

async function gettablesofquery(commonshared, engineshared, SSM, Registry, clientrequest, mssqlqueryplanspath, gotablepath) {

    var connectionstringsarray = _.reject(Registry.Parameter.Value.split('[[DBDELIM]]'), _.isEmpty);
    var dbp = engineshared.DBpropertylookup(connectionstringsarray, clientrequest.LogverzDBFriendlyName);

    if (dbp.DBEngineType == "postgres") {
        // By using SQL Explain statement for postgres we ensure that only Select statements can be executed.
        var validationrequest = {
            "Mode": "Native",
            "LogverzDBFriendlyName": clientrequest.LogverzDBFriendlyName,
            "QueryParams": "Explain(FORMAT JSON)(" + clientrequest.QueryParams + ")"
        }
        var executionplan = await sqlproxy.sqlproxy(validationrequest, Registry.Parameter.Value, commonshared, engineshared);
        if (executionplan != "[]") { //postgres type
            var Plans = JSON.parse(executionplan)[0]["QUERY PLAN"][0].Plan.Plans
            var tables = _.flatten(Plans.map(p => p["Relation Name"]));
        } else {
            //empty response no permission, wrong syntax or not Select statement
            var tables = []
        }
    } else if (dbp.DBEngineType.match("mssql")) {

        // Evaulation logic
        // 0 check if query contains commit if yes stop.
        // 1 check if query plan is retrievable
        // 2a if not than use a transaction to run the query go to 2b
        // 2b retrive query plan, 
        // 3 check if it is the execution plan or only plan handle
        // 4 if only plan handle run second query to retrieve the execution plan 
        //Native SQL query example: {"LogverzDBFriendlyName":"MSSQL","Mode":"Native","QueryParams":"SELECT * FROM Logverz.dbo.Invocations WHERE id BETWEEN 0 AND 500"}

        if (clientrequest.QueryParams.includes("commit") == true ){
            var tables =[]
            console.log("commit not allowed in the query string")
        }
        else{
            //1 check if query plan is retrievable 
            var QueryParams="with xmlnamespaces (default 'http://schemas.microsoft.com/sqlserver/2004/07/showplan') "
                QueryParams+="SELECT cplan.usecounts, cplan.objtype, qtext.text, qplan.query_plan, query_plan.value('(/ShowPlanXML/BatchSequence/Batch/Statements/StmtSimple/@ParameterizedPlanHandle)[1]', 'varchar(max)') as plan_handle FROM sys.dm_exec_cached_plans AS cplan "
                QueryParams+="CROSS APPLY sys.dm_exec_sql_text(plan_handle) AS qtext "
                QueryParams+="CROSS APPLY sys.dm_exec_query_plan(plan_handle) AS qplan "
                QueryParams+=`WHERE text = '${clientrequest.QueryParams.replaceAll("'","''")}' ` //OR text ='BEGIN TRANSACTION ${clientrequest.QueryParams} ROLLBACK TRANSACTION'
                QueryParams+="ORDER BY cplan.usecounts DESC"

            var validationrequest = {
                "Mode": "Native",
                "LogverzDBFriendlyName": clientrequest.LogverzDBFriendlyName,
                "QueryParams": QueryParams
            }

            var executionplan = JSON.parse(await sqlproxy.sqlproxy(validationrequest, Registry.Parameter.Value, commonshared, engineshared));

            if (executionplan.length == 0){
                var transactionrequest ={
                    "Mode": "Transaction",
                    "LogverzDBFriendlyName": clientrequest.LogverzDBFriendlyName,
                    "QueryParams": clientrequest.QueryParams
                }

                //2a if not than use a transaction to run the query go to 2b
                await sqlproxy.sqlproxy(transactionrequest, Registry.Parameter.Value, commonshared, engineshared)
                //2b retrive query plan
                executionplan = JSON.parse(await sqlproxy.sqlproxy(validationrequest, Registry.Parameter.Value, commonshared, engineshared));

            }

            //3 check if it is the execution plan or only plan handle
            if (executionplan[0].plan_handle != "NULL" && executionplan[0].plan_handle != null){
                
                var plan_handle_query="SELECT plan_handle,text, query_plan,query_hash,query_plan_hash FROM sys.dm_exec_query_stats AS qstats "
                plan_handle_query+="CROSS APPLY sys.dm_exec_query_plan(qstats.plan_handle) AS qplan "
                plan_handle_query+="CROSS apply sys.dm_exec_sql_text(qstats.plan_handle) as qtext "
                plan_handle_query+=`WHERE plan_handle =${executionplan[0].plan_handle}`
                validationrequest.QueryParams=plan_handle_query
                //3 if only plan handle run second query to retrieve the execution plan 
                executionplan = JSON.parse(await sqlproxy.sqlproxy(validationrequest, Registry.Parameter.Value, commonshared, engineshared));
                
            }
            executionplan=executionplan[0].query_plan

        }
        
        //process XML results
        const options = {
            ignoreAttributes: false,
            attributeNamePrefix: "Attr_",
            attributesGroupName: "Attr_"
        };

        const parser = new XMLParser(options);
        var jObj = parser.parse(executionplan);
        var statements = jObj.ShowPlanXML.BatchSequence.Batch.Statements.StmtSimple
        var statementtype = statements.Attr_.Attr_StatementType

        //Evaluate execution plan 
        if (statementtype == "SELECT") {
            var ColumnReference = deepSearchByKey(jObj, 'ColumnReference')
            var Attr = (deepSearchByKey(ColumnReference, 'Attr_Table')).map(a => a.Attr_Table)
            var tables = [...new Set(Attr)].map(t => t.replace('[', '').replace(']', ''))
        } else {
            var tables = []
        }

    } else if (dbp.DBEngineType == "mysql") {
        //Use mysql query explain to validate the only SELECT statements are made.  
        var isselect = true
        var validationrequest = {
            "Mode": "Native",
            "LogverzDBFriendlyName": clientrequest.LogverzDBFriendlyName,
            "QueryParams": "Explain format=json " + clientrequest.QueryParams
        }
        var executionplan = await sqlproxy.sqlproxy(validationrequest, Registry.Parameter.Value, commonshared, engineshared);
        var queryblock = JSON.parse(JSON.parse(executionplan)[0].EXPLAIN);
        console.log(queryblock)

        var del = (deepSearchByKey(queryblock, 'delete'))[0]
        var upd = (deepSearchByKey(queryblock, 'update'))[0]
        var rep = (deepSearchByKey(queryblock, 'replace'))[0]
        var ins = (deepSearchByKey(queryblock, 'insert'))[0]
        if (del || upd || rep || ins) {
            isselect = false
        }
        
        //Use external library to mitigate MYSQL bug reported in 2006!!
        //https://bugs.mysql.com/bug.php?id=24693
        var tablesstring = await run(gotablepath, [clientrequest.QueryParams]);

        if ((isselect) && (tablesstring.length >= 1)) {
            var tables = [...new Set(tablesstring.replace("[", "").replace("]", "").split(" "))]
        } else {
            //empty response wrong syntax and or not Select statement
            var tables = []
        }
    }

    return tables
}

async function run(gotablepath, QueryParams) {
    const {
        stdout,
        stderr
    } = await execFile(gotablepath, QueryParams);
    //console.log('stdout:', stdout);
    
    if (stderr) {
        console.log('stderr:', stderr);
    }
    return stdout
}

function deepSearchByKey(object, originalKey, matches = []) {
    //kudos: https://stackoverflow.com/questions/15523514/find-by-key-deep-in-a-nested-array
    //let result = deepSearchByKey(arrayOrObject, 'table_name')
    //alternative: https://jsfiddle.net/S2hsS
    if (object != null) {
        if (Array.isArray(object)) {
            for (let arrayItem of object) {
                deepSearchByKey(arrayItem, originalKey, matches);
            }
        } else if (typeof object == 'object') {

            for (let key of Object.keys(object)) {
                if (key == originalKey) {
                    matches.push(object);
                } else {
                    deepSearchByKey(object[key], originalKey, matches);
                }

            }

        }
    }

    return matches;
}

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
//Kudos:https://textart4u.blogspot.com/2012/03/victory-sign-text-art-ascii-art.html?m=0