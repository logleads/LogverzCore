var app = require('express')();
var bodyParser = require('body-parser');
var http = require('http').createServer(app);
var p2pconnection =require('./p2pconnection');

app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.get('/:name', (req, res) => {
  res.sendFile(__dirname + "\\"+req.params.name);
});

app.post('/', p2pconnection.p2pconnection);

http.listen(3000, () => {
  console.log('listening on *:3000');
});
