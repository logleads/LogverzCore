var AWS = require('aws-sdk');
AWS.config.update({
	region: 'ap-southeast-2',
});
var SSM = new AWS.SSM();
const Sequelize = require('sequelize');
const fsPromises = require('fs').promises

main()

async function main () {
    var [DBEndpointName, DBEndpointPort,DBEngineType,DBUserName,DBPassword,SchemaCtrail,DataTypeSelector] = await Promise.all([
        getssmparameter({Name: 'LogverzDBEndpointName',WithDecryption: true}),
        getssmparameter({Name: 'LogverzDBEndpointPort',WithDecryption: true}),
        getssmparameter({Name: 'LogverzEngineType',WithDecryption: true}),
        getssmparameter({Name: 'LogverzDBUserName',WithDecryption: true}),
        getssmparameter({Name: 'LogverzDBUserPassword',WithDecryption: true}),
        getssmparameter({Name: '/Logverz/Engine/Schemas/CloudTrail',WithDecryption: true}),
        getssmparameter({Name: 'LogverzDataTypeSelector',WithDecryption: true})
    ]);

    const DBName = "Logverz"
    const sequelize = new Sequelize(`${DBEngineType.Parameter.Value}://${DBUserName.Parameter.Value}:${DBPassword.Parameter.Value}@${DBEndpointName.Parameter.Value}:${DBEndpointPort.Parameter.Value}/${DBName}`);
    const Model = Sequelize.Model;
    const ModelName=DataTypeSelector.Parameter.Value

    switch(ModelName) {
		case "CloudTrail":
			//await writemodel(SchemaCtrail.Parameter.Value)
            await fsPromises.writeFile('./build/SelectedModel.js',constructmodel(SchemaCtrail.Parameter.Value))
            break;
		case "Custom":
		  // code block
		  break;
	}
    
    //const SelectedModel = require("../build/SchemaCloudTrail");
    const SelectedModel = require("../build/SelectedModel.js")
    
    console.log(SelectedModel)
}
// CloudTrail SchemaCloudTrail

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
function constructmodel(schema){
    FileContent="const Sequelize = require(\"sequelize\");\n"
    FileContent+="var SelectedModel ="+schema
    FileContent+="\nmodule.exports = SelectedModel;"
    return FileContent
}


/*
var SelectedModelxxx = {"eventVersion":{type: Sequelize.STRING},
"userIdentity_type":{type: Sequelize.STRING},
"userIdentity_principalId":{type: Sequelize.STRING},
"userIdentity_arn":{type: Sequelize.STRING},
"userIdentity_accountId":{type: Sequelize.STRING},
"userIdentity_accessKeyId":{type: Sequelize.STRING},
"userIdentity_userName": {type: Sequelize.STRING},
 "userIdentity_sessionContext_attributes_mfaAuthenticated":{type: Sequelize.STRING},
"userIdentity_sessionContext_attributes_creationDate":{type: Sequelize.STRING},
"userIdentity_sessionContext_sessionIssuer_type": {type: Sequelize.STRING},
"userIdentity_sessionContext_sessionIssuer_principalId": {type: Sequelize.STRING},
"userIdentity_sessionContext_sessionIssuer_arn": {type: Sequelize.STRING},
"userIdentity_sessionContext_sessionIssuer_accountId": {type: Sequelize.STRING},
"userIdentity_sessionContext_sessionIssuer_userName": {type: Sequelize.STRING},
"userIdentity_invokedBy":{type: Sequelize.STRING},
"eventTime":{type: Sequelize.STRING},
"eventSource":{type: Sequelize.STRING},
"eventName":{type: Sequelize.STRING},
"awsRegion":{type: Sequelize.STRING},
"sourceIPAddress":{type: Sequelize.STRING},
"userAgent":{type: Sequelize.STRING},
"errorCode":{type: Sequelize.STRING},
"errorMessage":{type: Sequelize.STRING},
"requestParameters":{type: Sequelize.JSON},
"responseElements":{type: Sequelize.JSON},
"additionalEventData":{type: Sequelize.JSON},
"requestID":{type: Sequelize.STRING},
"eventID":{type: Sequelize.STRING},
"eventType":{type: Sequelize.STRING},
"recipientAccountId":{type: Sequelize.STRING},
"vpcEndpointId":{type: Sequelize.STRING},
"serviceEventDetails": {type: Sequelize.STRING},
"readOnly":{type: Sequelize.STRING},
"resources": {type: Sequelize.STRING},
"Ctrailfilepath":{type: Sequelize.STRING}}

*/