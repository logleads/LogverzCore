var AWS = require('aws-sdk');
var _ = require('lodash');
const Sequelize = require('sequelize');
AWS.config.update({
	region: 'ap-southeast-2',
});

const DBuser = "LogverzAdmin"
const DBInstanceEndpointName = "llt0l0c207bu1g.cw2wwlr9bvlw.ap-southeast-2.rds.amazonaws.com"
const DBInstanceEndpointPort= "5432"
const DBPassword = ""
const DBName = "Logverz"
const DBEngineType ="postgres";
const sequelize = new Sequelize(`${DBEngineType}://${DBuser}:${DBPassword}@${DBInstanceEndpointName}:${DBInstanceEndpointPort}/${DBName}`);
const Model = Sequelize.Model;
const DBTableName ="First_Table"

var ctrailobjects =[{
    "eventVersion": "1.05",
    "userIdentity": {
        "type": "AWSService",
        "invokedBy": "eks.amazonaws.com"
    },
    "eventTime": "2020-09-06T04:01:09Z",
    "eventSource": "sts.amazonaws.com",
    "eventName": "AssumeRole",
    "awsRegion": "ap-southeast-2",
    "sourceIPAddress": "eks.amazonaws.com",
    "userAgent": "eks.amazonaws.com"
    },
	{
		"eventVersion": "1.05",
		"userIdentity": {
			"type": "AWSService",
			"invokedBy": "eks.amazonaws.com"
		},
		"eventTime": "2020-09-06T04:02:09Z",
		"eventSource": "sts.amazonaws.com",
		"eventName": "AssumeRole",
		"awsRegion": "ap-southeast-2",
		"sourceIPAddress": "eks.amazonaws.com",
		"userAgent": "eks.amazonaws.com"
	}
]

var NewModel = {"eventVersion":{type: Sequelize.STRING},
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
"resources": {type: Sequelize.JSON},
"Ctrailfilepath":{type: Sequelize.STRING}
}

	
function NewEntry (obj,NewModel) {
	//to filter which colums of the model are set as JSON in the model, as some in the model may have been  specified as string but are of type json.
	// we need to convert  fileds that are not specified as JSON and are of type json to String. OTherwise import fails. 
	var JSONFieldsarray =[]
	for (Modelskey in NewModel) {
	if (NewModel[Modelskey].type=="JSONTYPE"){
		JSONFieldsarray.push(Modelskey)
	}
	}
console.log(JSONFieldsarray)
	

	var NewEntry=''
	for (Modelskey in NewModel) {
		if (Modelskey.includes("_")){
		value= resolve(Modelskey, obj)
			if (value ===undefined){
				value='"null"'
			}else {
				value='"'+value+'"'
			} 
		}
		else{
			value=JSON.stringify(obj[Modelskey])
			if (value ===undefined){
				value='"null"'
			}
			else if (value ==="null"){
				value='"'+value+'"'
			} 
		}
		if(DBEngineType =="mssql"){
			// sequalize mssql modul tedious.js does not support JSON type values, hence need to convert json to string.
			//https://stackoverflow.com/questions/11346963/javascript-replace-double-quotes-with-slash
			value='"'+value.replace(/"/g,'\\"')+'"'
		}// the data is an object or array of object ie starting with {,[ respectively, yet key is not identified as JSON type. 
		//Than convert json to string.
		else if( (value.match('^{"')||value.match('^\\[\\{')) && !(_.includes(JSONFieldsarray,Modelskey)) ){
			oldvalue=value	 
			value='"'+value.replace(/"/g,'\\"')+'"'
			console.log("\n\nWARN: \""+Modelskey+"\" key is not specified as type of JSON in schema however it matches object or array type.The oldvalue:\n\n" +oldvalue+"\n\nConverted to:\n\n"+value+"\n\n")
		}
		Modelskey='"'+Modelskey+'"'
		NewEntry += Modelskey  +': '+ value+',\n'
	}
		//remove trailing , and new line
		NewEntry=NewEntry.substring(0, NewEntry.length - 2)
		NewEntry='{'+NewEntry+'}'
		return NewEntry
}

function resolve(path, obj) {
	//https://stackoverflow.com/questions/4244896/dynamically-access-object-property-using-variable
	return path.split('_').reduce(
		function(prev, curr) {
		return prev ? prev[curr] : null
	},
	 obj || self)
}

async function InitiateConnection() {	
var result =sequelize.authenticate()
return result
}

async function CreateSQLTable(){
//this initailizes the table in the database.
	return new Promise((resolve, reject) => {
		class CloudTrail extends Model {}
		CloudTrail.init(NewModel, {
			sequelize,
			modelName: 'CloudTrail',
			freezeTableName: true,	
			tableName: DBTableName, //'my_very_custom_table_name2',
		}).then(
			resolve(CloudTrail.sync({ force: true }))
		).catch(err => {			
				console.log(err)
				reject(err)
		});
	})
	
}

async function InsertData(array){

	return sequelize.transaction(t => {
		var mystring='[' ;
		// _.forEach(array, function(ctrailobj) {
		// 	mystring += ctrailobj+","
		// })
		// mystring=mystring.substring(0, mystring.length - 2)+"\n}"
		mystring +=array[0]
		mystring+=']'
  

		class CloudTrail extends Model {}
		CloudTrail.init(NewModel, {
		sequelize,
		modelName: 'CloudTrail',
		tableName: DBTableName,
		freezeTableName: true	
		})
		.then(
			
			CloudTrail.create((JSON.parse(mystring)[0])),
			//CloudTrail.create(XXXXXXX),
			//CloudTrail.create((JSON.parse(mystring)[1]))
		)
		.catch(err => {			
			console.log(err)
			reject(err)
		});
						
		// return CloudTrail.create((JSON.parse(mystring)[0]), {transaction: t})
		// .then(
		// 	CloudTrail.create(XXXXXXXX, {transaction: t})
		// )
		// .then(
		// 	CloudTrail.create((JSON.parse(mystring)[1]), {transaction: t})  
		// ).then(result => {
		// 		// Transaction has been committed
		// 		// result is whatever the result of the promise chain returned to the transaction callback
		// }).catch(err => {
		// 		// Transaction has been rolled back
		// 		// err is whatever rejected the promise chain returned to the transaction callback
		// });

	}) //return sequlize
}//insert data function
main()
async function main () {
	//check later: https://stackoverflow.com/questions/42870374/node-js-7-how-to-use-sequelize-transaction-with-async-await
	array=[]
	_.forEach(ctrailobjects, function(ctrailobj) {
		array.push(NewEntry(ctrailobj,NewModel))
  	})
	
	try {
		await InitiateConnection()
		console.log('Connection has been established successfully.')
    } catch (e) {
        console.error(e);
    }

	// try {
	// 	await CreateSQLTable()//.then(InsertData(array))
	// //InsertData(array)
	// 	console.log('Table has been setup successfully.')
    // } catch (e) {
    //     console.error(e);
    // }
	
	try {
   //     const action = await InsertData(array)
		await InsertData(array)
		console.log('Table user has been added successfully.')
    } catch (e) {
        console.error(e);
    }

}





/*
Example of NOT transactionally safe execution mystring[1] is not added however mytring[0] is. 

async function InsertData(array){

	return new Promise((resolve, reject) => {
		var mystring='[' ;
		_.forEach(array, function(ctrailobj) {
			mystring += ctrailobj+","
		})
		mystring=mystring.substring(0, mystring.length - 2)+"\n}"
		mystring+=']'
		
		class CloudTrail extends Model {}
		CloudTrail.init(NewModel, {
		sequelize,
		modelName: 'CloudTrail',
		tableName: DBTableName,
		freezeTableName: true	
		}).then(
			
			CloudTrail.create((JSON.parse(mystring)[0])),
			CloudTrail.create(XXXXXXX),
			CloudTrail.create((JSON.parse(mystring)[1]))
		)
		.catch(err => {			
			console.log(err)
			reject(err)
		  });
				
	})
}

*/