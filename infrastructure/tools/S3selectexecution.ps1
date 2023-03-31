#you need the powershell SDK installed for this to work, 3.3.20 and onwards 
#https://github.com/aws/aws-sdk-net/blob/master/sdk/src/Core/Amazon.Runtime/EventStreams/Internal/EnumerableEventStream.cs
Add-Type -Path "C:\Program Files (x86)\AWS SDK for .NET\bin\Net45\AWSSDK.S3.dll"
#https://aws.amazon.com/developer/language/net/code-samples/powershell-code-samples/

#source:https://github.com/austoonz/Convert/blob/master/src/Convert/Public/ConvertFrom-MemoryStreamToString.ps1
function ConvertFrom-MemoryStreamToString
{
    [CmdletBinding(HelpUri = 'http://convert.readthedocs.io/en/latest/functions/ConvertFrom-MemoryStreamToString/')]
    [Alias('ConvertFrom-StreamToString')]
    param
    (
        [Parameter(
            Mandatory = $true,
            ValueFromPipeline = $true,
            ValueFromPipelineByPropertyName = $true,
            ParameterSetName = 'MemoryStream')]
        [ValidateNotNullOrEmpty()]
        [System.IO.MemoryStream[]]
        $MemoryStream,

        [Parameter(
            Mandatory = $true,
            ValueFromPipelineByPropertyName = $true,
            ParameterSetName = 'Stream')]
        [ValidateNotNullOrEmpty()]
        [System.IO.Stream[]]
        $Stream
    )

    begin
    {
        $userErrorActionPreference = $ErrorActionPreference
    }

    process
    {
        switch ($PSCmdlet.ParameterSetName)
        {
            'MemoryStream'
            {
                $inputObject = $MemoryStream
            }
            'Stream'
            {
                $inputObject = $Stream
            }
        }

        foreach ($object in $inputObject)
        {
            try
            {
                $reader = [System.IO.StreamReader]::new($object)
                if ($PSCmdlet.ParameterSetName -eq 'MemoryStream')
                {
                    $object.Position = 0
                }
                $reader.ReadToEnd()
            }
            catch
            {
                Write-Error -ErrorRecord $_ -ErrorAction $userErrorActionPreference
            }
            finally
            {
                if ($reader)
                {
                    $reader.Dispose()
                }
            }
        }
    }
}

function find-cloudtrailentries{
    param(
        [Parameter()]
        [string]$query,
        [string]$bucket,
        [array]$filearray
    )
    $InputSerialization = [Amazon.S3.Model.InputSerialization]::new()
    $JSONInput=[Amazon.S3.Model.JSONInput]::new()
    $JSONInput.JsonType="Lines" 
    $InputSerialization.CompressionType="GZIP"
    $InputSerialization.JSON=$JSONInput

    $OutputSerialization =[Amazon.S3.Model.OutputSerialization]::new()
    $JSONOutput=[Amazon.S3.Model.JSONOutput]::new()
    $JSONOutput.RecordDelimiter=","
    $OutputSerialization.JSON=$JSONOutput
    $ExpressionType= [Amazon.S3.ExpressionType]::SQL
    $dataarray=@()

    for($i=0;$i -lt $filearray.Length;$i++){
        $file=$filearray[$i]
        $extendedbos=@()

        $Bytes=Select-S3ObjectContent -Expression $query -Bucket $bucket -ExpressionType $ExpressionType `
                                      -InputSerialization $InputSerialization -Key $file -OutputSerialization $OutputSerialization

        #Only try to process data payload exists, no need to go into the 
        if($Bytes.Length -eq 3) { 
            write-host "processing" $file
            $string=ConvertFrom-MemoryStreamToString -MemoryStream $Bytes[0].Payload
            #$Bytes[0].Payload.Length  #$string.Length
    
            #check last charachter if its "," remove it to get valid JSON. 
            if ($string.Substring($string.Length-1) -eq ",") {
            $jsonstring="["+$string.Substring(0,$string.Length-1)+"]"
            }
            else{
            $jsonstring="["+$string+"]"
            }

            $dataobjects =$jsonstring |ConvertFrom-Json
        
            foreach($dbo in $dataobjects){
                Add-Member -InputObject $dbo  -NotePropertyName FileName -NotePropertyValue $file
                $extendedbos+=$dbo
            } 

            $dataarray += $extendedbos
            write-host $dataarray.Length
        }
        else{
            write-host $i "/" $filearray.Length "no matching data in "$file
        }
    }
    return $dataarray

}

#https://docs.aws.amazon.com/powershell/latest/reference/items/Get-S3Object.html
$bucket=""

$list=Get-S3Object -BucketName $bucket -KeyPrefix ""
$list.Count

#$keys=@()
$keys= $list|%{$_.Key} |? {$_ -like "*.gz"}

$keys.count
$keys[1] |get-member


$file1=""
$file2=""
$file3=""
$file4=""
$filearray=@($file1,$file4,$file2,$file3)

$query= "select * from S3Object[*].Records[*] s Where s.errorcode!='null'" #"select * from S3Object[*].Records[*] s Where s.errorMessage!='null'"


$result=find-cloudtrailentries -query $query -bucket $bucket -filearray $keys #$filearray

$result.Count
$result| ? {$_.errorMessage -ne $null} 

$result| ? {$_.errorMessage -ne $null}| Select-Object eventName,errorCode,eventID,requestID,FileName |ft

#cli:
#aws s3api select-object-content --bucket xxx --key yyy.json.gz --expression "select * from S3Object[*].Records[*]  s Where s.errorMessage!='null'"  --expression-type SQL --input-serialization CompressionType=GZIP,JSON={Type=LINES} --output-serialization JSON={RecordDelimiter=','} ./testdata.txt

#cd C:\Users\Administrator\Documents\LogverzCore\snippets
#Start-Process 'cmd'  -ArgumentList "/c aws.exe s3api select-object-content --bucket $bucket --key $file --expression `"$query`"  --expression-type SQL --input-serialization CompressionType=GZIP,JSON={Type=LINES} --output-serialization JSON={RecordDelimiter=','} ./testdata.txt"  
#Remove-Item .\testdata.txt