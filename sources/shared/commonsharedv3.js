/* eslint-disable array-callback-return */
/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/* eslint brace-style: ["error", "stroustrup"] */

const getssmparameter = async (ssmclient, GetParameterCommand, params, ddclient, PutItemCommand, details) => {
  try {
    // const ssmresult = await SSM.getParameter(params).promise()
    const command = new GetParameterCommand(params)
    const ssmresult = await ssmclient.send(command)
    return ssmresult
  }
  catch (error) {
    const ssmresult = params.Name + ':     ' + error + '    SSM Parameter retrieval failed.'
    console.error(ssmresult)
    details.message = ssmresult
    try {
      await AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'GetParameter', 'Error', 'Infra', details, 'API')
      return ssmresult
    }
    catch (error) {
      // at stack initialisation DynamoDB does not exists...
      console.error('Error saving execution results to Logverz-Invocations table.')
      return ssmresult
    }
  }
}

const setssmparameter = async (ssmclient, PutItemCommand, PutParameterCommand, params, ddclient, details) => {
  try {
    const command = new PutParameterCommand(params)
    const ssmresult = await ssmclient.send(command)
    return ssmresult
  }
  catch (error) {
    const ssmresult = params.Name + ':     ' + error + '    SSM Parameter persistance failed.'
    console.error(ssmresult)
    details.message = ssmresult
    await AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'SetParameter', 'Error', 'Infra', details, 'API')
    return ssmresult
  }
}

const receiveSQSMessage = async function (sqsclient, ReceiveMessageCommand, QueueURL, maxmessagenumber) {
  var params = {
    AttributeNames: [
      'SentTimestamp'
    ],
    MaxNumberOfMessages: maxmessagenumber,
    MessageAttributeNames: [
      'All'
    ],
    QueueUrl: QueueURL,
    VisibilityTimeout: 90,
    WaitTimeSeconds: 0
  }

  const command = new ReceiveMessageCommand(params)
  const result = await sqsclient.send(command)
  return result
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

const AddDDBEntry = async (ddclient, PutItemCommand, DDBTableName, Action, Severity, Category, Details, Type) => {
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

  const command = new PutItemCommand(dbentryparams)
  const response = await ddclient.send(command)
  return response
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
      }
      else {
        var DBidentifier = connectionstringsarray[i].replace(/,/g, '<!!>')
      }
      break
    }
  }

  return DBidentifier
}

const DBpropertylookup = (connectionstringsarray, LogverzDBFriendlyName) => {
  // TODO move this to commonshared so that sequelize package can be removed from scale.js.

  for (var i = 0; i < connectionstringsarray.length; i++) {
    var connectionstring = connectionstringsarray[i].split(',')
    var CSLogverzDBFriendlyName = connectionstring.filter(s => s.includes('LogverzDBFriendlyName'))[0].split('=')[1]

    if (CSLogverzDBFriendlyName === LogverzDBFriendlyName) {
      var DBEngineType = connectionstring.filter(s => s.includes('LogverzEngineType'))[0].split('=')[1]
      var DBUserName = connectionstring.filter(s => s.includes('LogverzDBUserName'))[0].split('=')[1]
      var DBEndpointName = connectionstring.filter(s => s.includes('LogverzDBEndpointName'))[0].split('=')[1]
      var DBEndpointPort = connectionstring.filter(s => s.includes('LogverzDBEndpointPort'))[0].split('=')[1]
      var DBSecretRef = connectionstring.filter(s => s.includes('LogverzDBSecretRef'))[0].split('=')[1]
      var DBFriendlyName = connectionstring.filter(s => s.includes('LogverzDBFriendlyName'))[0].split('=')[1]

      var LogverzDBClusterID = connectionstring.filter(s => s.includes('LogverzDBClusterID'))[0]

      if (DBEngineType.match('sqlserver')) {
        // SQL server comes in many flavours express web standard enterprise and developer, we normalize it as mssql name convention defined by sequilize
        DBEngineType = 'mssql'
      }

      if (LogverzDBClusterID !== undefined) {
        var DBClusterID = LogverzDBClusterID.split('=')[1]
      }
      break
    }
  }

  var result = {
    DBEngineType,
    DBUserName,
    DBEndpointName,
    DBEndpointPort,
    DBSecretRef,
    DBFriendlyName
  }

  if (typeof DBClusterID !== 'undefined') {
    // if DBclusterid exists its a serverless database so we add it to the results
    // result['DBClusterID']+=DBClusterID
    Object.defineProperty(result, 'DBClusterID', {
      value: DBClusterID
    })
  }

  return result
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
  }
  else {
    // cookies comming fromAPI gateway are of type strings
    if (headers.Authorization !== undefined) {
      var token = headers.Authorization.split(' ')[1]
    }
    else if (typeof (headers.cookies) !== 'object') {
      var cookiearray = cookies.split(';')
      var LogverzAuthCookie = cookiearray.filter(i => i.includes('LogverzAuthToken')) // https://stackoverflow.com/questions/4556099/in-javascript-how-do-you-search-an-array-for-a-substring-match
      if (LogverzAuthCookie.length !== 0) {
        var token = LogverzAuthCookie[0].split('=')[1]
      }
      else {
        var token = 'missing'
      }
    }
    else {
      // cookies parsed by webrtcproxy are object.
      var token = cookies.LogverzAuthToken
    }

    if (token !== 'missing') {
      try {
        tokenobject.value = jwt.verify(token, cert, {
          algorithms: ['RS512']
        })
        // console.log(JSON.stringify(tokenobject))
      }
      catch (tokenvalidationerror) {
        console.log(tokenvalidationerror)
        tokenobject.value = tokenvalidationerror
        tokenobject.state = false
      }
    }
    else {
      tokenobject.value = 'Error: No authentication token was found in the request.'
      tokenobject.state = false
      console.error(JSON.stringify(tokenobject))
    }
  }
  return tokenobject
}

const apigatewayresponse = (input, headers, AllowedOrigins) => {
  if (input.header['Content-Type'] !== null && input.header['Content-Type'] !== undefined) {
    var contenttype = input.header['Content-Type']
  }
  else {
    var contenttype = 'application/json'
  }

  if (headers !== undefined && headers.origin !== null && (AllowedOrigins.split(',').map(p => p.includes(headers.origin)).includes(true))) {
    // set origin dynamically in case the response comes from a known / accepted source.
    var origin = headers.origin
  }
  else {
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
  }
  else {
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

const newcfnresponse = async (event, context, responseStatus, responseData) => {
  var responseBody = JSON.stringify({
    Status: responseStatus,
    Reason: 'See the details in CloudWatch Log Stream: ' + context.logStreamName,
    PhysicalResourceId: context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
    Data: responseData
  })

  console.log('Response body:\n', responseBody)

  var response = await fetch(event.ResponseURL, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': responseBody.length
    },
    method: 'PUT',
    body: responseBody
  })

  try {
    const result = await response.text()
    console.log('Result: \n\n' + result)
    // return context.done()
    return result
  }
  catch (error) {
    console.error('Error:', error)
    // return context.done(error)
    return error
  }
}

const getquerystringparameter = (parameter) => {
  var result = null
  try {
    result = parameter
  }
  catch (querystringerror) {
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
    }
    catch {
      // console.error(err)
    }
  }
  else if (type === 'root') {
    var value = undefined
    try {
      value = event[property]
    }
    catch {
      // console.error(err)
    }
  }
  else if (type === 'headers') {
    var value = undefined
    try {
      value = event.headers[property]
    }
    catch {
      // console.error(err)
    }
  }
  else {
    var value = undefined
    try {
      value = event.ResourceProperties[property]
    }
    catch (err) {
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
  }
  catch (e) {
    result = 'none'
  }
  return result
}

const getcookies = (headers) => {
  // Different browsers and browser version handle cookies differently
  if (headers.cookie !== undefined) {
    var cookies = headers.cookie
  }
  else if (headers.Cookie !== undefined) {
    var cookies = headers.Cookie
  }
  else if (headers.cookies !== undefined) {
    var cookies = headers.cookies
  }
  else {
    var cookies = undefined
  }
  return cookies
}

const S3GET = async (s3client, GetObjectCommand, requestbucket, requestedfile) => {
  var getParams = {
    Bucket: requestbucket,
    Key: requestedfile
  }
  try {
    const command = new GetObjectCommand(getParams)
    var response = await s3client.send(command)
  }
  catch (e) {
    var response = e
  }

  return response

  // TODO: in case the file is larger than 6MB (lambda sync limit) the request needs to beresponded to with a presigned url
  // https://intellipaat.com/community/19121/api-gateway-get-put-large-files-into-s3
  // PS: API GW has a 10MB limit for payload.
}

const s3putdependencies = async (LocalPath, DstBucket, s3client, PutObjectCommand, fs, fileURLToPath, FileName) => {
  var content = fs.readFileSync(fileURLToPath(LocalPath))

  const uploadParams = {
    Bucket: DstBucket,
    Key: FileName,
    Body: content
  }

  const command = new PutObjectCommand(uploadParams)

  try {
    const s3result = await s3client.send(command)
    console.log('Successfully put file ' + FileName + ' to: ' + DstBucket + ' bucket.')
    return await s3result.ETag
  }
  catch (error) {
    // console.error(error) // from creation or business logic
    return await error
  }
}

const emptybucket = async (s3client, ListObjectVersionsCommand, DeleteObjectCommand, bucket) => {
  const params = {
    Bucket: bucket
    //, MaxKeys: "10"
  }
  var allversions
  await getallversions(s3client, ListObjectVersionsCommand, params, allversions = [])
  console.log("In bucket '" + bucket + "' the total number of files are " + allversions.length)

  const promises = allversions.map(onefile => {
    const deleteParam = {
      Bucket: onefile[0],
      Key: onefile[1],
      VersionId: onefile[2]
    }

    const command = new DeleteObjectCommand(deleteParam)
    const response = s3client.send(command)
    return response
  })

  const resolved = await Promise.all(promises)
  console.log('finished emptying ' + bucket)
  return resolved
}

const getallversions = async (s3client, ListObjectVersionsCommand, params, allversions = []) => {
  const command = new ListObjectVersionsCommand(params)
  const response = await s3client.send(command)
  response.Versions.forEach(obj => allversions.push([params.Bucket, obj.Key, obj.VersionId]))

  if (response.NextVersionIdMarker) {
    params.VersionIdMarker = response.NextVersionIdMarker
    params.KeyMarker = response.NextKeyMarker
    await getallversions(s3client, params, allversions) // RECURSIVE CALL
  }
  return allversions
}

const GroupAsgInstances = (asgsettings) => {
  var allinstances = asgsettings[0].Instances // array
  var alltags = asgsettings[0].Tags.map(tag => {
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

const GetEC2InstancesMetrics = async (cwclient, GetMetricDataCommand, instances, period) => {
  var metricslong = ['AWS/EC2:CPUUtilization', 'AWS/EC2:CPUCreditBalance']
  var time = CreatePeriod(period) // in minutes

  var params = {
    StartTime: new Date(time.StartDate),
    EndTime: new Date(time.Enddate),
    MetricDataQueries: CreateDataqueries('ec2', instances, metricslong),
    ScanBy: 'TimestampDescending'
  }

  const command = new GetMetricDataCommand(params)
  const metrics = await cwclient.send(command)
  return metrics
}

const GetRDSInstancesMetrics = async (cwclient, GetMetricDataCommand, activedbinstances, dbpropertiesarray) => {
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
    StartTime: new Date(time.StartDate),
    EndTime: new Date(time.Enddate),
    MetricDataQueries: CreateDataqueries('rds', dbinstances, metricslong),
    ScanBy: 'TimestampDescending'
  }

  const command = new GetMetricDataCommand(params)
  const metrics = await cwclient.send(command)
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
    }
    else if (type === 'rds') {
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
      }
      else if (type === 'rds') {
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
  }
  else {
    return nums.reduce((a, b) => (a + b)) / nums.length
  }
}

const getbuildstatus = async (cbclient, BatchGetBuildsCommand, buildid) => {
  var params = {
    ids: buildid
  }

  const command = new BatchGetBuildsCommand(params)
  const buildresult = await cbclient.send(command)
  return buildresult
}

const walkfolders = async (_, ListObjectsV2Command, ddclient, PutItemCommand, commonshared, tobeprocessed, subfolderlist, getCommonPrefixes, callerid,jobid) => {
  for (const item of tobeprocessed) {
    var folder = item[0]
    var bucket = item[1]
    var delimiter = item[2]
    var maxdepth = item[3]
    var region= item[4]
    var currentdepth = folder.split('/').length - 1
    // dontgo deeper than maxdepth
    if (currentdepth === maxdepth) {
      // subfolderlist.push(item)
      delimiter = '*'
      subfolderlist.push([folder, bucket, delimiter, maxdepth, region])
      _.pull(tobeprocessed, item)
      continue
    }

    const subfolder = await getCommonPrefixes(currentdepth, region, jobid, callerid, ddclient, PutItemCommand, commonshared, ListObjectsV2Command, {
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
      }
      else {
        tobeprocessed.push([prfx, bucket, '/', maxdepth, region]) // delim
      }
    })
    _.pull(tobeprocessed, item)
  } // for
}

const TransformInputValues = async (s3client, GetBucketLocationCommand, S3Folders, StgEnumerationDepth, _) => {
  var Patharray = []
  var extendedpatharray=[]
  var delimiter = '/'

  if (S3Folders.includes(';')) {
    // var inputvalues = S3Folders.split(";");
    var inputvalues = _.reject(S3Folders.split(';'), _.isEmpty)
    _.forEach(inputvalues, oneresult => {
      var prefix = oneresult.split('/').slice(3).join('/')
      var bucket = oneresult.split('/').slice(1)[1]
      var currentdepth = prefix.split('/').length - 1
      var maxdepth = parseInt(StgEnumerationDepth) + currentdepth
      Patharray.push([prefix, bucket, delimiter, maxdepth])
    })
  }
  else {
    var oneresult = S3Folders
    var prefix = oneresult.split('/').slice(3).join('/')
    var bucket = oneresult.split('/').slice(1)[1]
    var currentdepth = prefix.split('/').length - 1
    var maxdepth = parseInt(StgEnumerationDepth) + currentdepth
    Patharray.push([prefix, bucket, delimiter, maxdepth])
  }

  for await (const onepath of Patharray) {
    const bucketLocationcommand = new GetBucketLocationCommand({"Bucket": onepath[1]})
    let result= await s3client.send(bucketLocationcommand)
    extendedpatharray.push([onepath[0],onepath[1],onepath[2],onepath[3],result.LocationConstraint])
  }

  return extendedpatharray
}

const ASGstatus = async (AutoScalingClient, paginateDescribeAutoScalingGroups, AutoScalingGroupNames) => {
  const paginatorConfig = {
    client: new AutoScalingClient({}),
    pageSize: 100
  }

  const paginator = paginateDescribeAutoScalingGroups(paginatorConfig, { AutoScalingGroupNames })
  const ASGList = []
  for await (const oneasg of paginator) {
    ASGList.push(...oneasg.AutoScalingGroups)
  }
  return ASGList
}

const deactivatequery = async (docClient, QueryCommand, UpdateCommand, DatabaseName, DBTableName, jobid) => {
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

  const command = new QueryCommand(queryparams)
  var data = (await docClient.send(command)).Items

  if (jobid !== false) {
    var lisofupdateitems = data.filter(d => d.QuerySettings.JobID !== jobid).map(i => {
      return [i.UsersQuery, i.UnixTime]
    })
  }
  else {
    var lisofupdateitems = data.map(d => {
      return [d.UsersQuery, d.UnixTime, d.TableName, d.QueryType]
    })
  }

  for await (var item of lisofupdateitems) {
    console.log('Setting UsersQuery ' + item[0] + ' at ' + item[1] + " 'Active: false'.")
    if (item[2] !== undefined) {
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

    const command = new UpdateCommand(updateparams)
    try {
      await docClient.send(command)
      var message = 'Update Item succeeded:' + JSON.stringify(updateparams.Key, null, 2)
      console.log('\n' + message)
    }
    catch (error) {
      console.error('Unable to update item. Error JSON:', JSON.stringify(error, null, 2))
    }
  }
  // return updateresult
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

  if (maskedevent.clientContext!== undefined && maskedevent.clientContext.cookie !== undefined){
    maskedevent.clientContext.cookie = '****'
  }
  return maskedevent
}

const maskcredentials = (mevent) => {
  if (mevent.OldResourceProperties !== undefined && mevent.ResourceProperties.TokenSigningPassphrase !== undefined) {
    mevent.ResourceProperties.TokenSigningPassphrase = '****'
    mevent.OldResourceProperties.TokenSigningPassphrase = '****'
  }
  else if (mevent.Parameters !== undefined && mevent.Parameters.some(k => k.ParameterKey === 'TokenSigningPassphrase')) {
    mevent.Parameters.filter(k => k.ParameterKey === 'TokenSigningPassphrase')[0].ParameterValue = '****'
  }
  else if (mevent.ResourceProperties.TokenSigningPassphrase !== undefined) {
    // at first deployment time no OldResourceProperties exists
    mevent.ResourceProperties.TokenSigningPassphrase = '****'
  }

  if (mevent.OldResourceProperties !== undefined && mevent.ResourceProperties.TurnSrvPassword !== undefined) {
    mevent.ResourceProperties.TurnSrvPassword = '****'
    mevent.OldResourceProperties.TurnSrvPassword = '****'
  }
  else if (mevent.Parameters !== undefined && mevent.Parameters.some(k => k.ParameterKey === 'TurnSrvPassword')) {
    mevent.Parameters.filter(k => k.ParameterKey === 'TurnSrvPassword')[0].ParameterValue = '****'
  }
  else if (mevent.ResourceProperties.TurnSrvPassword !== undefined) {
    // at first deployment time no OldResourceProperties exists
    mevent.ResourceProperties.TurnSrvPassword = '****'
  }

  if (mevent.OldResourceProperties !== undefined && mevent.ResourceProperties.WebRTCProxyKey !== undefined) {
    mevent.ResourceProperties.WebRTCProxyKey = '****'
    mevent.OldResourceProperties.WebRTCProxyKey = '****'
  }
  else if (mevent.Parameters !== undefined && mevent.Parameters.some(k => k.ParameterKey === 'WebRTCProxyKey')) {
    mevent.Parameters.filter(k => k.ParameterKey === 'WebRTCProxyKey')[0].ParameterValue = '****'
  }
  else if (mevent.ResourceProperties.WebRTCProxyKey !== undefined) {
    // at first deployment time no OldResourceProperties exists
    mevent.ResourceProperties.WebRTCProxyKey = '****'
  }

  if (mevent.OldResourceProperties !== undefined && mevent.ResourceProperties.DBpassword !== undefined) {
    mevent.ResourceProperties.DBpassword = '****'
    mevent.OldResourceProperties.DBpassword = '****'
  }
  else if (mevent.Parameters !== undefined && mevent.Parameters.some(k => k.ParameterKey === 'DBUserPasswd')) {
    mevent.Parameters.filter(k => k.ParameterKey === 'DBUserPasswd')[0].ParameterValue = '****'
  }
  else if (mevent.ResourceProperties.DBpassword !== undefined) {
    // at first deployment time no OldResourceProperties exists
    mevent.ResourceProperties.DBpassword = '****'
  }

  return mevent
}

async function getallssmparameterhistory (commonshared, ssmclient, GetParameterHistoryCommand, ddclient, PutItemCommand, parametername) {
  var parametersarray = []
  var NextToken

  do {
    var batchofparameters = await getbatchofparametersHistory(ssmclient, GetParameterHistoryCommand, parametername, NextToken)

    if (batchofparameters.Result === 'PASS') {
      if (batchofparameters.Data.NextToken !== undefined) {
        NextToken = batchofparameters.Data.NextToken
      }
    }
    else {
      var ssmallparamhistoryresult = parametername + ':  SSM Parameter retrieval failed.Because ' + batchofparameters.Data
      var details = {
        source: 'jobproducer.js:getallssmparameterhistory',
        message: ssmallparamhistoryresult
      }
      await commonshared.AddDDBEntry(ddclient, PutItemCommand, 'Logverz-Invocations', 'GetParameter', 'Error', 'Infra', details, 'API')
    }

    parametersarray = parametersarray.concat(batchofparameters.Data.Parameters)
  } while (batchofparameters.Data.NextToken !== undefined)

  return parametersarray.slice(-3) // return last 3 item.
}

async function getbatchofparametersHistory (ssmclient, GetParameterHistoryCommand, parametername, NextToken) {
  if (NextToken) {
    var params = {
      Name: parametername,
      // required
      NextToken,
      MaxResults: 50,
      WithDecryption: false
    }
  }
  else {
    var params = {
      Name: parametername,
      // required
      MaxResults: 50,
      WithDecryption: false
    }
  }

  const command = new GetParameterHistoryCommand(params)
  try {
    const data = await ssmclient.send(command)
    var result = {
      Result: 'PASS',
      Data: data
    }
    return result
  }
  catch (err) {
    var result = {
      Result: 'Fail',
      Data: err
    }
    return result
  }
}

function matchexecutionwithparameterhistory (executionhistory, S3Folders, TableParameters) {
  var match = false

  for (var i = executionhistory.length-1; i >= 0; i--) {
    var oneexecutionarray = executionhistory[i]
    oneexecutionarray.Value.split('\n')

    var EHTableParameters = oneexecutionarray.Value.split('\n').filter(s => s.includes('TableParameters'))[0].replace('TableParameters:', '').replace(';', '')
    var EHS3Folders = oneexecutionarray.Value.split('\n').filter(s => s.includes('S3Folders'))[0].replace('S3Folders:', '').replace(';', '')
    if (EHTableParameters === TableParameters && EHS3Folders === S3Folders) {
      match = oneexecutionarray
      console.log('match found')
      break
    }
    else {
      console.log('match false')
    }
  }

  return match
}

const CFNExecutionIdentity = async (commonshared, ssmclient, GetParameterHistoryCommand, ddclient, PutItemCommand, ExecutionHistory, S3Folder, TableParameters) => {

  console.log('Debug: At CloudFormation Start')
  // in case of cloudformation, execution information is not availabe in the context, hence username (that iniated execution) is looked up from the history.
  var retries = [1, 2, 3, 4]
  // Result can be delayed hence the retry
  for await (var attempt of retries) {
    // user name who invoked the job is retrieved from Execution history
    console.log('Attempt ' + attempt + ' of retriving the user from execution history')
    // do try catch here

    var executionhistory = await getallssmparameterhistory(commonshared, ssmclient, GetParameterHistoryCommand, ddclient, PutItemCommand, ExecutionHistory)

    // result may not be the last item in case of frequent invocations hence the matching
    var match = matchexecutionwithparameterhistory(executionhistory, S3Folder, TableParameters)
    if (match !== false) {
      break
    }
    else {
      await timeout(4000)
    }
  }

  if (match === false) {

    var result = {
      Result: 'Fail',
      message: 'Something went wrong cloud not determine the user making the call. As no match was found in the Execution history.'
    }
  }
  else {
    var lastmodifieduserarn = match.LastModifiedUser

    if (lastmodifieduserarn.match(':root') !== null) {
      var username = 'root' // root ||admin
    }
    else {
      var username = lastmodifieduserarn.split('/')[1]
    }
    var usertype = 'UserAWS'

    var result = {
      Result: 'PASS',
      username,
      usertype
    }
  }
  return result
}

const JobExecutionAuthorization = async (_, authenticationshared, commonshared, docClient, QueryCommand, identity, identityresult, S3Folder ) => {

  var userattributes = identity.chain().find({
    Type: identityresult.usertype,
    Name: identityresult.username
  }).collection.data[0] 

  if (userattributes === undefined) {
    userattributes = await authenticationshared.getidentityattributes(docClient, QueryCommand, identityresult.username, identityresult.usertype)
    userattributes = userattributes.Items[0]

    if (userattributes !== undefined) {
      identity.insert(userattributes)
    }
  }

  if (userattributes !== undefined) {
    // Doing S3 authorization here.
    var S3Folder = S3Folder.replace('S3Folders:', '')
    var S3Foldersarray = _.compact(S3Folder.split(';'))
    var message = authenticationshared.authorizeS3access(_, commonshared, userattributes, S3Foldersarray)
  }
  else {
    var message=  'User ' + username + ' does not exists in DynamoDB Logverz-Identities table. Could not check entitlement to validate access request.\nIdentity Sync may be needed.'
  }
  
  return message
}

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const invokelambda =async (lmdclient, InvokeCommand, clientcontext, FunctionName) =>{
  
  const lambdaparams = {
    ClientContext: clientcontext, // .toString('base64'),
    //FunctionName: WorkerFunction,
    FunctionName,
    InvocationType: 'RequestResponse', // "RequestResponse" || "Event" // bydefault Requestreponse times out after 120 sec, hence the timout 900 000 value
    LogType: 'None'
  }

  const command = new InvokeCommand(lambdaparams)
  const result =await lmdclient.send(command)
  return result
}

const RecordQuery = async (_, ddclient, PutItemCommand, commonshared, onejob, selectedcontroller, type) => {

  var StgProperties={}
  if(onejob.TableParameters.stringValue!=undefined) {
    //used for Master controller SQS automatic invocation of master controller.
    StgProperties = JSON.parse(onejob.StgProperties.stringValue)
    var TableParameters = onejob.TableParameters.stringValue.split('<!!>')
    var DBvalue = onejob.DatabaseParameters.stringValue.split('<!!>')
    var Query = JSON.parse(onejob.Query.stringValue)
    //var datatype =onejob.QueryType.stringValue
    var datatype = JSON.stringify(Query.DataType).replaceAll('"','')
    //var QueryString =onejob.QueryString.stringValue
    var QueryString =JSON.stringify(Query.QueryString)
   // var JobID = onejob.JobID.stringValue
    var JobID = JSON.stringify(Query.JobID)
  }
  else{
    //used for continous collection 
    StgProperties.StgFolders = onejob.S3parameters
    var TableParameters = onejob.TableParameters.split('<!!>')
    var DBvalue = onejob.DatabaseParameters.split('<!!>')
    var datatype =onejob.DataTypeSelector
    var QueryString =onejob.QueryString
    var JobID = 'continous_collection'
  }
  

  var DDBTableName = 'Logverz-Queries'

  var d = new Date()
  var weeknumber = getWeekNumber(d) // new Date()
  var hours = d.getHours()
  var minutes = d.getMinutes()

  var UsersQuery = commonshared.propertyvaluelookup(TableParameters.filter(t => t.includes('Creator')))
  var TableOwners = _.uniqWith((UsersQuery + ',' + commonshared.propertyvaluelookup(TableParameters.filter(t => t.includes('TableOwners')))).split(','), _.isEqual)
  var TableAccess = (commonshared.propertyvaluelookup(TableParameters.filter(t => t.includes('TableAccess')))).split(',')
  var QueryName = commonshared.propertyvaluelookup(TableParameters.filter(t => t.includes('TableName'))) + '-W' + weeknumber[1] + getdayName(d) + 'T' + hours + ':' + minutes
  var DatabaseName = DBvalue.filter(s => s.includes('LogverzDBFriendlyName'))[0].split('=')[1]

  var QuerySettings = {
    QueryString,
    ComputeEnvironment: selectedcontroller,
    JobID,
    StgFolders: StgProperties.StgFolders,
    Description: commonshared.propertyvaluelookup(TableParameters.filter(t => t.includes('TableDescription')))
  }

  var params = {
    Item: {
      UsersQuery: {
        S: (UsersQuery)
      }, // +"-Collection"
      UnixTime: {
        N: Date.now().toString()
      },
      QueryName: {
        S: QueryName
      }, // tablename+timeformat
      QueryType: {
        S: type
      }, // Collection
      TableName: {
        S: (TableParameters.filter(t => t.includes('TableName'))[0].split('=')[1])
      },
      DatabaseName: {
        S: DatabaseName
      },
      DataType: {
        S: datatype
      },
      QuerySettings: {
        M: {}
      },
      Access: {
        L: []
      },
      Owners: {
        L: []
      },
      Active: {
        BOOL: true
      },
      Archive: {
        BOOL: false
      }
    },
    ReturnConsumedCapacity: 'TOTAL',
    TableName: DDBTableName
  }

  var i
  for (i = 0; i < Object.keys(QuerySettings).length; i++) {
    var Name = Object.keys(QuerySettings)[i]
    var Value = QuerySettings[Name]
    params.Item.QuerySettings.M[Name] = {
      S: Value
    }
  }

  for (var j = 0; j < TableOwners.length; j++) {
    var oneowner = {
      S: TableOwners[j]
    }
    params.Item.Owners.L.push(oneowner)
  }

  for (var k = 0; k < TableAccess.length; k++) {
    if (TableAccess[k] !== '') { // checking for empty string (Table access not set)
      var oneaccess = {
        S: TableAccess[k]
      }
      params.Item.Access.L.push(oneaccess)
    }
  }

  const command = new PutItemCommand(params)
  return await ddclient.send(command)
}

function getWeekNumber (d) {
  // Copy date so don't modify original
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  // Set to nearest Thursday: current date + 4 - current day number
  // Make Sunday's day number 7
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  // Get first day of year
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  // Calculate full weeks to nearest Thursday
  var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  // Return array of year and week number
  return [d.getUTCFullYear(), weekNo]
}

function getdayName (d) {
  var weekday = new Array(7)
  weekday[0] = 'Sun'
  weekday[1] = 'Mon'
  weekday[2] = 'Tue'
  weekday[3] = 'Wed'
  weekday[4] = 'Thu'
  weekday[5] = 'Fri'
  weekday[6] = 'Sat'
  return weekday[d.getDay()]
}


export {
  getssmparameter, setssmparameter, receiveSQSMessage, makeid, timeConverter, AddDDBEntry, SelectDBfromRegistry, 
  DBpropertylookup, ValidateToken, apigatewayresponse, newcfnresponse, getquerystringparameter,
  eventpropertylookup, propertyvaluelookup, getcookies, S3GET, s3putdependencies, emptybucket,
  GroupAsgInstances, GetEC2InstancesMetrics, GetRDSInstancesMetrics, CreatePeriod, average, getbuildstatus,
  walkfolders, TransformInputValues, ASGstatus, deactivatequery, masktoken, maskcredentials, CFNExecutionIdentity,
  JobExecutionAuthorization, invokelambda, RecordQuery
}
