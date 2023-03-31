
#replace put sample event with your the event from cloudwatch.
$CWeventJSON=@"
{
    "RequestType": "Delete",
    "ServiceToken": "arn:aws:lambda:ap-southeast-2:965017399465:function:Logverz-SetConnectionParamsDB",
    "ResponseURL": "https://cloudformation-custom-resource-response-apsoutheast2.s3-ap-southeast-2.amazonaws.com/arn%3Aaws%3Acloudformation%3Aap-southeast-2%3A965017399465%3Astack/Logverz-DefaultDB-16DUSLS01PUMF/081ffba0-62e5-11ed-bc6d-0227f711bc36%7CSendDeleteSignal%7C08a921c0-0dc9-4f94-befd-ebb9b2beaceb?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20230203T212728Z&X-Amz-SignedHeaders=host&X-Amz-Expires=7200&X-Amz-Credential=AKIA6MM33IIZY5PTL54Z%2F20230203%2Fap-southeast-2%2Fs3%2Faws4_request&X-Amz-Signature=f27e23e19bffcd3c765adacf2873aa4b96e6d758d6032ad6415b43fb2bc8562e",
    "StackId": "arn:aws:cloudformation:ap-southeast-2:965017399465:stack/Logverz-DefaultDB-16DUSLS01PUMF/081ffba0-62e5-11ed-bc6d-0227f711bc36",
    "RequestId": "08a921c0-0dc9-4f94-befd-ebb9b2beaceb",
    "LogicalResourceId": "SendDeleteSignal",
    "PhysicalResourceId": "2022/11/12/[$LATEST]c9ed11233ff847db86ceb0850f333ae6",
    "ResourceType": "Custom::LambdaFunction",
    "ResourceProperties": {
        "ServiceToken": "arn:aws:lambda:ap-southeast-2:965017399465:function:Logverz-SetConnectionParamsDB",
        "RegistryNewValue": "LogverzDBFriendlyName=DefaultDB,LogverzDBEndpointName=logverz-defaultdb-16dusls01pumf-logverzdb-l71c3hnuf7wu.ctmpydtwitz8.ap-southeast-2.rds.amazonaws.com,LogverzDBSecretRef=/Logverz/Database/DefaultDBPassword",
        "Mode": "StackDelete",
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