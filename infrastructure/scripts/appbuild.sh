#!/bin/bash

 apigwdomains=$( aws apigateway get-domain-names --region $(echo $AWS_DEFAULT_REGION) |jq .items )

 if [ $(echo $apigwdomains|jq length) -gt 0 ]; then
	echo "Custom domain(s) for APIGW present"
	restapiid=$(echo $URL | awk '{split($0,a,"."); print a[1];}'|awk '{gsub(/https:\/\//,"\n")}1');
	domainnamesstring=$(echo $apigwdomains |jq .[].domainName);
	declare -a domainnamelist=($domainnamesstring);
	nomatch=0
    echo $restapiid

	for i in "${domainnamelist[@]}"
	do
		onedomainmappings=$(aws apigateway get-base-path-mappings --domain-name $(echo $i|awk '{gsub(/\"/,"")}1') --region $(echo $AWS_DEFAULT_REGION))
		mappingsrestapiid=$(echo $onedomainmappings |jq .items[].restApiId | sort | uniq|awk '{gsub(/\"/,"")}1')
		echo $i $mappingsrestapiid
		if [[ $(echo $restapiid) == $(echo $mappingsrestapiid) ]]; then
			echo "Custom domain for Logverz";
        
			echo "REGION=$AWS_DEFAULT_REGION" >enviromentparameters;
			echo "ACCOUNT_NUMBER=$AWS_ACCOUNT_ID" >>enviromentparameters;
			echo "BASE_URL=https://$(echo $i|awk '{gsub(/\"/,"")}1')" >>enviromentparameters;
			echo "STAGE_NAME=" >>enviromentparameters;

			echo -e "$(cat enviromentparameters)\n$(cat .env.example)">temp.txt;
			echo "">stagename
			#remove the original examples:
			cat temp.txt  | grep -v -E "^#.[A-Za-z].*">.env;
			#cat .env
			rm -f temp.txt;
			nomatch=1;
		fi
	done;
	
	if [[ $(echo $nomatch) -eq 0 ]]; then
		echo "No custom domains for Logverz";
	    echo "REGION=$AWS_DEFAULT_REGION" >enviromentparameters;
	    echo "ACCOUNT_NUMBER=$AWS_ACCOUNT_ID" >>enviromentparameters;
	    echo "BASE_URL=$URL" >>enviromentparameters;
	    echo "STAGE_NAME=$STAGE" >>enviromentparameters;

		echo -e "$(cat enviromentparameters)\n$(cat .env.example)">temp.txt;
		#remove the original examples:
		cat temp.txt  | grep -v -E "^#.[A-Za-z].*">.env;
		#cat .env
		rm -f temp.txt;
	
	fi

 else
	  echo "No custom domain(s) for APIGW at all";
	  echo "REGION=$AWS_DEFAULT_REGION" >enviromentparameters;
	  echo "ACCOUNT_NUMBER=$AWS_ACCOUNT_ID" >>enviromentparameters;
	  echo "BASE_URL=$URL" >>enviromentparameters;
	  echo "STAGE_NAME=$STAGE" >>enviromentparameters;

	  echo -e "$(cat enviromentparameters)\n$(cat .env.example)">temp.txt;
	  #remove the original examples:
	  cat temp.txt  | grep -v -E "^#.[A-Za-z].*">.env;
	  #cat .env
	  rm -f temp.txt;
 fi 



#echo "${domainnamelist[0]}"
# domainnamesstring=$(cat multipledomain.txt | jq .[].domainName)

# export AWS_DEFAULT_REGION=ap-southeast-2
# export URL=https://1azlzr9e3j.execute-api.ap-southeast-2.amazonaws.com
# export AWS_ACCOUNT_ID=accountnumber
# export STAGE=/V3
# export InitBucket=logverz-initbucket-12p59icbfg77u
# export LogicBucket=

#echo "$(echo $restapiid)" == echo"$(echo $mappingsrestapiid)"
#if [ $restapiid = $mappingsrestapiid ]; then
#i="${domainnamelist[0]}"