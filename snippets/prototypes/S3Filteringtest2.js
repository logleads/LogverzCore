var AWS = require('aws-sdk');
const {performance} = require('perf_hooks');
AWS.config.update({
	region: 'ap-southeast-2',
});

var _ = require('lodash');

//TODO: Send result to RDS.
//Send invocation start and finish to rds.

const S3 = new AWS.S3();

var compression= "GZIP"
var jsontype="LINES"
var query ="select * from S3Object[*].Records[*]  s Where s.errorMessage!='null'"
//var query ="select * from S3Object[*].Records[*]  s "
// additional parameters: 
// Where date is between x -y 
// Services in ()
// api calls type
//Exec result 

var prefixarray=[
	["06/02/2f75dd083d263201.timestamp","bucketname"],
	["06/02/accountnumber_CloudTrail_ap-southeast-2_20190906T0305Z_hpdoyLeVUP3BMd3z.json.gz","bucketname"],
	["06/02/accountnumber_CloudTrail_ap-southeast-2_20190801T0545Z_iNwRfbx6UWiIj1P3.json.gz","bucketname"],
	["06/02/accountnumber_CloudTrail_ap-southeast-2_20190804T0110Z_qgUzPFvCuSVI0Cb7.json.gz","bucketname"]
]

main()

async function	getFilteredS3data(params){
	// source: https://thetrevorharmon.com/blog/how-to-use-s3-select-to-query-json-in-node-js
	return new Promise((resolve, reject) => {
	  S3.selectObjectContent(params, (err, data) => {
		if (err) {
			resolve(console.log("Skipping processing file:  s3://"+params.Bucket+"/" + params.Key + " because of: \n"+err));
			//TODO !!! Add this record to a NEW Database File Processing errors table. 
		 }
		if (!data) {
		  resolve(console.log("Skipping processing file:  s3://"+params.Bucket+"/" + params.Key +' becasue of empty data object'));
		  //TODO !!! Add this record to a NEW Database File Processing errors table. 
		} 
		else{ 
			const records = []  
			// This is a stream of events
			data.Payload.on('data', (event) => {
			if (event.Records) {
				records.push(event.Records.Payload);
			}
			})
			.on('error', (err) => {
			//reject(err);
			console.log("Error processing file:  s3://"+params.Bucket+"/" + params.Key)
			//TODO !!! Add this record to a NEW Database File Processing errors table. 
			})
			.on('end', () => {
			// Convert the array of bytes into a buffer, and then
			// convert that to a string
			let planetString = Buffer.concat(records).toString('utf8');  
			// 2
			// remove any trailing commas
			planetString = planetString.replace(/\,$/, '');  
			// 3
			// Add into JSON 'array'
			planetString = `[${planetString}]`;  
			try {
				const planetData = JSON.parse(planetString);
				//const planetData = planetString;
				resolve(planetData);
			} catch (e) {
				reject(new Error(`Unable to convert S3 data to JSON object. S3 Select Query: ${params.Expression}`));
			}
			});
		} //else
	  }); // S3.selectObjectContent
	}) //return
}

async function main () {
	myr= await processS3data(prefixarray,getFilteredS3data)
	console.log(JSON.stringify(myr) + "bbb")	
}

async function processS3data(prefixarray) {
	 //source: https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#selectObjectContent-property 
	var s3parameters={
		Bucket: "",
		Key: "",
		ExpressionType: 'SQL',
		Expression: query,
		InputSerialization: {
		CompressionType: compression,
		JSON: {
			Type: jsontype
		}
		},
		OutputSerialization: {
			JSON: {
				RecordDelimiter: ',' //\n
			}
		}
	}
	//const t0 = performance.now();
	var promises = prefixarray.map(

		prefix=> {s3parameters.Key=prefix[0]
			s3parameters.Bucket=prefix[1]
		return  getFilteredS3data(s3parameters);
		}
	)
	const resolved =await Promise.all(promises)
	var results = _.compact(_.flatten(resolved))
	//console.log(results)	
	//const t1 = performance.now();
	console.log("Number of keys "+results.length+ " \n")
	//console.log("Call to main took " + (t1 - t0) + " milliseconds.\n");
	return results
}