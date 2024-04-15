#!/bin/bash

pwshdebversion="powershell_7.4.2-1.deb_amd64.deb"
pwshdeburl="https://github.com/PowerShell/PowerShell/releases/download/v7.4.2/powershell_7.4.2-1.deb_amd64.deb"

pwshrpmversion="powershell-7.4.2-1.rh.x86_64.rpm"
pwshrpmurl="https://github.com/PowerShell/PowerShell/releases/download/v7.4.2/powershell-7.4.2-1.rh.x86_64.rpm"

aws s3api head-object --bucket "$InitBucket" --key "bin/$pwshdebversion" || not_existdeb=true
if [ $not_existdeb ]; then
  echo "Downloading pwsh deb installer"
  wget "$pwshdeburl" --no-verbose
  aws s3 cp "./$pwshdebversion" "s3://$InitBucket/bin/$pwshdebversion" --no-progress
else
  echo "latest installer exists"
fi

aws s3api head-object --bucket "$InitBucket" --key "bin/$pwshrpmversion" || not_existrpm=true
if [ $not_existrpm ]; then
  echo "Downloading pwsh rpm installer"
  wget "$pwshrpmurl" --no-verbose
  aws s3 cp "./$pwshrpmversion" "s3://$InitBucket/bin/$pwshrpmversion" --no-progress
else
  echo "latest installer exists"
fi

#export InitBucket=logverz-initbucket-5qokamozrhac