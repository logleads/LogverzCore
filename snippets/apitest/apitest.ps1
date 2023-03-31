#https://techbeacon.com/app-dev-testing/11-top-open-source-api-testing-tools-what-your-team-needs-know

 Add-Type -AssemblyName System.Web
function Request-Token{
    param(
            [Parameter()]
            [object]$loginparams
    )
    $response= Invoke-WebRequest -Uri $($apigwurl+"/Auth?user=$($loginparams.user)&password=$($loginparams.password)&account=$($loginparams.account)") -Method 'POST' -Body $Body

    $cookies=$response.Headers.'Set-Cookie'
    if ($cookies -notlike "*LogverzAuthToken*"){

        throw "LogverzAuthToken missing"
    }
    else{
    $LogverzAuthToken=$cookies.split("=")[1].split(";")[0]
    }

    return $LogverzAuthToken 
}

function Get-ScriptDirectory {
    if ($psise) {
        Split-Path $psise.CurrentFile.FullPath
    }
    else {
        $global:PSScriptRoot
    }
}

$region="ap-southeast-2";
$accountId="";
$domain="xxx.execute-api.$region.amazonaws.com"
$apigwurl="https://$domain/V3";

#sample cases for api calls. 
$environmentpath = Get-ScriptDirectory
$NoSQLIdentitiesRead ="\IdentitiesRead.json";
$NoSQLIdentitiesWrite="\IdentitiesWrite.json";
$Submitjob="\submitjob.json";
$NoSQLQueriesRead ="\QueriesRead.json";
$NoSQLQueriesWrite ="\QueriesWrite.json";
$NoSQLInvocationsRead ="\InvocationsRead.json";

$user=""
$passwd="";

$loginparams = @{
    user = $user
    password = [System.Web.HttpUtility]::UrlEncode($passwd) 
    account = $accountId
}

$LogverzAuthToken =Request-Token -loginparams $loginparams;
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession;
$cookie = New-Object System.Net.Cookie;
$cookie.Name = "LogverzAuthToken";
$cookie.Value = $LogverzAuthToken;
$cookie.Domain = $domain;
$session.Cookies.Add($cookie);


#******************************* LOAD until here ********************************#





#------------NOSQL 'Identities' api calls------------
$IdentitiesRead= get-content $($environmentpath+$NoSQLIdentitiesRead)|ConvertFrom-Json 
#$IdentitiesRead|Format-List

$onequery=$IdentitiesRead[5];

$parametersjson=$(ConvertTo-Json -InputObject $onequery.Parameters -Depth 3 -Compress)
$parametersenURLencoded = [System.Web.HttpUtility]::UrlEncode($parametersjson) 
$parametersjson
$parametersenURLencoded

$result=Invoke-WebRequest -Uri $($apigwurl+"/NoSql?Resource=$($onequery.Resource)&Parameters=$parametersenURLencoded`
                        &Operation=$($onequery.Operation)") -Method 'POST' -Body $Body -WebSession $session
$result.Content |ConvertFrom-Json                 
$($result.Content |ConvertFrom-Json ).count


#.......
$IdentitiesWrite= get-content $($environmentpath+$NoSQLIdentitiesWrite)|ConvertFrom-Json 
#$IdentitiesWrite|Format-List

$onequery=$IdentitiesWrite[0];

$parametersjson=$(ConvertTo-Json -InputObject $onequery.Parameters -Depth 3 -Compress)
$parametersenURLencoded = [System.Web.HttpUtility]::UrlEncode($parametersjson) 
$parametersjson
$parametersenURLencoded

$result=Invoke-WebRequest -Uri $($apigwurl+"/NoSql?Resource=$($onequery.Resource)&Parameters=$parametersenURLencoded`
                        &Operation=$($onequery.Operation)") -Method 'POST' -Body $Body -WebSession $session


#------------NOSQL 'Invocations' api calls------------

$InvocationsRead= get-content $($environmentpath+$NoSQLInvocationsRead)|ConvertFrom-Json 
#$InvocationsRead|Format-List

$onequery=$InvocationsRead[5];

$parametersjson=$(ConvertTo-Json -InputObject $onequery.Parameters -Depth 3 -Compress)
$parametersenURLencoded = [System.Web.HttpUtility]::UrlEncode($parametersjson) 
$parametersjson
#$parametersenURLencoded

$result=Invoke-WebRequest -Uri $($apigwurl+"/NoSql?Resource=$($onequery.Resource)&Parameters=$parametersenURLencoded`
                        &Operation=$($onequery.Operation)") -Method 'POST' -Body $Body -WebSession $session
$result.Content |ConvertFrom-Json                        
$($result.Content |ConvertFrom-Json ).count





#------------NOSQL 'Queries' api calls------------

$QueriesRead= get-content $($environmentpath+$NoSQLQueriesRead)|ConvertFrom-Json 
#$QueriesRead|Format-List

$onequery=$QueriesRead[5];

$parametersjson=$(ConvertTo-Json -InputObject $onequery.Parameters -Depth 3 -Compress)
$parametersenURLencoded = [System.Web.HttpUtility]::UrlEncode($parametersjson) 
$parametersjson
$parametersenURLencoded

$result=Invoke-WebRequest -Uri $($apigwurl+"/NoSql?Resource=$($onequery.Resource)&Parameters=$parametersenURLencoded`
                        &Operation=$($onequery.Operation)") -Method 'POST' -Body $Body -WebSession $session
$result.Content |ConvertFrom-Json                        
$($result.Content |ConvertFrom-Json ).count


#.......
$QueriesWrite= get-content $($environmentpath+$NoSQLQueriesWrite)|ConvertFrom-Json 
#$QueriesWrite|Format-List

$onequery=$QueriesWrite[2];

$parametersjson=$(ConvertTo-Json -InputObject $onequery.Parameters -Depth 3 -Compress)
$parametersenURLencoded = [System.Web.HttpUtility]::UrlEncode($parametersjson) 
$parametersjson
$parametersenURLencoded

$result=Invoke-WebRequest -Uri $($apigwurl+"/NoSql?Resource=$($onequery.Resource)&Parameters=$parametersenURLencoded`
                        &Operation=$($onequery.Operation)") -Method 'POST' -Body $Body -WebSession $session

$result

#------------Start JOB api calls------------

$JobProducer= get-content $($environmentpath+"\sources\jobproducer\tests\submitjob.json")|ConvertFrom-Json 
$JobProducer|Format-List

$onequery=$JobProducer[0];
#$Body=[System.Web.HttpUtility]::UrlEncode($(ConvertTo-Json -InputObject $onequery -Compress)) 
$Body=$(ConvertTo-Json -InputObject $onequery -Compress);
$result=Invoke-WebRequest -Uri $($apigwurl+"/Start/Job") -Method 'POST' -Body $Body -WebSession $session
$result

$onequery.Parameters |ConvertTo-JSON


#------------Identity Sync call------------