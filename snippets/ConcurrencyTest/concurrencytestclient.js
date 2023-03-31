const { Client } = require('pg');

module.exports.handler = async function (event, context) {
	// var context={
	// 	"callbackWaitsForEmptyEventLoop": true,
	// 	"functionVersion": "$LATEST",
	// 	"functionName": "Test-DBClient",
	// 	"memoryLimitInMB": "192",
	// 	"logGroupName": "/aws/lambda/Test-DBClient",
	// 	"logStreamName": "2020/06/16/[$LATEST]5a60194c83f54fb0be48fce5e6f78a2a",
	// 	"clientContext": {
	// 		"jobid": "CL0E4f9Glomh",
	// 		"invocationid": "2"
	// 	},
	// 	"invokedFunctionArn": "arn:aws:lambda:ap-southeast-2:accountnumber:function:Test-DBClient",
	// 	"awsRequestId": "858ccb60-4f2b-4bfe-816f-b7cabef03a7b"
	// }
	console.log('REQUEST RECEIVED: ' + JSON.stringify(context));

	var sqlentryfrequency=3000 // add SQL I am alive entry every 3 seconds
	const client = new Client()
	client.connect()
	await timeout(1000);

	//need row|event id +connectio innitiatedid
	var querystring=`INSERT INTO public.concurrencytest(invocationid, jobid, content,starttime)VALUES('${context.clientContext.invocationid}', '${context.clientContext.jobid}', 'Connected to database','${timeConverter(Date.now())}');`
		console.log(querystring)
		client.query(querystring, (err, res) => {
			console.log(err ? err.stack : res)
	})

	await timeout(1000);

	for (let index = 0; index < 900000/sqlentryfrequency; index++) {
		var message = "Connected to database at "+ timeConverter(Date.now()) +" local time."
		var querystring=`UPDATE public.concurrencytest  SET content = '${message}' WHERE invocationid='${context.clientContext.invocationid}'and jobid ='${context.clientContext.jobid}';`
		console.log(querystring)
		client.query(querystring, (err, res) => {
			console.log(err ? err.stack : res)
	})
		await timeout(sqlentryfrequency);
		
	}

	client.end()
	console.log("Finished execution")

}

function timeout(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function timeConverter(UNIX_timestamp){
	//https://stackoverflow.com/questions/847185/convert-a-unix-timestamp-to-time-in-javascript
	var a = new Date(UNIX_timestamp);
	var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
	var year = a.getFullYear();
	var month = months[a.getMonth()];
	var date = a.getDate();
	var hour = a.getHours();
	var min = a.getMinutes();
	var sec = a.getSeconds();
	var time = date + ' ' + month + ' ' + year + ' ' + hour + ':' + min + ':' + sec ;
	return time;
}


