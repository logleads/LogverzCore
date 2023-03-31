
#to validate the json we need to set the screen width large, to avoid erroneous linebreaks. 
#$pshost = Get-Host              # Get the PowerShell Host.
#$pswindow = $pshost.UI.RawUI    # Get the PowerShell Host's UI.

#$newsize = $pswindow.BufferSize # Get the UI's current Buffer Size.
#$newsize.width = 1500            # Set the new buffer's width to 150 columns.
#$pswindow.buffersize = $newsize # Set the new Buffer Size as active.


#Run a Worker-lambda individually as if it where initiated by the controller.   
$context='{"jobid": "v87baBXfIJog",'
$context+='"QueryType": "ClassicLB",'
$context+='"invocationid": "S3fng0xc5uDeuzyZ",'
$context+='"QueueURL": "https://sqs.ap-southeast-2.amazonaws.com/accountnumber/LogverzMessageQueueS0.fifo",'
$context+='"S3SelectQuery": "SELECT * FROM s3object s",'
$context+='"DatabaseParameters": "LogverzDBFriendlyName=DefaultDB<!!>LogverzDBEndpointName=apigwid.ctmpydtwitz8.ap-southeast-2.rds.amazonaws.com<!!>LogverzDBEndpointPort=5432<!!>LogverzEngineType=postgres<!!>LogverzDBUserName=LogverzAdmin<!!>LogverzDBSecretRef=/Logverz/Database/DefaultDBPassword<!!>LogverzDBInstanceClass=db.t2.micro",'
$context+='"DBTableName": "Sample_ClassicLB",'
$context+='"S3SelectParameter": "{\"InputSerialization\":{\"Compression\":\"NONE\",\"CSV\":{\"FileHeaderInfo\":\"NONE\",\"FieldDelimiter\":\" \"}},\"OutputSerialization\":{\"CSV\":{\"RecordDelimiter\":\";;\",\"FieldDelimiter\":\" \"}}}",'
$context+='"Schema":"{\"timestamp\":{type: Sequelize.STRING(64)},\"elb\":{type: Sequelize.STRING(64)},\"client:port\":{type: Sequelize.STRING(64)},\"backend:port\":{type: Sequelize.STRING},\"request_processing_time\":{type: Sequelize.DOUBLE},\"backend_processing_time\":{type: Sequelize.DOUBLE},\"response_processing_time\":{type: Sequelize.DOUBLE},\"elb_status_code\":{type: Sequelize.INTEGER},\"backend_status_code\":{type: Sequelize.INTEGER},\"received_bytes\":{type: Sequelize.BIGINT},\"sent_bytes\":{type: Sequelize.BIGINT},\"request\":{type: Sequelize.STRING(8192)},\"user_agent\":{type: Sequelize.STRING(8192)},\"ssl_cipher\":{type: Sequelize.STRING},\"ssl_protocol\":{type: Sequelize.STRING(8)}}"'
$context+='}'

$context


$Bytes = [System.Text.Encoding]::UTF8.GetBytes($context)
$EncodedConText =[Convert]::ToBase64String($Bytes)
# Alternative encodgin method: #https://adsecurity.org/?p=478

iex "aws.exe lambda invoke --function-name Logverz-Worker --invocation-type RequestResponse --client-context $EncodedConText  out.txt"

#https://www.igorkromin.net/index.php/2017/04/26/base64-encode-or-decode-on-the-command-line-without-installing-extra-tools-on-linux-windows-or-macos/
#certutil -encode ./testdata.txt tmp.b64 && findstr /v /c:- tmp.b64 > data.b64
#certutil -decode zip.b64 decodedzip.zip
#$envvar=@"
#-----BEGIN RSA PUBLIC KEY-----
#MIICCgKCAgEAyUui0S9iXFPX+T7l4zi1SoycpIZjTNW+o0LhU/yPyvhy25r5F0QAMyUZ3R4v+kPfYjAA+LTT8LA4FqZSOyY/Nvm+Upbj7fX5shAFQNr6zDYHh5jqO3GDDbuNQ4o1wdeFESxSIZ3FyrMCsRgTKGOyYyEfHyZcwK2NHEYS9wDiJoYCIzha0Fb1Kg9/gE+paUqBPHHnvujZAyIaPkkCg9vm628qxUpTJ+xQQ3JHgFnMdeTZ8rQbdvZ2KeSs2Me0EoDUIMvaeMYBwfXTxPzNnXZfwJvK+GzfAfkzKR0ERahJDclYVBbFb/TfBjuxT9HRARfwehedWlW7QMRrPQIjxlj4zqu0w5AW34Ac058BlbReAJinJHT67PZ3Dg67IBJrx6pUfm4VE5EsSZrAaWwgZnv0GzdbpG0OyHU1YpGWnTq23STFfiJo073BPHmkBZkIekdwASZ03UlBkFnLvrd6PD6aNWp70QMRJQP/UDl6BWGVvUrXqmZzW1L6UitanMam4ZlRt2rslX/COmfg7/kct1RY54Y3cELaOQHDqUsf64Aqw+Fes/0WVRSL0E4dXgiUkitrZILG8uIHu7RgWImnuzsnhK8QGOHvCkr9BYMI9pvHUbUQvwRkSudacAcKA8QclwPqqitLXMqZV6sIwGg9ZmKVx96zGodH4h1wNcll8ObnwzUCAwEAAQ==
#-----END RSA PUBLIC KEY-----
#"@
#Update-LMFunctionConfiguration -FunctionName Logverz-HTTPRelay -Environment_Variable @{ "APIGatewayURL"="https://apigwid.execute-api.ap-southeast-2.amazonaws.com/V3/";"LB"="Logverzlogic-bucket-kr4slgg5h2ss";"PublicKey"=$envvar;"TestPath"="enabled"}
