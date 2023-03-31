var AWS = require('aws-sdk');
var JSZip = require("jszip");
const fs = require('fs');
const path = require('path');



module.exports.handler = async function (event, context) {
	console.log('REQUEST RECEIVED: ' + JSON.stringify(event));	

    //Dev environment settings
    if (process.env.Environment =="Windows"){
	  var region = "ap-southeast-2";
	  var event ={LogicalResourceId:"x"}
    }else { //lambda function settings 
      var arnList = (context.invokedFunctionArn).split(":");
	  var region = arnList[3]
	}
	
	//need to save a manifest file that contains the settings and the file name .
	//need to save to and copy from s3, and zip and unzip file.	

    AWS.config.update({
        region: region,
	});  
	const s3 = new AWS.S3();

	var filename="decodedzip.zip";
	var bucket="bucketname"
	absoluteFilePath = path.join(__dirname, filename);
	//TODO at some point test with greater than 2GB file.
	var fileData=fs.readFileSync(absoluteFilePath);
	var stats = fs.statSync(absoluteFilePath)
	var fileSizeInBytes = stats["size"]
	var partSize = 1024 * 1024 * 5;
	var params = {
		Bucket: bucket, 
		Key: filename,
		ContentType:"application/zip"
	};
	if(fileSizeInBytes < partSize) {
	
		params['Body']= fileData; 
		
		const putobject =(params)=>{ 
			return new Promise((resolve, reject) => {
				s3.putObject(params, function(err, data) {
					if (err) {
						console.log(err, err.stack); // an error occurred
						return reject(error);
					}else{
						console.log(data);           // successful response
						return resolve(data);
					}
				});
			})
		}

		await putobject(params);
		console.log("uploaded");

	}else{
		var multipartobject=await startmultipartupload(s3,params);
		var multipartuploadid= multipartobject.UploadId
		var partNum = 0;
		var partsarray=[];
		for (var rangeStart = 0; rangeStart < fileData.length; rangeStart += partSize) {
			//based on https://gist.github.com/sevastos/5804803
			partNum++;
			var end = Math.min(rangeStart + partSize, fileData.length),
			partParams = {
				Body: fileData.slice(rangeStart, end),
				Bucket: bucket,
				Key: filename,
				PartNumber: String(partNum),
				UploadId: multipartuploadid
			};

			console.log('Uploading part: #', partParams.PartNumber, ', Range start:', (rangeStart/1000),'KB.');
			var uploadedpart =await domultipartupload(s3,partParams)
			partsarray.push({"ETag":uploadedpart.ETag,"PartNumber":partNum});

		}//for

		await endmultipartupload(s3,bucket,filename,multipartuploadid,partsarray)
	
	}//else multipart upload

	await timeout(2500);
	//return response(event, context, "SUCCESS", "ok")
	//return response(event, context, "SUCCESS", buildresult)
	console.log("finish")
}

function timeout(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function response(event, context, status, err) {
	return new Promise(() => cfnresponse(event, context, status,
	  err ? { error: err } : {}, event.LogicalResourceId));
}

function cfnresponse(event, context, responseStatus, responseData, physicalResourceId, noEcho) {
	//https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-lambda-function-code-cfnresponsemodule.html
	
	var responseBody = JSON.stringify({
		Status: responseStatus,
		Reason: "See the details in CloudWatch Log Stream: " + context.logStreamName,
		PhysicalResourceId: physicalResourceId || context.logStreamName,
		StackId: event.StackId,
		RequestId: event.RequestId,
		LogicalResourceId: event.LogicalResourceId,
		NoEcho: noEcho || false,
		Data: responseData
	});
 
	console.log("Response body:", responseBody);
 
	var https = require("https");
	var url = require("url");
 
	var parsedUrl = url.parse(event.ResponseURL);
	var options = {
		hostname: parsedUrl.hostname,
		port: 443,
		path: parsedUrl.path,
		method: "PUT",
		headers: {
			"content-type": "",
			"content-length": responseBody.length
		}
	};
 
	var request = https.request(options, function(response) {
		console.log("Status code: " + response.statusCode);
		console.log("Status message: " + response.statusMessage);
		context.done();
	});
 
	request.on("error", function(error) {
		console.log("send(..) failed executing https.request(..): " + error);
		context.done();
	});
 
	request.write(responseBody);
	request.end(
	);
}


async function startmultipartupload(s3,params){
	return new Promise((resolve, reject) => {
		s3.createMultipartUpload(params, function(err, data) {
			if (err){ 
				console.log(err, err.stack); // an error occurred
				reject (err);
			}else{
				console.log(data);           // successful response
				resolve(data)
			}
	   });
	})//new promise
}

async function domultipartupload(s3,partParams){
	return new Promise((resolve, reject) => {
		s3.uploadPart(partParams, function(err, data) {
			if (err) {
				console.log(err, err.stack); // an error occurred
				reject (err);
			}else{
				console.log(data);           // successful response
				resolve(data);
			}
		})
	})//new promise
}

async function endmultipartupload(s3,bucket,filename,multipartuploadid,partsarray){
	var params = {
		Bucket: bucket, 
		Key: filename, 
		MultipartUpload: {
		Parts: partsarray
		}, 
		UploadId: multipartuploadid
	};
	return new Promise((resolve, reject) => {
		s3.completeMultipartUpload(params, function(err, data) {
			if (err){
				console.log(err, err.stack); // an error occurred
				reject (err);
			}
			else{
				console.log(data);           // successful response
				resolve(data);
			}
		});
	})//new promise
}