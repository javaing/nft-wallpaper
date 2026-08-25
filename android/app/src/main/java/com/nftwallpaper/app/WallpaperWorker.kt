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

    private var workDeadline = 0L

    private fun budgetExceeded(deadline: Long = workDeadline): Boolean {
        return System.currentTimeMillis() >= deadline
    }

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
        // 目前桌布的 NFT 完整資訊 (JSON) + 設定時間戳，供 JS 端 dialog 顯示
        const val KEY_CURRENT_RECORD = "current_wallpaper_record"
        const val KEY_CURRENT_RECORD_AT = "current_wallpaper_at"
        const val KEY_SHOWN_IDS_PREFIX = "shown_ids_"
        const val KEY_SHOWN_IDS_GLOBAL_SCOPE = "__global__"
        const val KEY_DISPLAY_HISTORY_PREFIX = "display_history_"
        const val KEY_HISTORY_RESET_DATE_PREFIX = "history_reset_date_"
        const val MAX_DISPLAY_HISTORY = 200
        const val FETCH_BUDGET_MS = 7 * 60 * 1000L
        const val AUTO_LIST_TTL_MS = 60 * 60 * 1000L
        const val HTTP_CONNECT_MS = 8000
        const val HTTP_READ_MS = 12000
        const val IMAGE_CONNECT_MS = 12000
        const val IMAGE_READ_MS = 20000
        const val BROWSER_UA =
            "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        val IPFS_GATEWAYS = listOf(
            "https://gateway.pinata.cloud/ipfs/",
            "https://4everland.io/ipfs/",
            "https://w3s.link/ipfs/",
            "https://dweb.link/ipfs/",
            "https://nftstorage.link/ipfs/",
            "https://ipfs.io/ipfs/",
        )

        fun shownIdsKey(address: String) = KEY_SHOWN_IDS_PREFIX + address
        fun displayHistoryKey(address: String) = KEY_DISPLAY_HISTORY_PREFIX + address
        fun historyResetDateKey(address: String) = KEY_HISTORY_RESET_DATE_PREFIX + address

        fun todayDateKey(): String {
            return java.text.SimpleDateFormat("EEE MMM dd yyyy", java.util.Locale.US)
                .format(java.util.Date())
        }

        fun clearDisplayHistory(prefs: android.content.SharedPreferences, address: String) {
            prefs.edit().putString(displayHistoryKey(address), "[]").apply()
        }

        /** 每日清空展示紀錄；不動 shown_ids。回傳 true 表示剛清空。 */
        fun maybeResetDailyDisplayHistory(
            prefs: android.content.SharedPreferences,
            address: String
        ): Boolean {
            val today = todayDateKey()
            val last = prefs.getString(historyResetDateKey(address), null)
            if (last == today) return false
            clearDisplayHistory(prefs, address)
            prefs.edit().putString(historyResetDateKey(address), today).apply()
            Log.d("WallpaperWorker", "daily display history reset for $address")
            return true
        }

        fun readShownIds(prefs: android.content.SharedPreferences, scope: String): MutableSet<String> {
            val raw = prefs.getString(shownIdsKey(scope), "[]") ?: "[]"
            return try {
                val arr = JSONArray(raw)
                (0 until arr.length()).mapTo(mutableSetOf()) { arr.getString(it) }
            } catch (e: Exception) {
                mutableSetOf()
            }
        }

        fun writeShownIds(prefs: android.content.SharedPreferences, scope: String, ids: Collection<String>) {
            val arr = JSONArray()
            ids.forEach { arr.put(it) }
            prefs.edit().putString(shownIdsKey(scope), arr.toString()).apply()
        }

        fun readDisplayHistoryRaw(prefs: android.content.SharedPreferences, address: String): JSONArray {
            val raw = prefs.getString(displayHistoryKey(address), "[]") ?: "[]"
            return try {
                JSONArray(raw)
            } catch (e: Exception) {
                JSONArray()
            }
        }

        fun appendDisplayHistory(
            prefs: android.content.SharedPreferences,
            historyScope: String,
            nftJson: JSONObject,
            setAt: Long,
            ownerAddress: String = historyScope
        ) {
            maybeResetDailyDisplayHistory(prefs, historyScope)
            val legacyKey = nftJson.optString("contractAddress", "") + "-" + nftJson.optString("tokenId", "")
            val key = nftJson.optString("chain", "") + ":" + legacyKey
            val history = readDisplayHistoryRaw(prefs, historyScope)
            val next = JSONArray()
            next.put(
                JSONObject().apply {
                    put("setAt", setAt)
                    put("address", ownerAddress)
                    put("nft", nftJson)
                }
            )
            for (i in 0 until history.length()) {
                if (next.length() >= MAX_DISPLAY_HISTORY) break
                val item = history.optJSONObject(i) ?: continue
                val itemNft = item.optJSONObject("nft") ?: continue
                val itemLegacyKey = itemNft.optString("contractAddress", "") + "-" + itemNft.optString("tokenId", "")
                val itemKey = itemNft.optString("chain", "") + ":" + itemLegacyKey
                if (itemKey == key || itemLegacyKey == legacyKey) continue
                next.put(item)
            }
            prefs.edit().putString(displayHistoryKey(historyScope), next.toString()).apply()
        }

        fun schedule(context: Context, interval: String = INTERVAL_DAILY) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val currentInterval = prefs.getString(KEY_INTERVAL, null)
            // 同 interval → KEEP，保留既有排程（避免重複呼叫 reset 已等待的 worker）
            // 換 interval → UPDATE，必須替換新的週期
            val policy = if (currentInterval == interval) {
                ExistingPeriodicWorkPolicy.KEEP
            } else {
                ExistingPeriodicWorkPolicy.UPDATE
            }
            val intervalAmount = if (interval == INTERVAL_15MIN) 15L else 1L
            val intervalUnit = if (interval == INTERVAL_15MIN) TimeUnit.MINUTES else TimeUnit.DAYS
            val request = PeriodicWorkRequestBuilder<WallpaperWorker>(intervalAmount, intervalUnit)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(WORK_NAME, policy, request)
            if (currentInterval != interval) {
                prefs.edit().putString(KEY_INTERVAL, interval).apply()
            }
            Log.d("WallpaperWorker", "schedule interval=$interval policy=$policy")
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
            (0 until arr.length()).map { arr.getString(it).trim() }.filter { it.isNotBlank() }
        } catch (e: Exception) {
            listOf(addressRaw.trim()).filter { it.isNotBlank() }
        }

        if (addresses.isEmpty()) {
            saveResult(prefs, "error", "address 未設定")
            return Result.failure()
        }

        workDeadline = System.currentTimeMillis() + FETCH_BUDGET_MS
        val perWalletMs = FETCH_BUDGET_MS / addresses.size
        val allNfts = mutableListOf<NftInfo>()

        // 每個錢包均分時間，避免 ETH 先抓滿 10 分鐘導致 Tezos 完全沒進池
        // 清單是 metadata JSON（不是縮圖）；1 小時內走檔案 cache，避免每 15 分鐘重打 TzKT 25 頁
        for (addr in addresses) {
            if (budgetExceeded()) {
                Log.w("WallpaperWorker", "fetch budget exceeded before $addr, have ${allNfts.size}")
                break
            }
            val cached = readCachedNfts(addr)
            if (cached != null) {
                allNfts.addAll(cached)
                val chain = cached.firstOrNull()?.chain ?: "?"
                Log.i("WallpaperWorker", "NFT metadata cache $chain ${cached.size} from $addr")
                continue
            }
            val addrDeadline = minOf(workDeadline, System.currentTimeMillis() + perWalletMs)
            val before = allNfts.size
            if (addr.startsWith("tz") || addr.startsWith("KT")) {
                fetchTezosNfts(addr, allNfts, addrDeadline)
            } else if (!apiKey.isNullOrBlank()) {
                fetchEthereumNfts(addr, apiKey, allNfts, addrDeadline)
            }
            writeCachedNfts(addr, allNfts.subList(before, allNfts.size).toList())
        }

        val ethCount = allNfts.count { it.chain == "ethereum" }
        val xtzCount = allNfts.count { it.chain == "tezos" }
        Log.i("WallpaperWorker", "pool eth=$ethCount xtz=$xtzCount total=${allNfts.size} wallets=${addresses.size}")
        for (addr in addresses) {
            val n = allNfts.count { it.ownerAddress == addr }
            val chain = allNfts.firstOrNull { it.ownerAddress == addr }?.chain
                ?: if (addr.startsWith("tz") || addr.startsWith("KT")) "tezos" else "ethereum"
            Log.i("WallpaperWorker", "  $chain ${addr.take(6)}…${addr.takeLast(4)} count=$n")
        }

        if (allNfts.isEmpty()) {
            saveResult(prefs, "error", "無 NFT 可設定")
            return Result.failure()
        }

        maybeResetDailyDisplayHistory(prefs, KEY_SHOWN_IDS_GLOBAL_SCOPE)
        for (addr in addresses) {
            maybeResetDailyDisplayHistory(prefs, addr)
        }

        val shownIds = readShownIds(prefs, KEY_SHOWN_IDS_GLOBAL_SCOPE)
        for (addr in addresses) {
            shownIds.addAll(readShownIds(prefs, addr))
        }

        val skipped = mutableSetOf<String>()
        var lastError: Exception? = null
        repeat(12) {
            val remaining = allNfts.filter { !skipped.contains(it.key()) && !skipped.contains(it.legacyKey()) }
            if (remaining.isEmpty()) return@repeat
            val chosen = try {
                pickRandomUnshown(remaining, shownIds)
            } catch (e: Exception) {
                lastError = e
                return@repeat
            }
            try {
                val file = downloadImage(chosen.imageUrl)
                file.inputStream().use { stream ->
                    WallpaperManager.getInstance(applicationContext).setStream(stream)
                }
                file.delete()
                shownIds.add(chosen.key())
                writeShownIds(prefs, KEY_SHOWN_IDS_GLOBAL_SCOPE, shownIds)
                val now = System.currentTimeMillis()
                val recordJson = JSONObject().apply {
                    put("nft", chosen.toJson())
                    put("setDate", java.text.SimpleDateFormat("EEE MMM dd yyyy", java.util.Locale.US)
                        .format(java.util.Date(now)))
                    put("address", chosen.ownerAddress)
                    put("source", "worker")
                }
                appendDisplayHistory(prefs, KEY_SHOWN_IDS_GLOBAL_SCOPE, chosen.toJson(), now, chosen.ownerAddress)
                appendDisplayHistory(prefs, chosen.ownerAddress, chosen.toJson(), now, chosen.ownerAddress)
                prefs.edit()
                    .putLong(KEY_LAST_RUN_AT, now)
                    .putString(KEY_LAST_RESULT, "success")
                    .putString(KEY_LAST_MESSAGE, "pick ${chosen.chain} ${chosen.name} / eth=$ethCount xtz=$xtzCount")
                    .putString(KEY_CURRENT_RECORD, recordJson.toString())
                    .putLong(KEY_CURRENT_RECORD_AT, now)
                    .apply()
                Log.i("WallpaperWorker", "壁紙設定成功 ${chosen.chain} ${chosen.name} total=${allNfts.size}")
                return Result.success()
            } catch (e: Exception) {
                lastError = e
                skipped.add(chosen.key())
                Log.w("WallpaperWorker", "candidate failed ${chosen.chain} ${chosen.name}: ${e.message}")
            }
        }

        saveResult(prefs, "error", lastError?.message ?: "全部候選失敗")
        return Result.failure()
    }

    // ─── Internal NFT data class ─────────────────────────────────────────────
    private data class NftInfo(
        val chain: String,
        val contractAddress: String,
        val tokenId: String,
        val name: String,
        val collectionName: String,
        val imageUrl: String,
        val ownerAddress: String,
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("chain", chain)
            put("contractAddress", contractAddress)
            put("tokenId", tokenId)
            put("name", name)
            put("collectionName", collectionName)
            put("imageUrl", imageUrl)
            put("wallpaperUrl", imageUrl)
        }

        fun key(): String = "$chain:$contractAddress-$tokenId"
        fun legacyKey(): String = "$contractAddress-$tokenId"
        fun toCacheJson(): JSONObject = toJson().put("ownerAddress", ownerAddress)
    }

    private fun nftListCacheFile(address: String): File {
        val safe = address.replace(Regex("[^a-zA-Z0-9]"), "_")
        return File(applicationContext.cacheDir, "auto_nft_list_$safe.json")
    }

    private fun readCachedNfts(address: String): List<NftInfo>? {
        return try {
            val file = nftListCacheFile(address)
            if (!file.exists()) return null
            val obj = JSONObject(file.readText())
            val ts = obj.optLong("ts", 0L)
            if (System.currentTimeMillis() - ts > AUTO_LIST_TTL_MS) return null
            val arr = obj.optJSONArray("items") ?: return null
            (0 until arr.length()).mapNotNull { i ->
                val n = arr.optJSONObject(i) ?: return@mapNotNull null
                val image = n.optString("imageUrl", n.optString("wallpaperUrl", ""))
                if (image.isBlank()) return@mapNotNull null
                NftInfo(
                    chain = n.optString("chain", ""),
                    contractAddress = n.optString("contractAddress", ""),
                    tokenId = n.optString("tokenId", ""),
                    name = n.optString("name", ""),
                    collectionName = n.optString("collectionName", ""),
                    imageUrl = image,
                    ownerAddress = n.optString("ownerAddress", address),
                )
            }.takeIf { it.isNotEmpty() }
        } catch (e: Exception) {
            Log.w("WallpaperWorker", "read cache failed $address: ${e.message}")
            null
        }
    }

    private fun writeCachedNfts(address: String, nfts: List<NftInfo>) {
        if (nfts.isEmpty()) return
        try {
            val arr = JSONArray()
            nfts.forEach { arr.put(it.toCacheJson()) }
            val obj = JSONObject().apply {
                put("ts", System.currentTimeMillis())
                put("address", address)
                put("items", arr)
            }
            nftListCacheFile(address).writeText(obj.toString())
            Log.i("WallpaperWorker", "NFT metadata cached ${nfts.size} for $address")
        } catch (e: Exception) {
            Log.w("WallpaperWorker", "write cache failed $address: ${e.message}")
        }
    }

    private fun pickRandomUnshown(
        allNfts: List<NftInfo>,
        shownIds: MutableSet<String>
    ): NftInfo {
        val pool = allNfts.filter { it.imageUrl.isNotBlank() }
        require(pool.isNotEmpty()) { "無可用 NFT 圖片" }

        val chains = pool.map { it.chain }.distinct()
        val chain = chains[Random.nextInt(chains.size)]
        val chainPool = pool.filter { it.chain == chain }

        var chainCandidates = chainPool.filter { !shownIds.contains(it.key()) && !shownIds.contains(it.legacyKey()) }
        if (chainCandidates.isEmpty()) {
            val chainKeys = chainPool.flatMap { listOf(it.key(), it.legacyKey()) }.toSet()
            shownIds.removeAll(chainKeys)
            chainCandidates = chainPool
            Log.i("WallpaperWorker", "chain cycle reset $chain pool=${chainPool.size}")
        }

        val byWallet = chainCandidates.groupBy { it.ownerAddress }
        val wallets = byWallet.keys.toList()
        val wallet = wallets[Random.nextInt(wallets.size)]
        val walletNfts = byWallet.getValue(wallet)
        val chosen = walletNfts[Random.nextInt(walletNfts.size)]
        Log.i(
            "WallpaperWorker",
            "pick chain=$chain/${chains.joinToString("+")} wallet=${wallet.take(8)}… " +
                "name=${chosen.name} chainUnshown=${chainCandidates.size} walletN=${walletNfts.size}"
        )
        return chosen
    }

    private fun fetchEthereumNfts(address: String, apiKey: String, out: MutableList<NftInfo>, deadline: Long) {
        try {
            var pageKey: String? = null
            var page = 0
            val maxPages = 25
            val before = out.size

            while (page < maxPages && !budgetExceeded(deadline)) {
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
                    if (!resolved.startsWith("http://") && !resolved.startsWith("https://")) continue

                    val contract = nft.optJSONObject("contract")?.optString("address", "") ?: ""
                    val tokenIdHex = nft.optJSONObject("id")?.optString("tokenId", "") ?: ""
                    val tokenId = hexToDecimalSafe(tokenIdHex)
                    val nftName = nft.optJSONObject("metadata")?.optString("name", "")
                        ?: nft.optString("title", "")
                    val displayName = if (nftName.isNullOrBlank()) "#$tokenId" else nftName
                    val collectionName = nft.optJSONObject("contractMetadata")?.optString("name", "")
                        ?: ""

                    out.add(
                        NftInfo(
                            chain = "ethereum",
                            contractAddress = contract,
                            tokenId = tokenId,
                            name = displayName,
                            collectionName = collectionName,
                            imageUrl = resolved,
                            ownerAddress = address,
                        )
                    )
                }
                val nextPageKey = obj.optString("pageKey", "")
                if (nextPageKey.isBlank()) break
                pageKey = nextPageKey
                page++
            }
            Log.i("WallpaperWorker", "Ethereum NFT metadata fetched: ${out.size - before} from $address")
        } catch (e: Exception) {
            Log.e("WallpaperWorker", "fetchEthereumNfts error: ${e.message}")
        }
    }

    private fun fetchTezosNfts(address: String, out: MutableList<NftInfo>, deadline: Long) {
        try {
            val pageSize = 100
            var offset = 0
            var page = 0
            val maxPages = 25
            val before = out.size

            while (page < maxPages && !budgetExceeded(deadline)) {
                val url =
                    "https://api.tzkt.io/v1/tokens/balances?account=$address&balance.gt=0&limit=$pageSize&offset=$offset&token.standard=fa2"
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
                    if (!resolved.startsWith("http://") && !resolved.startsWith("https://")) continue

                    val contract = tokenObj.optJSONObject("contract")?.optString("address", "") ?: ""
                    val tokenId = tokenObj.optString("tokenId", "")
                    val nftName = metadata.optString("name", "")
                    val displayName = if (nftName.isNullOrBlank()) "#$tokenId" else nftName
                    val collectionAlias = tokenObj.optJSONObject("contract")?.optString("alias", "")
                        ?: ""

                    out.add(
                        NftInfo(
                            chain = "tezos",
                            contractAddress = contract,
                            tokenId = tokenId,
                            name = displayName,
                            collectionName = collectionAlias,
                            imageUrl = resolved,
                            ownerAddress = address,
                        )
                    )
                }
                if (arr.length() < pageSize) break
                offset += pageSize
                page++
            }
            Log.i("WallpaperWorker", "Tezos NFT metadata fetched: ${out.size - before} from $address")
        } catch (e: Exception) {
            Log.e("WallpaperWorker", "fetchTezosNfts error: ${e.message}")
        }
    }

    private fun hexToDecimalSafe(hex: String): String {
        if (hex.isBlank()) return ""
        return try {
            val cleaned = if (hex.startsWith("0x")) hex.substring(2) else hex
            java.math.BigInteger(cleaned, 16).toString(10)
        } catch (e: Exception) {
            hex
        }
    }

    private fun resolveIpfs(url: String): String {
        val cid = ipfsCidPath(url)
        return if (cid != null) "${IPFS_GATEWAYS.first()}$cid" else url
    }

    private fun ipfsCidPath(url: String): String? {
        val trimmed = url.trim()
        if (trimmed.startsWith("ipfs://")) {
            return trimmed.removePrefix("ipfs://").removePrefix("ipfs/").trimStart('/')
        }
        if ("/ipfs/" in trimmed) {
            return trimmed.substringAfter("/ipfs/").substringBefore('?').trimStart('/')
        }
        return null
    }

    private fun downloadImage(imageUrl: String): File {
        val urls = linkedSetOf<String>()
        val cid = ipfsCidPath(imageUrl)
        if (cid != null) {
            IPFS_GATEWAYS.forEach { urls.add("$it$cid") }
        } else {
            urls.add(imageUrl)
        }
        var last: Exception? = null
        for (url in urls) {
            try {
                val file = downloadImageOnce(url)
                Log.i("WallpaperWorker", "download ok $url")
                return file
            } catch (e: Exception) {
                last = e
                Log.w("WallpaperWorker", "download failed $url: ${e.message}")
            }
        }
        throw last ?: Exception("download failed")
    }

    private fun downloadImageOnce(imageUrl: String): File {
        val conn = URL(imageUrl).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = true
        conn.setRequestProperty("User-Agent", BROWSER_UA)
        conn.setRequestProperty("Accept", "image/webp,image/png,image/jpeg,image/*,*/*")
        conn.connectTimeout = IMAGE_CONNECT_MS
        conn.readTimeout = IMAGE_READ_MS
        conn.connect()
        if (conn.responseCode !in 200..299) {
            val code = conn.responseCode
            conn.disconnect()
            throw Exception("HTTP $code downloading image")
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
            conn.connectTimeout = HTTP_CONNECT_MS
            conn.readTimeout = HTTP_READ_MS
            conn.connect()
            val code = conn.responseCode
            if (code == 429) {
                conn.disconnect()
                Thread.sleep(1500)
                return httpGetRetry(urlStr)
            }
            if (code != 200) {
                Log.e("WallpaperWorker", "HTTP $code for $urlStr")
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

    private fun httpGetRetry(urlStr: String): String? {
        return try {
            val conn = URL(urlStr).openConnection() as HttpURLConnection
            conn.setRequestProperty("User-Agent", "NFTWallpaper/1.0")
            conn.connectTimeout = HTTP_CONNECT_MS
            conn.readTimeout = HTTP_READ_MS
            conn.connect()
            if (conn.responseCode != 200) {
                Log.e("WallpaperWorker", "HTTP ${conn.responseCode} retry for $urlStr")
                conn.disconnect()
                return null
            }
            val text = conn.inputStream.bufferedReader().readText()
            conn.disconnect()
            text
        } catch (e: Exception) {
            Log.e("WallpaperWorker", "httpGet retry error: ${e.message}")
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
