
#dont forget to associate the ec2 instance with the DB security group
#also it needs to have lambda and s3 full access  
#tecadmin install nodejs

<# 
SQL Table creation: 
CREATE TABLE public.concurencytest (
	eventid int8 NOT NULL GENERATED ALWAYS AS IDENTITY,
	jobid varchar NULL,
	invocationid int4 NULL,
	"content" varchar NULL,
	starttime varchar NULL
);
#>
# Set environment variables for test 
#setx  PGUSER zzzz /m 
#setx  PGHOST ld4zazynxx5t4d.cw2wwlr9bvlw.ap-southeast-2.rds.amazonaws.com /m
#setx  PGPASSWORD xxxx /m
#setx  PGDATABASE ConcurrencyTest /m
#setx  PGPORT 5432 /m

#lambda async invocation client context issue: 
# https://github.com/aws/aws-sdk-js/issues/1388
 

Get-LMFunctionList -FunctionVersion ALL

$context='{"jobid": "BBB",'
$context+='"QueryType": "CloudTrail",'
$context+='"invocationid": "BBB",'
$context+='"QueueURL": "https://sqs.ap-southeast-2.amazonaws.com/accountnumber/LogverzMessageQueueS1.fifo",'
$context+="`"S3SelectQuery`": `"select * from S3Object[*].Records[*] s Where s.errorcode='ThrottlingException'`","
$context+='"DatabaseParameters": "LogverzDBEndpointName=llol1nbx804u7z.cw2wwlr9bvlw.ap-southeast-2.rds.amazonaws.com<!!>LogverzDBEndpointPort=5432<!!>LogverzEngineType=postgres<!!>LogverzDBUserName=hegyannadmin",'
$context+='"DBTableName": "First_Table",'
$context+='"S3SelectParameter": "{\"Compression\":\"GZIP\",\"JsonType\":\"LINES\"}"}'

$Bytes = [System.Text.Encoding]::UTF8.GetBytes($context)
$EncodedConText =[Convert]::ToBase64String($Bytes)



 for($i=0;$i -lt 75;$i++){
 
 <#
    $context = '{"jobid":"'+$jobid+'","invocationid":"'+$i+'"}'
    $Bytes = [System.Text.Encoding]::UTF8.GetBytes($context)
    $EncodedConText =[Convert]::ToBase64String($Bytes)
    
    Invoke-LMFunction -FunctionName "Test-DBClient"  -InvocationType Event -ClientContext  $newcontext #-ClientContext $EncodedConText
    Start-Sleep -Milliseconds 200
    write-host "Started job: " $i 
 #>
  

 Start-Job -ScriptBlock { Start-sleep -Seconds 30 }
 Start-Sleep -Seconds 5
 Start-Job -ScriptBlock { Start-sleep -Seconds 30 }

 Get-Job 



 }

 $jobid="001"
 #https://stackoverflow.com/questions/46095064/using-boto3-and-python3-i-cannot-base64-encode-the-json-for-clientcontext
 $newcontext='{
    "custom": {"foo": "bar"},
    "env": {"test": "test"},
    "client": {}
}	
'


    $Bytes = [System.Text.Encoding]::UTF8.GetBytes($newcontext)
    $EncodedConText =[Convert]::ToBase64String($Bytes)
    

Measure-Command {     

 Invoke-LMFunction -FunctionName "Test-DBClient"  -InvocationType RequestResponse -ClientContext  $newcontext

}


iex "aws.exe lambda invoke --function-name Test-DBClient --invocation-type RequestResponse --client-context $EncodedConText  out.txt"
