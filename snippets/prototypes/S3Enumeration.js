var AWS = require('aws-sdk');
var _ = require('lodash');
const {performance} = require('perf_hooks');
AWS.config.update({
	region: 'ap-southeast-2',
});
const s3 = new AWS.S3();
var Bottleneck = require("bottleneck");

// Limits the number of subfolders queried parallel. 
const s3limiter= new Bottleneck({
	maxConcurrent: 100
});

var subfolderlist=[];
var tobeprocessed=[];
// TODOs: 
//DONE 1 enummerate all the given prefixes. Use S3Folders="s3://bucketname/06/;s3://bucketname/07/"
//DONE 2 check what happens if  a folder has 1000+ items, use s3://bucketname/07/  and do the test two folder 06 and 07
//DONE 3 If a folder has files in it handle it separatly from the subfolders 
//DONE 4 dont go deeper than maxdepth. 
//TBD  5 add https://www.npmjs.com/package/cli-progress 


S3Folders="s3://aws-sam-cli-managed-default-samclisourcebucket-1jvrido8jzjk8/;s3://cf-templates-1ljma9xvdip7j-ap-southeast-2/"
S3EnumerationDepth=2;

main()

async function main () {
  
	tobeprocessed = TransformInputValues(S3Folders); //TODO change to 
	
	const t0 = performance.now();
	do{
		await walkfolders(tobeprocessed);
		//await timeout(100)
	}
	while (((subfolderlist.length + tobeprocessed.length) != 0 ) && (tobeprocessed.length !=0)) 	 
	const t1 = performance.now();
	console.log("Walk folders took " + ((t1 - t0)/1000) + " seconds."+"\n\n");
	
	const alltasksresolved = await s3limiter.schedule(() => {
		const allTasks =  subfolderlist.map(
			subfolderarrayitem => getAllKeys(s3,{ Bucket: subfolderarrayitem[1],  Prefix: subfolderarrayitem[0],Delimiter: subfolderarrayitem[2] })
		);
		return Promise.all(allTasks);
	});
	const t2 = performance.now();
	
	console.log("getAllkeys took " + ((t2 - t1)/1000) + " seconds."+"\n\n");
	var allKeys = _.flatten(alltasksresolved)
	const t3 = performance.now();
	console.log("Number of keys "+allKeys.length+ " \n")
	console.log("Flatting took " + ((t3 - t2)/1000) + " seconds."+"\n\n");
	console.log("finish");

}	

async function walkfolders(prefixes){
	
	for (const item of prefixes) {
		
		var folder=item[0];
		var bucket=item[1];
		var delimiter=item[2];
		var maxdepth=item[3];
		var currentdepth = folder.split("/").length-1
		//dontgo deeper than maxdepth
		 if (currentdepth === maxdepth){
			//subfolderlist.push(item)
			delimiter="*"
			subfolderlist.push([folder,bucket,delimiter,maxdepth])
			_.pull(tobeprocessed,item);
			continue
		}

		const subfolder= await getCommonPrefixes(s3,{ Bucket: bucket,  Prefix: folder, Delimiter:delimiter }) //
			_.forEach(subfolder, function(object) {
			
				prfx=object[0]
				delim=object[2]
			
				if(delim =="/"){
					subfolderlist.push(object)
					_.pull(tobeprocessed,object); 
				}else{
					tobeprocessed.push([prfx,bucket,"/",maxdepth]) //delim
				}
			})
			
			_.pull(tobeprocessed,item);
	}//for 	 
}//walkfolders

async function getCommonPrefixes(s3,params,  allKeys = []){
	//https://stackoverflow.com/questions/42394429/aws-sdk-s3-best-way-to-list-all-keys-with-listobjectsv2
	const response = await s3.listObjectsV2(params).promise();

	if((response.Contents.length>0)&&(response.CommonPrefixes.length==0)){
		//There are objects in the given prefix so it needs to be explictly scoped to the prefix level, otherwise it  would also contain the subfolders.
		//listing bucket 06/ without delimiter it would contain files from 06/01, 06/02, 06/abc subfolders. 
		var delimeter="/"
	    allKeys.push([response.Prefix,params.Bucket,delimeter]);	
	}
	else if((response.Contents.length>0)){
		var delimeter="/"
		allKeys.push([response.Prefix,params.Bucket,delimeter]);
		var delimiter="*"
		response.CommonPrefixes.forEach(obj => allKeys.push([obj.Prefix,params.Bucket,delimiter]));	
	}
	else{
		var delimiter="*"
		response.CommonPrefixes.forEach(obj => allKeys.push([obj.Prefix,params.Bucket,delimiter]));
	}	
	return allKeys;
}

async function getAllKeys(s3,params,  allKeys = []){
	//https://stackoverflow.com/questions/42394429/aws-sdk-s3-best-way-to-list-all-keys-with-listobjectsv2
	const response = await s3.listObjectsV2(params).promise();
	response.Contents.forEach(obj => allKeys.push([obj.Key,params.Bucket]));

	if (response.NextContinuationToken) {
		params.ContinuationToken = response.NextContinuationToken;
		await getAllKeys(s3,params, allKeys); // RECURSIVE CALL
	}
	return allKeys;
}

function TransformInputValues(S3Folders){
	var Patharray=[];
	var delimiter="/";

	if (S3Folders.includes(";")){
		var inputvalues = S3Folders.split(";");
		_.forEach(inputvalues, oneresult => {
			var prefix=oneresult.split('/').slice(3).join('/');
			var bucket=oneresult.split('/').slice(1)[1];
			var currentdepth=prefix.split('/').length-1;
			var maxdepth=parseInt(S3EnumerationDepth)+currentdepth;
			Patharray.push([prefix,bucket,delimiter,maxdepth])
		})
	}
	else {
		var oneresult = S3Folders;
		var prefix=oneresult.split('/').slice(3).join('/');
		var bucket=oneresult.split('/').slice(1)[1];
		var currentdepth=prefix.split('/').length-1;
		var maxdepth=parseInt(S3EnumerationDepth)+currentdepth;
		Patharray.push([prefix,bucket,delimiter,maxdepth])
	}
	return Patharray
}

function s3folderstats(subfolderlist,alltasksresolved){
 //TODO write out stats

}
