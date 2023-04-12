
function Create-metricdataquery-Config{
    param(
            [Parameter()]
            [string]$instanceid,
            [string]$instancetype,
            [string]$periodinseconds,
            [string]$cpucreditmetricqueryfilepath,
            [string]$turntrafficmetricqueryfilepath
    )
    $templatecpubalance=@"
    [
      {
        "Id": "cpuCreditBalance",
        "MetricStat": {
          "Metric": {
            "Namespace": "AWS/EC2",
            "MetricName": "CPUCreditBalance",
            "Dimensions": [
              {
                "Name": "InstanceId",
                "Value": "<InstanceId>"
              }
            ]
          },
          "Period": 60,
          "Stat": "Average"
        },

        "Label": "CPUCreditBalance",
        "ReturnData": true

      }
    ]
"@

    $templateturntraffictally=@"
[
  {
    "Id": "turnTrafficInTally",
    "MetricStat": {
      "Metric": {
        "Namespace": "Logverz",
        "MetricName": "TurnTrafficIn",
        "Dimensions": [
          {
            "Name": "InstanceID",
            "Value": "<InstanceID>"
          },
          {
            "Name": "InstanceType",
            "Value": "<InstanceType>"
          }
        ]
      },
      "Period": <Period>,
      "Stat": "Sum"
    },
    "Label": "TurnTrafficInTally",
    "ReturnData": true
  },
  {
    "Id": "turnTrafficOutTally",
    "MetricStat": {
      "Metric": {
        "Namespace": "Logverz",
        "MetricName": "TurnTrafficOut",
        "Dimensions": [
          {
            "Name": "InstanceID",
            "Value": "<InstanceID>"
          },
          {
            "Name": "InstanceType",
            "Value": "<InstanceType>"
          }
        ]
      },
      "Period": <Period>,
      "Stat": "Sum"
    },
    "Label": "TurnTrafficOutTally",
    "ReturnData": true
  }
]
"@
    $turntemplateprocessed= $($templateturntraffictally -replace "<InstanceID>",$instanceid  -replace "<InstanceType>",$instancetype -replace "<Period>",$periodinseconds) 

    New-Item -Path $cpucreditmetricqueryfilepath -Value $($templatecpubalance -replace "<InstanceId>",$instanceid) -Force
    New-Item -Path $turntrafficmetricqueryfilepath -Value $turntemplateprocessed -Force

}

function Create-coturn-Config{
    param(
            [Parameter()]
            [string]$turnpassword,
            [string]$turnusername,
            [string]$hostname,
            [string]$hostip,
            [string]$port,
            [string]$coturnconfigpath,
            [string]$privateip
    )

    $template=@"
fingerprint
user=$($turnusername+":"+$turnpassword)
listening-port=$port
lt-cred-mech
realm=$hostname
log-file=/var/log/turnserver.log
simple-log
external-ip=$hostip/$privateip
min-port=49152
max-port=65535
"@

    New-Item -Path $coturnconfigpath -Value $template -Force
}

function Create-CloudWatchAgent-Config{
    param(
            [Parameter()]
            [string]$CloudWatchAgentPath
    )

    $template=@"
{
	"agent": {
		"metrics_collection_interval": 60
	},
	"logs": {
		"logs_collected": {
			"files": {
				"collect_list": [
					{
						"file_path": "/var/log/turnserver.log",
						"log_group_name": "/Logverz/TurnService",
						"log_stream_name": "{hostname}/turnserverlog",
						"timestamp_format" :"%b %d %H:%M:%S"
					}
                                ]
                        }
               }
       }
}
"@

    #invoke-expression "sudo su -c 'chown -R ubuntu:ubuntu $CloudWatchAgentPath && chmod +x $CloudWatchAgentPath'"
    #$environmentpath="/home/ubuntu/";
    Start-Process -wait "sudo" -ArgumentList "/bin/bash -c `"touch $CloudWatchAgentPath && chown -R ubuntu:ubuntu $CloudWatchAgentPath &&  chmod -R 755 $CloudWatchAgentPath`""

    Add-Content -Path $CloudWatchAgentPath -Value $template -Force
    
    write-host "Created CloudWatchAgent Config"

}

function Update-ConnectionString{
    param(
            [Parameter()]
            [string]$hostname,
            [string]$region,
            [string]$AutoScalingGroupName,
            [string]$ASGinstancesPath,
            [string]$bucket,
            [string]$appconnectionstring,
            [string]$TurnSrvUserName
    )

    #get asg current instances
    #todo try catch here
    $asgpropertiesobject=$(Invoke-Expression "aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names $AutoScalingGroupName --region $region"|ConvertFrom-Json)
    $currentinstancids=$asgpropertiesobject.AutoScalingGroups.Instances| Where-Object{$_.HealthStatus -eq "Healthy" }|ForEach-Object{$_.InstanceId}
    
    #if no instance exists than its a new deployment and should be 
    if (!( test-path -Path $ASGinstancesPath)) {
      
        New-item -Path $ASGinstancesPath -Value $($currentinstancids |Out-String) -Force
        Create-ConnectionString -instanceids $currentinstancids -appconnectionstring $appconnectionstring -region $region -TurnSrvUserName $TurnSrvUserName
        #put config file to logic bucket so that application can use it.
        Invoke-Expression "aws s3 cp $appconnectionstring s3://$bucket/webrtc.config";
        
    }
    else{
        $previousinstanceids=get-content -Path $ASGinstancesPath;
        #checks for current and previous ASG instances, if the two are not the same it will create a new config file. 
         $compareresult= Compare-Object -ReferenceObject $currentinstancids -DifferenceObject $previousinstanceids

        if($compareresult -ne $null){
            New-item -Path $ASGinstancesPath -Value $($currentinstancids |Out-String) -Force
            Create-ConnectionString -instanceids $currentinstancids -appconnectionstring $appconnectionstring -region $region -TurnSrvUserName $TurnSrvUserName
            #put config file to logic bucket so that application can use it.
            Invoke-Expression "aws s3 cp $appconnectionstring s3://$bucket/webrtc.config";
        }
    }

}

function Create-ConnectionString{
    
    param(
            [Parameter()]
            [array]$instanceids,
            [string]$appconnectionstring,
            [string]$region,
            [string]$TurnSrvUserName
   )

    $instancenames=$(invoke-expression "aws ec2 describe-instances --instance-ids $instanceids --region $region"|ConvertFrom-Json).Reservations.Instances.PublicDnsName
    $iceServers=""
    #TODO change order of servers based on performance data:
    # if overal usage is low put it in the second lowest used server.
    # if overal usage is high put it in the lowest used server. 
    Foreach ($instance in $instancenames){
    
        $server = New-Object -TypeName psobject
        $server | Add-Member -MemberType NoteProperty -Name urls -Value $($instance)
        $server | Add-Member -MemberType NoteProperty -Name credential -Value 'replaceme'
        $server | Add-Member -MemberType NoteProperty -Name username -Value $TurnSrvUserName
        $iceServers+=$($server|ConvertTo-Json)+","
    }

    $iceServers=$iceServers.Substring(0, $iceServers.length - 1);
    $template='{ "iceServers": ['
    $template+=$iceServers
    $template+="]`n}"

    New-Item -Path $appconnectionstring -Value $template -Force
}

function Get-InterfaceStatistics{
    param (
        [Parameter()]
        [string]$chain
    )
    $turntraffic= invoke-expression "sudo su -c 'iptables -nvxL $chain'"
    #$turntraffic=@"
#Chain turn_out (2 references)
#    pkts      bytes target     prot opt in     out     source               destination
#       0        0            tcp  --  *      *       0.0.0.0/0            0.0.0.0/0            tcp spt:3478
#     980  1070015            udp  --  *      *       0.0.0.0/0            0.0.0.0/0            udp spt:3478
#"@

    $udptrafficarray=$($turntraffic.split("`r`n")|?{$_ -match ".*udp.*"}).Split(" ")|?{$_ -ne ""}
    $tcptrafficarray=$($turntraffic.split("`r`n")|?{$_ -match ".*tcp.*"}).Split(" ")|?{$_ -ne ""}

    $totaltrafficpkts=$udptrafficarray[0] + $tcptrafficarray[0]
    $totaltraffickilobyts=[math]::Round($($tcptrafficarray[1] + $udptrafficarray[1])/1024)

    #clear traffic numbers.
    invoke-expression "sudo su -c 'iptables -Z $chain'"

    return @($totaltrafficpkts,$totaltraffickilobyts)
}

function Add-CWNetworkMetrics{
  param (
    [Parameter()]
    [string]$region
  )
  
  $Totalturnout=Get-InterfaceStatistics -chain "turn_out"
  $Totalturnin=Get-InterfaceStatistics -chain "turn_in"

  #TODO Combine this to one call. 
  invoke-expression "aws cloudwatch  put-metric-data --namespace Logverz --metric-name TurnTrafficIn --unit Kilobytes --value $($Totalturnin[1]) --dimensions InstanceID=$instanceid,InstanceType=$instanceType --region $($region)"
  invoke-expression "aws cloudwatch  put-metric-data --namespace Logverz --metric-name TurnTrafficOut --unit Kilobytes --value $($Totalturnout[1]) --dimensions InstanceID=$instanceid,InstanceType=$instanceType --region $($region)"

}

if($env:Environment -eq "LocalDev"){
   #dev environment settings
   $environmentpath="C:/Users/Administrator/Documents/LogverzCore/build/"
   $coturnconfigdestination="C:\Users\Administrator\Documents\LogverzCore\build\turnserver.conf";
   $instanceid="i-0fe135a4d9440ad04";
   $instanceType="t3.nano";
   $publichostname="ec2-54-253-86-129.ap-southeast-2.compute.amazonaws.com"
   $publichostipv4="172.31.24.233";
   $region="ap-southeast-2";
   $webrtcbucket="Logverz-webrtcbucket-1o5zhzorn1r87";
}
else{
   $environmentpath="/home/ubuntu/";
   #invoke-expression "sudo su -c 'chown -R ubuntu:ubuntu $environmentpath && chmod -R 755 $environmentpath'"
   Start-Process  -wait "sudo" -ArgumentList "/bin/bash -c `"chown -R ubuntu:ubuntu $environmentpath &&  chmod -R 755 $environmentpath`""

   $identity=Get-Content $($environmentpath + "environment/identitydocument")|ConvertFrom-Json;
   $instanceid=$identity.instanceId;
   $instanceid=$identity.instanceId;
   $instanceType=$identity.instanceType;
   $region=$identity.region
   $coturnconfigdestination="/etc/turnserver.conf";
   $publichostname=$(wget -q -O - http://169.254.169.254/latest/meta-data/public-hostname);
   $publichostipv4=$(wget -q -O - http://169.254.169.254/latest/meta-data/public-ipv4);
   $privateip=$identity.privateIp;
   $webrtcbucket=Get-Content -path "/home/ubuntu/environment/webrtcbucket";
   $CloudWatchAgentPath="/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json"
   #$logfilelocation=$environmentpath+"systemlog";
   $serverstartunixtime= Get-Content $($environmentpath + "environment/serverstarttime");
   $origin = New-Object -Type DateTime -ArgumentList 1970, 1, 1, 0, 0, 0, 0;
   $serverstarttime = $($origin.AddSeconds($serverstartunixtime)).ToLocalTime();
   $firstrunpath=$($environmentpath + "environment/firstrun.signal")
}

$getmetricsfrequency=5 #once evey 5 minutes
$port=3478;
$cpucreditmetricqueryfilepath=$($environmentpath+"environment/cpucreditmetric-data-queries.json");
$turntrafficmetricqueryfilepath=$($environmentpath+"environment/turntrafficmetric-data-queries.json");
$coturnconfigpath=$($environmentpath+"coturnconfig/turnserver.conf");
$ASGNamePath=$($environmentpath+"environment/ASGsList.setting");
$TurnSrvUserPath=$($environmentpath+"environment/TurnSrvUserPath.setting");
$ASGinstancesPath=$($environmentpath+"environment/AutoScalingGroupInstanceIds");
$appconnectionstring=$($environmentpath+"webrtc.config");
$endtime=Get-Date $(Get-date).ToUniversalTime() -Format "yyyy-MM-ddTHH:mm:ssZ";
$readytostop=$false

#Add-Content -Path $logfilelocation -Value "`nCurrent time: $endtime."

#At first run turnserver.conf does not exists create it and other dependencies
if (!( test-path -Path $firstrunpath)) {
    Start-Process -wait "sudo" -ArgumentList "/bin/bash -c `"touch $firstrunpath && chown -R ubuntu:ubuntu $firstrunpath &&  chmod -R 755 $firstrunpath`""

    #get turnserverpassword and user
    $turnpassword= $($(invoke-expression "aws ssm get-parameter --name '/Logverz/Settings/TurnSrvPassword' --region $region") |ConvertFrom-Json).Parameter.Value #sudo ??
    $turnusername= $($(invoke-expression "aws ssm get-parameter --name '/Logverz/Settings/TurnSrvUserName' --region $region") |ConvertFrom-Json).Parameter.Value
    
    $turnusername| Out-File -FilePath $TurnSrvUserPath

    Create-coturn-Config -turnpassword $turnpassword -turnusername $turnusername -hostname $publichostname -hostip $publichostipv4 -port $port -coturnconfigpath $coturnconfigpath -privateip $privateip;

    #set turn server config
    Start-Process  -wait "sudo" -ArgumentList "/bin/bash -c `"mv -f $coturnconfigpath $coturnconfigdestination`""

    #restart coturn service
    invoke-expression "sudo systemctl restart coturn";

    #Create turnserviceidle.setting local file. 
    $TurnServiceidletime= $($($(invoke-expression "aws ssm get-parameter --name '/Logverz/Settings/IdleTime'--region $region") |ConvertFrom-Json).Parameter.Value|ConvertFrom-Json).TurnService; #sudo ??
    write-host "The VALUE:  $TurnServiceidletime"
    $TurnServiceidletime|ConvertTo-Json |Out-File -FilePath $($environmentpath +"/environment/turnserviceidle.setting");

    #Create ASGsList.setting local file.
    $ASGsList= $($(invoke-expression "aws ssm get-parameter --name '/Logverz/Engine/AutoScalingGroupList'  --region $region") |ConvertFrom-Json).Parameter.Value
    New-Item -Path $ASGNamePath -Value $ASGsList -Force
    

    #create query file to retrieve "AWS/EC2:CPUCreditBalance" CW metric and Logverz/TurnServer Network traffic counters.
    Create-metricdataquery-Config -cpucreditmetricqueryfilepath $cpucreditmetricqueryfilepath -turntrafficmetricqueryfilepath $turntrafficmetricqueryfilepath `
                                  -instanceid $instanceid -instancetype $instanceType -periodinseconds $([int]$($TurnServiceidletime.Period)*60*1.1);

    #turnadmin -k -u lisa -r ec2-54-206-87-237.ap-southeast-2.compute.amazonaws.com -p 123456abZ

    if ($env:Environment -ne "LocalDev"){
    
      #download cloudwatch agent: kudos:https://www.petefreitag.com/item/868.cfm
      invoke-expression "sudo su -c 'curl -o /root/amazon-cloudwatch-agent.deb https://s3.amazonaws.com/amazoncloudwatch-agent/debian/amd64/latest/amazon-cloudwatch-agent.deb'"
    
      #install cloudwatch agent
      invoke-expression "sudo su -c 'dpkg -i -E /root/amazon-cloudwatch-agent.deb'"
      Create-CloudWatchAgent-Config -CloudWatchAgentPath $CloudWatchAgentPath

      invoke-expression "sudo su -c 'systemctl enable amazon-cloudwatch-agent.service'"
      invoke-expression "sudo su -c 'systemctl start amazon-cloudwatch-agent'"

      #set up ip table rules to track network usage 
      invoke-expression "sudo su -c 'iptables -N turn_in && iptables -N turn_out'"

      invoke-expression "sudo su -c 'iptables -A turn_in -p tcp --dport $port && iptables -A turn_in -p udp --dport $port && `
                        iptables -A turn_out -p tcp --sport $port  && iptables -A turn_out -p udp --sport $port'" 
      
      Invoke-Expression "sudo su -c 'iptables -A OUTPUT --protocol udp --sport $port -j turn_out && `
      iptables -A INPUT --protocol udp --dport $port -j turn_in && `
      iptables -A OUTPUT --protocol tcp --sport $port -j turn_out && `
      iptables -A INPUT --protocol tcp --dport $port -j turn_in'"

    }
}


#updateconnectionstring as needed.
Update-ConnectionString -hostname $instanceid -region $region -bucket $webrtcbucket -appconnectionstring $appconnectionstring `
  -ASGinstancesPath $ASGinstancesPath -AutoScalingGroupName $(Get-Content -path $ASGNamePath|ConvertFrom-Json).TurnServerASG -TurnSrvUserName $(Get-Content -path $TurnSrvUserPath)

#put the network interface metrics into AWS CloudWatch Metrics and reset traffic counters. 
Add-CWNetworkMetrics -region $region

$turnserviceidlesetting = $(Get-Content $($environmentpath + "environment/turnserviceidle.setting")|ConvertFrom-Json); 
$idletimeminute=$turnserviceidlesetting.Period
$idletrafficthreshold=$turnserviceidlesetting.CombinedTrafficKbyte
$starttimeidle=Get-Date $((Get-date).AddMinutes(-$idletimeminute)).ToUniversalTime() -Format "yyyy-MM-ddTHH:mm:ssZ";
#make sure that idle time minute has passed since the serverstartup time.
$afterinitialperiod=$($serverstarttime.AddMinutes($idletimeminute) -lt $(Get-date) );

if ($afterinitialperiod -and $($(Get-date).Minute % $getmetricsfrequency) -eq 0){
 
  $TurnTraffic=Invoke-Expression "aws cloudwatch get-metric-data --metric-data-queries file://$($turntrafficmetricqueryfilepath -replace"\\","/") --start-time $starttimeidle --end-time $endtime --region $region";
  $metricvaluesinperiod= $($($TurnTraffic | ConvertFrom-Json).MetricDataResults |ForEach-Object{$_.Values})
  $totaltrafficinperiod= $($metricvaluesinperiod |measure-object -Sum).Sum
  
  if($totaltrafficinperiod -lt $idletrafficthreshold){
    
    $burstableinstancepattern="^t.*\..*";#starts with t, than anynumber of charachters than . finally any number of charachters.
    $readytostop=$true

    $ASGSettingsJSON= Invoke-Expression "aws autoscaling describe-auto-scaling-groups --auto-scaling-group-name $($(Get-Content -path $ASGNamePath|ConvertFrom-Json).TurnServerASG) --region $region"
    $ASGSettings=$(ConvertFrom-Json $($ASGSettingsJSON|Out-String)).AutoScalingGroups[0]

    if ($instanceType -match $burstableinstancepattern){
      $starttime=Get-Date $((Get-date).AddMinutes(-15)).ToUniversalTime() -Format "yyyy-MM-ddTHH:mm:ssZ";
      $CpuCreditBalanceMetric=Invoke-Expression "aws cloudwatch get-metric-data --metric-data-queries file://$($cpucreditmetricqueryfilepath -replace"\\","/") --start-time $($starttime) --end-time $($endtime) --region $($region)";
      $metricvaluesinperiod= $($($CpuCreditBalanceMetric | ConvertFrom-Json).MetricDataResults |ForEach-Object{$_.Values})
      $CpuCreditBalance= $($metricvaluesinperiod |measure-object -Maximum).Maximum;
 
      if ($CpuCreditBalance -lt 1){
        $readytostop = $false 
      }
    }

      
    #Ensure that turn server only shuts down when there are no proxy servers running. 
    #As its possible that period of time turn server does not receive traffic (direct connections only) and stops when it should not.

    
    if(($ASGSettings.Instances.Length -eq 1) -and ($turnserviceidlesetting.CoupledToProxy -eq $true)){
        
        $WebRTCASGSettingsJSON= Invoke-Expression "aws autoscaling describe-auto-scaling-groups --auto-scaling-group-name $($(Get-Content -path $ASGNamePath|ConvertFrom-Json).WebRTCProxyASG) --region $region"
        $WebRTCASGSettings=$(ConvertFrom-Json $($WebRTCASGSettingsJSON|Out-String)).AutoScalingGroups[0]
        if ($WebRTCASGSettings.Instances.Length -ne 0){
           $readytostop=$false 
        }
    }


    
    if ($readytostop -eq $true){

      
      #if the ASG minimum size is not reached we decrement the desired count.
      if ($ASGSettings.MinSize -lt $ASGSettings.Instances.Count){
          Invoke-Expression "aws autoscaling set-desired-capacity --auto-scaling-group-name $($($(Get-Content -path $ASGNamePath|ConvertFrom-Json).TurnServerASG)) --region  $($region) --desired-capacity $($($ASGSettings.DesiredCapacity)-1) --honor-cooldown"
          Start-Sleep -Seconds 5
          Invoke-Expression "sudo su -c 'init 0'";
      }
      else{
        write-host "At minimum ASG Intsances count, can't stop instance."
      }
    
     
    }
    
  }

}
write-host "at the end"
#exit 0
#Testing:
#journalctl -u coturncontrol -n 30

<#cases: 
1 rules, if asg is at minimum don't turn of/ scale down. 

2 turn server starts, active connections not null/ updates are made ASG not at minimum 
    -when to scale up CloudWatch events ASG cpu over 40%
    -when to scale down initiated by the instance

Scale down based on metrics.  
#https://unix.stackexchange.com/questions/320687/tcpdump-counting-outgoing-and-incoming-udp-packets

1 put network data in cw 
2 have algoritm to loadbalance one server
3 check network data stop server without connections 

#>

<#
root@ip-172-31-8-99:/var/snap/amazon-ssm-agent/3552# iptables -nvL turn_in && iptables -nvL turn_out
Chain turn_in (2 references)
 pkts bytes target     prot opt in     out     source               destination
    0     0            tcp  --  *      *       0.0.0.0/0            0.0.0.0/0            tcp dpt:3478
 5737  598K            udp  --  *      *       0.0.0.0/0            0.0.0.0/0            udp dpt:3478
Chain turn_out (2 references)
 pkts bytes target     prot opt in     out     source               destination
    0     0            tcp  --  *      *       0.0.0.0/0            0.0.0.0/0            tcp spt:3478
 9590   11M            udp  --  *      *       0.0.0.0/0            0.0.0.0/0            udp spt:3478
#>