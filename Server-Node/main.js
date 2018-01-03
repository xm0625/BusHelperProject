const SimpleHttpServer = require("./SimpleHttpServer");
const businessError = SimpleHttpServer.businessError;
const WebSocket = require('ws');


/**
 * 全局final变量
 * */
const REPORT_API_TOKEN = "ThisIsToken";
/**
 * //全局final变量
 * */

/**
 * 全局变量 分布式服务千万别用
 * */
/**公交线路ID对公交信息列表映射Map*/
var busStateMap = {
};
/**
 * //全局变量
 * */

var config = {};

/**
 * WebSocket Server
 * */
const wss = new WebSocket.Server({ port: 8889 });

wss.on('connection', function connection(ws, req) {
	/**
	 * 接收心跳并标记回话状态
	 * */
	ws.isAlive = true;
	var heartbeat = function(){
		//this ws
		console.log("pong");
		this.isAlive = true;
	};
	ws.on('pong', heartbeat);

	/**
	 * 接收消息
	 * */
	ws.on('message', function incoming(message) {
		console.log('received: %s', message);
		try{
			var messageMap = JSON.parse(message);
			if(!("messageType" in messageMap)){
				return;
			}
			var messageType = messageMap["messageType"];
			if(messageType == "ping"){
				ws.send(JSON.stringify({"messageType": "pong"}));
				console.log("reply pong");
				return;
			}
			console.log("unknown messageType:" + messageType);
		}catch(e){
			console.log(e);
		}
	});

	/**
	 * 连接后执行的操作
	 * */
	const ip = req.connection.remoteAddress;
	console.log('connected: %s', ip);
	ws.send(JSON.stringify({"messageType": "greeting"}));
});

const interval = setInterval(function ping() {
	wss.clients.forEach(function each(ws) {
		if (ws.isAlive === false) {
			console.log("terminate");
			return ws.terminate();
		}

		ws.isAlive = false;
		console.log("ping");
		try{
			ws.ping('', false, true);
		}catch(e){
			console.log(e);
		}
	});
}, 10000);

/**
 * Http Server
 * */
SimpleHttpServer.addRoute("/hello", ["GET", "POST"], function(params, dtd, req){
	dtd.resolve(params);
});

SimpleHttpServer.addRoute("/busStateReport", ["GET", "POST"], function(params, dtd, req){
	//验证token
	if(params["token"] != REPORT_API_TOKEN){
		throw businessError("api token not valid");
	}
	var oldBusStateList = params["wayNo"] in busStateMap?busStateMap[params["wayNo"]]:[];
	var newBusStateList = JSON.parse(params["busStateList"]);
	setTimeout(function () {
		if(oldBusStateList.length != newBusStateList.length){
			pushBusStateListMessage(newBusStateList);
			return;
		}
		for(var i in oldBusStateList){
			if(i>=2){
				break;
			}
			var oldBusState = oldBusStateList[i];
			var newBusState = newBusStateList[i];
			if(oldBusState["busStopNumber"] != newBusState["busStopNumber"]){
				pushBusStateListMessage(newBusStateList);
				return;
			}
		}
	}, 1);
	busStateMap[params["wayNo"]] = newBusStateList;
	dtd.resolve();
});

SimpleHttpServer.addRoute("/getBusStateListByWayNo", ["GET", "POST"], function(params, dtd, req){
	var busStateList = params["wayNo"] in busStateMap?busStateMap[params["wayNo"]]:[];


	dtd.resolve({"busStateList": busStateList});
});

SimpleHttpServer.startServer(8888);


function pushBusStateListMessage(busStateList){
	wss.clients.forEach(function each(ws) {
		try{
			console.log("pushBusStateListMessage");
			ws.send(JSON.stringify({"messageType": "busStateList", "data": {"busStateList": busStateList}}));
			console.log("pushBusStateListMessage success");
		}catch(e){
			console.log(e);
		}
	});
}
