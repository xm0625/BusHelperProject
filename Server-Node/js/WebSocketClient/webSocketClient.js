//发送消息并确认发送成功
//接收消息回调

var CreateWebSocketClient = function(url, onMessageCallBack){
    var webSocketClient = {
        wsUrl: url,
        onMessageCallBack: onMessageCallBack,
        _ws : null,
        _lockReconnect: false,
        _initWebSocketEventHandle: function () {
            var self = this;
            self._ws.onclose = function () {
                self._reconnect();
            };
            self._ws.onerror = function () {
                self._reconnect();
            };
            self._ws.onopen = function () {
                //心跳检测重置
                self._heartCheckReset()._heartCheckStart();
            };
            self._ws.onmessage = function (event) {
                //如果获取到消息，心跳检测重置
                //拿到任何消息都说明当前连接是正常的
                self._heartCheckReset()._heartCheckStart();
                self.onMessageCallBack(event);
            };
        },
        _reconnect: function(){
            var self = this;
            if(self._lockReconnect){
                return;
            }
            self._lockReconnect = true;
            setTimeout(function () {
                self.connect();
            }, 2000);
        },
        heartCheckTimeout: 10000, //10秒
        _heartCheckTimeoutObj: null,
        _heartCheckServerTimeoutObj: null,
        _heartCheckReset: function(){
            clearTimeout(this._heartCheckTimeoutObj);
            clearTimeout(this._heartCheckServerTimeoutObj);
            return this;
        },
        _heartCheckStart: function () {
            var self = this;
            self._heartCheckTimeoutObj = setTimeout(function(){
                //这里发送一个心跳，后端收到后，返回一个心跳消息，
                //onmessage拿到返回的心跳就说明连接正常
                try{
                    self._ws.send(JSON.stringify({"messageType": "ping"}));
                }catch(e){
                    console.log(e);
                }
                self._heartCheckServerTimeoutObj = setTimeout(function(){//如果超过一定时间还没重置，说明后端主动断开了
                    console.log("close");
                    self._ws.close();//如果onclose会执行reconnect，我们执行ws.close()就行了.如果直接执行reconnect 会触发onclose导致重连两次
                }, self.heartCheckTimeout)
            }, self.heartCheckTimeout)
        },
        connect: function(){
            this._lockReconnect = false;
            this._ws = new WebSocket(this.wsUrl);
            this._initWebSocketEventHandle();
        },
        disconnect: function(){
            this._heartCheckReset();
            console.log("close");
            this._lockReconnect = true;
            this._ws.close();
        }
    };
    return webSocketClient;
};