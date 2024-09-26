
#Add your event {...} from cloudwatch to line 4.
$CWeventJSON=@"

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