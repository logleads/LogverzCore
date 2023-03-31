var loki = require('lokijs');

// create db
var db = new loki('db.json', {
    autoupdate: true
});

exports.db = db;