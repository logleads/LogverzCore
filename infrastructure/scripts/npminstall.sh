#!/bin/bash
subdirectorylist=$(ls -d */| grep -v scripts)
#subdirectorylist=$(ls -d */)

echo $subdirectorylist
for value in $subdirectorylist
do
    cd $value
    v="${value////}"
    echo Building $v
    npm install --loglevel warn #--no-progress
    zip -q -r ../../bin/$v.zip ./*
    cd ..
done