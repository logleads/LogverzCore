var Peer = require('simple-peer')
var wrtc = require('wrtc')

exports.p2pconnection = function(req, res) {

    var peer2 = new Peer({ initiator: false,  wrtc: wrtc,objectMode: false })

    // client has sent connection offer
    var offer=req.body.offer
    peer2.signal(offer)
    
    peer2.on('signal', data => {

        //send back the ok answer
        if(data.type=="answer"){
            //console.log(JSON.stringify(data))
            res.send(data)
        }
    })    

    peer2.on('connect', async () => {
        // wait for 'connect' event before using the data channel
        for(var i = 0; i < 20; i++) {
            await timeout(2000);
            peer2.send('message: '+i+',\n')
        }
    })

    peer2.on('data', data => {
        // got a data channel message
        console.log('got a message from the browser: ' + data)
        peer2.send('message: '+data+'\n'+data+'\n')
    })
 
};

function timeout(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}