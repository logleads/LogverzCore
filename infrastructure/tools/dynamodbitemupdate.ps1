#install: https://www.powershellgallery.com/packages/AWS.Tools.DynamoDBv2/4.1.10.0
#samples: https://aws.amazon.com/developer/language/net/code-samples/powershell-code-samples/

#1 set credentials info: https://docs.aws.amazon.com/powershell/latest/userguide/specifying-your-aws-credentials.html
#2 Set-AWSCredentials -AccessKey XXX -SecretKey YYY  -StoreAs profileX
#3 Initialize-AWSDefaultConfiguration -ProfileName profileX -Region ap-southeast-2
#4 verify using command: "Get-STSCallerIdentity"  and command "Get-AWSCredential -ListProfileDetail"


Add-Type -Path "C:\Program Files (x86)\AWS SDK for .NET\bin\Net45\AWSSDK.DynamoDBv2.dll"

# Create a RegionEndpoint object directly, or using an AWS Region name

$region = [Amazon.RegionEndpoint]::GetBySystemName('ap-southeast-2');
$tableName = 'Logverz-Queries';
# Create an AmazonDynamoDBClient. This is used for the underlying API calls
#   - Use default AWS credentials, or an AWS credential object
$client = New-Object -TypeName Amazon.DynamoDBv2.AmazonDynamoDBClient -ArgumentList $region

# Create a Table object. This is used for calls using the DynamoDB Document Model
$table = [Amazon.DynamoDBv2.DocumentModel.Table]::LoadTable($client,$tableName);


# Create the List for storing the retrieved Document objects
$documentList = New-Object -TypeName 'System.Collections.Generic.List[Amazon.DynamoDBv2.DocumentModel.Document]'

$scan=New-Object -TypeName Amazon.DynamoDBv2.DocumentModel.ScanFilter

$search = $table.Scan($scan);
$documentSet = $search.GetNextSet();
      
for ($i=0; $i -lt $documentSet.count; $i++) {
    $document= $documentSet[$i];
    $object= ConvertFrom-Json -InputObject $document.ToJson()
    $object | Add-Member -Type NoteProperty -Name 'Active' -Value $false
    $newdocument=$object|ConvertTo-Json
    $DDdocument = [Amazon.DynamoDBv2.DocumentModel.Document]::FromJson($newdocument);
    $table.UpdateItem($DDdocument);
    write-host $i `n
}


<#
    [System.Collections.ArrayList]$oldvalue= $documentSet[0]|ConvertTo-Json | ConvertFrom-Json

    $value = @{
    Value = 'API'
    Type = 0
    }

    $Type=@{
        Key       = 'Type'
        Value = $value
    }
    $newvalue=$(@($oldvalue; $Type) | ConvertTo-Json| ConvertFrom-Json)|ConvertTo-Json
#>

#AWS CLI: 
#aws dynamodb query --table-name Logverz-Identities --expression-attribute-names "#AN=IAM,#IAMGroups=IAMGroups"  --key-condition-expression "#AN = :AttributeValue" --index-name "IAMIndex" --filter-expression "contains(#IAMGroups,:L)" --expression-attribute-values file://querystring.json 

#querystring.json:{
#    ":AttributeValue": {"S": "true"},
#    ":L": {"S":"LogverzPowerUsers-ap-southeast-2"}
#}