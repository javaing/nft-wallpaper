package com.nftwallpaper.app

import android.app.WallpaperManager
import android.content.Context
import android.util.Log
import androidx.work.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import kotlin.random.Random

class WallpaperWorker(context: Context, workerParams: WorkerParameters) :
    Worker(context, workerParams) {

    companion object {
        const val PREFS_NAME = "WallpaperWorkerPrefs"
        const val KEY_ADDRESS = "wallet_address"
        const val KEY_API_KEY = "alchemy_api_key"
        const val KEY_INDEX = "nft_index"
        const val KEY_LAST_DATE = "last_date"
        const val KEY_LAST_RUN_AT = "last_run_at"
        const val KEY_LAST_RESULT = "last_result"
        const val KEY_LAST_MESSAGE = "last_message"
        const val WORK_NAME = "daily_wallpaper_work"
        const val KEY_INTERVAL = "worker_interval"
        const val INTERVAL_15MIN = "15min"
        const val INTERVAL_DAILY = "daily"

        fun schedule(context: Context, interval: String = INTERVAL_DAILY) {
            val intervalAmount = if (interval == INTERVAL_15MIN) 15L else 1L
            val intervalUnit = if (interval == INTERVAL_15MIN) TimeUnit.MINUTES else TimeUnit.DAYS
            // No network constraint: let the worker decide at runtime whether to skip
            val request = PeriodicWorkRequestBuilder<WallpaperWorker>(intervalAmount, intervalUnit)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(
                    WORK_NAME,
                    ExistingPeriodicWorkPolicy.UPDATE,
                    request
                )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }

        fun runNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<WallpaperWorker>().build()
            WorkManager.getInstance(context).enqueue(request)
        }
    }

    override fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val addressRaw = prefs.getString(KEY_ADDRESS, null)
        val apiKey = prefs.getString(KEY_API_KEY, null)

        if (addressRaw.isNullOrBlank()) {
            saveResult(prefs, "error", "address 未設定")
            return Result.failure()
        }

        val addresses = try {
            val arr = JSONArray(addressRaw)
            (0 until arr.length()).map { arr.getString(it) }
        } catch (e: Exception) {
            listOf(addressRaw)
        }

        val allNfts = mutableListOf<String>()

        for (address in addresses) {
            val addr = address.trim()
            if (addr.startsWith("tz") || addr.startsWith("KT")) {
                fetchTezosNfts(addr, allNfts)
            } else if (addr.isNotBlank() && !apiKey.isNullOrBlank()) {
                fetchEthereumNfts(addr, apiKey, allNfts)
            }
        }

        if (allNfts.isEmpty()) {
            saveResult(prefs, "error", "無 NFT 可設定")
            return Result.failure()
        }

        val savedIndex = prefs.getInt(KEY_INDEX, -1)
        val index = if (allNfts.size <= 1) {
            0
        } else {
            var candidate = Random.nextInt(allNfts.size)
            if (candidate == savedIndex) {
                candidate = (candidate + 1 + Random.nextInt(allNfts.size - 1)) % allNfts.size
            }
            candidate
        }
        val imageUrl = allNfts[index]

        return try {
            val file = downloadImage(imageUrl)
            file.inputStream().use { stream ->
                WallpaperManager.getInstance(applicationContext).setStream(stream)
            }
            file.delete()
            prefs.edit()
                .putInt(KEY_INDEX, index)
                .putLong(KEY_LAST_RUN_AT, System.currentTimeMillis())
                .putString(KEY_LAST_RESULT, "success")
                .putString(KEY_LAST_MESSAGE, "設定 NFT #$index / ${allNfts.size}")
                .apply()
            Log.d("WallpaperWorker", "壁紙設定成功 index=$index total=${allNfts.size}")
            Result.success()
        } catch (e: Exception) {
            Log.e("WallpaperWorker", "doWork error: ${e.message}")
            saveResult(prefs, "error", e.message ?: "Unknown error")
            Result.failure()
        }
    }

    private fun fetchEthereumNfts(address: String, apiKey: String, out: MutableList<String>) {
        try {
            var pageKey: String? = null
            var page = 0
            val maxPages = 25

            while (page < maxPages) {
                val url = buildString {
                    append("https://eth-mainnet.g.alchemy.com/nft/v2/$apiKey/getNFTs?owner=$address&withMetadata=true&pageSize=100")
                    if (!pageKey.isNullOrBlank()) {
                        append("&pageKey=")
                        append(pageKey)
                    }
                }
                val json = httpGet(url) ?: break
                val obj = JSONObject(json)
                val nfts = obj.optJSONArray("ownedNfts") ?: break
                for (i in 0 until nfts.length()) {
                    val nft = nfts.getJSONObject(i)
                    val mediaArr = nft.optJSONArray("media")
                    val imageUrl = mediaArr?.optJSONObject(0)?.optString("gateway", "")
                        ?: nft.optJSONObject("metadata")?.optString("image", "")
                        ?: ""
                    val resolved = resolveIpfs(imageUrl)
                    if (resolved.startsWith("http://") || resolved.startsWith("https://")) {
                        out.add(resolved)
                    }
                }
                val nextPageKey = obj.optString("pageKey", "")
                if (nextPageKey.isBlank()) break
                pageKey = nextPageKey
                page++
            }
            Log.d("WallpaperWorker", "Ethereum NFTs fetched: ${out.size} from $address")
        } catch (e: Exception) {
            Log.e("WallpaperWorker", "fetchEthereumNfts error: ${e.message}")
        }
    }

    private fun fetchTezosNfts(address: String, out: MutableList<String>) {
        try {
            val pageSize = 100
            var offset = 0
            var page = 0
            val maxPages = 25

            while (page < maxPages) {
                val url =
                    "https://api.tzkt.io/v1/tokens/balances?account=$address&balance.gt=0&limit=$pageSize&offset=$offset&select=token"
                val json = httpGet(url) ?: break
                val arr = JSONArray(json)
                for (i in 0 until arr.length()) {
                    val tokenObj = arr.optJSONObject(i)?.optJSONObject("token") ?: continue
                    val metadata = tokenObj.optJSONObject("metadata") ?: continue
                    val displayUri = metadata.optString("displayUri", "")
                    val artifactUri = metadata.optString("artifactUri", "")
                    val thumbnailUri = metadata.optString("thumbnailUri", "")
                    val raw = listOf(displayUri, artifactUri, thumbnailUri)
                        .firstOrNull { it.isNotBlank() } ?: continue
                    val resolved = resolveIpfs(raw)
                    if (resolved.startsWith("http://") || resolved.startsWith("https://")) {
                        out.add(resolved)
                    }
                }
                if (arr.length() < pageSize) break
                offset += pageSize
                page++
            }
            Log.d("WallpaperWorker", "Tezos NFTs fetched: from $address")
        } catch (e: Exception) {
            Log.e("WallpaperWorker", "fetchTezosNfts error: ${e.message}")
        }
    }

    private fun resolveIpfs(url: String): String {
        return if (url.startsWith("ipfs://")) {
            "https://ipfs.io/ipfs/${url.removePrefix("ipfs://")}"
        } else url
    }

    private fun downloadImage(imageUrl: String): File {
        val conn = URL(imageUrl).openConnection() as HttpURLConnection
        conn.setRequestProperty("User-Agent", "NFTWallpaper/1.0")
        conn.connectTimeout = 15000
        conn.readTimeout = 30000
        conn.connect()
        if (conn.responseCode != 200) {
            conn.disconnect()
            throw Exception("HTTP ${conn.responseCode} downloading image")
        }
        val file = File(applicationContext.cacheDir, "wallpaper_temp.jpg")
        conn.inputStream.use { input ->
            file.outputStream().use { output ->
                input.copyTo(output)
            }
        }
        conn.disconnect()
        return file
    }

    private fun httpGet(urlStr: String): String? {
        return try {
            val conn = URL(urlStr).openConnection() as HttpURLConnection
            conn.setRequestProperty("User-Agent", "NFTWallpaper/1.0")
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            conn.connect()
            if (conn.responseCode != 200) {
                Log.e("WallpaperWorker", "HTTP ${conn.responseCode} for $urlStr")
                conn.disconnect()
                return null
            }
            val text = conn.inputStream.bufferedReader().readText()
            conn.disconnect()
            text
        } catch (e: Exception) {
            Log.e("WallpaperWorker", "httpGet error: ${e.message}")
            null
        }
    }

    private fun saveResult(prefs: android.content.SharedPreferences, result: String, message: String) {
        prefs.edit()
            .putLong(KEY_LAST_RUN_AT, System.currentTimeMillis())
            .putString(KEY_LAST_RESULT, result)
            .putString(KEY_LAST_MESSAGE, message)
            .apply()
    }
}
