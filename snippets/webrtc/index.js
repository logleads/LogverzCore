  const axios = require('axios');
  var Peer = require('simple-peer');
  const qs = require('qs');
  var peer;
  
  document.getElementById('connect').addEventListener('click',function () { 

      peer = new Peer({
        initiator: true,
        trickle: false
      })

      peer.on('signal',  async function (data2) {
          document.getElementById('yourId').value =  JSON.stringify(data2)
          var answer= await axios({
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              method: 'POST',
              port:3000,
              host:'127.0.0.1',
              url: '/',
              data:qs.stringify({"offer":data2})
            })
            
          document.getElementById('otherId').value =  JSON.stringify(answer.data)
          peer.signal(answer.data)
      })

      peer.on('data', function (data) {
          document.querySelector('#ServerMessage').textContent +=data  + '\n'
      })

      peer.on('connect', () => {
          console.log('P2/Server CONNECTed')
      })

  })


  document.getElementById('send').addEventListener('click', function () {
    var yourMessage = document.getElementById('yourMessage').value
    peer.send(yourMessage)
  })
  
  //browserify index.js -o bundle.js
  //terser bundle.js >bundle.min.js