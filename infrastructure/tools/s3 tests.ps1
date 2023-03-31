function enumerate-s3files(){
    param(
        [Parameter()]
        [String[]]$prefixarray,
        [string]$bucket
    )
     #The number of files slightly differ as per console and as pare this tool.
     #The reason for that bellow does not count empty directories (files with 0 length). 
    $total=0
    foreach($item in $prefixarray){
        $data=iex "aws s3api list-objects-v2 --bucket $bucket --prefix $item --delimiter '/'" # 
        $number=$($($data |ConvertFrom-Json).Contents).count
        write-host "Number: " $number ".  Item: "$item "`n"
        $total+= $number
        Write-Host "Total: "$total "`n`n`n"
    }
}

$bucket="lldata"
#to test credentials.
Get-S3Bucket -BucketName $bucket 

#usage:
enumerate-s3files -prefixarray @("06/","06/02/","06/02/000/","06/01/","06/01/001/","06/03/") -bucket $bucket


cd C:\Users\Administrator\Documents\LogverzCore\build\temp

$jsonstring=Get-Content "C:\Users\Administrator\Downloads\accountnumber_CloudTrail_ap-southeast-2_20191020T2310Z_ZCGATcf1e9YAkGpn.json"
$jsonobject= $jsonstring |ConvertFrom-Json

 $jsonobject.Records |ConvertTo-Csv |Out-File 

 
for($i=0;$i -lt $jsonobject.Records.Length;$i++){
    $record=$jsonobject.Records[$i]
    $record | ConvertTo-Csv| Out-File $i".txt"
}
#change powershell window width and height if needed: 

#$pshost = get-host
#$pswindow = $pshost.ui.rawui
#$newsize = $pswindow.buffersize
#$newsize.height = 3000
#$newsize.width = 400
#$pswindow.buffersize = $newsize

#auto remove failed multipart chunks from bucket after 1 day:
#C:\Users\Administrator\Documents\LogverzCore\build>aws s3api put-bucket-lifecycle-configuration --bucket lldata --lifecycle-configuration file://filename-containing-lifecycle-configuration.txt

#list mulipart uploads
#aws s3api list-multipart-uploads --bucket lldata

#ondemand remove failed multipart chunks from bucket:
#$uploadid="fSFljZS1.ScQjPTnfhe2T4HO.InzYur.visHGZmJVxSE.0G2ozQ_gaaYH2ebV4Y4nlN6_6wCQuBuS5y9Ny6bDBeRkXft56a8cNFf8fiBvAlfh9.GDQzx3td9ccNid6Cge8IJWgL1VhXS7MekiPRaKg--"
#iex "aws s3api abort-multipart-upload --bucket lldata --key 'dummy.zip' --upload-id $uploadid"
