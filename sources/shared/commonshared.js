/* eslint-disable no-undef-init */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */

const getssmparameter = async (SSM, params, dynamodb, details) => {
  try {
    const ssmresult = await SSM.getParameter(params).promise()
    return ssmresult
  } catch (error) {
    const ssmresult = params.Name + ':     ' + error + '    SSM Parameter retrieval failed.'
    console.error(ssmresult)
    details.message = ssmresult
    try {
      await AddDDBEntry(dynamodb, 'Logverz-Invocations', 'GetParameter', 'Error', 'Infra', details, 'API')
      return ssmresult
    } catch (error) {
      // at stack initialisation DynamoDB does not exists...
      console.error('Error saving execution results to Logverz-Invocations table.')
      return ssmresult
    }
  }
}

const setssmparameter = async (SSM, params, dynamodb, details) => {
  try {
    const ssmresult = await SSM.putParameter(params).promise()
    return ssmresult
  } catch (error) {
    const ssmresult = params.Name + ':     ' + error + '    SSM Parameter persistance failed.'
    console.error(ssmresult)
    details.message = ssmresult
    await AddDDBEntry(dynamodb, 'Logverz-Invocations', 'SetParameter', 'Error', 'Infra', details, 'API')
    return ssmresult
  }
}

const receiveSQSMessage = async function (QueueURL, sqs) {
  var params = {
    AttributeNames: [
      'SentTimestamp'
    ],
    MaxNumberOfMessages: 1,
    MessageAttributeNames: [
      'All'
    ],
    QueueUrl: QueueURL,
    VisibilityTimeout: 90,
    WaitTimeSeconds: 0
  }
  return new Promise((resolve, reject) => {
    sqs.receiveMessage(params, function (err, data) {
      if (err) {
        reject(err)
        console.log('Receive Error', err)
      } else if (data.Messages) {
        resolve(data.Messages)
      } else {
        var msg = 'No message in Queue...'
        reject(msg)
        console.log(msg)
      }
    }) // sqs
  }) // promise
}

const makeid = (length) => {
  // https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
  var result = ''
  var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  var charactersLength = characters.length
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength))
  }
  return result
}

// eslint-disable-next-line camelcase
const timeConverter = (UNIX_timestamp) => {
  // kudos: https://stackoverflow.com/questions/847185/convert-a-unix-timestamp-to-time-in-javascript
  var a = new Date(UNIX_timestamp)
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  var year = a.getFullYear()
  var month = months[a.getMonth()]
  var date = a.getDate()
  var hour = a.getHours()
  var min = a.getMinutes()
  var sec = a.getSeconds()
  var time = date + ' ' + month + ' ' + year + ' ' + hour + ':' + min + ':' + sec
  return time
}

const AddDDBEntry = async (dynamodb, DDBTableName, Action, Severity, Category, Details, Type) => {
  var CurrentTime = Date.now().toString()

  var dbentryparams = {
    Item: {
      Action: {
        S: Action
      },
      UnixTime: {
        N: CurrentTime
      },
      Severity: {
        S: Severity
      },
      Category: {
        S: Category
      },
      Details: {
        M: {}
      },
      Type: {
        S: Type
      }
    },
    ReturnConsumedCapacity: 'TOTAL',
    TableName: DDBTableName
  }
  var i
  for (i = 0; i < Object.keys(Details).length; i++) {
    var Name = Object.keys(Details)[i]
    var Value = Details[Name]
    dbentryparams.Item.Details.M[Name] = {
      S: Value
    }
  }
  return await dynamodb.putItem(dbentryparams).promise()
}

const deleteDDB = async (docClient, params) => {

  var promiseddelete = new Promise((resolve, reject) => {
    docClient.delete(params, function (err, data) {
      if (err) {
        console.error('Unable to delete item. Error JSON:', JSON.stringify(err, null, 2))
        reject(err)
      } else {
        console.log('Delete Item succeeded:', JSON.stringify(params.Key, null, 2))
        resolve(data)
      }
    })
  })
  var deleteresult = await promiseddelete
  return deleteresult
}

const UpdateDDB = async (docClient, params) => {

  var promisedupdate = new Promise((resolve, reject) => {
    docClient.update(params, function (err, data) {
      if (err) {
        console.error('Unable to update item. Error JSON:', JSON.stringify(err, null, 2))
        reject(err)
      } else {
        var message = 'Update Item succeeded:' + JSON.stringify(params.Key, null, 2)
        // console.log(message);
        resolve(message)
      }
    })
  })
  var updateresult = await promisedupdate
  return updateresult
}

const putDDB = async (dynamodb, params) => {
  var promisedput = new Promise((resolve, reject) => {
    dynamodb.putItem(params, function (err, data) {
      if (err) {
        console.log(err, err.stack)
        reject(err)
        // an error occurred
      } else resolve(data) // console.log(data);           // successful response
    })
  })
  var putresults = await promisedput
  return putresults
}

const putJSONDDB = async (docClient, params) => {

  var promisedputresult = new Promise((resolve, reject) => {
    docClient.put(params, function (err, data) {
      if (err) {
        console.error('Unable to put data to DynamoDB. Error:', JSON.stringify(err, null, 2))
        reject(err)
      } else {
        // console.log("Query succeeded.");
        resolve(data)
      }
    })
  })
  var queryresults = await promisedputresult
  return queryresults
}

const queryDDB = async (docClient, params) => {

  var promisedqueryresult = new Promise((resolve, reject) => {
    docClient.query(params, function (err, data) {
      if (err) {
        console.error('Unable to query. Error:', JSON.stringify(err, null, 2))
        reject(err)
      } else {
        // console.log("Query succeeded.");
        resolve(data)
      }
    })
  })
  var queryresults = await promisedqueryresult
  return queryresults
}

const SelectDBfromRegistry = (_, Registry, DBidentifier, mode) => {
  var connectionstringsarray = _.reject(Registry.Parameter.Value.split(',[[DBDELIM]]'), _.isEmpty)

  for (var i = 0; i < connectionstringsarray.length; i++) {
    var connectionstring = connectionstringsarray[i].split(',')
    var LogverzDBFriendlyName = connectionstring.filter(s => s.includes('LogverzDBFriendlyName'))[0].split('=')[1]
    if (LogverzDBFriendlyName === DBidentifier) {
      if (mode === 'idonly') {
        var DBEndpointName = connectionstring.filter(s => s.includes('LogverzDBEndpointName'))[0].split('=')[1]
        DBidentifier = DBEndpointName.split('.')[0]
      } else {
        var DBidentifier = connectionstringsarray[i].replace(/,/g, '<!!>')
      }
      break
    }
  }

  return DBidentifier
}

const ValidateToken = (jwt, headers, cert) => {
  var cookies = getcookies(headers)
  var tokenobject = {
    state: true,
    value: ''
  }

  if (typeof cookies === 'undefined' && headers.Authorization === undefined) {
    tokenobject.value = 'Error: No authentication token was found in the request. Please log in to the application.'
    tokenobject.state = false
    console.error(JSON.stringify(tokenobject))
  } else {
    // cookies comming fromAPI gateway are of type strings
    if (headers.Authorization !== undefined) {
      var token = headers.Authorization.split(' ')[1]
    } else if (typeof (headers.cookies) !== 'object') {
      var cookiearray = cookies.split(';')
      var LogverzAuthCookie = cookiearray.filter(i => i.includes('LogverzAuthToken')) // https://stackoverflow.com/questions/4556099/in-javascript-how-do-you-search-an-array-for-a-substring-match
      if (LogverzAuthCookie.length !== 0) {
        var token = LogverzAuthCookie[0].split('=')[1]
      } else {
        var token = 'missing'
      }
    } else {
      // cookies parsed by webrtcproxy are object.
      var token = cookies.LogverzAuthToken
    }

    if (token !== 'missing') {
      try {
        tokenobject.value = jwt.verify(token, cert, {
          algorithms: ['RS512']
        })
        // console.log(JSON.stringify(tokenobject))
      } catch (tokenvalidationerror) {
        console.log(tokenvalidationerror)
        tokenobject.value = tokenvalidationerror
        tokenobject.state = false
      }
    } else {
      tokenobject.value = 'Error: No authentication token was found in the request.'
      tokenobject.state = false
      console.error(JSON.stringify(tokenobject))
    }
  }
  return tokenobject
}

const apigatewayresponse = (input, headers, AllowedOrigins) => {
  
  if (input.header['Content-Type'] !== null && input.header['Content-Type'] !==undefined) {
    var contenttype = input.header['Content-Type']
  } else {
    var contenttype = 'application/json'
  }

  if (headers.origin !== null && (AllowedOrigins.split(',').map(p => p.includes(headers.origin)).includes(true))) {
    // set origin dynamically in case the response comes from a known / accepted source.
    var origin = headers.origin
  } else {
    var origin = '*' // * effective Deny as Cross origin resource sharing with credentials are not allowed by browsers
  }

  var message = input.data
  // console.log(JSON.stringify(input.data))

  if (input.status === 200) {
    var response = {
      statusCode: 200,
      headers: {
        'Content-Type': contenttype, // "text/html"
        'Access-Control-Allow-Origin': origin, // '*', 'http://localhost:8080'
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Set-Cookie',
        'Access-Control-Allow-Credentials': true
      },
      body: message
    }
  } else {
    var response = {
      statusCode: input.status,
      headers: {
        'Content-Type': contenttype,
        'Access-Control-Allow-Origin': origin, // '*'
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Set-Cookie',
        'Access-Control-Allow-Credentials': true
      },
      body: message
    }
  }

  if (input.header !== null && Object.keys(input.header) !== 0) {
    response.headers[Object.keys(input.header)[0]] = input.header[Object.keys(input.header)[0]]
  }

  if (input.base64 === true) {
    response.isBase64Encoded = true
  }
  return response
}

const newcfnresponse= async (event, context, responseStatus, responseData) => {

  return new Promise((resolve, reject) => {
      var responseBody = JSON.stringify({
          Status: responseStatus,
          Reason: "See the details in CloudWatch Log Stream: " + context.logStreamName,
          PhysicalResourceId: context.logStreamName,
          StackId: event.StackId,
          RequestId: event.RequestId,
          LogicalResourceId: event.LogicalResourceId,
          NoEcho: false,
          Data: responseData
      });

      console.log("Response body:\n", responseBody);

      var https = require("https");
      var url = require("url");

      var parsedUrl = url.parse(event.ResponseURL);
      var options = {
          hostname: parsedUrl.hostname,
          port: 443,
          path: parsedUrl.path,
          method: "PUT",
          headers: {
              "content-type": "application/json",
              "content-length": responseBody.length
          }
      };

      var request = https.request(options, function(response) {
          console.log("Status code: " + response.statusCode);
          console.log("Status message: " + response.statusMessage);
          resolve(context.done());
      });

      request.on("error", function(error) {
          console.log("send(..) failed executing https.request(..): " + error);
          reject(context.done(error));
      });

      request.write(responseBody);
      request.end();
  })

}

const getquerystringparameter = (parameter) => {
  var result = null
  try {
    result = parameter
  } catch (querystringerror) {
    result = querystringerror
    console.log(querystringerror)
  }
  return result
}

const eventpropertylookup = (event, property, type) => {
  if (type === 'queryStringParameters') {
    var value = undefined
    try {
      value = event.queryStringParameters[property]
    } catch {
      // console.error(err)
    }
  } else if (type === 'root') {
    var value = undefined
    try {
      value = event[property]
    } catch {
      // console.error(err)
    }
  } else if (type === 'headers') {
    var value = undefined
    try {
      value = event.headers[property]
    } catch {
      // console.error(err)
    }
  } else {
    var value = undefined
    try {
      value = event.ResourceProperties[property]
    } catch (err) {
      console.log('error at function requestproperty lookup:')
      console.error(err)
    }
  }
  return value
}

const propertyvaluelookup = (string) => {
  var result = null
  try {
    result = string[0].split('=')[1]
  } catch (e) {
    result = 'none'
  }
  return result
}

const getcookies = (headers) => {
  // Different browsers and browser version handle cookies differently
  if (headers.cookie !== undefined) {
    var cookies = headers.cookie
  } else if (headers.Cookie !== undefined) {
    var cookies = headers.Cookie
  } else if (headers.cookies !== undefined) {
    var cookies = headers.cookies
  } else {
    var cookies = undefined
  }
  return cookies
}

const S3GET = async (s3, requestbucket, requestedfile) => {
  var getParams = {
    Bucket: requestbucket,
    Key: requestedfile
  }
  try {
    var data = await s3.getObject(getParams).promise()
  } catch (e) {
    var data = e
  }

  return data

  // TODO: in case the file is larger than 6MB (lambda sync limit) the request needs to beresponded to with a presigned url
  // https://intellipaat.com/community/19121/api-gateway-get-put-large-files-into-s3
  // PS: API GW has a 10MB limit for payload.
}

const S3PUT = async (s3, destinationbucket, destinationkey, data) => {
  var putparams = {
    Body: data,
    Bucket: destinationbucket,
    Key: destinationkey
  }

  try {
    var data = await s3.putObject(putparams).promise()
  } catch (e) {
    var data = e
  }
  return data

  // s3.upload... in s3copytet.js
}

const GetAsgSettings = async (autoscaling, params) => {
  var promisedasgsettings = new Promise((resolve, reject) => {
    autoscaling.describeAutoScalingGroups(params, function (err, data) {
      if (err) reject(err) // console.log(err, err.stack); // an error occurred
      else resolve(data) // console.log(data);           // successful response
    })
  })
  var settings = await promisedasgsettings
  return settings
}

const GroupAsgInstances = (asgsettings) => {
  var allinstances = asgsettings.AutoScalingGroups[0].Instances // array
  var alltags = asgsettings.AutoScalingGroups[0].Tags.map(tag => {
    var object = {}
    object[tag.Key] = tag.Value
    return object
  })

  var drainingtags = alltags.filter(tag => (Object.keys(tag)[0].toLowerCase().match(/^drain.*/g)))
  var draininginstances = drainingtags.map(tag => tag[Object.keys(tag)[0]])

  // do not consider draining instances in placement decision.
  var filteredinst = allinstances.filter(instance => draininginstances.includes(instance.InstanceId) === false)

  // do not consider unhealthy (terminating or preservice) instances in placement decision.
  var instances = filteredinst.filter(instance => instance.LifecycleState === 'InService')
  // Valid lifecycles 	//InService,PreInService,Terminating,Pending: https://docs.aws.amazon.com/autoscaling/ec2/userguide/AutoScalingGroupLifecycle.html

  return {
    eligable: instances,
    draining: draininginstances,
    all: allinstances
  }
}

const GetEC2InstancesMetrics = async (cloudwatch, instances, period) => {
  var metricslong = ['AWS/EC2:CPUUtilization', 'AWS/EC2:CPUCreditBalance']
  var time = CreatePeriod(period) // in minutes

  var params = {
    StartTime: time.StartDate,
    EndTime: time.Enddate,
    MetricDataQueries: CreateDataqueries('ec2', instances, metricslong),
    ScanBy: 'TimestampDescending'
  }

  var metrics = await GetCWmetrics(cloudwatch, params)
  return metrics
}

const GetRDSInstancesMetrics = async (cloudwatch, activedbinstances, dbpropertiesarray) => {
  var metricslong = Object.keys(dbpropertiesarray[0].CWMetrics)
  var maxperiod = Math.max(...(dbpropertiesarray.map(p => p.IdlePeriodMin)))
  var time = CreatePeriod(maxperiod) // in minutes
  // eslint-disable-next-line array-callback-return
  var dbinstances = dbpropertiesarray.filter(dbpa => {
    if (activedbinstances.includes(dbpa.DBInstanceIdentifier)) {
      return dbpa
    }
  })

  var params = {
    StartTime: time.StartDate,
    EndTime: time.Enddate,
    MetricDataQueries: CreateDataqueries('rds', dbinstances, metricslong),
    ScanBy: 'TimestampDescending'
  }

  var metrics = await GetCWmetrics(cloudwatch, params)
  return metrics
}

const GetCWmetrics = async (cloudwatch, params) => {
  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudWatch.html#getMetricData-property
  var promisedcwmetrics = new Promise((resolve, reject) => {
    cloudwatch.getMetricData(params, function (err, data) {
      if (err) reject(err) // console.log(err, err.stack); // an error occurred
      else resolve(data) // console.log(data);           // successful response
    })
  })
  var metrics = await promisedcwmetrics
  return metrics
}

const CreatePeriod = (range) => {
  var timeagoinmin = range
  var Enddate = new Date()
  var StartDate = new Date(new Date() - timeagoinmin * 60000)
  StartDate = StartDate.toISOString()
  Enddate = Enddate.toISOString()

  return {
    StartDate,
    Enddate
  }
}

function CreateDataqueries (type, instancelist, metricslong) {
  var result = []
  var i = 1
  for (var item in instancelist) {
    if (type === 'ec2') {
      var instance = instancelist[item].InstanceId
    } else if (type === 'rds') {
      var onedbproperties = instancelist[item]
      var instance = onedbproperties.DBInstanceIdentifier
    }

    var j = i
    for (var metric in metricslong) {
      var namespace = metricslong[metric].split(':')[0]
      var name = metricslong[metric].split(':')[1]

      if (type === 'ec2') {
        var property = 'InstanceId' // Dimension property
        var stattype = 'Average'
      } else if (type === 'rds') {
        var property = 'DBInstanceIdentifier' // Dimension property
        var stattype = onedbproperties.CWMetrics[(namespace + ':' + name)]
      }

      var entry = {
        Id: 'm' + i + j, // (name+i).toLowerCase(), //instance.replace("-","_"),
        Label: instance + ':' + name,
        MetricStat: {
          Metric: {
            Dimensions: [{
              Name: property,
              Value: instance
            }],
            MetricName: name,
            Namespace: namespace
          },
          Period: 60, // 1 minute data resolution.
          Stat: stattype
        },
        ReturnData: true
      }
      result.push(entry)
      j++
    }
    i++
  }
  return result
}

const average = (nums) => {
  // kudos https://jrsinclair.com/articles/2019/five-ways-to-average-with-js-reduce/
  if (nums.length === 0) {
    return 0
  } else {
    return nums.reduce((a, b) => (a + b)) / nums.length
  }
}

// const updatelambdaenvironmentvariables = async (lambda, functionname, data) => {
//   var configparams = {
//     FunctionName: functionname
//   }

//   var configpromise = new Promise((resolve, reject) => {
//     lambda.getFunctionConfiguration(configparams, function (err, data) {
//       if (err) reject(err) // console.log(err, err.stack); // an error occurred
//       else resolve(data) // console.log(data);           // successful response
//     })
//   })
//   var lambdaconfig = await configpromise
//   var environmentvariables = lambdaconfig.Environment.Variables
//   environmentvariables[data.AttributeName] = data.AttributeValue

//   var updateparams = {
//     FunctionName: functionname,
//     Environment: {
//       Variables: environmentvariables
//     }
//   }
//   var updatepromise = new Promise((resolve, reject) => {
//     lambda.updateFunctionConfiguration(updateparams, function (err, data) {
//       if (err) reject(err) // console.log(err, err.stack); // an error occurred
//       else resolve(data) // console.log(data);           // successful response
//     })
//   })
//   var updateresult = await updatepromise
//   console.log(updateresult)
// }

const getbuildstatus = async (codebuild, buildid) => {
  var params = {
    ids: buildid
  }
  return new Promise((resolve, reject) => {
    codebuild.batchGetBuilds(params, function (err, data) {
      if (err) {
        console.log(err, err.stack)
        reject(err)
      } // an error occurred
      // else     console.log(data);           // successful response
      resolve(data)
    })
  })
}

const walkfolders = async (_, s3, dynamodb, commonshared, tobeprocessed, subfolderlist, getCommonPrefixes) => {
  for (const item of tobeprocessed) {
    var folder = item[0]
    var bucket = item[1]
    var delimiter = item[2]
    var maxdepth = item[3]
    var currentdepth = folder.split('/').length - 1
    // dontgo deeper than maxdepth
    if (currentdepth === maxdepth) {
      // subfolderlist.push(item)
      delimiter = '*'
      subfolderlist.push([folder, bucket, delimiter, maxdepth])
      _.pull(tobeprocessed, item)
      continue
    }

    const subfolder = await getCommonPrefixes(dynamodb, commonshared, s3, {
      Bucket: bucket,
      Prefix: folder,
      Delimiter: delimiter
    }) //
    _.forEach(subfolder, function (object) {
      var prfx = object[0]
      var delim = object[2]

      if (delim === '/') {
        subfolderlist.push(object)
        _.pull(tobeprocessed, object)
      } else {
        tobeprocessed.push([prfx, bucket, '/', maxdepth]) // delim
      }
    })
    _.pull(tobeprocessed, item)
  } // for
}

const TransformInputValues = (S3Folders, S3EnumerationDepth, _) => {
  var Patharray = []
  var delimiter = '/'

  if (S3Folders.includes(';')) {
    // var inputvalues = S3Folders.split(";");
    var inputvalues = _.reject(S3Folders.split(';'), _.isEmpty)
    _.forEach(inputvalues, oneresult => {
      var prefix = oneresult.split('/').slice(3).join('/')
      var bucket = oneresult.split('/').slice(1)[1]
      var currentdepth = prefix.split('/').length - 1
      var maxdepth = parseInt(S3EnumerationDepth) + currentdepth
      Patharray.push([prefix, bucket, delimiter, maxdepth])
    })
  } else {
    var oneresult = S3Folders
    var prefix = oneresult.split('/').slice(3).join('/')
    var bucket = oneresult.split('/').slice(1)[1]
    var currentdepth = prefix.split('/').length - 1
    var maxdepth = parseInt(S3EnumerationDepth) + currentdepth
    Patharray.push([prefix, bucket, delimiter, maxdepth])
  }
  return Patharray
}

const GetRDSSettings = async (rds, params) => {
  var promisedrdssettings = new Promise((resolve, reject) => {
    rds.describeDBInstances(params, function (err, data) {
      if (err) reject(err) // console.log(err, err.stack); // an error occurred
      else resolve(data) // console.log(data);           // successful response
    })
  })
  var settings = await promisedrdssettings
  return settings
}

const ASGstatus = async (autoscaling, AutoScalingGroupNames) => {
  // todo make request in batches simmilar to getiamidentitiessegment(Marker)
  var params = {
    AutoScalingGroupNames
  }

  var promisedasgsettings = new Promise((resolve, reject) => {
    autoscaling.describeAutoScalingGroups(params, function (err, data) {
      if (err) reject(err) // console.log(err, err.stack); // an error occurred
      else resolve(data) // console.log(data);           // successful response
    })
  })
  var settings = await promisedasgsettings
  return settings.AutoScalingGroups
}

const deactivatequery = async (commonshared, docClient, DatabaseName, DBTableName, jobid) =>{
   
  const TableName = 'Logverz-Queries'
  const queryparams = {
    TableName,
    ExpressionAttributeNames: {
      '#TableName': 'TableName',
      '#DatabaseName': 'DatabaseName'
    },
    KeyConditionExpression: '#TableName = :TableValue and #DatabaseName = :DatabaseValue',
    ExpressionAttributeValues: {
      ':TableValue': DBTableName,
      ':DatabaseValue': DatabaseName,
      ':Active': true
    },
    FilterExpression: 'Active = :Active',
    IndexName: 'TableName'
  }

  const data = (await commonshared.queryDDB(docClient, queryparams)).Items

  if (jobid !== false){
    var lisofupdateitems = data.filter(d => d.QuerySettings.JobID !== jobid).map(i => {
      return [i.UsersQuery, i.UnixTime]
    })
  }
  else{
    var lisofupdateitems=data.map(d=>{return [d.UsersQuery, d.UnixTime,d.TableName,d.QueryType]})
  }

  for await (item of lisofupdateitems) {
    console.log('Setting UsersQuery ' + item[0] + ' at ' + item[1] + " 'Active: false'.")
    if (item[2]!==undefined){
      console.log('Corresponding TableName ' + item[2] + " and QueryType'" + item[3] + " '.")
    }
    const updateparams = {
      TableName,
      Key: {
        UsersQuery: item[0],
        UnixTime: item[1]
      },
      UpdateExpression: 'set Active = :val',
      ExpressionAttributeValues: {
        ':val': false
      },
      ReturnValues: 'UPDATED_NEW'
    }
    var updateresult = (await commonshared.UpdateDDB(docClient, updateparams))
    console.log(updateresult)
  }
  return updateresult
}

const masktoken = (maskedevent) => {
  if (maskedevent.headers !== undefined && maskedevent.headers.Authorization !== undefined) {
    maskedevent.headers.Authorization = '****'
    maskedevent.multiValueHeaders.Authorization = '****'
  }

  if (maskedevent.headers !== undefined && maskedevent.headers.Cookie !== undefined) {
    maskedevent.headers.Cookie = '****'
    maskedevent.multiValueHeaders.Cookie = '****'
  }

  if (maskedevent.headers !== undefined && maskedevent.headers.cookie !== undefined) {
    maskedevent.headers.cookie = '****'
    maskedevent.multiValueHeaders.cookie = '****'
  }
  return maskedevent
}

exports.getssmparameter = getssmparameter
exports.setssmparameter = setssmparameter
exports.receiveSQSMessage = receiveSQSMessage
exports.makeid = makeid
exports.timeConverter = timeConverter
exports.AddDDBEntry = AddDDBEntry
exports.deleteDDB = deleteDDB
exports.putDDB = putDDB
exports.putJSONDDB = putJSONDDB
exports.queryDDB = queryDDB
exports.UpdateDDB = UpdateDDB
exports.SelectDBfromRegistry = SelectDBfromRegistry
exports.ValidateToken = ValidateToken
exports.apigatewayresponse = apigatewayresponse
exports.newcfnresponse = newcfnresponse
exports.getquerystringparameter = getquerystringparameter
exports.eventpropertylookup = eventpropertylookup
exports.propertyvaluelookup = propertyvaluelookup
exports.getcookies = getcookies
exports.S3GET = S3GET
exports.S3PUT = S3PUT
exports.GetAsgSettings = GetAsgSettings
exports.GroupAsgInstances = GroupAsgInstances
exports.GetEC2InstancesMetrics = GetEC2InstancesMetrics
exports.GetRDSInstancesMetrics = GetRDSInstancesMetrics
exports.GetCWmetrics = GetCWmetrics
exports.CreatePeriod = CreatePeriod
exports.average = average
//exports.updatelambdaenvironmentvariables = updatelambdaenvironmentvariables
exports.getbuildstatus = getbuildstatus
exports.walkfolders = walkfolders
exports.TransformInputValues = TransformInputValues
exports.GetRDSSettings = GetRDSSettings
exports.ASGstatus = ASGstatus
exports.deactivatequery = deactivatequery
exports.masktoken = masktoken
