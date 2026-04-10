package com.nftwallpaper.app

import android.app.WallpaperManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.*
import java.io.FileInputStream

class WallpaperModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "WallpaperModule"

    @ReactMethod
    fun setWallpaper(fileUri: String, promise: Promise) {
        try {
            val path = Uri.parse(fileUri).path
                ?: return promise.reject("ERR_INVALID_URI", "Invalid file URI: $fileUri")
            val wallpaperManager = WallpaperManager.getInstance(reactApplicationContext)
            FileInputStream(path).use { stream ->
                wallpaperManager.setStream(stream)
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_SET_WALLPAPER", e.message ?: "Unknown error", e)
        }
    }

    @ReactMethod
    fun saveWalletSettings(address: String, apiKey: String, promise: Promise) {
        try {
            reactApplicationContext.getSharedPreferences(
                WallpaperWorker.PREFS_NAME, android.content.Context.MODE_PRIVATE
            ).edit()
                .putString(WallpaperWorker.KEY_ADDRESS, address)
                .putString(WallpaperWorker.KEY_API_KEY, apiKey)
                .apply()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_SAVE_SETTINGS", e.message ?: "Unknown error", e)
        }
    }

    @ReactMethod
    fun scheduleDailyWallpaper(enable: Boolean, interval: String, promise: Promise) {
        try {
            if (enable) {
                WallpaperWorker.schedule(reactApplicationContext, interval)
            } else {
                WallpaperWorker.cancel(reactApplicationContext)
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_SCHEDULE", e.message ?: "Unknown error", e)
        }
    }

    @ReactMethod
    fun testWorkerNow(promise: Promise) {
        try {
            WallpaperWorker.runNow(reactApplicationContext)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_TEST_WORKER", e.message ?: "Unknown error", e)
        }
    }

    @ReactMethod
    fun isBatteryOptimizationIgnored(promise: Promise) {
        try {
            val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            promise.resolve(pm.isIgnoringBatteryOptimizations(reactApplicationContext.packageName))
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun requestBatteryOptimizationExemption(promise: Promise) {
        try {
            val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            val pkg = reactApplicationContext.packageName
            if (!pm.isIgnoringBatteryOptimizations(pkg)) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$pkg")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                reactApplicationContext.startActivity(intent)
                promise.resolve(false) // dialog shown, not yet granted
            } else {
                promise.resolve(true) // already exempted
            }
        } catch (e: Exception) {
            promise.reject("ERR_BATTERY", e.message ?: "Unknown error", e)
        }
    }

    @ReactMethod
    fun getWorkerDebugStatus(promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences(
                WallpaperWorker.PREFS_NAME, android.content.Context.MODE_PRIVATE
            )
            val map = Arguments.createMap()
            map.putDouble("lastRunAt", prefs.getLong(WallpaperWorker.KEY_LAST_RUN_AT, 0).toDouble())
            map.putString("lastResult", prefs.getString(WallpaperWorker.KEY_LAST_RESULT, null))
            map.putString("lastMessage", prefs.getString(WallpaperWorker.KEY_LAST_MESSAGE, null))
            map.putInt("currentIndex", prefs.getInt(WallpaperWorker.KEY_INDEX, 0))
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ERR_DEBUG_STATUS", e.message ?: "Unknown error", e)
        }
    }
}
