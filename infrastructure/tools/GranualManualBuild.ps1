﻿#determine os type AND verify dependencies are present 
if ($Env:OS -eq "Windows_NT"){
    $OSType="Windows"
    
    $cmdName="7z"
    if (!(Get-Command $cmdName -errorAction SilentlyContinue))
    {
        write-host "`n $cmdName dependency not installed, use chocolatey (https://chocolatey.org/), 'choco install 7zip' command for installation`n" -ForegroundColor yellow
        Start-Sleep -Seconds 10
        exit
    }


}
else{
    $OSType="Linux"
    $cmdName="7za"
    if (!(Get-Command $cmdName -errorAction SilentlyContinue))
    {
        write-host "`n $cmdName dependency not installed, use package manger of your os command for installation example sudo apt install p7zip or sudo yum install p7zip for ubuntu/centos respectively" -ForegroundColor yellow
        write-host " in case command fails add extra repositories sudo add-apt-repository universe && sudo apt update for ubuntu and sudo yum install epel-release for centos. Than try again." -ForegroundColor yellow
        Start-Sleep -Seconds 10
        exit
    }
}

Add-Type -assembly 'System.IO.Compression'
Add-Type -assembly 'System.IO.Compression.FileSystem'


$projectpath="C:/Users/Administrator/Documents/LogverzCore"
Import-Module $($projectpath+"/infrastructure/tools/LogverzBuild.psm1") -Verbose:$false


#Logverz-Transform  -------------------------------------------------------------------
create-Bundle -zipfilename "transform.zip" `
              -projectpath $projectpath `
              -componentpath "\sources\transform"`
              -files "transform.js","package.json","package-lock.json"`
              -extrafiles "\sources\shared\commonshared.js","\sources\shared\package.json"
                   
update-lambda -lambdafunctionname "Logverz-Transform"`
              -projectpath $projectpath `
              -lambdafunctionbundle "\sources\transform\build\transform.zip"

#Logverz-WebRTCSignal  -------------------------------------------------------------------
create-Bundle -zipfilename "signal.zip" `
              -projectpath $projectpath `
              -componentpath "\sources\signal"`
              -files "signal.js","package.json","package-lock.json"`
              -extrafiles "\sources\shared\commonshared.js","\sources\shared\package.json"
                   
update-lambda -lambdafunctionname "Logverz-WebRTCSignal"`
              -projectpath $projectpath `
              -lambdafunctionbundle "\sources\signal\build\signal.zip"


#SetConnectionParamsDB  -------------------------------------------------------------------
create-Bundle -zipfilename "setconnectionparamsdb.zip" `
              -projectpath $projectpath `
              -componentpath "\sources\setconnectionparamsdb"`
              -files "setconnectionparamsdb.js","package.json","package-lock.json"`
              -extrafiles "\sources\shared\commonshared.js","\sources\shared\package.json"
                   
update-lambda -lambdafunctionname "Logverz-SetConnectionParamsDB"`
              -projectpath $projectpath `
              -lambdafunctionbundle "\sources\setconnectionparamsdb\build\setconnectionparamsdb.zip"


#SetConnectionParamsDNS  -------------------------------------------------------------------
create-Bundle -zipfilename "setconnectionparamsdns.zip" `
              -projectpath $projectpath `
              -componentpath "\sources\setconnectionparamsdns"`
              -files "setconnectionparamsdns.js","package.json","package-lock.json"`
              -extrafiles "\sources\shared\commonshared.js","\sources\shared\package.json"
                   
update-lambda -lambdafunctionname "Logverz-SetConnectionParamsDNS"`
              -projectpath $projectpath `
              -lambdafunctionbundle "\sources\setconnectionparamsdns\build\setconnectionparamsdns.zip"


#Controller -------------------------------------------------------------------
create-Bundle -zipfilename "controller.zip" `
              -projectpath $projectpath `
              -componentpath "\sources\controller"`
              -files "db.js","controller.js","package.json","package-lock.json","DbInstanceClasses.csv"`
              -extrafiles "\infrastructure\buildspec.yaml","\sources\shared\engineshared.js","\sources\shared\commonshared.js","\sources\shared\authenticationshared.js","\sources\shared\package.json"
              $projectpath=$projectpath
              cd $($projectpath+"\sources\controller\build\package")
                   
              iex "7z a  ..\controller.zip * -r"
              iex "7z a ..\controller.zip *.*"

#Logverz-Worker -------------------------------------------------------------------
create-Bundle -zipfilename "worker.zip" `
              -projectpath $projectpath `
              -componentpath "\sources\worker"`
              -files "worker.js","package.json","package-lock.json"`
              -extrafiles "\sources\shared\engineshared.js","\sources\shared\commonshared.js","\sources\shared\package.json"

update-lambda -lambdafunctionname "Logverz-Worker"`
              -projectpath $projectpath `
              -lambdafunctionbundle "\sources\worker\build\worker.zip"
                    


#Init-environment -------------------------------------------------------------------
$buildrelativepath="sources/init"
$buildfullpath="$projectpath/$buildrelativepath/build"
$repobaseurl="https://logleads@dev.azure.com/logleads/LogverzPortal/_git/"

build-webapp-source -builddirectory $buildfullpath -repo $($repobaseurl+"Portal") -appname "Portal" -branchname "dev" -OSType $OSType
build-webapp-source -builddirectory $buildfullpath -repo $($repobaseurl+"PortalAccess") -appname "PortalAccess" -branchname "dev" -OSType $OSType


$extrafiles= get-extrafiles -filepath $($projectpath+"/infrastructure/tools/buildextrafiles.csv")
set-init-sources -projectpath $projectpath -extrafiles $extrafiles -builddirectory $buildrelativepath -OSType $OSType


update-lambda -lambdafunctionname "Logverz-Initiate"`
              -projectpath $projectpath `
              -lambdafunctionbundle "\sources\init\init.zip"



#Job Producer -------------------------------------------------------------------
create-Bundle -zipfilename "jobproducer.zip" `
              -projectpath $projectpath `
              -componentpath "\sources\jobproducer"`
              -files "db.js","jobproducer.js","package.json","package-lock.json"`
              -extrafiles "\sources\shared\commonshared.js","\sources\shared\package.json","\sources\shared\authenticationshared.js"


update-lambda -lambdafunctionname "Logverz-JobProducer"`
              -projectpath $projectpath `
              -lambdafunctionbundle "\sources\jobproducer\build\jobproducer.zip"

#httprelay-------------------------------------------------------------------
create-Bundle -zipfilename "httprelay.zip" `
                    -projectpath $projectpath `
                    -componentpath "\sources\httprelay"`
                    -files "httprelay.js","package.json","package-lock.json"`
                    -extrafiles "\sources\shared\commonshared.js","\sources\shared\package.json","\sources\shared\authenticationshared.js"

update-lambda -lambdafunctionname "Logverz-HTTPRelay"`
              -projectpath $projectpath `
              -lambdafunctionbundle "\sources\httprelay\build\httprelay.zip"   



#identitysync----------------------------------------------------------------
create-Bundle -zipfilename "identitysync.zip" `
                    -projectpath $projectpath `
                    -componentpath "\sources\identitysync"`
                    -files "db.js","identitysync.js","package.json","package-lock.json"`
                    -extrafiles "\sources\shared\commonshared.js","\sources\shared\package.json","\sources\shared\authenticationshared.js"

update-lambda -lambdafunctionname "Logverz-IdentitySync"`
              -projectpath $projectpath `
              -lambdafunctionbundle "\sources\identitysync\build\identitysync.zip"




#login  -------------------------------------------------------------------
create-Bundle -zipfilename "login.zip" `
                    -projectpath $projectpath `
                    -componentpath "\sources\login"`
                    -files "db.js","login.js","package.json","package-lock.json"`
                    -extrafiles "\sources\shared\commonshared.js","\sources\shared\authenticationshared.js","\sources\shared\package.json"

                   
update-lambda -lambdafunctionname "Logverz-Login"`
              -projectpath $projectpath `
              -lambdafunctionbundle "\sources\login\build\login.zip"

              
#NoSQL-------------------------------------------------------------------
create-Bundle -zipfilename "nosql.zip" `
                    -projectpath $projectpath `
                    -componentpath "\sources\nosql"`
                    -files "db.js","nosql.js","package.json","package-lock.json"`
                    -extrafiles "\sources\shared\commonshared.js","\sources\shared\package.json","\sources\shared\authenticationshared.js"

update-lambda -lambdafunctionname "Logverz-NoSQL"`
              -projectpath $projectpath `
              -lambdafunctionbundle "\sources\nosql\build\nosql.zip"


#MasterController-------------------------------------------------------------------
create-Bundle -zipfilename "mastercontroller.zip" `
                    -projectpath $projectpath `
                    -componentpath "\sources\mastercontroller"`
                    -files "mastercontroller.js","package.json","package-lock.json"`
                    -extrafiles "\infrastructure\buildspec.yaml","\sources\shared\commonshared.js","\sources\shared\package.json"

update-lambda -lambdafunctionname "Logverz-MasterController"`
              -projectpath $projectpath `
              -lambdafunctionbundle "\sources\mastercontroller\build\mastercontroller.zip"

#Logverz-Info-------------------------------------------------------------------
create-Bundle -zipfilename "info.zip" `
                    -projectpath $projectpath `
                    -componentpath "\sources\info"`
                    -files "db.js","info.js","package.json","package-lock.json"`
                    -extrafiles "\sources\shared\commonshared.js","\sources\shared\package.json","\sources\shared\authenticationshared.js"

update-lambda -lambdafunctionname "Logverz-Info"`
              -projectpath $projectpath `
              -lambdafunctionbundle "\sources\info\build\info.zip"


#Logverz-Scale  -------------------------------------------------------------------
create-Bundle -zipfilename "scale.zip" `
              -projectpath $projectpath `
              -componentpath "\sources\scale"`
              -files "db.js","scale.js","package.json","package-lock.json"`
              -extrafiles "\sources\shared\engineshared.js","\sources\shared\commonshared.js","\sources\shared\package.json","\sources\shared\authenticationshared.js"
                   
update-lambda -lambdafunctionname "Logverz-Scale"`
              -projectpath $projectpath `
              -lambdafunctionbundle "\sources\scale\build\scale.zip"