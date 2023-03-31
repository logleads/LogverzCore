#converting a JSON object to CloudFormation format. 

#$pshost = get-host
$pswindow = $pshost.ui.rawui
$newsize = $pswindow.buffersize
$newsize.height = 600
$newsize.width = 600
$pswindow.buffersize = $newsize


#JSON has to use tabs to create the hierachy such as the output of https://jsonlint.com/
$json=@"
    {
    	"version": "int",
    	"account-id": "int",
    	"srcport": "int",
    	"dstport": "int",
    	"protocol": "int",
    	"packets": "int",
    	"bytes": "int",
    	"start": "int",
    	"end": "int",
    	"traffic-path": "int"
    }
"@

$json.Replace("`t","  ").Replace("`n","\n").Replace('"','\"')