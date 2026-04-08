package com.nftwallpaper.app

import android.app.WallpaperManager
import android.net.Uri
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
