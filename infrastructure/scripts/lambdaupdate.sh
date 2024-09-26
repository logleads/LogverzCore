#!/bin/bash

#stty rows 50 cols 132
declare -A LambdaList
LambdaList[Logverz-MasterController]=mastercontroller.zip
LambdaList[Logverz-NoSQL]=nosql.zip
LambdaList[Logverz-WebRTCSignal]=signal.zip
LambdaList[Logverz-Transform]=transform.zip
LambdaList[Logverz-JobProducer]=jobproducer.zip
LambdaList[Logverz-SetConnectionParamsDNS]=setconnectionparamsdns.zip
LambdaList[Logverz-Login]=login.zip
LambdaList[Logverz-IdentitySync]=identitysync.zip
LambdaList[Logverz-HTTPRelay]=httprelay.zip
LambdaList[Logverz-Worker]=worker.zip
LambdaList[Logverz-Scale]=scale.zip
LambdaList[Logverz-SetConnectionParamsDB]=setconnectionparamsdb.zip
LambdaList[Logverz-Info]=info.zip
LambdaList[Logverz-ContinousCollection]=collection.zip
#LambdaList[Logverz-Initiate]=init.zip #function is updated by user by providing path in Cloudformation template

s3prefix="bin"

existing_deployment=true
#Check if Jobproducer (last function to be deployed) exists or not
aws lambda get-function --function-name Logverz-JobProducer --region $AWS_DEFAULT_REGION >/dev/null 2>&1  || existing_deployment=false
echo $existing_deployment

if [ $existing_deployment == "true" ]; then
    echo "Subsequent deployment lambda needs to be updated"
    for key in "${!LambdaList[@]}"
    do 
        value=$(echo ${LambdaList[$key]});
        path="${s3prefix}/${value}"
        printf "Updating function ${key} with binary located at ${InitBucket}/${path}\n\n"
        aws lambda update-function-code --function-name $key --region $AWS_DEFAULT_REGION --s3-bucket $InitBucket --s3-key $path
    done; 
else
  echo "Initial deployment no need to update"
fi

# export InitBucket=logverz-initbucket-12p59icbfg77u
# export AWS_DEFAULT_REGION=ap-southeast-2
