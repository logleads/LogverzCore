#Dependency of build.ps1

function create-Bundle{
    param(
        [Parameter()]
        [string]$NPMInstall,
        [string]$projectpath,
        [string]$componentpath,
        [string]$zipfilename,
        [String[]]$files,
        [String[]]$extrafiles,
        [Boolean]$useprojectpath=$true
    )
    
    #note Windows only for now. 

    #creates package  directory if it does not exist
    if (!( test-path -Path $($projectpath+$componentpath+'\build\package')) -or ($NPMInstall-eq $true)) {

        New-Item -ItemType Directory  -Path $($projectpath+$componentpath+'\build\package') -Force        
        Copy-Item -Path $($projectpath+$componentpath+"\*") -Include "*.json"  -Destination $($projectpath+$componentpath+"\build\package\") 

        $npm="cmd.exe"
        $params = "/c npm install"
        Start-Process -FilePath $npm -WorkingDirectory $($projectpath+$componentpath+"\build\package\") -ArgumentList $params -Wait  -WindowStyle Normal
    }

    #The zip file name:
    [string]$zipFN = $projectpath+$componentpath+'\build\'+$zipfilename
    #removes existing (previous version) code bundle file
    if ( test-path -Path $zipFN) {
        Remove-Item $zipFN
    }

    #add project files 
    foreach ($file in $files)  {  
        
        $originalfile =Join-Path -Path $($projectpath+$componentpath) -ChildPath $file
        $destinationfile=Join-Path -Path $($projectpath+$componentpath) -ChildPath $('\build\package\'+$file)
        if ( test-path -Path $destinationfile) {
            Remove-Item $destinationfile
        }
        Copy-Item -Path $originalfile -Destination $destinationfile
    }
    
    $recursingarray=@()

    #ennumerate folders
    foreach ($recursing in $extrafiles){

        if ($recursing -match"\*"){
        $recursingpath =$($projectpath+$recursing).replace("*","")
        $recursingarray+=Get-ChildItem -Path $recursingpath -Recurse| where { ! $_.PSIsContainer }|% {$($_.FullName).replace($projectpath,"")}
        $recursingarray.count
        #remove the recursive directory
        $extrafiles=$extrafiles| Where-Object { $_ –ne $recursing }
        }
    }

    $extrafiles+=$recursingarray
    #add extra files 
    foreach ($efile in $extrafiles)  {  
        
        if ($useprojectpath){
            $originalfile =$($projectpath + $efile)
        }
        else{
            $originalfile =$efile
        }

        $file = Split-Path $originalfile -leaf
        
           
        if ($originalfile -like "*shared\*"){
            $destinationfile=Join-Path -Path $($projectpath+$componentpath) -ChildPath $('\build\package\shared\'+$file)  
        }
        #we check if its a file from the root of the component directory if it is than we add it to the \build\package root.
        elseif($originalfile.replace($($projectpath+$componentpath+"\"),"") -eq $originalfile){
            $destinationfile=Join-Path -Path $($projectpath+$componentpath) -ChildPath $('\build\package\'+$file)  
        
        }       
        else{
            #the file is not in the top of the component root directory, ie its in a subfolder, we add that to new path.
            $subfolder=$originalfile.replace($($projectpath+$componentpath+"\"),"").replace($file,"")
            $destinationfile=Join-Path -Path $($projectpath+$componentpath) -ChildPath $('\build\package\'+$subfolder+$file)
            
        }


        if ( test-path -Path $destinationfile) {
            Remove-Item $destinationfile
        }
        else{
            $destinationpath=Split-Path $destinationfile
            New-Item -ItemType Directory  -Path $destinationpath -Force
        }
        
        Copy-Item -Path $originalfile -Destination $destinationfile -Force
    }

    cd $($projectpath+$componentpath+"\build")


    [io.compression.zipfile]::CreateFromDirectory($($projectpath+$componentpath+"\build\package"), $zipFN )

}

function update-lambda{ 
    param(
        [Parameter()]
        [string]$lambdafunctionname,
        [string]$projectpath,
        [string]$lambdafunctionbundle
    )
    #iex "aws.exe lambda update-function-code --function-name $lambdafunctionname --zip-file fileb://$($projectpath+$lambdafunctionbundle)"

    $zipFileItem = Get-Item -Path $($projectpath+$lambdafunctionbundle)
    $fileStream = $zipFileItem.OpenRead()
    $memoryStream = New-Object System.IO.MemoryStream
    $fileStream.CopyTo($memoryStream)   

    Update-LMFunctionCode -FunctionName  $lambdafunctionname -ZipFile $memoryStream  
}

function create-control-bundle{
    param(
        [Parameter()]
        [string]$projectpath,
        [string]$componentpath,
        [string]$zipfilename,
        [string]$builddirectory,
        [string]$OSType 

    )
    
    $controlbundle=$($componentpath+$zipfilename)
    if ( test-path -Path $controlbundle) {
        Remove-Item -Path $controlbundle -Force
    }
    
    cd $componentpath
    
    if($OSType -eq "Windows"){
        7z a  $controlbundle * -r
    }
    else{
        7za a $controlbundle * -r
    }

    copy-item -Path $controlbundle -Destination $($projectpath+"/$builddirectory/build/sources/"+$zipfilename)
     
}

function set-init-sources{
    param(
        [Parameter()]
        [string]$projectpath,
        $extrafiles,
        [string]$builddirectory,
        [string]$componentpath=$projectpath,
        [string]$OSType,
        [string]$repositoryurl,
        [string]$branchname,
        [string]$tag="",
        [string]$coreonly=$false
    )
    #this function copies sources to init/sources directory to be packaged with the lambda function
    #which inturn deploys it in the client s3 bucket and starts codebuild to create 
    #1) initiate the Stack deployment 2) build lambda bundles, build webapp, build containers 

    #write-host "project path" $projectpath
    #write-host "builddirectory" $builddirectory
    #write-host "componentpath path" $componentpath
    #write-host "Extrafilescount" $extrafiles.count
    #write-host "repositoryurl" $repositoryurl
    #write-host "tag" $tag
    #write-host "branchname" $branchname "`n`n`n"

    if($OSType -eq "Windows"){
        $zipcommand="7z"
        $gitcommand="git.exe"
    }
    else{
        $zipcommand="7za"
        $gitcommand="git"
    }

    cd  $componentpath
    
    if (($repositoryurl -ne $null) -and ($tag -ne "")){
        $checkout="checkout tags/$tag" 
    }
    elseif(($repositoryurl -ne $null)-and ($branchname -ne $null)){
        $checkout="checkout $branchname"
    }
     
    
    $location = Invoke-Expression "pwd"
    write-host "Present location: $location" 
    write-host "Git checkout command:" $checkout

    Start-Process -FilePath $gitcommand -ArgumentList "fetch --all --tags"  -ErrorAction SilentlyContinue -Wait
    Start-Process -FilePath $gitcommand -ArgumentList $checkout  -ErrorAction SilentlyContinue -Wait
 
    start-sleep 3
    write-host "The Checked out branch:"
    iex "$gitcommand branch"

    if ( Test-Path ($projectpath+"/$builddirectory/build/") ){
        Get-ChildItem -Path $($projectpath+"/$builddirectory/build/") -Exclude  "PortalAccess","Portal","PortalAccess.zip","Portal.zip" | Remove-Item -Recurse -Force
    }

    if(test-path $($projectpath+"/$builddirectory/init.zip")){
        Remove-Item -Path  $($projectpath+"/$builddirectory/init.zip") -Recurse
    }

    $sourcelist=@{}
    # Get directories that are not 
    $directories=Get-ChildItem -Path $($componentpath+"/sources") -directory |? {$_.Name -ne "init"} |? {$_.Name -ne "shared"} 
    $directories+=Get-ChildItem -Path $($componentpath) -directory|? {$_ -like "*infrastructure*"}
    #Create a Hashtables of the files and the components
    foreach ($onedir in $directories){
        $temparray=@()
        $file =Get-ChildItem -path  $onedir.FullName |? {($_.Name -like "*.js") -or ($_.Name -like"package.json")} |%{$_.FullName -replace ("\\","/")}
        
    
        for($i=0;$i -lt $extrafiles.Length;$i++){
            
            $component = $extrafiles[$i][0]
            $path= $extrafiles[$i][1]
            
            #if the component has subfolders such as webrtcproxy/landingpage use the parent value.
            if ($component -like "*/*"){
                $component=$component.split("/")[0]
            }

            if ($component -eq $onedir.Name) {
                $temparray+=$($componentpath+$path)
            }
        }
        $sourcelist += @{$onedir = $file,$temparray|%{$_}}

    }

    #Copies the Components to /sources/init/sources folder 
    $components=$($($sourcelist.GetEnumerator()).key).Name

    for($i=0;$i -lt $components.Length;$i++){

        #$($sourcelist.GetEnumerator()|Select-Object -First 1).value
        $component =$($sourcelist.GetEnumerator()).key[$i]

        #Change this so that it checks if $component has path ("/") in it.  
        # If yes add that to the path. 
        $files =$($sourcelist.GetEnumerator()|Select-Object -index $i).value
        
        for($j=0;$j -lt $files.Length;$j++){
        
            if ($files[$j]-like "*sources/shared*"){
                $destination=$($files[$j] -replace("sources/shared",$("$builddirectory/build/sources/"+$component.Name+"/shared")))
            }
            elseif($files[$j]-like "*sources*"){
                $destination=$files[$j] -replace("sources",$("$builddirectory/build/sources"))
            }
            #PUT files from the root of infrastructure to the sources root.
            elseif(($files[$j]-like $("*infrastructure*")) -and ($component.Name -eq "infrastructure" ) ){  
                $destination=$($($files[$j] -replace("infrastructure",$("$builddirectory/build/sources"))) -replace("/templates",""))
            }
            #PUT files to specific component subfolder
            elseif($files[$j]-like "*infrastructure*"){ 
                $destination=$($files[$j] -replace("infrastructure",$("$builddirectory/build/sources/"+$component.Name)))
            }

            if ($componentpath -ne $projectpath){
                #in case of script is execuded part of a release, the build directory is in the release project root not in the LogverzCore (componenent) path.
                $destination=$destination.Replace($componentpath,$projectpath)
            }
        
            $destinationpath= $destination.Substring(0,$destination.LastIndexOf("/"))
            if (!( test-path -Path $destinationpath)) {
                #creating directory if it does not exists
                New-Item -ItemType Directory  -Path $destinationpath -Force
            } 

            Copy-Item -Path $files[$j] -Destination $destination  -force
        }
    }

    create-control-bundle -projectpath $projectpath -componentpath "$componentpath/infrastructure/coturncontrol/" -zipfilename "coturncontrol.zip" -builddirectory $builddirectory -OSType $OSType
    create-control-bundle -projectpath $projectpath -componentpath "$componentpath/infrastructure/webrtcproxycontrol/" -zipfilename "webrtcproxycontrol.zip" -builddirectory $builddirectory -OSType $OSType

    Copy-Item -Path $($componentpath+"/infrastructure/buildspec_init.yaml") -Destination $($projectpath+"/$builddirectory/build/buildspec_init.yaml")  -force
    Copy-Item -Path $($componentpath+"/sources/init/initiate.js") -Destination $($projectpath+"/$builddirectory/build/initiate.js")  -force
    Copy-Item -Path $($componentpath+"/sources/init/package.json") -Destination $($projectpath+"/$builddirectory/build/package.json")  -force
    Copy-Item -Path $($componentpath+"/sources/shared/commonsharedv3.js") -Destination $($projectpath+"/$builddirectory/build/commonsharedv3.js")  -force

    #NOTE: using io.compress.zipfile results in error "warning:  sources.zip appears to use backslashes as path separators" in codebuild execution.
    #https://thedeveloperblog.com/7-zip-examples   
    cd $($projectpath+"/$builddirectory/build/sources")

    iex "$zipcommand a  ../sources.zip * -r"
    
    cd $($projectpath+"/$builddirectory/build")
    
    if ($coreonly -eq $false){
        iex "$zipcommand a ../init.zip *.*"
    }
    else {
        Copy-Item sources.zip "../init_core.zip"
    }
} 

function build-webapp-source{
    param(
        [Parameter()]
        [string]$builddirectory,
        [string]$repositoryurl,
        [string]$appname,
        [string]$branchname,
        [string]$OSType,
        [string]$tag=""
    )

    $localpath=$($builddirectory+"/" +$appname);

    if (test-path $($builddirectory+"/"+$appname+".zip")){
        #remove previous build.
        Remove-Item -Path $($builddirectory+"/"+$appname+".zip") -Recurse -force
    }

    if($OSType -eq "Windows"){
        $gitcommand="git.exe"
        $zipcommand="7z"
    }
    else{
        $gitcommand="git"
        $zipcommand="7za"
    }

    if (($repositoryurl -ne $null) -and ($tag -ne "")){
        $checkout="checkout tags/$tag" 
    }
    elseif(($repositoryurl -ne $null)-and ($branchname -ne $null)){
        $checkout="checkout $branchname"
    }

    write-host "Git checkout command:" $checkout
    
    
    $location = Invoke-Expression "pwd"
    write-host "Present location: $location" 

    if (test-path $localpath){
        cd  $localpath
        # build directory exists git pull 
        Start-Process -FilePath $gitcommand -ArgumentList "fetch --all --tags"  -ErrorAction SilentlyContinue -Wait
        Start-Process -FilePath $gitcommand -ArgumentList "pull"  -ErrorAction SilentlyContinue -Wait
        Start-Process -FilePath $gitcommand -ArgumentList $checkout  -ErrorAction SilentlyContinue -Wait
    }
    else{
        cd  $builddirectory

        # app directory does not exists git clone and checkout specified branch
        Start-Process -FilePath $gitcommand -ArgumentList "clone $repositoryurl $localpath"  -ErrorAction SilentlyContinue -Wait

        #enter project folder and check out tag or branchname
        cd  $localpath
        Start-Process -FilePath $gitcommand -ArgumentList $checkout  -ErrorAction SilentlyContinue -Wait
    }
     
    Invoke-Expression "$zipcommand a $($builddirectory+'/'+$appname+'.zip') . -xr!'.git'"
}

function get-extrafiles{
    param(
        [Parameter()]
        [string]$filepath
    )
    $efiles=Get-Content -Path $filepath -Verbose:$false
    $extrafiles=@()

    Foreach ($efile in $efiles){
        $component=$efile.split(",")[0]
        $path=$efile.split(",")[1]
        $extrafiles+=,@($component,$path)
    }

    return $extrafiles
}

function create-GHRelease{
    param(
        [Parameter()]
        [string]$RepositoryName,
        [string]$Tag,
        [string]$AssetPath,
        [string]$Body
    )
 
    #list releases
    #$releases= Get-GitHubRelease  -RepositoryName LogverzReleases -OwnerName logleads
    
    $newrelease=New-GitHubRelease -RepositoryName $RepositoryName -OwnerName logleads -Tag $Tag -Body $Body

    #$newrelease

    New-GitHubReleaseAsset -RepositoryName $RepositoryName  -OwnerName logleads -Release $newrelease.ReleaseId -Path $AssetPath
    
    $result = Get-GitHubReleaseAsset -RepositoryName $RepositoryName  -OwnerName logleads -Release $newrelease.ReleaseId #$releases[0].ReleaseId

    #Set-GitHubRelease -OwnerName logleads -RepositoryName LogverzReleases -Release $newrelease.ReleaseId -Body $Body

    return $result
}

function get-latesttag{
    param(
        [Parameter()]
        [array]$Tags,
        [string]$OSType
        )

    if($OSType -eq "Windows"){
        #$zipcommand="7z"
        $gitcommand="git.exe"
    }
    else{
        #$zipcommand="7za"
        $gitcommand="git"
    }

    $tagsDetailsArray = @()

    for ($i = 0; $i -lt $Tags.count; $i++) { 
        
        $onetag=$Tags[$i]
        $onehash=iex "$gitcommand rev-parse $onetag" 
        #$stats=iex "$gitcommand show $onehash --stat" 
        $onedate=iex "$gitcommand show -s --format=%ct $onehash"

        $tagproperties = New-Object -TypeName psobject 
        $tagproperties | Add-Member -MemberType NoteProperty -Name Name -Value $onetag
        $tagproperties | Add-Member -MemberType NoteProperty -Name Hash -Value $onehash
        $tagproperties | Add-Member -MemberType NoteProperty -Name Date -Value $onedate

        $tagsDetailsArray+=$tagproperties
    
    }

  $latesttag=$tagsDetailsArray |Sort-Object Name -Descending |Sort-Object Date -Unique  

return $latesttag

}

Export-ModuleMember -Function *