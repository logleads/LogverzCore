function Get-HeartBeat{
    param(
            [Parameter()]
            [string]$heartbeatlocation,
            [string]$environmentpath,
            [string]$maximumnumberofchecks
    )

    if (!(test-path -path $heartbeatlocation)){
        Add-Content -path $($environmentpath +"startupdelayorerror") -Value 1
    }
    else{
       $lastupdate= $(Get-ChildItem -path $heartbeatlocation).LastWriteTime
       return $lastupdate
    }

    if ((test-path -path $($environmentpath +"startupdelayorerror"))){

     return "startupdelayorerror"
    }

}

function Get-DockerContainer {
    #kudos: https://gist.github.com/jdhitsolutions/a55db2737d30fcb57d4d8c15d47a9cda
    [cmdletbinding(DefaultParameterSetName = "name")]
    [alias("gdc")]
    [OutputType("Get-DockerContainer.myDockerContainer")]

    Param(
        [Parameter(Position = 0, HelpMessage = "Enter a docker container name. The default is all running containers.", ParameterSetName = "name")]
        [ValidateNotNullorEmpty()]
        [string[]]$Name,
        [Parameter(HelpMessage = "Get all containers, not just those that are running.", ParameterSetName = "all")]
        [switch]$All
    )

    Begin {
        Write-Verbose "[BEGIN  ] Starting: $($MyInvocation.Mycommand)"

        #define a class for my docker container objects
        Class myDockerContainer {

            [string]$ID
            [string]$Name
            [datetime]$Created
            [string]$State
            [Boolean]$IsRunning
            [datetime]$Started
            #define Finished as a generic object so it can be null or a datetime
            [object]$Finished
            [timespan]$Runtime
            [string]$Image
            [object[]]$Mount
            [string]$Platform
            [int]$Size
            [string]$Path

            #methods
            [timespan] GetRuntime([datetime]$Start, [datetime]$End) {
                return ($end - $start)
            }
            [string] GetImageName([string]$image) {
                $val = (docker image inspect ($image -split ":")[1] --format "{{json .RepoTags}}") -replace '\[|\]|"', ""
                return $val
            }
            [int] GetContainerSize() {

                $stat = Get-Childitem $this.path -file -recurse | Measure-Object length -sum

                $sz = docker ps -asf "name=$($this.name)" --format "{{json .}}" | ConvertFrom-Json | Select-Object -expandproperty size
                [regex]$rx = "\d+"
                [int]$szbytes = $rx.match($sz).value
                
                if ($this.mount) {
                    [int]$mnt =0 #($this.mount |ForEach-Object { Get-ChildItem -path $_.source -file -recurse } |Measure-Object length -sum).sum
                }
                else {
                    $mnt = 0
                }

                $totalsz = $stat.sum + $szbytes + $mnt

                return $totalsz
            }
            #the constructor
            myDockerContainer ($Name) {
                #get the docker installation directory
                $dockpath = ((docker system info | Select-String "docker root dir") -split ": ")[1]
                $json = docker container inspect $Name | ConvertFrom-Json

                $this.Name = $Name.replace('"', '')
                $this.Created = $json.Created
                $this.ID = $json.ID
                $this.IsRunning = $json.state.Running
                #adjust date to localtime because PowerShell Core converts it differently than Windows PowerShell
                $this.Started = ($json.state.startedat -as [datetime]).toLocalTime()
                $this.Finished = if ($this.IsRunning) { $null } else {$json.state.finishedat -as [datetime]}
                $this.Runtime = if ($this.IsRunning) { $this.GetRuntime($this.started, (Get-Date) )} else {$this.GetRuntime($this.started, $this.finished )   }
                $this.State = $json.state.status
                $this.image = $this.GetImageName($json.image)
                $this.platform = $json.platform
                $this.mount = $json.mounts
                $this.Path = Join-Path -path $dockpath -childpath "containers\$($this.ID)"
                $this.Size = $this.GetContainerSize()
            }
        } #close class

    } #begin
    Process {
        if ($all) {
            Write-Verbose "[PROCESS] Getting all containers"
            $names = docker container ls -a --no-trunc --format "{{json .Names}}"
        }
        elseif ($Name) {
            Write-Verbose "[PROCESS] Getting container $name"
            $names = $Name
        }
        else {
            Write-Verbose "[PROCESS] Getting running containers"
            $names = docker container ls --no-trunc --format "{{json .Names}}"
        }

        if ($names) {
            foreach ($name in $names) {
                Write-Verbose "[PROCESS] Processing $name"
                if (docker container ls -qaf Name=$name) {
                    [myDockerContainer]::new($name)
                }
                else {
                    Write-Warning "Failed to find a container named $name"
                }
            } #foreach $Name
        } #if $name
        else {
            Write-Warning "No containers found"
        }
    } #process
    End {
        Write-Verbose "[END    ] Ending: $($MyInvocation.Mycommand)"
    } #end
}

if($env:Environment -eq "Windows"){
   $environmentpath="C:\Users\Administrator\Documents\LogverzCore\build\";
   $region="";
   $accountId="";
   $webrtcbucket="Logverz-webrtcbucket-16ce0zxrawaf9";
   $heartbeatlocation=$environmentpath+"heartbeat.json"
   $asgname="Logverz-WebRTC-M84ERFHFUB6L-LogverzClusterMultiITASG-11LJRA7WH7034"
}
else{
   $environmentpath="/home/ec2-user/";
   $identitydocument=$($(wget -q -O - http://169.254.169.254:80/latest/dynamic/instance-identity/document)|ConvertFrom-Json);
   $region=$identitydocument.region;
   $accountId=$identitydocument.accountId;
   $webrtcbucket=Get-Content -path $($environmentpath+"webrtcbucket");
   $heartbeatlocation=$($environmentpath+"heartbeat.json");
   $taskmemorysize=$(get-content $($environmentpath+"taskmemorysize"))+"m";
   $asgname=Get-Content -path $($environmentpath+"ASGName");
}

$imagename="logverz/webrtcproxy:latest"

#Used at start, the number of cycles we wait to check for heartbeatfiles existence. 
$maximumnumberofchecks=3
#Time after the host shuts down if no update is made to the HB.
$heartbeatdelay=3

$containercheck=get-dockercontainer |? {$_.Image -like "*$imagename*"}

#Startup as heartbeat file does not exists
if(($null -eq $containercheck) -and (!(test-path -path $heartbeatlocation))){
    #login to ECR
    Invoke-Expression "sudo su -c `"`$(aws ecr get-login --no-include-email --region $region)`"";

    #pull image
    Invoke-Expression "sudo su -c `"docker pull $accountId.dkr.ecr.$region.amazonaws.com/$imagename`"";

    #tag image 
    Invoke-Expression "sudo su -c `"docker tag $accountId.dkr.ecr.$region.amazonaws.com/$imagename $imagename`"";

    #run container with shared folder for heartbeath
    Invoke-Expression "sudo su -c `"docker run --memory=$taskmemorysize --env AWS_REGION=$region --env webrtcbucket=$webrtcbucket -d --network='host' --mount type=bind,source=$environmentpath,target=/usr/src/app/build --log-driver=awslogs --log-opt awslogs-group=/Logverz/WebRTCProxy $imagename`"";
} 

#TODO: make a check for container running if not, use above run container. 

#get the heartbeatfile 
$heartbeat=Get-HeartBeat -heartbeatlocation $heartbeatlocation -environmentpath $environmentpath -maximumnumberofchecks $maximumnumberofchecks

#if heartbeatfile result equals "startupdelayorerror" than the process either not yet started or has failed. To determine what happened we wait $maxnumberofchecks.
if($heartbeat -eq "startupdelayorerror"){
    
    $numberofchecks=$(Get-Content -path $($environmentpath +"startupdelayorerror")).Length
    #if file is not present after maxnumberofchecks than container failed we stop the instance. 
    if ($numberofchecks -gt $maximumnumberofchecks){
       
       Add-Content -Path $($environmentpath+"log") -Value "`nCurrent time: $(get-date)."
       Invoke-Expression "sudo su -c `"init 0`""
    }

}
else{ #the process started there are HB files

    $now=get-date
    $ago=$now.AddMinutes(-$heartbeatdelay);

    #$string= "aws autoscaling set-desired-capacity --auto-scaling-group-name `"$asgname`" --region $region --desired-capacity $($($ASGSettings.DesiredCapacity)-1) --honor-cooldown"
    #iex "echo $`"$string`" >/home/ec2-user/debug.log"

    # no recent heartbeath, shutting down. 
    if( $heartbeat -lt  $ago){
        
        $ASGSettingsJSON= Invoke-Expression "aws autoscaling describe-auto-scaling-groups --auto-scaling-group-name `"$asgname`" --region $region"
        $ASGSettings=$(ConvertFrom-Json $($ASGSettingsJSON|Out-String)).AutoScalingGroups[0]
        
        #if the ASG minimum size is not reached we decrement the desired count.
        if ($ASGSettings.MinSize -lt $ASGSettings.Instances.Count){
            Invoke-Expression "aws autoscaling set-desired-capacity --auto-scaling-group-name `"$asgname`" --region $region --desired-capacity $($($ASGSettings.DesiredCapacity)-1) --honor-cooldown"
            Start-Sleep -Seconds 5
        }

        Invoke-Expression "sudo su -c `"init 0`""
    }

}