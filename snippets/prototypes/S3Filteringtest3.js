var AWS = require('aws-sdk');
AWS.config.update({
	region: 'ap-southeast-2',
});

var _ = require('lodash');
const Sequelize = require('./node_modules/sequelize');
const s3 = new AWS.S3();

/******************      Environment Specific Settigns       *****************/
var DatabaseParameters="LogverzDBFriendlyName=DefaultDB<!!>LogverzDBEndpointName=llu8dvl0nswrom.ctmpydtwitz8.ap-southeast-2.rds.amazonaws.com<!!>LogverzDBEndpointPort=5432<!!>LogverzEngineType=postgres<!!>LogverzDBUserName=LogverzAdmin<!!>LogverzDBSecretRef=/Logverz/Database/DefaultDBPassword";
var DBAvalue=DatabaseParameters.split("<!!>")
var DBEngineType=DBAvalue.filter(s => s.includes('LogverzEngineType'))[0].split("=")[1]
var DBUserName="LogverzAdmin"//DBAvalue.filter(s => s.includes('LogverzDBUserName'))[0].split("=")[1]
var DBEndpointName=DBAvalue.filter(s => s.includes('LogverzDBEndpointName'))[0].split("=")[1]
var DBEndpointPort=DBAvalue.filter(s => s.includes('LogverzDBEndpointPort'))[0].split("=")[1]
var DBPassword="";

const DBName = "Logverz";
const sequelize = new Sequelize(`${DBEngineType}://${DBUserName}:${DBPassword}@${DBEndpointName}:${DBEndpointPort}/${DBName}`);
sequelize.options.logging = false; //Disable logging
const Model = Sequelize.Model; 

var vpcflowlogs="{\"InputSerialization\":{\"Compression\":\"GZIP\",\"CSV\": {\"FileHeaderInfo\": \"USE\",\"FieldDelimiter\": \" \"}}}";
var ApplicationLB="{\"InputSerialization\":{\"Compression\":\"GZIP\",\"CSV\": {\"FileHeaderInfo\": \"NONE\",\"FieldDelimiter\": \" \"}},\"OutputSerialization\":{\"CSV\":{\"RecordDelimiter\":\";;\",\"FieldDelimiter\":\" \"}}}";
var cloudtrail="{\"InputSerialization\":{\"Compression\":\"GZIP\",\"JsonType\":\"LINES\",\"RootElement\":\"Records\"}}";

const context={
    "callbackWaitsForEmptyEventLoop": true,
    "functionVersion": "$LATEST",
    "functionName": "Logverz-Worker",
    "memoryLimitInMB": "384",
    "logGroupName": "/aws/lambda/Logverz-Worker",
    "logStreamName": "2020/04/27/[$LATEST]e06d0efc5ea74181b0a99d987bab4e56",
    "clientContext": {
        "Schema": "{\"version\":{type: Sequelize.INTEGER},\"account-id\":{type: Sequelize.BIGINT},\"interface-id\":{type: Sequelize.STRING},\"srcaddr\":{type: Sequelize.STRING(64)},\"dstaddr\":{type: Sequelize.STRING(64)},\"srcport\":{type: Sequelize.INTEGER},\"dstport\":{type: Sequelize.INTEGER},\"protocol\":{type: Sequelize.INTEGER},\"packets\":{type: Sequelize.BIGINT},\"bytes\":{type: Sequelize.BIGINT},\"start\":{type: Sequelize.BIGINT},\"end\":{type: Sequelize.BIGINT},\"action\":{type: Sequelize.STRING(8)},\"log-status\":{type: Sequelize.STRING(8)},\"vpc-id\":{type: Sequelize.STRING(32)},\"subnet-id\":{type: Sequelize.STRING(32)},\"tcp-flags\":{type: Sequelize.STRING(8)},\"type\":{type: Sequelize.STRING(8)},\"pkt-srcaddr\": {type: Sequelize.STRING(64)},\"pkt-dstaddr\":{type: Sequelize.STRING(64)},\"region\": {type: Sequelize.STRING(32)},\"az-id\": {type: Sequelize.STRING(32)},\"sublocation-type\": {type: Sequelize.STRING(32)},\"sublocation-id\": {type: Sequelize.STRING(32)}}",
        "jobid": "Nhwl3DEGiFOH",
        "invocationid": "Fk416MYPWOkRAP5A",
        "QueueURL": "https://sqs.ap-southeast-2.amazonaws.com/accountnumber/LogverzMessageQueueS0.fifo",
        "S3SelectQuery": "select * from s3object s",
        "DatabaseParameters": "LogverzDBFriendlyName=DefaultDB<!!>LogverzDBEndpointName=llu8dvl0nswrom.ctmpydtwitz8.ap-southeast-2.rds.amazonaws.com<!!>LogverzDBEndpointPort=5432<!!>LogverzEngineType=postgres<!!>LogverzDBUserName=LogverzAdmin<!!>LogverzDBSecretRef=/Logverz/Database/DefaultDBPassword",
        "DBTableName": "SampleData",
        "QueryType":"VPCFlow",
        "S3SelectParameter": "{\"Compression\":\"GZIP\",\"CSV\": {\"FileHeaderInfo\": \"USE\",\"FieldDelimiter\": \" \"}}"
    },
    "invokedFunctionArn": "arn:aws:lambda:ap-southeast-2:accountnumber:function:Logverz-Worker",
    "awsRequestId": "9e387058-a585-4126-9c6c-3031014abf62",
    getRemainingTimeInMillis : function () {
         return 900000;
       }
}

var prefixarrayvpcflowlogs='[["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0355Z_934a25e8.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0400Z_164c9b60.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0400Z_701146df.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0405Z_8ae87de2.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0405Z_ddea806d.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0410Z_2b076301.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0410Z_e2f66d0a.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0415Z_068b4546.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0415Z_3f0a8369.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0420Z_3dc878db.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0420Z_6e3ef22c.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0425Z_a1bec2dd.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0425Z_f5bba5c0.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0430Z_11fd731a.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0430Z_370c2afb.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0435Z_4a7c3a8d.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0435Z_f479822f.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0440Z_0d3c4933.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0440Z_3b9b507c.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0445Z_c5f6747f.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0445Z_ec0e8920.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0450Z_0ed768b3.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0450Z_7e702584.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0455Z_4b4fe475.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0455Z_cb1e4a2a.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0500Z_d641702c.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0500Z_e84e6275.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0505Z_1917d09a.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0505Z_d15f12b9.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0510Z_479e5536.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0510Z_67a989cd.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0515Z_1d5c504d.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0515Z_a4b1e170.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0520Z_5b9b0b57.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0520Z_855aa658.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0525Z_63bdf935.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0525Z_c7740a4b.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0530Z_0052f6be.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0530Z_1bcbbd25.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0535Z_1bdca5c2.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0535Z_f6465379.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0540Z_5d698c83.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0540Z_d8719720.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0545Z_504abdbf.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0545Z_9f2b81e9.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0550Z_179ba046.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0550Z_b4fd1882.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0555Z_22ea5b47.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0555Z_eee485bd.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0600Z_662c1904.log.gz","lltestdata"],["vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0600Z_8e1a3414.log.gz","lltestdata"]]'
var prefixarrayvpcflowlogs=JSON.parse(prefixarrayvpcflowlogs);

var VPCModel = {"version":{type: Sequelize.INTEGER},"account-id":{type: Sequelize.BIGINT},"interface-id":{type: Sequelize.STRING},"srcaddr":{type: Sequelize.STRING(64)},"dstaddr":{type: Sequelize.STRING(64)},"srcport":{type: Sequelize.INTEGER},"dstport":{type: Sequelize.INTEGER},"protocol":{type: Sequelize.INTEGER},"packets":{type: Sequelize.BIGINT},"bytes":{type: Sequelize.BIGINT},"start":{type: Sequelize.BIGINT},"end":{type: Sequelize.BIGINT},"action":{type: Sequelize.STRING(8)},"log-status":{type: Sequelize.STRING(8)},"vpc-id":{type: Sequelize.STRING(32)},"subnet-id":{type: Sequelize.STRING(32)},"tcp-flags":{type: Sequelize.STRING(8)},"type":{type: Sequelize.STRING(8)},"pkt-srcaddr": {type: Sequelize.STRING(64)},"pkt-dstaddr":{type: Sequelize.STRING(64)},"region": {type: Sequelize.STRING(32)},"az-id": {type: Sequelize.STRING(32)},"sublocation-type": {type: Sequelize.STRING(32)},"sublocation-id": {type: Sequelize.STRING(32)}};

var applicationLBprefixarray=[
	[
		"ALB/AWSLogs/accountnumber/elasticloadbalancing/ap-southeast-2/2021/03/06/accountnumber_elasticloadbalancing_ap-southeast-2_app.awseb-AWSEB-DYDS4GWPNVJM.956c435f2571f959_20210306T0255Z_54.66.117.38_31pvovgg.log.gz",
		"lltestdata"
	  ],
	  [
		"ALB/AWSLogs/accountnumber/elasticloadbalancing/ap-southeast-2/2021/03/06/accountnumber_elasticloadbalancing_ap-southeast-2_app.awseb-AWSEB-DYDS4GWPNVJM.956c435f2571f959_20210306T0300Z_54.66.117.38_2cmz2bb1.log.gz",
		"lltestdata"
	  ],
	  [
		"ALB/AWSLogs/accountnumber/elasticloadbalancing/ap-southeast-2/2021/03/06/accountnumber_elasticloadbalancing_ap-southeast-2_app.awseb-AWSEB-DYDS4GWPNVJM.956c435f2571f959_20210306T0305Z_54.66.117.38_5gsgb6mh.log.gz",
		"lltestdata"
	  ]
]

var appLBModel={"type":{type: Sequelize.STRING(8)},"timestamp":{type: Sequelize.STRING(64)},"elb":{type: Sequelize.STRING(64)},"client:port":{type: Sequelize.STRING(64)},"target:port":{type: Sequelize.STRING},"request_processing_time":{type: Sequelize.DOUBLE},"target_processing_time":{type: Sequelize.DOUBLE},"response_processing_time":{type: Sequelize.DOUBLE},"elb_status_code":{type: Sequelize.INTEGER},"target_status_code":{type: Sequelize.INTEGER},"received_bytes":{type: Sequelize.BIGINT},"sent_bytes":{type: Sequelize.BIGINT},"request":{type: Sequelize.STRING(8192)},"user_agent":{type: Sequelize.STRING(8192)},"ssl_cipher":{type: Sequelize.STRING},"ssl_protocol":{type: Sequelize.STRING(8)},"target_group_arn":{type: Sequelize.STRING},"trace_id":{type: Sequelize.STRING(64)},"domain_name":{type: Sequelize.STRING},"chosen_cert_arn": {type: Sequelize.STRING},"matched_rule_priority":{type: Sequelize.INTEGER},"request_creation_time": {type: Sequelize.STRING(64)},"actions_executed":{type: Sequelize.STRING(32)},"redirect_url": {type: Sequelize.STRING(8192)},"error_reason":{type: Sequelize.STRING(32)},"target:port_list": {type: Sequelize.STRING},"target_status_code_list":{type: Sequelize.INTEGER},"classification":{type: Sequelize.STRING},
"classification_reason":{type: Sequelize.STRING}}

var cloudtrailprefixarray=[
	["ctrail/06/accountnumber_CloudTrail_ap-southeast-2_20190906T0305Z_hpdoyLeVUP3BMd3z.json.gz","lltestdata"],
	["ctrail/06/accountnumber_CloudTrail_ap-southeast-2_20190801T0545Z_iNwRfbx6UWiIj1P3.json.gz","lltestdata"],
	["ctrail/06/accountnumber_CloudTrail_ap-southeast-2_20190804T0110Z_qgUzPFvCuSVI0Cb7.json.gz","lltestdata"]
]

var CtrailModel={"eventVersion":{type: Sequelize.STRING},"userIdentity":{type: Sequelize.JSON},"eventTime":{type: Sequelize.STRING},"eventSource":{type: Sequelize.STRING},"eventName":{type: Sequelize.STRING},"awsRegion":{type: Sequelize.STRING},"sourceIPAddress":{type: Sequelize.STRING},"userAgent":{type: Sequelize.STRING},"errorCode":{type: Sequelize.STRING},"errorMessage":{type: Sequelize.STRING(8192)},"requestParameters":{type: Sequelize.JSON},"responseElements":{type: Sequelize.JSON},"additionalEventData":{type: Sequelize.JSON},"requestID":{type: Sequelize.STRING},"eventID":{type: Sequelize.STRING},"eventType":{type: Sequelize.STRING},"recipientAccountId":{type: Sequelize.STRING},"vpcEndpointId":{type: Sequelize.STRING},"serviceEventDetails": {type: Sequelize.STRING},"readOnly":{type: Sequelize.STRING},"resources": {type: Sequelize.JSON}};

//console.log(requestresult);
/******************      Environment Specific Settigns       *****************/

/******************      QUERY Specific Settigns       *****************/
//var S3SelectQuery="select * from S3Object[*].Records[*] s ";//Where s.errorMessage!='null'
var S3SelectQuery="select * from s3object s";
var prefixarray=applicationLBprefixarray//applicationLBprefixarray//cloudtrailprefixarray//prefixarrayvpcflowlogs;
var SelectedModel =appLBModel//appLBModel//CtrailModel;//VPCModel;
var QueryType="ApplicationLB"//"ApplicationLB"//"CloudTrail"// //"VPCFlow";
var S3SelectParameter=JSON.parse(ApplicationLB);//cloudtrail//ApplicationLB;//vpcflowlogs
var DBTableName="ApplicationLB";
/******************      QUERY Specific Settigns       *****************/

var header =true;

if(S3SelectParameter.InputSerialization.JsonType!=undefined){
	var type="JSON";
}
else if(S3SelectParameter.InputSerialization.CSV.FileHeaderInfo=="USE"){
	var type="CSV";
}
else{
	var type="CSV";
	var header =false;
}

main()

async function main () {
	// try {
	// 	await CreateSQLTable(sequelize,Model,SelectedModel,QueryType,DBTableName)
	// 	console.log(`Table ${DBTableName}has been setup successfully.`)
	// }catch (e) {
	// 	console.error(e);
	// }

	var s3results = await processS3data(prefixarray,S3SelectQuery,S3SelectParameter,type,header);
	var Transformeddata= DatatoSchemaTransformation(s3results,SelectedModel,S3SelectParameter,type,header);
	
	if(Transformeddata.length!=0){
		await InsertData(sequelize,Model,SelectedModel,QueryType,DBTableName,Transformeddata);
		console.log("done")
	}
}

function DatatoSchemaTransformation(s3results,SelectedModel,S3SelectParameter,type,header) {
	//var SelectedModellength=Object.keys(SelectedModel).length;

	if (type == "JSON"){
		var finalarray= convertdatatosqlschema(s3results,SelectedModel);
	}
	else if (type == "CSV" && header ==true){
		var finalarray= convertdatatosqlschema(s3results,SelectedModel);
	}
	else if (type == "CSV" && header ==false){
		var intermediatearray=[]
		var headers=Object.keys(SelectedModel);

		_.forEach(s3results, onefile => {
			var temparray=[];
			var entries=[]
			entries=onefile.split(S3SelectParameter.OutputSerialization.CSV.RecordDelimiter);
			for (var i = 0; i < entries.length; i++) {
				
				if(S3SelectParameter.OutputSerialization.CSV.FieldDelimiter=" "){
					var oneentry =entries[i].match(/(?:[^\s"]+|"[^"]*")+/g) 
				}
				else{
					var oneentry = entries[i].split(S3SelectParameter.OutputSerialization.CSV.FieldDelimiter);
				}

				if (oneentry !="" &&oneentry !=null){
					oneentry=oneentry.map(oe=>{
						if(oe.match(/^".*"$/)){
							oe=oe.substring(1,oe.length-1) //remove starting " and ending " charchters...
						}
						return oe
					})
					temparray.push(_.zipObject(headers, oneentry));
				}//if oneentry not empty
			}//for i entries
			intermediatearray.push(temparray);
		});
		var intermediatearray = _.compact(_.flatten(intermediatearray));
		var finalarray= convertdatatosqlschema(intermediatearray,SelectedModel);
		

	}
	else{
		console.log("Parquet filetype not yet supported");
	}

	return finalarray
}

async function processS3data(prefixarray,S3SelectQuery,S3SelectParameter,type,header) {
	//source: https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#selectObjectContent-property 
  
	var s3parameters={
		Bucket: "",
		Key: "",
		ExpressionType: 'SQL',
		Expression: S3SelectQuery,
		InputSerialization: {
		CompressionType: S3SelectParameter.InputSerialization.Compression
		},
		OutputSerialization: {}
	}
	if(type=="JSON"){
		s3parameters.InputSerialization.JSON={};
		s3parameters.InputSerialization.JSON.Type=S3SelectParameter.InputSerialization.JsonType;
		s3parameters.OutputSerialization.JSON={};
		s3parameters.OutputSerialization.JSON.RecordDelimiter=','
	}
	else if(type=="CSV"){
		
		if (header==false){
			s3parameters.InputSerialization.CSV={};
			s3parameters.OutputSerialization.CSV=S3SelectParameter.OutputSerialization.CSV;
		}
		else{
			s3parameters.OutputSerialization.JSON={};
			s3parameters.OutputSerialization.JSON.RecordDelimiter=','
		}
		
		s3parameters.InputSerialization.CSV=S3SelectParameter.InputSerialization.CSV;
	}
	else if(S3SelectParameter.InputSerialization.Parquet!=undefined){
		console.log("Parquet support to be done!")
	}

	var promises =prefixarray.map( prefix=> {
		s3parameters.Key=prefix[0];
		s3parameters.Bucket=prefix[1];
		let params=s3parameters;
		return  FilteredS3data (params,type,header);
	})//prefixarray.map
  
	var resolved =await Promise.all(promises)
	var results = _.compact(_.flatten(resolved));
  
	if ( typeof results[0][S3SelectParameter.InputSerialization.RootElement] =="object"){
		//its a list of elements 
		var combined=[];
		results.map(r=>combined.push(r.Records));
		results=_.flatten(combined);
	}
  
	console.log("Number of matching data: "+results.length+ " \n")
	return results
}

async function FilteredS3data(params,type,header) {
    var filtereresult=  new Promise((resolve) => {
	// sources: https://thetrevorharmon.com/blog/how-to-use-s3-select-to-query-json-in-node-js ,https://github.com/aws/aws-sdk-js/issues/1682
	//Alternative: https://www.pluralsight.com/guides/javascript-callbacks-variable-scope-problem
	var req = s3.selectObjectContent(params, function(err, data) {
		if (err){
			console.log("error:\n");
			console.log(JSON.stringify(err));
		}  // an error occurred
		else {
				var results = [];
				var eventStream = data.Payload;

				eventStream.on('data', ({ Records, End }) => {
				if (Records) {
					results.push(Records.Payload)
				} else if (End) {
					let plainstring = Buffer.concat(results).toString('utf8');
					var result=[];
					if (type=="JSON"){
						var result= convertrawdata(plainstring);
						resolve(result);
					}
					else if(type=="CSV" && header==true){
						var result= convertrawdata(plainstring);
						resolve(result);
					}
					else if(type=="CSV" && header==false){ 
						result.push(plainstring);
						resolve({Result:"PASS",Data:result});
					}
					
				}
				});//eventstream on data
			
		}// successful response
	});
		
	req.on('complete', (response) => {                     
		if(response.error!=null) {
			var errorstring=response.httpResponse.stream.req._header
			var file=errorstring.match(/POST.*?select.*/g)
			var bucket=errorstring.match(/Host:.*/g)
			//this is the compacted errormessage 
			var errormessagedatabase="Error Processing request: \n"+file+"\n"+bucket+"\nReason:\n"+Buffer.from(response.httpResponse.body).toString('utf8');
			//this is the full errormessage:
			var errormessageconsole="Error Processing request: \n"+errorstring +"\n------------------------------------------------------------------\n"
				errormessageconsole+= Buffer.from(response.httpResponse.body).toString('utf8')
				console.log(errormessageconsole);
			resolve({Result:"Fail",Data:errormessagedatabase});
		}
	})

    });//new promise

  var result = await filtereresult
  if (result.Result == "PASS"){
    return result.Data
  }
  else{
	console.log(result)
	return result
  }
 
} //FilteredS3data

function convertdatatosqlschema(s3results,SelectedModel){
	var array=[]
	var themodel=SelectedModel
	_.forEach(s3results, existingentry => {

		for (var Modelskey in SelectedModel) {
			var value=existingentry[Modelskey];
			var type=(themodel[Modelskey]).type.key;
			
			if((type=='INTEGER'||type=='BIGINT')){
			//convert non number value such as '-' to NULL
				if (value.match(/^[0-9]*$/)==null){
					value=null
					existingentry[Modelskey]=value;
				}
				else{
					try{
						value=parseInt(value);
					}
					catch(err){
						console.log("The key: \n"+Modelskey+"\nThe Value: \n"+value+"\nThe error: \n"+err)
					};
					existingentry[Modelskey]=value;
				}
			}
			else if (value ==="null"){
				value=null
				existingentry[Modelskey]=value;
			}
		}
		array.push(existingentry);
	})
	return array
}

function convertrawdata(plainstring){
	plainstring = plainstring.replace(/\,$/, '');  
	// Add into JSON 'array'
	plainstring = `[${plainstring}]`;  
	try {
		var JSONobject = JSON.parse(plainstring);
		var result={Result:"PASS",Data:JSONobject}//encapsulating state of data to PASS/FAIL JSON object. 

	} catch (e) {
		console.log(e);
		var result={Result:"Fail",Data:e}
	}

	return result
}

async function InsertData(sequelize,Model,SelectedModel,QueryType,DBTableName,Transformeddata){

	return sequelize.transaction(t => {
    
		class Entry extends Model {}
		Entry.init(SelectedModel, {
		sequelize,
		modelName: QueryType,
    tableName: DBTableName,
		freezeTableName: true	
		})
						
		return Entry.bulkCreate(Transformeddata, {transaction: t})
	    .then(result => {
        rdsinsertsuccess=true
        console.log('SQL Server BulkEntry  has been completed successfully. Number of entries: '+Transformeddata.length)       
				// Transaction has been committed
        // result is whatever the result of the promise chain returned to the transaction callback

		}).catch(err => {
      console.log(err)
      rdsinsertsuccess=false
				// Transaction has been rolled back
        // err is whatever rejected the promise chain returned to the transaction callback
		});

	}) //return sequlize
}//insert data function

async function CreateSQLTable(sequelize,Model,SelectedModel,QueryType,DBTableName){
	//this initailizes the table in the database.
		return new Promise((resolve, reject) => {
			class Entry extends Model {}
			Entry.init(SelectedModel, {
				sequelize,
				modelName: QueryType,
				freezeTableName: true,	
				tableName: DBTableName, //'my_very_custom_table_name2',
			}).then(
				resolve(Entry.sync({ force: true }))
			).catch(err => {			
					console.log(err)
					reject(err)
			});
		})
		
}

/*

	var params={"Bucket":"lltestdata","Key":"vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0355Z_934a25e8.log.gz","ExpressionType":"SQL","Expression":"select * from s3object s","InputSerialization":{"CompressionType":"GZIP","CSV":{"FileHeaderInfo":"NONE","FieldDelimiter":" "}},"OutputSerialization":{"CSV":{"RecordDelimiter":";","FieldDelimiter":" "}}}

	// '{"Bucket":"lltestdata","Key":"vpcflowlogs/ap-southeast-2/2020/09/27/accountnumber_vpcflowlogs_ap-southeast-2_fl-04c552f50e8e18a29_20200927T0600Z_8e1a3414.log.gz","ExpressionType":"SQL","Expression":"select * from S3Object[*].Records[*] s ","InputSerialization":{"CompressionType":"GZIP","JSON":{"Type":"LINES"}},"OutputSerialization":{"JSON":{"RecordDelimiter":","}}}'

	// aws s3api select-object-content --bucket lltestdata --key ctrail/06/accountnumber_CloudTrail_ap-southeast-2_20190906T0305Z_hpdoyLeVUP3BMd3z.json.gz --expression "select * from S3Object[*].Records[*]  s Where s.errorMessage!='null'" --expression-type SQL --input-serialization CompressionType=GZIP,JSON={Type=LINES} --output-serialization JSON={RecordDelimiter=','} ./testdata.txt --debug

*/