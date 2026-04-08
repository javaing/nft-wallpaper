package com.nftwallpaper.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class DateChangedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_DATE_CHANGED,
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                Log.d("DateChangedReceiver", "Received: ${intent.action}, triggering wallpaper update")
                WallpaperWorker.runNow(context)
            }
        }
    }
}
