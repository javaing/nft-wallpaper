package com.nftwallpaper.app

import android.app.WallpaperManager
import android.content.Context
import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Arguments
import java.io.FileInputStream

class WallpaperModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "WallpaperModule"

    /** 手動設定桌布（傳入本機 file:// URI） */
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

    /** 儲存錢包地址與 API Key 到 SharedPreferences，供 WallpaperWorker 使用 */
    @ReactMethod
    fun saveWalletSettings(address: String, apiKey: String, promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences(
                WallpaperWorker.PREFS_NAME, Context.MODE_PRIVATE
            )
            prefs.edit()
                .putString(WallpaperWorker.KEY_ADDRESS, address)
                .putString(WallpaperWorker.KEY_API_KEY, apiKey)
                .apply()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_SAVE_SETTINGS", e.message ?: "Unknown error", e)
        }
    }

    /** 啟用或停用自動換桌布排程（由 WorkManager 週期觸發） */
    @ReactMethod
    fun scheduleDailyWallpaper(enabled: Boolean, promise: Promise) {
        try {
            if (enabled) {
                WallpaperWorker.schedule(reactApplicationContext)
            } else {
                WallpaperWorker.cancel(reactApplicationContext)
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_SCHEDULE", e.message ?: "Unknown error", e)
        }
    }

    /** 立即觸發一次 Worker（測試用） */
    @ReactMethod
    fun testWorkerNow(promise: Promise) {
        try {
            WallpaperWorker.runNow(reactApplicationContext)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_TEST_WORKER", e.message ?: "Unknown error", e)
        }
    }

    /** 讀取 Worker debug 狀態（僅偵錯用途） */
    @ReactMethod
    fun getWorkerDebugStatus(promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences(
                WallpaperWorker.PREFS_NAME, Context.MODE_PRIVATE
            )
            val map = Arguments.createMap()
            map.putDouble("lastRunAt", prefs.getLong(WallpaperWorker.KEY_LAST_RUN_AT, 0L).toDouble())
            map.putString("lastResult", prefs.getString(WallpaperWorker.KEY_LAST_RESULT, "never"))
            map.putString("lastMessage", prefs.getString(WallpaperWorker.KEY_LAST_MESSAGE, ""))
            map.putInt("currentIndex", prefs.getInt(WallpaperWorker.KEY_INDEX, 0))
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ERR_WORKER_STATUS", e.message ?: "Unknown error", e)
        }
    }
}
