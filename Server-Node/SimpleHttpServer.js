var Q = require("q");
var http = require("http");
var urlUtil = require('url');
var qsUtil = require('querystring');

var server = http.createServer();

var routeMap = {
};

var addRoute = function(pathInfo, methodList, callFunc){
    routeMap[pathInfo] = {
        "methodList": methodList,
        "callFunc": callFunc
    };
};

var responseSuccess = function(res, data){
    res.writeHead(200, {'Content-Type': 'text/plain;charset=utf-8'});
    res.write(JSON.stringify({"code": "0", "message": "", "data": data}));
    res.end();
};

var responseError = function(res, error){
    res.writeHead(200, {'Content-Type': 'text/plain;charset=utf-8'});
    res.write(JSON.stringify({"code": error["code"], "message": error["message"]}));
    res.end();
};

var businessError = function(args){
    var error = new Error();
    error.code = "-1";
    error.message = "system internal error";
    if(arguments.length=1){
        error.message = arguments[0];
    }
    if(arguments.length=2){
        error.code = arguments[0];
        error.message = arguments[1];
    }
    return error;
};

server.on("request", function(req, res){
    var queryUrl = urlUtil.parse(req.url, true);
    var pathInfo = queryUrl["pathname"];
    var remoteAddress = req.socket.remoteAddress;

    console.log(req.method+" "+pathInfo+" "+remoteAddress);

    try{
        //当路径不在路由表中时, 返回未找到
        if(!(pathInfo in routeMap)){
            throw businessError("not found");
        }

        //当路径在路由表中但请求方法不在路径里时, 返回不允许的方法
        if(routeMap[pathInfo]["methodList"].indexOf(req.method.toUpperCase()) < 0){
            throw businessError("method not allow:" + req.method.toUpperCase());
        }

        var prepareParams = Q.defer();
        if (req.method.toUpperCase() == 'GET') {
            var params = queryUrl["query"];
            prepareParams.resolve(params);
        }

        if (req.method.toUpperCase() == 'POST') {
            var postData = "";
            req.addListener("data", function (data) {
                postData += data;
            });
            req.addListener("end", function () {
                var params = qsUtil.parse(postData);
                prepareParams.resolve(params);
            });
        }
        var callFunc = routeMap[pathInfo]["callFunc"];
        prepareParams.promise.then(function(params){
            var dtd = Q.defer();
            callFunc(params, dtd, req);
            dtd.promise
                .then(function(data){
                    responseSuccess(res, data);
                });
        }).fail(function(e){
            normalErrorHandler(res, e);
        });
    }catch(e){
        normalErrorHandler(res, e);
    }
});

var normalErrorHandler = function(res, e){
    if(typeof(e["code"]) == ("string" || "number")) {
        responseError(res, e);
        return;
    }
    console.log(e);
    responseError(res, businessError());
};

var startServer = function(port){
    server.listen(port);
    return server;
};

exports.startServer = startServer;
exports.addRoute = addRoute;
exports.businessError = businessError;


//server.listen(8888);
//addRoute("/hello", ["GET", "POST"], function(params, dtd, req){
//    dtd.resolve(params);
//});

