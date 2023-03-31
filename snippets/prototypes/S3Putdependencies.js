var cfnresponse = require('cfn-response');
var AWS = require('aws-sdk');
var _ = require('lodash');
var JSZip = require("jszip");
const fs = require('fs');
var region = "ap-southeast-2"

AWS.config.update({
	region: region,
});
var SSM = new AWS.SSM();
var cloudformation = new AWS.CloudFormation();
s3 = new AWS.S3({apiVersion: '2006-03-01'});

//module.exports.handler = async function (event, context) {

main()

async function main () {
	var [Stackname,ArtifactsBucket] = await Promise.all([
		getssmparameter({Name: 'LogverzStackname',WithDecryption: true}),
		getssmparameter({Name: 'LogverzArtifactsBucket',WithDecryption: true}),
	]);


	var getcfntemplate=await cloudformation.getTemplate({StackName: Stackname.Parameter.Value}, function(err, data) {
		if (err) console.log(err, err.stack); // an error occurred
	}).promise();

	var cfntemplate=JSON.parse(getcfntemplate.TemplateBody)

	var result= await createZipFile(cfntemplate)
	s3putdependencies('build-trigger.zip',ArtifactsBucket.Parameter.Value)
	s3putdependencies('lambdaworker-source.zip',ArtifactsBucket.Parameter.Value)
	

	//return response(event, context, cfnresponse.SUCCESS, result)
}
function s3putdependencies(filename,bucket) {
	fs.readFile(('./'+filename), function (err, data) {
		if (err) { throw err; }
		var uploadParams = {Bucket: bucket, Key: filename, Body: data};
		s3.putObject(uploadParams, function(err, data) {
			   if (err) {
				   console.log(err)
			   } else {
				   console.log("Successfully put dependency " +filename+ " to: "+bucket+" bucket.");
			   }
		});
	});
}

async function createZipFile(cfntemplate) {
	var zip= new JSZip();
	var zip2= new JSZip();
	var ControllerPackageJSON=base64decode(cfntemplate.Metadata.ControllerPackageJSON)
	var ControllerBuildSpec=base64decode(cfntemplate.Metadata.ControllerBuildSpec)
	var ControllerJS=base64decode(cfntemplate.Metadata.ControllerJS)
	var WorkerJS=base64decode(cfntemplate.Metadata.WorkerJS)
	var WorkerPackageJSON=base64decode(cfntemplate.Metadata.WorkerPackageJSON)
	zip.file("buildspec.yml", ControllerBuildSpec);
	zip.file("app/controller.json", ControllerJS);
	zip.file("app/package.json", ControllerPackageJSON);
	zip2.file("worker.js", WorkerJS);
	zip2.file("package.json", ControllerPackageJSON);

	 codebuildzip= new Promise((resolve, reject) => {        
		zip.generateNodeStream({type:'nodebuffer',streamFiles:true})
			.pipe(fs.createWriteStream('build-trigger.zip'))
			.on('finish', function () {                 
				resolve("build-trigger.zip written.");
			});
		})
	 lambdazip= new Promise((resolve, reject) => {        
		zip2.generateNodeStream({type:'nodebuffer',streamFiles:true})
			.pipe(fs.createWriteStream('lambdaworker-source.zip'))
			.on('finish', function () {                 
				  resolve("lambdaworker-source.zip written.");
		});
	}) 
	return (codebuildzip,lambdazip)
}
function base64decode(input) {
	var buff = Buffer.from(input, 'base64');
	var text = buff.toString('ascii');
	return text
}
function response(event, context, status, err) {
	return new Promise(() => cfnresponse.send(event, context, status,
	  err ? { error: err } : {}, event.LogicalResourceId));
}

async function getssmparameter(params){
	try {
		const ssmresult = await SSM.getParameter(params).promise();
		return ssmresult;
	}
	catch (error) {
		console.error(params.Name+ ":     "+error + "    SSM Parameter retrieval failed.");
		ssmresult=error
		return ssmresult;
	}
}