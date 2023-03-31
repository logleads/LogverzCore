# Get-AWSRegion
#https://docs.aws.amazon.com/powershell/latest/reference/items/Get-AWSRegion.html #LOL

$regionstring= iex "aws ssm get-parameters-by-path --path /aws/service/global-infrastructure/regions --output json"
$regionobject=$($regionstring |ConvertFrom-Json).Parameters.Name
$regionobject -like "*gov-*" | %{$_ +" GOV region, no access, need to check: https://aws.amazon.com/ec2/pricing/on-demand/ for instance availibility  `n"} 
$regionobject -like "*cn-*" | %{$_ +" China region, no access, need to check: https://www.amazonaws.cn/en/ec2/pricing/ec2-linux-pricing/   for instance availibility `n"} 
    
$regionobject=$regionobject | ?{$_ -notlike "*gov-*"}| ?{$_ -notlike "*cn-*"}


#Asia Pacific (Osaka) Local Region ** /ap-northeast-3      same as Tokyo ap-northeast-1 region. 
#https://aws.amazon.com/about-aws/global-infrastructure/regional-product-services/#Asia_Pacific_.28Osaka.29_Local_Region_**
$dataarray=@()

For ($i=0; $i -lt $regionobject.Length; $i++) {
    $oneregion = $regionobject[$i]
    $oneregioncode=$oneregion.split("/")[-1]
    write-host $i "/" $($regionobject.Length-1) ":" $oneregioncode
    $availableinstancetypes=$(Get-EC2InstanceTypeOffering -Region $oneregioncode)  |?{$_.InstanceType -match "c6g"} |?{$_.InstanceType -like "*medium*"}
    #https://aws.amazon.com/premiumsupport/knowledge-center/iam-validate-access-credentials/
    $data = New-Object -TypeName psobject    
    $data | Add-Member -MemberType NoteProperty -Name region -Value $oneregioncode
    $data | Add-Member -MemberType NoteProperty -Name types -Value $availableinstancetypes.InstanceType.Value
    $dataarray+=$data
}

$instancetypesstring=iex "aws ec2 describe-instance-type-offerings --region $oneregioncode"
$regionobject=$($instancetypesstring |ConvertFrom-Json).InstanceTypes.InstanceType