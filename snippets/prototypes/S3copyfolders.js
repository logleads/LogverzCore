
var AWS = require('aws-sdk');

AWS.config.update({
	region: 'ap-southeast-2',
	accessKeyId: '', secretAccessKey: ''
});

/**
 * https://stackoverflow.com/questions/30959251/how-to-copy-move-all-objects-in-amazon-s3-from-one-prefix-to-other-using-the-aws
 * Copy s3 folder
 * @param {string} bucket Params for the first argument
 * @param {string} source for the 2nd argument
 * @param {string} dest for the 2nd argument
 * @returns {promise} the get object promise
 */
const bucket = '';
const source = '08/'; //( folder prefix)
const dest = ''; //bucket
//const file={}
//file.key='08/01/accountnumber_CloudTrail_ap-southeast-2_20190801T0000Z_p0uXxmUJbbxmOeOu.json.gz'
const s3 = new AWS.S3();
async function s3CopyFolder(bucket, source, dest) {
	// sanity check: source and dest must end with '/'

	//const s3 = new AWS.S3();
	// plan, list through the source, if got continuation token, recursive
	const listResponse = await s3.listObjectsV2({
		Bucket: bucket,
		Prefix: source,
		Delimiter: '/',
	}).promise();
   await console.log(listResponse);
  
   // recursively go trough the folders 
  await Promise.all(
    listResponse.CommonPrefixes.map(async (folder) => {
		await console.log( bucket,`${folder.Prefix}`, dest)
		await s3CopyFolder(
        bucket,
        `${folder.Prefix}`,
	   // `${dest}${folder.Prefix}`,
	   dest,
	  );

    }),
  ); 

   // copy objects
 await Promise.all(
    listResponse.Contents.map(async (file) => {
	await console.log(dest+ "    "+ bucket+"   "+file.Key  ),
      await s3.copyObject({
        Bucket: dest,
        CopySource: `${bucket}/${file.Key}`,
		Key:file.Key,		
	  },
	  ).promise();
    }),
  );

};

 
s3CopyFolder(bucket, source, dest) 
