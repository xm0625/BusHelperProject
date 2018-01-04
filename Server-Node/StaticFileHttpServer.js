const connect = require("connect");
const serveStatic = require("serve-static");

var startServer = function(path, port){
    var server = connect();
    server.use(serveStatic(path));
    server.listen(port);
};

exports.startServer = startServer;
