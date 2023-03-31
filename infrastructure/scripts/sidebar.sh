#!/bin/bash
 
 echo "The build region $AWS_DEFAULT_REGION"

FILE=../stagename
if [ -f "$FILE" ]; then
    #echo "$FILE exists."
    export STAGE_NAME=""
else 
    #echo "$FILE does not exist."
    export STAGE_NAME=$STAGE
fi

 sidebarconfig=$( aws ssm get-parameter --name /Logverz/Settings/Sidebar --region $AWS_DEFAULT_REGION 2>&1 >./sidebarconfig.json)
 index="(ParameterNotFound)"
 if [[ "$sidebarconfig" == *"$index"* ]]; then
  echo "No sidebar config"
  cat ./baseconfig.json | jq --arg STAGE_NAME "$STAGE_NAME" '.sideBarIcon|=sub("stagename";$STAGE_NAME)' >config.json
 else
  echo "sidebar config exists"
  cat ./sidebarconfig.json |jq .Parameter.Value |awk '{gsub(/\\n/,"\n")}1' |awk '{gsub(/^"$/,"")}1'|awk '{gsub(/\\"/,"\"")}1'| grep '\S' >sidebarconfig.txt
    
  declare -A idp_parameters
  input="sidebarconfig.txt"
  while IFS= read -r line
  do
    index=$(echo $line | awk '{split($0,a,"=="); print a[1];}'|awk '{gsub(/\"/,"")}1'|awk '{gsub(/\[/,"")}1'|awk '{gsub(/\]/,"")}1');
    value=$(echo $line | awk '{split($0,a,"=="); print a[2];}'|awk '{gsub(/\"/,"")}1');
    echo  "index: " $index "value: " $value
	idp_parameters["$index"]="$value"
	#echo "index: $index      value: $value"
  done < "$input"
  
  for i in "${!idp_parameters[@]}"
  do
	 idp=$(echo $i | awk '{split($0,a,"_"); print a[1];}');
	 property=$(echo $i | awk '{split($0,a,"_"); print a[2];}');
	 value=$(echo ${idp_parameters[$i]});
	 objJSON="{\"$property\": \"$value\"}"
	 if [[ "$idp" != *"ProvidersList"* ]]; then
	    cat baseconfig.json|  jq --arg idp "$idp" --argjson objJSON "$objJSON" '.advertisement[$idp] += $objJSON' |sponge baseconfig.json
	 fi
  done;
  
 ProvidersList=$(echo ${idp_parameters[ProvidersList]}); 
 IFS='; ' read -r -a array <<< $ProvidersList

 for i in "${array[@]}"
 do
	objJSON='{"advertisementHTML": "<ins data-revive-zoneid=\"3\" data-revive-id=\"2f546c30ad8d4b80838351c12a4786b1\"></ins>"}'
	cat baseconfig.json|  jq --arg idp "$i" --argjson objJSON "$objJSON" '.advertisement[$idp] += $objJSON' |sponge baseconfig.json
    objJSON='{"advertisementId": "2f546c30ad8d4b80838351c12a4786b1"}'
	cat baseconfig.json|  jq --arg idp "$i" --argjson objJSON "$objJSON" '.advertisement[$idp] += $objJSON' |sponge baseconfig.json
 done;

 #mv baseconfig.json config.json
 cat ./baseconfig.json | jq --arg STAGE_NAME "$STAGE_NAME" '.sideBarIcon|=sub("stagename";$STAGE_NAME)' >config.json
 #cat config.json
 fi

echo "sidebarconfiguration finished"
# echo ${idp_parameters[GoogleAuth_btnText]}
#/Logverz/Settings/Sidebar
#export AWS_DEFAULT_REGION=ap-southeast-2
#export InitBucket=

#-------------Tests ----------------------------------

# declare -A idp_parameters
# idp_parameters=( 
#   [GoogleAuth_title]="Log In with your social identity"
#   [GoogleAuth_btnText]="Continue with Google"
#   [GoogleAuth_bodyText]="To able to use the system administrator needs to provide you access"
#   [GoogleAuth_url]="https://8d018470-ec39-11eb-be00-0a579f9f91fc.auth.ap-southeast-2.amazoncognito.com/oauth2/authorize?identity_provider=Google&redirect_uri=https://demo.logleads.com/Auth&response_type=CODE&client_id=30n58m2ttuuj86gn023kv0smea&scope=email openid profile",
#   [GoogleAuth_sideBarIcon]="<img src='/V3/HTTP/S3/LB/public/images/Google.png' alt='user-icon' width='50' height='50' />"
#   [GoogleAuth_loginButtonIcon]="<img src='/V3/HTTP/S3/LB/public/images/Google.png' alt='user-icon' width='50' height='50' />"
# )

# echo ${!idp_parameters[@]}
# $testvariable="GoogleAuth_bodyText"
# echo $testvariable | awk '{split($0,a,"_"); print a[2]; print a[1];}'
# echo $testvariable | awk '{split($0,a,"_"); print a[2];}'

# for i in "${!idp_parameters[@]}"
# do
#    idp=$(echo $i | awk '{split($0,a,"_"); print a[1];}');
#    property=$(echo $i | awk '{split($0,a,"_"); print a[2];}');
#    value=  $(echo ${idp_parameters0[$i]});
#    objJSON="{\"$property\": \"$value\"}"
#    cat config.json|  jq --arg idp "$idp" --argjson objJSON "$objJSON" '.advertisment[$idp] += $objJSON' 
# done;