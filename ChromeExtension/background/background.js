currentTarget = "bg";

var serverUrl = "ws://192.168.0.100:8889";
var webSocketClient = null;
var running = false;
var startTime = {hour: 17, min: 28};
var endTime = {hour: 18, min: 30};
var lastNotificationId = null;

function setBadgeText(text){
    chrome.browserAction.setBadgeText({text: text});
}

function getTime(){
    var now = new Date();
    var hour=now.getHours()<10?"0"+now.getHours():now.getHours();
    var minute=now.getMinutes()<10?"0"+now.getMinutes():now.getMinutes();
    return {hour: hour, min: minute};
}

function getMinutesBetween(startTime, endTime){
    return (endTime.hour-startTime.hour)*60 + (endTime.min-startTime.min)
}


function init(){
    chrome.browserAction.setPopup({popup:"page/popup/switchStatePage.html"});

    initWebSocketClient();

    planLoopChecker();
}

function planLoopChecker(){
    var nextStartMinutes = getMinutesBetween(getTime(), startTime);
    var nextStopMinutes = getMinutesBetween(getTime(), endTime);
    if(nextStartMinutes<=0 && nextStopMinutes>=0){
        changeRunningState(true);
    }else{
        changeRunningState(false);
    }

    if(nextStartMinutes<=0){
        nextStartMinutes = nextStartMinutes + 24*60;
    }

    if(nextStopMinutes<0){
        nextStopMinutes = nextStartMinutes + 24*60;
    }

    var nextCheckTimeout = (nextStartMinutes<=10 || nextStopMinutes<=10)?(30 * 1000):(10 * 60 * 1000);
    setTimeout(loopChecker, nextCheckTimeout);
}

function switchRunningState(){
    if(running){
        changeRunningState(false);
        return;
    }
    changeRunningState(true);
}



function changeRunningState(runningState){
    if(runningState && !running){
        //如果需要打开但未运行
        running = true;
        webSocketClient.connect();
    }
    if(!runningState && running){
        running = false;
        webSocketClient.disconnect();
    }
    if(running){
        setBadgeText("On");
    }else{
        setBadgeText("Off");
    }
}

function initWebSocketClient(){
    webSocketClient = CreateWebSocketClient(serverUrl, function(event){
        console.log(event);
        try{
            var messageMap = JSON.parse(event.data);
            if(!("messageType" in messageMap)){
                return;
            }
            var messageType = messageMap["messageType"];
            if(messageType == "busStateList"){
                var message = "";
                var busStateList = messageMap["data"]["busStateList"];
                if(busStateList.length==0){
                    setBadgeText("--");
                    sendNotification("等待发车");
                    return;
                }
                var firstBusState = busStateList[0];
                setBadgeText(firstBusState["busStopNumber"]+"");
                message = message + "下一班车:"+ generateBusStateMessage(firstBusState);
                var secondBusState = busStateList.length>=2?busStateList[1]:null;
                if(secondBusState == null){
                    sendNotification(message);
                    return;
                }
                message = message + "\n下下一班车:"+ generateBusStateMessage(secondBusState);
                sendNotification(message);

                console.log(busStateList);
                return;
            }
            if(messageType == "greeting"){
                console.log("connected");
                return;
            }
            console.log("messageType:" + messageType);
        }catch(e){
            console.log(e);
        }
    });
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

function sendNotification(message){
    if(lastNotificationId!=null){
        chrome.notifications.clear(lastNotificationId);
    }
    lastNotificationId = Math.random()*100000000000000000+"";
    chrome.notifications.create(lastNotificationId, {
        type: "basic",
        iconUrl: "../icons/icon128.png",
        title: "上车提醒",
        message: message,
        eventTime: Date.now()
    });
}


init();


