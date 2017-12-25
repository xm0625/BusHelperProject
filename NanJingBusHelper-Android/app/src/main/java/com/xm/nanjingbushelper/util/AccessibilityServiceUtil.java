package com.xm.nanjingbushelper.util;

import android.accessibilityservice.AccessibilityService;
import android.text.TextUtils;
import android.util.Log;
import android.view.accessibility.AccessibilityNodeInfo;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.xm.nanjingbushelper.service.DataWatcherService;

import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Created by xm on 2017/12/13.
 */

public class AccessibilityServiceUtil {

    public static boolean waitForTargetText(AccessibilityService accessibilityService, String[]... targetTextList) throws InterruptedException{
        return waitForTargetText(accessibilityService, 10, targetTextList);
    }

    public static boolean waitForTargetText(AccessibilityService accessibilityService, int timeoutSecond, String[]... targetTextList) throws InterruptedException{
        Log.d("DataWatcherThread", "findTargetNode targetTextList:"+ JSON.toJSONString(targetTextList));
        int retryTime = 0;
        int maxRetryCount = timeoutSecond*1000/500;
        retryWhile: while(!Thread.interrupted() && retryTime<maxRetryCount){
            for(String[] targetTextArray:targetTextList) {
                if(targetTextArray.length<2){
                    return false;
                }
                if (findTargetNode(accessibilityService, targetTextArray[0], targetTextArray[1]) == null) {
                    retryTime++;
                    Thread.sleep(500);
                    continue retryWhile;
                }
            }
            return true;
        }
        return false;
    }

    public static AccessibilityNodeInfo findTargetNode(AccessibilityService accessibilityService, String keyWords, String regExp){
        AccessibilityNodeInfo rootInActiveWindow = accessibilityService.getRootInActiveWindow();
        if(rootInActiveWindow == null){
            return null;
        }
        return findNodeByText(rootInActiveWindow, keyWords, regExp);
    }

    public static AccessibilityNodeInfo findNodeByText(AccessibilityNodeInfo node, String keyWords, String regExp){
        List<AccessibilityNodeInfo> accessibilityNodeInfosByText = node.findAccessibilityNodeInfosByText(keyWords);
        if(accessibilityNodeInfosByText.size() < 1){
            return null;
        }
        if(TextUtils.isEmpty(regExp)){
            return accessibilityNodeInfosByText.get(0);
        }
        for(AccessibilityNodeInfo accessibilityNodeInfo:accessibilityNodeInfosByText){
            String nodeText = accessibilityNodeInfo.getText().toString();
            Pattern pattern = Pattern.compile(regExp);
            if(pattern.matcher(nodeText).matches()){
                return accessibilityNodeInfo;
            }
        }
        return accessibilityNodeInfosByText.get(0);
    }

    public static boolean clickNode(AccessibilityNodeInfo node){
        try{
            AccessibilityNodeInfo clickTarget = node;
            while(!clickTarget.isClickable()){
                clickTarget = clickTarget.getParent();
                if(clickTarget == null){
                    return false;
                }
            }
            clickTarget.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            return true;
        }catch (Exception e){
            Log.d("DataWatcherThread", "node click failed");
            return false;
        }
    }

    public static AccessibilityNodeInfo findNodeById(AccessibilityNodeInfo node, String packageName, String targetId){
        List<AccessibilityNodeInfo> accessibilityNodeInfoList = node.findAccessibilityNodeInfosByViewId(packageName+":id/"+targetId);
        if(accessibilityNodeInfoList.size()<1){
            return null;
        }
        return accessibilityNodeInfoList.get(0);
    }

}
