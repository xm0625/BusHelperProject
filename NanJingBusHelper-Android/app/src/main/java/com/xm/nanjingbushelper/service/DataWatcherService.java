package com.xm.nanjingbushelper.service;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.ActivityManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.text.TextUtils;
import android.util.Log;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.Toast;

import com.alibaba.fastjson.JSON;
import com.xm.nanjingbushelper.util.AccessibilityServiceUtil;
import com.xm.nanjingbushelper.util.TaskUtil;

import java.io.IOException;
import java.lang.ref.WeakReference;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.FormBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

import static com.xm.nanjingbushelper.util.AccessibilityServiceUtil.findTargetNode;

/**
 * Created by xm on 2017/12/12.
 */

public class DataWatcherService extends AccessibilityService {

    public static final String PACKAGE_NAME = "com.ygkj.chelaile.standard";

    public static final String REPORT_API_TOKEN = "ThisIsToken";
    public static final String WAY_NO = "w51tyc";
    public static final String SERVER_URL = "http://192.168.0.100:8888";

    ConcurrentHashMap<Integer, String> eventTypeTransMap = new ConcurrentHashMap<>();
    WatcherThread watcherThread;

    @Override
    public void onAccessibilityEvent(AccessibilityEvent accessibilityEvent) {
        int eventType = accessibilityEvent.getEventType();
        Log.d("DataWatcherService", "onAccessibilityEvent eventType:"+(eventTypeTransMap.keySet().contains(eventType)?eventTypeTransMap.get(eventType):"unknown"));

    }

    @Override
    public void onInterrupt() {
        Log.d("DataWatcherService", "onInterrupt");
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        Log.d("DataWatcherService", "onServiceConnected");
        eventTypeTransMap.clear();
        Class accessibilityEvent = AccessibilityEvent.class;
        Field[] declaredFields = accessibilityEvent.getDeclaredFields();
        for(Field field:declaredFields){
            if(field.getName().startsWith("TYPE_") || field.getName().startsWith("CONTENT_")){
                try {
                    eventTypeTransMap.put((int)field.get(accessibilityEvent), field.getName());
                } catch (IllegalAccessException e) {
                    e.printStackTrace();
                }
            }
        }

        if(watcherThread != null){
            watcherThread.interrupt();
        }
        watcherThread = new WatcherThread(this);
        watcherThread.setDaemon(true);
        watcherThread.start();

    }

    @Override
    public void onDestroy() {
        Log.d("DataWatcherService", "onDestroy");
        watcherThread.interrupt();
        super.onDestroy();
    }

    @Override
    protected boolean onGesture(int gestureId) {
        Log.d("DataWatcherService", "onGesture");
        return super.onGesture(gestureId);
    }

    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        Log.d("DataWatcherService", "onKeyEvent");
        return super.onKeyEvent(event);
    }


    class WatcherThread extends Thread{
        private WeakReference<AccessibilityService> accessibilityServiceWeakReference;

        public WatcherThread(AccessibilityService accessibilityService) {
            this.accessibilityServiceWeakReference = new WeakReference<AccessibilityService>(accessibilityService);
        }

        @Override
        public void run() {
            super.run();

            while(!Thread.interrupted()){
                try {
                    AccessibilityService accessibilityService = accessibilityServiceWeakReference.get();
                    if(accessibilityService == null){
                        return;
                    }
                    Thread.sleep(5000);
                    killApp(accessibilityService, PACKAGE_NAME);
                    try {
                        TaskUtil.openApp(accessibilityService, PACKAGE_NAME);
                    } catch (PackageManager.NameNotFoundException e) {
                        e.printStackTrace();
                        Toast.makeText(accessibilityService, "车来了 未安装", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    boolean isNewVersionPageShown = AccessibilityServiceUtil.waitForTargetText(accessibilityService, 10, new String[]{"发现新版本", null});
                    if(isNewVersionPageShown){
                        guaranteeStepSuccess("点击取消更新按钮", AccessibilityServiceUtil.clickNode(AccessibilityServiceUtil.findTargetNode(accessibilityService, "取消", "^取消$")));
                    }
                    guaranteeStepSuccess("进入应用首页", AccessibilityServiceUtil.waitForTargetText(accessibilityService, 3, new String[]{"首页", null}, new String[]{"我的收藏", null}));
                    guaranteeStepSuccess("点击我的收藏按钮", AccessibilityServiceUtil.clickNode(AccessibilityServiceUtil.findTargetNode(accessibilityService, "我的收藏", "^我的收藏$")));
                    enterWayDetail(accessibilityService, "南理工科技园", "^.*南理工科技园$");

                    while(!Thread.interrupted()){
                        refreshCurrentPage(accessibilityService);
                        List<BusState> busStateList = fetchBusStateListWithRetry(accessibilityService);
                        if(busStateList.size()<2){
                            switchToOtherWay(accessibilityService, "终点站", "^.*终点站$");
                            //反向的公交列表 停靠时间未知 停靠站台+5 距离+3000
                            List<BusState> comingBusStateList = fetchBusStateListWithRetry(accessibilityService);
                            for(BusState busState:comingBusStateList){
                                busState.setArrivalTimeInSecond(-1);
                                busState.setBusStopNumber(busState.getBusStopNumber()+5);
                                busState.setDistanceMeter(busState.getDistanceMeter()+3000);
                            }
                            busStateList.addAll(comingBusStateList);
                            switchToOtherWay(accessibilityService, "南理工科技园", "^.*南理工科技园$");
                        }

                        Log.d("WatcherThread", "busStateList:"+ JSON.toJSONString(busStateList));
                        postBusStateList(busStateList);
                        Thread.sleep(1000);
                    }

                    return;
                } catch (UnExpectStepException ue){
                    Log.e("WatcherThread", "由该错误引发重试："+ue.getMessage());
                } catch (InterruptedException e) {
                    e.printStackTrace();
                    return;
                }
            }
        }

        private void postBusStateList(List<BusState> busStateList) {
            OkHttpClient mOkHttpClient=new OkHttpClient();
            RequestBody formBody = new FormBody.Builder()
                    .add("token", REPORT_API_TOKEN)
                    .add("wayNo", WAY_NO)
                    .add("busStateList", JSON.toJSONString(busStateList))
                    .build();
            Request request = new Request.Builder()
                    .url(SERVER_URL+"/busStateReport")
                    .post(formBody)
                    .build();
            Call call = mOkHttpClient.newCall(request);
            call.enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {

                }
                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    Log.d("WatcherThread", "postBusStateList success");
                }
            });
        }

        class BusState{
            private Float busStopNumber;
            private Integer distanceMeter;
            private Integer arrivalTimeInSecond;
            private Boolean online;

            public BusState() {
            }

            public BusState(Float busStopNumber, Integer distanceMeter, Integer arrivalTimeInSecond, Boolean online) {
                this.busStopNumber = busStopNumber;
                this.distanceMeter = distanceMeter;
                this.arrivalTimeInSecond = arrivalTimeInSecond;
                this.online = online;
            }

            public Float getBusStopNumber() {
                return busStopNumber;
            }

            public void setBusStopNumber(Float busStopNumber) {
                this.busStopNumber = busStopNumber;
            }

            public Integer getDistanceMeter() {
                return distanceMeter;
            }

            public void setDistanceMeter(Integer distanceMeter) {
                this.distanceMeter = distanceMeter;
            }

            public Integer getArrivalTimeInSecond() {
                return arrivalTimeInSecond;
            }

            public void setArrivalTimeInSecond(Integer arrivalTimeInSecond) {
                this.arrivalTimeInSecond = arrivalTimeInSecond;
            }

            public Boolean getOnline() {
                return online;
            }

            public void setOnline(Boolean online) {
                this.online = online;
            }
        }

        private List<BusState> fetchBusStateListWithRetry(AccessibilityService accessibilityService) throws UnExpectStepException, InterruptedException {
            int retryTime = 0;
            while(true) {
                try {
                    return getBusStateList(accessibilityService);
                } catch (UnExpectStepException e) {
                    retryTime++;
                    if(retryTime<3){
                        refreshCurrentPage(accessibilityService);
                        Thread.sleep(500);
                        continue;
                    }
                    throw e;
                }
            }
        }

        private List<BusState> getBusStateList(AccessibilityService accessibilityService) throws UnExpectStepException {
            try {
                List<BusState> busStateList = new ArrayList<>();

                //判断当前的到站公交指示牌的块数
                //等待发车 不计数
                //已到站 不计数
                //即将到站 1站
                //正常／掉线 n站

                //判断是否是等待发车
                boolean isWaitSending = (AccessibilityServiceUtil.findTargetNode(accessibilityService, "等待发车", null) != null);
                //如果等待发车，则当前页公交信息列表为空，直接返回
                if(isWaitSending){
                    return busStateList;
                }
                //如果不是等待发车

                //找到Bus信息显示区域
                AccessibilityNodeInfo busInfoParentNode = AccessibilityServiceUtil.findNodeById(accessibilityService.getRootInActiveWindow(), PACKAGE_NAME, "cll_dash_buses");
                int busInfoNodeCount = busInfoParentNode.getChildCount();
                for(int i = 0; i < busInfoNodeCount; i++){
                    AccessibilityNodeInfo busInfoNode = busInfoParentNode.getChild(i);

                    //需要从子节点中分析出以下数据
                    float busStopNumber = 0;
                    int distanceMeter = 0;
                    int arrivalTimeInSecond = 0;
                    boolean online = true;

                    //判断是否延迟
                    online = (AccessibilityServiceUtil.findNodeByText(busInfoNode, "延迟", "^延迟.*$") == null);
                    if(!online){
                        AccessibilityServiceUtil.clickNode(AccessibilityServiceUtil.findNodeByText(busInfoNode, "延迟", "^延迟.*$"));
                    }

                    //判断是否到站
                    String arrivalTimeFirstPartString = AccessibilityServiceUtil.findNodeById(busInfoNode, PACKAGE_NAME, "cll_time_num").getText().toString();
                    //如果已经到站
                    if("已到站".equals(arrivalTimeFirstPartString)){
                        busStopNumber = 0;
                        distanceMeter = 0;
                        arrivalTimeInSecond = 0;

                        busStateList.add(new BusState(busStopNumber, distanceMeter, arrivalTimeInSecond, online));
                        continue;
                    }
                    //如果没有到站
                    int arrivalTimeFirstPartNumber = Integer.parseInt(arrivalTimeFirstPartString);
                    //取到时间单位
                    String arrivalTimeSecondPartString = AccessibilityServiceUtil.findNodeById(busInfoNode, PACKAGE_NAME, "cll_time_unit").getText().toString();
                    //根据单位计算到站秒数，目前只考虑了秒和分，其他单位按秒算
                    arrivalTimeInSecond = arrivalTimeFirstPartNumber;
                    if("分".equals(arrivalTimeSecondPartString)){
                        arrivalTimeInSecond = arrivalTimeFirstPartNumber * 60;
                    }
                    //取到到站数和距离
                    String busStopAndDistanceString = AccessibilityServiceUtil.findNodeById(busInfoNode, PACKAGE_NAME, "cll_bus_gallery_item_row_text").getText().toString();
                    Log.d("WatcherThread", "busStopAndDistanceString:" + busStopAndDistanceString);
                    String busStopString = busStopAndDistanceString.substring(0, busStopAndDistanceString.indexOf("站"));
                    if("即将到".equals(busStopString)){
                        busStopNumber = 0;
                    }else{
                        busStopNumber = Integer.parseInt(busStopString);
                    }
                    busStopNumber = busStopNumber + 0.5f;
                    Log.d("WatcherThread", "busStopString:" + busStopString);
                    if(busStopAndDistanceString.contains("km")){
                        String distanceString = busStopAndDistanceString.substring(busStopAndDistanceString.indexOf("/")+1, busStopAndDistanceString.length()-2).trim();
                        distanceMeter = (int)(Float.parseFloat(distanceString)*1000);
                    }else{
                        String distanceString = busStopAndDistanceString.substring(busStopAndDistanceString.indexOf("/")+1, busStopAndDistanceString.length()-1).trim();
                        distanceMeter = Integer.parseInt(distanceString);
                    }
                    busStateList.add(new BusState(busStopNumber, distanceMeter, arrivalTimeInSecond, online));
                }

                return busStateList;
            }catch (Exception e){
                e.printStackTrace();
                throw new UnExpectStepException("获取Bus状态失败");
            }
        }

        private void refreshCurrentPage(AccessibilityService accessibilityService) throws UnExpectStepException, InterruptedException {
            guaranteeStepSuccess("点击刷新按钮", AccessibilityServiceUtil.clickNode(findTargetNode(accessibilityService, "刷新", "^刷新$")));
            guaranteeStepSuccess("等待站台详情页刷新完毕", AccessibilityServiceUtil.waitForTargetText(accessibilityService, 10, new String[]{"票价", null}, new String[]{"换向", null}, new String[]{"刷新", null}));
        }

        private void switchToOtherWay(AccessibilityService accessibilityService, String wayKeyWord, String wayRegExp) throws UnExpectStepException, InterruptedException {
            accessibilityService.performGlobalAction(GLOBAL_ACTION_BACK);
            enterWayDetail(accessibilityService, wayKeyWord, wayRegExp);
        }

        private void enterWayDetail(AccessibilityService accessibilityService, String wayKeyWord, String wayRegExp) throws UnExpectStepException, InterruptedException {
            guaranteeStepSuccess("进入收藏页", AccessibilityServiceUtil.waitForTargetText(accessibilityService, 3, new String[]{"全部", null}, new String[]{"上班", null}, new String[]{"回家", null}));
            guaranteeStepSuccess("点击"+wayKeyWord+"站台", AccessibilityServiceUtil.clickNode(AccessibilityServiceUtil.findTargetNode(accessibilityService, wayKeyWord, wayRegExp)));
            guaranteeStepSuccess("进入"+wayKeyWord+"站台详情页", AccessibilityServiceUtil.waitForTargetText(accessibilityService, 10, new String[]{"票价", null}, new String[]{"换向", null}, new String[]{"刷新", null}));
        }

        private void guaranteeStepSuccess(String stepName, boolean stepSuccess) throws UnExpectStepException{
            if(!stepSuccess){
                throw new UnExpectStepException(stepName+ "失败");
            }
        }


        private void killApp(AccessibilityService accessibilityService, String packageName) throws InterruptedException, UnExpectStepException {
            accessibilityService.performGlobalAction(GLOBAL_ACTION_HOME);
            Thread.sleep(1000);
            TaskUtil.jumpToPackageDetail(accessibilityService, packageName);
            guaranteeStepSuccess("进入应用详情页", AccessibilityServiceUtil.waitForTargetText(accessibilityService, new String[]{"应用信息", null}, new String[]{"版本", null}));
            guaranteeStepSuccess("点击强行停止按钮", AccessibilityServiceUtil.clickNode(findTargetNode(accessibilityService, "强行停止", null)));
            guaranteeStepSuccess("弹出强行停止确认对话框", AccessibilityServiceUtil.waitForTargetText(accessibilityService, new String[]{"导致", null}, new String[]{"确定", null}));
            guaranteeStepSuccess("点击强行停止确认对话框确认按钮", AccessibilityServiceUtil.clickNode(findTargetNode(accessibilityService, "确定", "^确定$")));
            accessibilityService.performGlobalAction(GLOBAL_ACTION_BACK);
            Thread.sleep(1000);
        }

    }

    private class UnExpectStepException extends Exception{
        private String message = "";

        public UnExpectStepException(String message) {
            this.message = message;
        }

        @Override
        public String getMessage() {
            return message;
        }

        public void setMessage(String message) {
            this.message = message;
        }
    }
}
