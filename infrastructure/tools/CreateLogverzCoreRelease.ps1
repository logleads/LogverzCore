#determine os type AND verify dependencies are present 
if ($Env:OS -eq "Windows_NT"){
    $OSType="Windows"
    $gitcommand="git.exe"
    
    $cmdName="7z"
    if (!(Get-Command $cmdName -errorAction SilentlyContinue))
    {
        write-host "`n $cmdName dependency not installed, use chocolatey (https://chocolatey.org/), 'choco install 7zip' command for installation`n" -ForegroundColor yellow
        Start-Sleep -Seconds 10
        exit
    }
    write-host "`n Operating System Windows`n" -ForegroundColor green
}
else{
    $OSType="Linux"
    $cmdName="7za"
    $gitcommand="git"
    if (!(Get-Command $cmdName -errorAction SilentlyContinue))
    {
        write-host "`n $cmdName dependency not installed, use package manger of your os command for installation example sudo apt install p7zip or sudo yum install p7zip for ubuntu/centos respectively" -ForegroundColor yellow
        write-host " in case command fails add extra repositories sudo add-apt-repository universe && sudo apt update for ubuntu and sudo yum install epel-release for centos. Than try again." -ForegroundColor yellow
        Start-Sleep -Seconds 10
        exit
    }
    write-host "`n Operating System Linux`n" -ForegroundColor green

}

$projectpath=$env:COREPROJECTPATH
#$projectpath="C:/Users/Administrator/Documents/LogverzCore" # change accroding to local path
$buildrelativepath="sources/init"
$corereponame="LogverzCore"
$corerepobaseurl="https://logleads@dev.azure.com/logleads/LogverzCore/_git/$corereponame"
$CoreBranchName="main"


Import-Module $($projectpath+"/infrastructure/tools/LogverzBuild.psm1") -Verbose:$false
Import-Module PowerShellForGitHub

$extrafiles= get-extrafiles -filepath $($projectpath+"/infrastructure/tools/buildextrafiles.csv")

cd $projectpath

#Get-GitHubRepository -RepositoryName LogverzCore -OwnerName logleads

$gittags=invoke-expression "$gitcommand tag"
$releases= Get-GitHubRelease  -RepositoryName LogverzCore -OwnerName logleads


if ($gittags.count -eq $releases.count){
 write-host "`n Operating System Windows`n" -ForegroundColor green
 Start-Sleep -Seconds 10
 exit
}
else{
    $lastreleasetag=$releases[0].tag_name
    $newtags=$gittags | Where-Object -FilterScript { $_ -notin $releases.tag_name }
    $latesttag=$(get-latesttag -Tags $newtags -OSType $OSType).Name
    write-host "`n`n##[section] New release is being generated for tag $latesttag, contains changes happened since tag $lastreleasetag`n`n"
}



#generate new release asset
set-init-sources -projectpath $projectpath -extrafiles $extrafiles -builddirectory $buildrelativepath `
                 -OSType $OSType -repositoryurl $corerepobaseurl -branchname $CoreBranchName -coreonly $true

#rename asset according to tag
$newname=$("init_core_v"+$latesttag+".zip")
Rename-Item -Path $($projectpath+"/"+$buildrelativepath+"/init_core.zip")  -NewName $newname
$AssetPath = $($projectpath+"/"+$buildrelativepath+"/"+$newname)

#generate change notes
iex "git-chglog --config $projectpath/.chglog/config.yml --output $projectpath/$buildrelativepath/build/output.md $lastreleasetag..$latesttag"
$ReleaseBody= $(Get-Content -Path $("$projectpath/$buildrelativepath/build/output.md") -Encoding UTF8 |Out-String)



#upload release asset and notes
create-GHRelease -RepositoryName $corereponame -Tag $latesttag -AssetPath $AssetPath -Body $ReleaseBody

