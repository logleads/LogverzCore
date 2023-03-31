#source:https://docs.aws.amazon.com/powershell/latest/reference/items/Send-SQSMessage.html

$queueurl="https://sqs.ap-southeast-2.amazonaws.com/accountnumber/LogverzMessageQueueS1.fifo"
$projectpath="C:\Users\Administrator\Documents\Logverz"
$messaggroupid="Q99Fx654y6gBv2bqvVZL9mV5ZgQndOaMFrWNjqQokaumKbFtfCR5zWUtBIXDcreFSAL0aGEYibp6KueSrmVaAj59KAONqvCpiGF3yoVTUweKU7boXdtSPYJwNiwRVTdz" #randomly generated
$Schema='{"eventVersion":{type: Sequelize.STRING}, "userIdentity":{type: Sequelize.JSON}, "eventTime":{type: Sequelize.STRING}, "eventSource":{type: Sequelize.STRING}, "eventName":{type: Sequelize.STRING}, "awsRegion":{type: Sequelize.STRING}, "sourceIPAddress":{type: Sequelize.STRING}, "userAgent":{type: Sequelize.STRING}, "errorCode":{type: Sequelize.STRING}, "errorMessage":{type: Sequelize.STRING(8192)}, "requestParameters":{type: Sequelize.JSON}, "responseElements":{type: Sequelize.JSON}, "additionalEventData":{type: Sequelize.JSON}, "requestID":{type: Sequelize.STRING}, "eventID":{type: Sequelize.STRING}, "eventType":{type: Sequelize.STRING}, "recipientAccountId":{type: Sequelize.STRING}, "vpcEndpointId":{type: Sequelize.STRING}, "serviceEventDetails": {type: Sequelize.STRING}, "readOnly":{type: Sequelize.STRING}, "resources": {type: Sequelize.JSON}}'
#https://docs.aws.amazon.com/powershell/latest/reference/items/Receive-SQSMessage.html

$LogverzMessageQueueS1=Get-SQSQueueAttribute -QueueUrl $queueurl -AttributeName "All"
$LogverzMessageQueueS1.ApproximateNumberOfMessages 


for($i=0;$i -lt $LogverzMessageQueueS1.ApproximateNumberOfMessages ;$i++){
 
    $sqsmessage=Receive-SQSMessage -QueueUrl $queueurl -MessageCount 1 -VisibilityTimeout 90 -AttributeName "All"-WaitTimeInSeconds 0 -MessageAttributeName "All" 
    #$sqsmessage.Attributes.MessageGroupId
    #$sqsmessage.Body
    #$sqsmessage.MessageAttributes.Schema.StringValue   

    $bodyname="body"+$i+".txt"
    new-item -Path $projectpath -Name $bodyname -Value $sqsmessage.Body

}

$filearray=Get-ChildItem -Path $projectpath -File |? {$_.Name -like "*.txt"}
$SchemaAttributeValue = New-Object Amazon.SQS.Model.MessageAttributeValue
$SchemaAttributeValue.DataType = "String"
$SchemaAttributeValue.StringValue = $Schema
$messageAttributes = New-Object System.Collections.Hashtable
$messageAttributes.Add("Schema", $SchemaAttributeValue)


for($i=0;$i -lt $filearray.Count ;$i++){
    
    $file=$filearray[$i].FullName
    $filecontent=Get-Content -Path $file
    Send-SQSMessage -QueueUrl $queueurl -MessageBody $filecontent `
                    -DelayInSeconds 0 -MessageGroupId $messaggroupid #-MessageAttributes $messageAttributes 

}



