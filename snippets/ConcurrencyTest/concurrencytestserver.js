var AWS = require('aws-sdk');
const https = require('https');
//Dev environment settings
var region = "ap-southeast-2";
var WorkerFunction="Test-DBClient"
var NumberofClients=75;//3/100//150  //The number of lambda clients 
var lambdatimeout=900000;
var timebetweeninvocations=200; //1000/200 -> 5 lambdas are called in a second.

const agent = new https.Agent({
    maxSockets: NumberofClients // https://stackoverflow.com/questions/54629780/how-can-the-aws-lambda-concurrent-execution-limit-be-reached
});

AWS.config.update({
	region: region,
	maxRetries: 2,
    httpOptions: {
        timeout: lambdatimeout,  //https://aws.amazon.com/premiumsupport/knowledge-center/lambda-function-retry-timeout-sdk/
        agent: agent
    }
});

var lambda = new AWS.Lambda({apiVersion: '2015-03-31'});

main()

async function main () {
    var  jobid=makeid(12)
	
    for (let index = 1; index < NumberofClients+1; index++) {
        var invocationid=index
        await invokelambda(invocationid,jobid)
        await timeout(timebetweeninvocations);
    }

}

	

async function invokelambda(invocationid,jobid){
	//https://docs.aws.amazon.com/lambda/latest/dg/API_Invoke.html#API_Invoke_RequestSyntax 
	//max 3583 byte
	var invocationparameters=`{"jobid":"${jobid}","invocationid":"${invocationid}"}`
	var clientcontext = Buffer.from(invocationparameters).toString('base64') 
	
	var lambdaparams = {
	ClientContext: clientcontext.toString('base64'), 
	FunctionName: WorkerFunction, 
	InvocationType: "RequestResponse", //"RequestResponse" || "Event" // bydefault Requestreponse times out after 120 sec, hence the timout 900 000 value
	LogType: "None", 
	};

	lambda.invoke(lambdaparams, function(err, data) {
		if (err) console.log(err, err.stack); // an error occurred
		else     console.log(data);           // successful response
	})
}

function timeout(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function makeid(length){
	//https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
	var result           = '';
	var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	var charactersLength = characters.length;
	for ( var i = 0; i < length; i++ ) {
	   result += characters.charAt(Math.floor(Math.random() * charactersLength));
	}
	return result;
}
/*
CREATE TABLE public.concurrencytest (
	eventid int8 NOT NULL GENERATED ALWAYS AS IDENTITY,
	jobid varchar NULL,
    invocationid int4 NULL,
    starttime varchar NULL,
	"content" varchar NULL
	
);
*/