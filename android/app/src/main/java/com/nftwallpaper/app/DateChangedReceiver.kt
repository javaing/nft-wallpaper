package com.nftwallpaper.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * 監聽系統日期變更廣播（每天午夜觸發）
 * 不受電池優化影響，App 關閉時也能收到
 */
class DateChangedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_DATE_CHANGED,
            Intent.ACTION_BOOT_COMPLETED,       // 重開機後重新觸發一次
            Intent.ACTION_MY_PACKAGE_REPLACED   // App 更新後重新觸發
            -> {
                Log.i("DateChangedReceiver", "收到: ${intent.action}，觸發換桌布")
                WallpaperWorker.runNow(context)
            }
        }
    }
}
