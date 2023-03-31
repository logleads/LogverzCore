const AWS = require('aws-sdk');
var jwt = require('jsonwebtoken');
const fs = require('fs');
path = require('path');
var _ = require('lodash');
var db = require('./db').db;
if (db.collections.length==0){
    var identity=db.addCollection('Logverz-Identities', {"ttl":20*60*1000});
}
console.log("start")

module.exports.handler = async function (event, context) {
    console.log('REQUEST RECEIVED: \n' + JSON.stringify(context)+'\n\n');
    console.log('THE EVENT: \n' + JSON.stringify(event)+'\n\n');

    if (process.env.Environment =="Windows"){
        var region = "ap-southeast-2";
        var accountnumber="accountnumber";
        var commonshared=require('../shared/commonshared');
        var authenticationshared=require('../shared/authenticationshared');
        var event = apigwevent;
        var context = apigwcontext;
        var cert = fs.readFileSync(path.join(__dirname, '..', '..', 'infrastructure', 'public.key'));
        var AllowedOrigins="http://localhost:8080,http://127.0.0.1:8080,https://testapi.logleads.com";
    }
    else { //lambda function settings 
        var arnList = (context.invokedFunctionArn).split(":");
        var region = arnList[3];
        var accountnumber=arnList[4];
        var commonshared=require('./shared/commonshared');
        var authenticationshared=require('./shared/authenticationshared');
        var cert =process.env.PublicKey;
        var AllowedOrigins=process.env.AllowedOrigins;
    }
    var arnList = (context.invokedFunctionArn).split(":");

	AWS.config.update({
		region: region,
    });

    var docClient = new AWS.DynamoDB.DocumentClient();
    var message="ok";
    
    var tokenobject= commonshared.ValidateToken(jwt,event.headers,cert);
	console.log(tokenobject);
	if (tokenobject.state==true){
			
		var username=tokenobject.value.user.split(":")[1];
		var usertype="User"+tokenobject.value.user.split(":")[0];
	    var userattributes=identity.chain().find({'Type':usertype,'Name':username}).collection.data[0]; //?.data()
			
		if (userattributes==undefined){
			var userattributes= await authenticationshared.getidentityattributes(commonshared,docClient,username,usertype);
			userattributes=userattributes.Items[0];
			identity.insert(userattributes);
	    }
    	  
	}
	else {
		//invalid token
		message=tokenobject.value
    }

    if(message =="ok"){
        // its comming from authorized source: aws events or api gateway
        console.log("Calling Main");
        var reply=await main(event,commonshared,authenticationshared,_,userattributes,region,accountnumber);
    }
    else{
        // its invalid token
        console.error(message);
        reply={"status":400, "data":message,"header":{}}

    }
    //context.succeed(result);
    var result= commonshared.apigatewayresponse(reply,event.headers,AllowedOrigins);
    return result
}

async function main (event,commonshared,authenticationshared,_,userattributes,region,accountnumber) {
    
    console.log("main")
    const service = commonshared.getquerystringparameter(event.queryStringParameters.service);
    var apicall = commonshared.getquerystringparameter(event.queryStringParameters.apicall);
    var parameters = commonshared.getquerystringparameter(event.queryStringParameters.Parameters);
    var resource =setresource(apicall,parameters,region,accountnumber);

    var action={"Resource": resource,"Operation": service+":"+apicall } //"lambda:InvokeFunction"
	var authorization = authenticationshared.authorize(_,commonshared,action,userattributes);
	if (authorization.status!="Allow"){
        //request not authorized
        var responsecode =400;
        var result=authorization.Reason;
        console.log(result);
    }
    else{
        var responsecode =200;
       console.log("do the scaling action here...")
       var result="OOOOKAAY";
    }

    var reply = {
        status: responsecode, 
        data: result //JSON.stringify(result)
        ,"header":{} 
    };
    
    return  reply
} //main

var apigwcontext={
    "callbackWaitsForEmptyEventLoop": true,
    "functionVersion": "$LATEST",
    "functionName": "Logverz-Info",
    "memoryLimitInMB": "256",
    "logGroupName": "/aws/lambda/Logverz-Info",
    "logStreamName": "2021/01/07/[$LATEST]271b5674dfc844bd9a2dcfcefe9ff252",
    "invokedFunctionArn": "arn:aws:lambda:ap-southeast-2:accountnumber:function:Logverz-Info",
    "awsRequestId": "16b2e595-5c5e-466d-af87-42c1ca2e3c50",
    succeed : function() {
    }
}

var apigwevent={}