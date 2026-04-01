package com.nftwallpaper.app

import android.app.WallpaperManager
import android.content.Context
import android.util.Log
import androidx.work.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

class WallpaperWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    companion object {
        const val TAG       = "WallpaperWorker"
        const val PREFS_NAME = "nft_wallpaper_prefs"
        const val KEY_ADDRESS = "wallet_address"
        const val KEY_API_KEY = "alchemy_api_key"
        const val KEY_INDEX  = "auto_index"
        const val KEY_LAST_RUN_AT = "debug_last_run_at"
        const val KEY_LAST_RESULT = "debug_last_result"
        const val KEY_LAST_MESSAGE = "debug_last_message"
        const val WORK_NAME  = "periodic_wallpaper_worker"
        const val WORK_NAME_TEST = "test_wallpaper_worker"

        fun schedule(context: Context) {
            Log.i(TAG, "排程自動換桌布 (WorkManager, 15 分鐘)")
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<WallpaperWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            )
            Log.i(TAG, "排程完成，每 15 分鐘執行一次")
        }

        fun runNow(context: Context) {
            Log.i(TAG, "立即觸發 Worker 測試")
            val request = OneTimeWorkRequestBuilder<WallpaperWorker>()
                .setConstraints(Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                WORK_NAME_TEST,
                ExistingWorkPolicy.REPLACE,
                request
            )
        }

        fun cancel(context: Context) {
            Log.i(TAG, "取消自動換桌布排程")
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }

        private fun writeDebugStatus(context: Context, result: String, message: String) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putLong(KEY_LAST_RUN_AT, System.currentTimeMillis())
                .putString(KEY_LAST_RESULT, result)
                .putString(KEY_LAST_MESSAGE, message)
                .apply()
        }
    }

    override fun doWork(): Result {
        Log.i(TAG, "doWork() 開始")
        val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val address = prefs.getString(KEY_ADDRESS, null)
        val apiKey  = prefs.getString(KEY_API_KEY,  null)

        if (address.isNullOrEmpty()) {
            Log.e(TAG, "address 未設定")
            writeDebugStatus(applicationContext, "failure", "address not set")
            return Result.failure()
        }
        if (apiKey.isNullOrEmpty()) {
            Log.e(TAG, "apiKey 未設定")
            writeDebugStatus(applicationContext, "failure", "apiKey not set")
            return Result.failure()
        }

        val index = prefs.getInt(KEY_INDEX, 0)
        Log.i(TAG, "address=$address index=$index")

        val isTezos = address.matches(Regex("^tz[123][1-9A-HJ-NP-Za-km-z]{33}$"))
        return try {
            val nfts = if (isTezos) fetchTezosNFTs(address) else fetchNFTs(address, apiKey)
            Log.i(TAG, "取得 NFT 數量: ${nfts.size} (${if (isTezos) "Tezos" else "Ethereum"})")
            if (nfts.isEmpty()) {
                Log.e(TAG, "NFT 清單為空")
                writeDebugStatus(applicationContext, "failure", "nft list empty")
                return Result.failure()
            }

            val imageUrl = nfts[index % nfts.size]
            Log.i(TAG, "下載圖片: $imageUrl")
            val conn = URL(imageUrl).openConnection() as HttpURLConnection
            conn.connectTimeout = 20_000
            conn.readTimeout    = 20_000
            conn.instanceFollowRedirects = true
            val code = conn.responseCode
            if (code != 200) {
                Log.e(TAG, "圖片 HTTP $code")
                writeDebugStatus(applicationContext, "retry", "image http $code")
                return Result.retry()
            }
            conn.inputStream.use { stream ->
                WallpaperManager.getInstance(applicationContext).setStream(stream)
            }

            prefs.edit().putInt(KEY_INDEX, index + 1).apply()
            Log.i(TAG, "換桌布完成！下次 index=${index + 1}")
            writeDebugStatus(applicationContext, "success", "wallpaper updated index=${index + 1}")
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "doWork 失敗: ${e.message}", e)
            writeDebugStatus(applicationContext, "retry", e.message ?: "unknown error")
            Result.retry()
        }
    }

    /** Fetch up to 100 NFT image URLs，先試 v2，失敗再試 v3 */
    private fun fetchNFTs(address: String, apiKey: String): List<String> {
        val urlV2 = "https://eth-mainnet.g.alchemy.com/v2/$apiKey/getNFTs" +
                    "?owner=$address&withMetadata=true&pageSize=100"
        val urlV3 = "https://eth-mainnet.g.alchemy.com/nft/v3/$apiKey/getNFTsForOwner" +
                    "?owner=$address&withMetadata=true&pageSize=100"

        var body: String? = null
        var isV3 = false

        // 嘗試 v2
        try {
            val conn = URL(urlV2).openConnection() as HttpURLConnection
            conn.connectTimeout = 15_000; conn.readTimeout = 15_000
            val code = conn.responseCode
            Log.i(TAG, "Alchemy v2 HTTP $code")
            if (code == 200) body = conn.inputStream.bufferedReader().readText()
            else conn.errorStream?.close()
        } catch (e: Exception) { Log.w(TAG, "v2 失敗: ${e.message}") }

        // v2 失敗則嘗試 v3
        if (body == null) {
            val conn = URL(urlV3).openConnection() as HttpURLConnection
            conn.connectTimeout = 15_000; conn.readTimeout = 15_000
            val code = conn.responseCode
            Log.i(TAG, "Alchemy v3 HTTP $code")
            if (code == 200) { body = conn.inputStream.bufferedReader().readText(); isV3 = true }
            else conn.errorStream?.close()
        }

        if (body == null) { Log.e(TAG, "Alchemy API 全部失敗"); return emptyList() }

        val arr = JSONObject(body).getJSONArray("ownedNfts")

        val result = mutableListOf<String>()
        for (i in 0 until arr.length()) {
            val nft = arr.getJSONObject(i)
            val raw: String? = if (isV3) {
                // v3: nft.image.cachedUrl / originalUrl
                val img = nft.optJSONObject("image")
                img?.optString("cachedUrl")?.takeIf { it.isNotEmpty() }
                    ?: img?.optString("originalUrl")?.takeIf { it.isNotEmpty() }
            } else {
                // v2: nft.media[0].gateway / thumbnail
                val mediaArr = nft.optJSONArray("media")
                if (mediaArr != null && mediaArr.length() > 0) {
                    val m = mediaArr.getJSONObject(0)
                    m.optString("gateway").takeIf { it.isNotEmpty() }
                        ?: m.optString("thumbnail").takeIf { it.isNotEmpty() }
                } else {
                    nft.optJSONObject("metadata")?.optString("image")?.takeIf { it.isNotEmpty() }
                }
            }
            val resolved = raw?.let { resolveUrl(it) }
            if (!resolved.isNullOrEmpty()) result.add(resolved)
        }
        Log.i(TAG, "解析後有效圖片數: ${result.size}")
        return result
    }

    /** Fetch Tezos NFT image URLs via TzKT */
    private fun fetchTezosNFTs(address: String): List<String> {
        val url = "https://api.tzkt.io/v1/tokens/balances" +
                  "?account=$address&limit=100&offset=0&token.standard=fa2"
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 15_000; conn.readTimeout = 15_000
        val code = conn.responseCode
        Log.i(TAG, "TzKT HTTP $code")
        if (code != 200) { conn.errorStream?.close(); return emptyList() }
        val body = conn.inputStream.bufferedReader().readText()
        val arr = org.json.JSONArray(body)

        val result = mutableListOf<String>()
        for (i in 0 until arr.length()) {
            val item = arr.getJSONObject(i)
            val meta = item.optJSONObject("token")?.optJSONObject("metadata") ?: continue
            val raw =
                meta.optString("thumbnailUri").takeIf { it.isNotEmpty() }
                    ?: meta.optString("displayUri").takeIf { it.isNotEmpty() }
                    ?: meta.optString("artifactUri").takeIf { it.isNotEmpty() }
                    ?: continue
            result.add(resolveUrl(raw))
        }
        Log.i(TAG, "Tezos 解析後有效圖片: ${result.size}")
        return result
    }

    private fun resolveUrl(url: String) = when {
        url.startsWith("ipfs://") -> "https://ipfs.io/ipfs/${url.substring(7)}"
        url.startsWith("ar://")   -> "https://arweave.net/${url.substring(5)}"
        else -> url
    }
}
