  var Peer = require('../node_modules/simple-peer');
  const qs = require('../node_modules/qs');
  var CryptoJS = require("crypto-js");
  const END_OF_FILE_MESSAGE = 'EOF';
  var receivedBuffers = [];

  var peer;
  //global.config;
  //Test 1 Establishing P2P connection
  document.getElementById('connect').addEventListener('click',function () { 

      if(document.getElementById('TurnSrv').value==""){
        //direct connection
         config={
          initiator: true,
          trickle: false,
          objectMode: false
        }
      }else{
        // uses specified turnserver
         config={
          initiator: true,
          trickle: false,
          objectMode: false,
          //config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478?transport=udp' }] },
          config: { 
            iceServers: [
              {urls: ('turn:'+document.getElementById('TurnSrv').value),
              credential: document.getElementById('TurnSrvPassword').value,
              username: document.getElementById('TurnSrvUser').value},
              {urls: ('stun:'+document.getElementById('TurnSrv').value)}
          ]}
        }
      }

      console.log("The config: ")
      console.log(config)
      peer = new Peer(config)

       
      peer.on('signal',  async function (data2) {
         
          var host= document.getElementById('host').value
          var urlpath= document.getElementById('urlpath').value
          var key=document.getElementById('httpeckey').value
          
          if(key!=""){
            var ciphertext = CryptoJS.AES.encrypt(JSON.stringify(data2), key).toString(); //key
            var payload=qs.stringify({"ec":{"offer":ciphertext}});
          }
          else{
            var payload=JSON.stringify(data2);
          }
          console.log("The signal:")
          console.log(data2)
          if(data2.type=="offer"){

              await fetch(host+urlpath, {
                method: "POST", // *GET, POST, PUT, DELETE, etc.
                credentials: "include", // include, *same-origin, omit
                headers: {
                  'content-Type': 'application/x-www-form-urlencoded',
                  Authorization: "Bearer "+document.cookie.split(";").filter(s=>s.includes('LogverzAuthToken'))[0].split("=")[1],
                  Accept: 'application/json, text/plain, */*'

                },
                body: payload // body data type must match "Content-Type" header
              })
              .then((result) => result.text())
              .then((data) => {                  
                  //we need this if we directly communicate with the proxy server, 
                  //if its going through the api gateway its https so no need for encryption.
                  if (host.includes("http://")){
                    var bytes  = CryptoJS.AES.decrypt(data,key);
                        response= bytes.toString(CryptoJS.enc.Utf8);
                  }
        
                  document.getElementById('yourId').value =  JSON.stringify(data2);
                  document.getElementById('otherId').value =  JSON.stringify(response);
                  peer.signal(response)
                  })
          }
      })

      peer.on('data', function (data) {
        
        try {

          var decodedstring=String.fromCharCode.apply(null, data);
          if (decodedstring !== END_OF_FILE_MESSAGE) {
            document.querySelector('#ServerMessage').textContent +=decodedstring  + '\n';
          } 
          
        } catch (err) {
          console.log('File transfer failed:\n'+JSON.stringify(err));
        }
      })

      peer.on('connect', () => {
          console.log('P2/Server CONNECTed\n'+'id:'+JSON.stringify(peer._id)+'\nChannelname:'+peer.channelName);

      })

      peer.on('close', () => {
        console.log('The server connection closed')
      })

      peer.on('error', (err) => {
        console.log('The following error happened:'+JSON.stringify(err));
      })

  })

  //Test 2 Echo.
  document.getElementById('send1').addEventListener('click', function () {
      //var EchoMessage = {"echo":('"'+document.getElementById('EchoMessage').value+'"')}
      var EchoMessage = JSON.stringify({"echo":document.getElementById('EchoMessage').value})
      peer.send(EchoMessage)
  })

  //Test 3 Querying DB.
  document.getElementById('send2').addEventListener('click', function () {
    var SQLQuery = JSON.stringify({"query":document.getElementById('SQLQuery').value})
    peer.send(SQLQuery)
  })

  document.getElementById('getstats').addEventListener('click', function () {
      //https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_Statistics_API
      //https://github.com/feross/simple-peer/issues/470
    peer._pc.getStats().then(stats => {
      var statsOutput = "";
      stats.forEach(report => {
          Object.keys(report).forEach(statName => {
            statsOutput += `<strong>${statName}:</strong> ${report[statName]}<br>\n`;
          });
      })
      //document.getElementById(".stats-box").innerHTML =statsOutput;
      
      document.getElementById("myPopup").innerHTML =statsOutput;
      console.log(statsOutput)
    })
  });
  //browserify index.js -o bundle.js
  //terser bundle.js >bundle.min.js
  //rollup --config ./rollup.config.js --bundleConfigAsCjs
  global.END_OF_FILE_MESSAGE=END_OF_FILE_MESSAGE
  //global.config=config;