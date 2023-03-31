#!/bin/bash

echo "The destintation bucket "$InitBucket
#InitBucket=initenvironment-initbucket-vouaml1xdb1f
#ls -la
jsonfilelist=$(ls |grep .json)

echo "Copying templates to S3 bucket."
for jsonfile in $jsonfilelist;
do
    echo copying $jsonfile;
    aws s3 cp $jsonfile s3://$InitBucket/templates/$jsonfile;
done

bundlelist=$(ls |grep .zip)

echo "Copying control bundles to S3 bucket."
for bundle in $bundlelist;
do
    echo copying $bundle;
    aws s3 cp $bundle s3://$InitBucket/bin/$bundle;
done

cd ../bin 
#ls -la
zipfilelist=$(ls |grep -E ".*.zip")
echo "Copying lambda binaries to S3 bucket."
for zipfile in $zipfilelist;
do
    echo copying $zipfile;
    aws s3 cp $zipfile s3://$InitBucket/bin/$zipfile --no-progress;
done