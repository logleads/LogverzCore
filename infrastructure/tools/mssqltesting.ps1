#Install-Module sqlserver
Import-Module sqlserver

$username="LogverzAdmin"
$password="5Five*****"

$serverfqdn = "logverzdevenvironment-externaldb-mssql-logverzdb-tanruvpmxmqs.ctmpydtwitz8.ap-southeast-2.rds.amazonaws.com"

$query1_viofilestat= @" 
SELECT *
FROM sys.dm_io_virtual_file_stats(DB_ID('Logverz'), NULL) divfs
ORDER BY divfs.io_stall DESC;
"@

#https://blog.sqlauthority.com/2018/01/09/sql-server-introduction-log-space-usage-dmv-sys-dm_db_log_space_usage/
$query2_logspace=@"
USE logverz;
SELECT total_log_size_in_bytes/1048576.0 AS [Total Log Size in MB],
used_log_space_in_bytes/1048576.0 AS [Used Log Size in MB],
used_log_space_in_percent [Used Log Space in %],
(total_log_size_in_bytes - used_log_space_in_bytes)/1048576.0 AS [Free log space in MB],
log_space_in_bytes_since_last_backup/1048576.0 [Log Since Last Log Backup]
FROM sys.dm_db_log_space_usage;
"@

$array= @()

do {
$result_viofilestat= Invoke-Sqlcmd -ServerInstance $serverfqdn  -Database 'master' -Username $username -Password $password  -Query $query1_viofilestat
$result_logspace= Invoke-Sqlcmd -ServerInstance $serverfqdn  -Database 'master' -Username $username -Password $password  -Query $query2_logspace





$completeresult = New-Object -TypeName PSCustomObject
$completeresult | Add-Member -MemberType NoteProperty -Name "VioFileStat" -Value $result_viofilestat
$completeresult | Add-Member -MemberType NoteProperty -Name "LogSpace" -Value $result_logspace
#$completeresult | Add-Member -MemberType NoteProperty -Name "VioFileStat" -Value $result_viofilestat

$array+= $completeresult 
start-sleep -Seconds 2
} while($true)


$data = iex "aws rds describe-db-instances --db-instance-identifier logverzserverlesscluster-logverzdbserverlessinstan-9birn0vahws8"

$data
