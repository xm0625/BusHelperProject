const SimpleHttpServer = require("./SimpleHttpServer");
const StaticFileHttpServer = require("./StaticFileHttpServer");
const businessError = SimpleHttpServer.businessError;
const WebSocket = require('ws');
const fs = require('fs');
const request = require("superagent");

/**
 * 全局final变量
 * */
const REPORT_API_TOKEN = "ThisIsToken";
const START_TIME = {hour: 17, min: 20};
const END_TIME = {hour: 18, min: 30};
const STATIC_HTTP_SERVER_URL = "http://192.168.0.100:8808";
/**
 * //全局final变量
 * */

/**
 * 全局变量 分布式服务千万别用
 * */
/**公交线路ID对公交信息列表映射Map*/
var busStateMap = {
};

var lastUpdateTime = 0;
/**
 * //全局变量
 * */

var config = {
	"dingDingBot": {
		"noToDetail": {
			"demoBotNo": {
				"webHook": "xxxx",
				"wayNo": "",
				"state": false
			}
		},
		"webHookToNo": {},
		"wayNoToBotNoListMap":{
			"demoWayNo": {
				"demoBotNo": 1
			}
		}
	}
};

//TODO startTime定时开  endTime 定时置为关 最后开启日 最后关闭日

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
	var wayNo = params["wayNo"];
	var oldBusStateList = wayNo in busStateMap?busStateMap[wayNo]:[];
	var newBusStateList = JSON.parse(params["busStateList"]);
	busStateMap[wayNo] = newBusStateList;
	lastUpdateTime = new Date().getTime();
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
				setTimeout(function(){
					pushBusStateListMessage(newBusStateList);
				}, 1);
				setTimeout(function(){
					pushDingDingBotMessage(wayNo, newBusStateList);
				}, 1);
				return;
			}
		}
	}, 1);
	dtd.resolve();
});

SimpleHttpServer.addRoute("/getBusStateListByWayNo", ["GET", "POST"], function(params, dtd, req){
	var busStateList = params["wayNo"] in busStateMap?busStateMap[params["wayNo"]]:[];

	dtd.resolve({"busStateList": busStateList});
});

SimpleHttpServer.addRoute("/dingDingBot/add", ["GET", "POST"], function(params, dtd, req){
	if(!("wayNo" in params)){
		throw businessError("wayNo is empty");
	}
	var wayNo = params["wayNo"];
	if(!("webHook" in params)){
		throw businessError("webHook is empty");
	}
	var webHook = params["webHook"];
	if(webHook in config["dingDingBot"]["webHookToNo"]){
		throw businessError("webHook already exist");
	}
	var botNo = Math.random()*100000000000000000+"";
	config["dingDingBot"]["noToDetail"][botNo] = {
		"webHook": webHook,
		"wayNo": wayNo,
		"state": true
	};
	config["dingDingBot"]["webHookToNo"][webHook] = botNo;

	if(!(wayNo in config["dingDingBot"]["wayNoToBotNoListMap"])){
		config["dingDingBot"]["wayNoToBotNoListMap"][wayNo] = {};
	}
	config["dingDingBot"]["wayNoToBotNoListMap"][wayNo][botNo] = 1;

	setTimeout(saveConfig, 50);

	dtd.resolve({});
});

SimpleHttpServer.addRoute("/dingDingBot/mute", ["GET", "POST"], function(params, dtd, req){
	if(!("botNo" in params)){
		throw businessError("botNo is empty");
	}
	var botNo = params["botNo"];
	config["dingDingBot"]["noToDetail"][botNo]["state"] = false;

	setTimeout(saveConfig, 50);

	dtd.resolve({});
});

SimpleHttpServer.addRoute("/dingDingBot/unMute", ["GET", "POST"], function(params, dtd, req){
	if(!("botNo" in params)){
		throw businessError("botNo is empty");
	}
	var botNo = params["botNo"];

	config["dingDingBot"]["noToDetail"][botNo]["state"] = true;

	setTimeout(saveConfig, 50);
	dtd.resolve({});
});

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

function pushDingDingBotMessage(wayNo, busStateList){
	if(!(wayNo in config["dingDingBot"]["wayNoToBotNoListMap"])){
		return;
	}

	var message = generateMsgFromBusStateList(busStateList);

	var botNoListMap = config["dingDingBot"]["wayNoToBotNoListMap"][wayNo];
	for(var botNo in botNoListMap){
		if(!(botNo in config["dingDingBot"]["noToDetail"])){
			continue;
		}
		var dingDingBotDetail = config["dingDingBot"]["noToDetail"][botNo];
		if(dingDingBotDetail["state"]){
			var postData = JSON.stringify(
				{
					"actionCard": {
						"title": message,
						"text": message,
						"hideAvatar": "0",
						"btnOrientation": "0",
						"btns": [
							{
								"title": "停止播报",
								"actionURL": STATIC_HTTP_SERVER_URL+"/action.html?action=mute&botNo="+botNo
							},
							{
								"title": "重新开启",
								"actionURL": STATIC_HTTP_SERVER_URL+"/action.html?action=unMute&botNo="+botNo
							}
						]
					},
					"msgtype": "actionCard"
				});
			console.log("postData:"+postData);
			request.post(dingDingBotDetail["webHook"]).set('Content-Type', 'application/json').send(postData).then(function(res) {
				console.log('res:' + JSON.stringify(res.body));
			});
		}
	}
}

function generateMsgFromBusStateList(busStateList){
	var message = "";
	if(busStateList.length==0){
		return "等待发车"
	}
	var firstBusState = busStateList[0];
	message = message + "下一班车:"+ generateBusStateMessage(firstBusState);
	var secondBusState = busStateList.length>=2?busStateList[1]:null;
	if(secondBusState == null){
		return message;
	}
	message = message + "\n下下一班车:"+ generateBusStateMessage(secondBusState);
	return message;
}


function generateBusStateMessage(busState){
	var message = "";
	var busStopNumber = busState["busStopNumber"];
	if(busStopNumber>=1){
		message = message + "还有";
		var busStopNumberInt = parseInt(busStopNumber);
		message = message + busStopNumberInt + "站";
		if(busStopNumberInt!=busStopNumber){
			message = message + "半";
		}
	}
	if(busStopNumber==0.5){
		message = message + "即将";
	}
	if(busStopNumber==0){
		message = message + "已";
	}
	message = message + "到站";
	return message;
}

function loadConfig(){
	if(fs.existsSync('./config.json')){
		var content = fs.readFileSync('./config.json', {encoding: "utf-8"});
		if (content.charCodeAt(0) === 0xFEFF) {
			content = content.slice(1);
		}
		config = JSON.parse(content);
	}
}

function saveConfig(){
	fs.writeFileSync('./config.json', JSON.stringify(config), {encoding: "utf-8"})
}

loadConfig();
SimpleHttpServer.startServer(8888);
StaticFileHttpServer.startServer("./www", 8808);
