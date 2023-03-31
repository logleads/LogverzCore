var AWS = require('aws-sdk');
var pako = require('pako');
var _ = require('lodash');
var cloudwatchlogs = new AWS.CloudWatchLogs({apiVersion: '2014-03-28'});
const {performance} = require('perf_hooks');


AWS.config.update({
	region: 'ap-southeast-2',
});

const s3 = new AWS.S3();
var bucket="bucketname"
var key = "accountnumber_CloudTrail_ap-southeast-2_20190906T0305Z_hpdoyLeVUP3BMd3z.json.gz"
main()

async function s3GetDataInJson(bucket, key ) {
		//Info: the function retrieves Cloudtrail file, than unzip and returns it as a json object 
		const t0 = performance.now();
		const s3data = await s3.getObject({	Bucket: bucket, Key: key}).promise() 	
		// Convert character data to binary data. The characters are byte-representations anyway so they are all 8 bit.
		var binData     =  new Uint8Array(s3data.Body);
		// gunzip gzipped binary data
		var data        =  pako.inflate(binData);
		// Convert gunzipped binary data to ascii string
		var strData     =  String.fromCharCode.apply(null, new Uint16Array(data));
		// Convert to Object
		CloudTrailEvents =  JSON.parse(strData);
		const t1 = performance.now();
		console.log("Call to doSomething took " + (t1 - t0) + " milliseconds.");
		return CloudTrailEvents
}

async function main () {

	const CTrailEvents = await s3GetDataInJson(bucket,key) 
	var FilteredEvents = []

	_.forEach(CTrailEvents.Records, function(object,key) {
		//Filter parameters such as if it has errorcode.
		if (object.hasOwnProperty("errorCode")) {
			console.log("\n\nThe object   :" +JSON.stringify(object));
			//console.log("The key   :" +key);
			FilteredEvents.push(key)
		}
  	})

	_.forEach(FilteredEvents, function(event,key) {
  	console.log(event)
	//const CloudTrailEvents = await s3GetDataInJson(bucket,key) 
	//console.log (JSON.stringify(CTrailEvents.Records[0]) +"ccc")
	})

}







/* 
// WORKING !!!!!!

async function s3GetDataFolder(bucket, key ) {
	
		const s3data = await s3.getObject({	Bucket: bucket, Key: key}).promise() 	
		// console.log(s3data);
		// Convert character data to binary data. The characters are byte-representations anyway so they are all 8 bit.
		var binData     =  new Uint8Array(s3data.Body);
		// gunzip gzipped binary data
		var data        =  pako.inflate(binData);
		// Convert gunzipped binary data to ascii string
		var strData     =  String.fromCharCode.apply(null, new Uint16Array(data));

		//console.log(strData);
		CloudTrailEvents =  JSON.parse(strData);
		//console.log(JSON.stringify(CloudTrailEvents.Records[27]));
		return new Promise( resolve => {
		//resolve  (JSON.stringify(CloudTrailEvents));
		resolve  (CloudTrailEvents);
	})
}

async function main () {
const CloudTrail = await s3GetDataFolder("bucketname","accountnumber_CloudTrail_ap-southeast-2_20190906T0305Z_hpdoyLeVUP3BMd3z.json.gz") 
console.log (JSON.stringify(CloudTrail.Records[27]) +"ccc")
}
main()

*/
