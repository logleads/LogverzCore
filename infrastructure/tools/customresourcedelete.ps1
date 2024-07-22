
#replace put sample event with your the event from cloudwatch.
$CWeventJSON=@"
{
    "RequestType": "Update",
    "ServiceToken": "arn:aws:lambda:ap-southeast-2:965017399465:function:Logverz-SetConnectionParamsDB",
    "ResponseURL": "https://cloudformation-custom-resource-response-apsoutheast2.s3-ap-southeast-2.amazonaws.com/arn%3Aaws%3Acloudformation%3Aap-southeast-2%3A965017399465%3Astack/LogverzDevEnvironment-ExternalDB-MSSQL/512e05c0-fe30-11ee-a6ed-0ac02e734187%7CSetConnectionResourceServer%7C447cd03a-3911-4be8-85e1-172177de7f0e?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20240722T153537Z&X-Amz-SignedHeaders=host&X-Amz-Expires=7200&X-Amz-Credential=AKIA6MM33IIZUKZWGRGP%2F20240722%2Fap-southeast-2%2Fs3%2Faws4_request&X-Amz-Signature=c9224474e847625688869325b94ca1ee185b3092507c479e37b73a351a378b50",
    "StackId": "arn:aws:cloudformation:ap-southeast-2:965017399465:stack/LogverzDevEnvironment-ExternalDB-MSSQL/512e05c0-fe30-11ee-a6ed-0ac02e734187",
    "RequestId": "447cd03a-3911-4be8-85e1-172177de7f0e",
    "LogicalResourceId": "SetConnectionResourceServer",
    "PhysicalResourceId": "2024/07/21/[]5aacfd6f111849ffb7cdb745cda70c6b",
    "ResourceType": "Custom::LambdaFunction",
    "ResourceProperties": {
        "ServiceToken": "arn:aws:lambda:ap-southeast-2:965017399465:function:Logverz-SetConnectionParamsDB",
        "RegistryNewValue": "LogverzDBFriendlyName=MSSQL,LogverzDBEndpointName=logverzdevenvironment-externaldb-mssql-logverzdb-tanruvpmxmqs.ctmpydtwitz8.ap-southeast-2.rds.amazonaws.com,LogverzDBEndpointPort=1433,LogverzEngineType=sqlserver-ex,LogverzDBUserName=LogverzAdmin,LogverzDBSecretRef=/Logverz/Database/MSSQLPassword,LogverzDBInstanceClass=db.t3.small,[[DBDELIM]]",
        "Mode": "RegistryRequest",
        "RegistryName": "/Logverz/Database/Registry"
    },
    "OldResourceProperties": {
        "ServiceToken": "arn:aws:lambda:ap-southeast-2:965017399465:function:Logverz-SetConnectionParamsDB",
        "RegistryNewValue": "LogverzDBFriendlyName=MSSQL,LogverzDBEndpointName=logverzdevenvironment-externaldb-mssql-logverzdb-tanruvpmxmqs.ctmpydtwitz8.ap-southeast-2.rds.amazonaws.com,LogverzDBEndpointPort=1433,LogverzEngineType=sqlserver-ex,LogverzDBUserName=LogverzAdmin,LogverzDBSecretRef=/Logverz/Database/MSSQLPassword,LogverzDBInstanceClass=db.t3.medium,[[DBDELIM]]",
        "Mode": "RegistryRequest",
        "RegistryName": "/Logverz/Database/Registry"
    }
}
"@

$CWevent= ConvertFrom-Json -InputObject $CWeventJSON




$contentType = "application/json"      
$data = @{        
    Status = "SUCCESS" #FAILED ||SUCCESS
    StackId = $CWevent.StackId 
    RequestId = $CWevent.RequestId;
    PhysicalResourceId = $CWevent.PhysicalResourceId;
    LogicalResourceId = $CWevent.LogicalResourceId;
};
$json = $data | ConvertTo-Json;
Invoke-RestMethod -Method PUT -Uri $CWevent.ResponseURL -ContentType $contentType -Body $json; 