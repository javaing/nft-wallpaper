package com.nftwallpaper.app

import android.app.WallpaperManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.*
import java.io.FileInputStream
import org.json.JSONObject

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

    /**
     * 取得目前實際設定的桌布 NFT 資訊 (來自 native SharedPreferences)。
     * 不論是 JS 手動設定還是 WorkManager 背景換的，都會回傳當下生效的記錄。
     */
    @ReactMethod
    fun getCurrentWallpaper(promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences(
                WallpaperWorker.PREFS_NAME, android.content.Context.MODE_PRIVATE
            )
            val raw = prefs.getString(WallpaperWorker.KEY_CURRENT_RECORD, null)
            if (raw.isNullOrBlank()) {
                promise.resolve(null)
                return
            }
            val obj = JSONObject(raw)
            val map = Arguments.createMap()
            // setDate / address / source
            map.putString("setDate", obj.optString("setDate", ""))
            map.putString("address", obj.optString("address", ""))
            map.putString("source", obj.optString("source", ""))
            map.putDouble("setAt", prefs.getLong(WallpaperWorker.KEY_CURRENT_RECORD_AT, 0L).toDouble())
            // nft 子物件
            val nft = obj.optJSONObject("nft")
            val nftMap = Arguments.createMap()
            if (nft != null) {
                nftMap.putString("chain", nft.optString("chain", ""))
                nftMap.putString("contractAddress", nft.optString("contractAddress", ""))
                nftMap.putString("tokenId", nft.optString("tokenId", ""))
                nftMap.putString("name", nft.optString("name", ""))
                nftMap.putString("collectionName", nft.optString("collectionName", ""))
                nftMap.putString("imageUrl", nft.optString("imageUrl", ""))
                nftMap.putString("wallpaperUrl", nft.optString("wallpaperUrl", nft.optString("imageUrl", "")))
            }
            map.putMap("nft", nftMap)
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ERR_GET_CURRENT", e.message ?: "Unknown error", e)
        }
    }

    /**
     * JS 端手動設定桌布後呼叫，把 NFT 資訊寫到 native SharedPreferences。
     * 這樣 native worker 與 JS 共享同一份「目前桌布」狀態。
     */
    @ReactMethod
    fun recordCurrentWallpaper(record: ReadableMap, promise: Promise) {
        try {
            val nftMap = record.getMap("nft")
                ?: return promise.reject("ERR_RECORD", "missing nft field")
            val nftJson = JSONObject().apply {
                put("chain", nftMap.getString("chain") ?: "")
                put("contractAddress", nftMap.getString("contractAddress") ?: "")
                put("tokenId", nftMap.getString("tokenId") ?: "")
                put("name", nftMap.getString("name") ?: "")
                put("collectionName", nftMap.getString("collectionName") ?: "")
                val img = nftMap.getString("imageUrl") ?: ""
                put("imageUrl", img)
                put("wallpaperUrl", nftMap.getString("wallpaperUrl") ?: img)
            }
            val now = System.currentTimeMillis()
            val recordJson = JSONObject().apply {
                put("nft", nftJson)
                put("setDate", if (record.hasKey("setDate")) record.getString("setDate") else
                    java.text.SimpleDateFormat("EEE MMM dd yyyy", java.util.Locale.US).format(java.util.Date(now)))
                put("address", if (record.hasKey("address")) record.getString("address") else "")
                put("source", "manual")
            }
            reactApplicationContext.getSharedPreferences(
                WallpaperWorker.PREFS_NAME, android.content.Context.MODE_PRIVATE
            ).edit()
                .putString(WallpaperWorker.KEY_CURRENT_RECORD, recordJson.toString())
                .putLong(WallpaperWorker.KEY_CURRENT_RECORD_AT, now)
                .apply()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_RECORD", e.message ?: "Unknown error", e)
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
