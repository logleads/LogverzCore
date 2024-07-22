#!/bin/bash

echo "The destintation bucket "$InitBucket
#InitBucket=initenvironment-initbucket-vouaml1xdb1f
#ls -la
jsonfilelist=$(ls |grep .json)

echo -e "\nCopying templates to S3 bucket.\n"
for jsonfile in $jsonfilelist;
do
    echo copying $jsonfile;
    aws s3 cp $jsonfile s3://$InitBucket/templates/$jsonfile;
done

bundlelist=$(ls |grep .zip)

echo -e"\nCopying control bundles to S3 bucket.\n"
for bundle in $bundlelist;
do
    echo copying $bundle;
    aws s3 cp $bundle s3://$InitBucket/bin/$bundle;
done

cd ../bin 
#ls -la
zipfilelist=$(ls |grep -E ".*.zip")
echo -e"\nCopying lambda binaries to S3 bucket.\n"
for zipfile in $zipfilelist;
do
    echo copying $zipfile;
    aws s3 cp $zipfile s3://$InitBucket/bin/$zipfile --no-progress;
done