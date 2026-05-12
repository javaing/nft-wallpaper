import {
  StyleSheet,
  Text,
  View,
  FlatList,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
  Modal,
  Linking,
} from 'react-native';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  setWallpaperDirect,
  saveWalletSettings,
  scheduleDailyWallpaper,
  testWorkerNow,
  getWorkerDebugStatus,
  isBatteryOptimizationIgnored,
  requestBatteryOptimizationExemption,
  getCurrentWallpaper as getNativeCurrentWallpaper,
  recordCurrentWallpaper as recordNativeWallpaper,
  type WorkerDebugStatus,
  type WallpaperInterval,
} from './WallpaperManager';
import { useTranslation } from 'react-i18next';

const ALCHEMY_API_KEY = process.env.EXPO_PUBLIC_ALCHEMY_API_KEY ?? 'YOUR_ALCHEMY_API_KEY';
const PAGE_SIZE = 20;
const STORAGE_KEY_WALLPAPER = 'nft_wallpaper_current';
const STORAGE_KEY_AUTO_INDEX = 'auto_wallpaper_index';
const STORAGE_KEY_AUTO_LAST_TS = 'auto_wallpaper_last_ts';
const STORAGE_KEY_INTERVAL = 'wallpaper_interval';
const STORAGE_KEY_LIST_PREFIX = 'nft_list_v1_';
const STORAGE_KEY_AUTO_LIST_PREFIX = 'nft_auto_list_v1_';
const NFT_LIST_TTL_MS = 10 * 60 * 1000; // 10 分鐘內視為新鮮，免再打 API
const AUTO_LIST_TTL_MS = 60 * 60 * 1000; // 全部 NFT 清單變動慢，1 小時 TTL
const INTERVAL_MS: Record<WallpaperInterval, number> = {
  '15min': 15 * 60 * 1000,
  'daily': 24 * 60 * 60 * 1000,
};
const DEBUG_SHOW_WORKER_STATUS = __DEV__;
const PRELOAD_URI = `${FileSystem.cacheDirectory}nft_wallpaper_preload.jpg`;

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_SIZE = (SCREEN_WIDTH - 48) / 2;

export type Chain = 'ethereum' | 'tezos';

export type NFTItem = {
  tokenId: string;
  name: string;
  imageUrl: string | null;      // 列表縮圖（thumbnail）
  wallpaperUrl: string | null;  // 桌布高畫質（cached / original）
  collectionName: string;
  contractAddress: string;
  chain: Chain;
};

type CachedPage = {
  items: NFTItem[];
  nextPageKey?: string;
  totalCount?: number;
  ts: number;
};

const memoryCache = new Map<string, CachedPage>();

function cacheKey(address: string, pageKey?: string) {
  return `${address}|${pageKey ?? '__first__'}`;
}

function storageKeyFor(address: string, pageKey?: string) {
  return STORAGE_KEY_LIST_PREFIX + cacheKey(address, pageKey);
}

async function readCachedPage(address: string, pageKey?: string): Promise<CachedPage | null> {
  const key = cacheKey(address, pageKey);
  const mem = memoryCache.get(key);
  if (mem) return mem;
  try {
    const raw = await AsyncStorage.getItem(storageKeyFor(address, pageKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPage;
    memoryCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function writeCachedPage(address: string, pageKey: string | undefined, page: CachedPage) {
  memoryCache.set(cacheKey(address, pageKey), page);
  try {
    await AsyncStorage.setItem(storageKeyFor(address, pageKey), JSON.stringify(page));
  } catch {
    // AsyncStorage 失敗不致命：記憶體層仍可用
  }
}

// ── 全部 NFT 清單 cache（auto-wallpaper 用）─────────────────────────────────
type CachedAutoList = { items: NFTItem[]; ts: number };
const autoListMemoryCache = new Map<string, CachedAutoList>();

function autoListStorageKey(address: string) {
  return STORAGE_KEY_AUTO_LIST_PREFIX + address;
}

async function readCachedAutoList(address: string): Promise<CachedAutoList | null> {
  const mem = autoListMemoryCache.get(address);
  if (mem) return mem;
  try {
    const raw = await AsyncStorage.getItem(autoListStorageKey(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAutoList;
    autoListMemoryCache.set(address, parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function writeCachedAutoList(address: string, list: CachedAutoList) {
  autoListMemoryCache.set(address, list);
  try {
    await AsyncStorage.setItem(autoListStorageKey(address), JSON.stringify(list));
  } catch {
    // 略：記憶體層仍可用
  }
}

function clearAutoListCache(address: string) {
  autoListMemoryCache.delete(address);
  AsyncStorage.removeItem(autoListStorageKey(address)).catch(() => {});
}

function clearPageCacheFor(address: string) {
  for (const key of Array.from(memoryCache.keys())) {
    if (key.startsWith(`${address}|`)) memoryCache.delete(key);
  }
  // AsyncStorage 中的 page cache 不主動清，下次 write 會覆蓋；force fetch 會直接 bypass
}

function detectChain(address: string): Chain | null {
  if (/^0x[0-9a-fA-F]{40}$/i.test(address)) return 'ethereum';
  if (/^tz[123][1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return 'tezos';
  return null;
}

type WallpaperRecord = {
  nft: NFTItem;
  setDate: string; // toDateString()
  address: string;
};

function resolveUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${url.slice(7)}`;
  if (url.startsWith('ar://')) return `https://arweave.net/${url.slice(5)}`;
  return url;
}

// 產生 NFT 詳情頁外部連結
function buildAssetUrl(nft: NFTItem): string | null {
  if (!nft?.contractAddress || !nft?.tokenId) return null;
  if (nft.chain === 'ethereum') {
    return `https://opensea.io/assets/ethereum/${nft.contractAddress}/${nft.tokenId}`;
  }
  if (nft.chain === 'tezos') {
    return `https://objkt.com/asset/${nft.contractAddress}/${nft.tokenId}`;
  }
  return null;
}

const DOWNLOAD_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36',
  'Accept': 'image/webp,image/png,image/jpeg,*/*',
};

function parseNFT(nft: any): NFTItem {
  // v3: nft.tokenId (decimal string), nft.image.*
  // v2: nft.id.tokenId (hex string), nft.media[], nft.metadata.image, nft.title
  const rawId = nft.tokenId ?? nft.id?.tokenId ?? '';
  const tokenId = rawId.startsWith('0x') ? String(parseInt(rawId, 16)) : rawId;

  return {
    tokenId,
    name: nft.name || nft.title || `#${tokenId}`,
    imageUrl:
      resolveUrl(nft.image?.thumbnailUrl) ||
      resolveUrl(nft.media?.[0]?.thumbnail) ||
      resolveUrl(nft.image?.cachedUrl) ||
      resolveUrl(nft.media?.[0]?.gateway) ||
      resolveUrl(nft.image?.originalUrl) ||
      resolveUrl(nft.metadata?.image) ||
      null,
    wallpaperUrl:
      resolveUrl(nft.image?.cachedUrl) ||
      resolveUrl(nft.image?.originalUrl) ||
      resolveUrl(nft.media?.[0]?.gateway) ||
      resolveUrl(nft.metadata?.image) ||
      resolveUrl(nft.image?.thumbnailUrl) ||
      resolveUrl(nft.media?.[0]?.thumbnail) ||
      null,
    collectionName:
      nft.collection?.name ||
      nft.contract?.name ||
      nft.contractMetadata?.name ||
      '未知系列',
    contractAddress: nft.contract?.address ?? '',
    chain: 'ethereum',
  };
}

function parseTezosNFT(item: any): NFTItem | null {
  const meta = item.token?.metadata;
  // 跳過沒有 metadata 或 name 的 token（通常是 fungible token）
  if (!meta?.name && !meta?.symbol) return null;
  const tokenId = item.token?.tokenId ?? '0';
  const thumb =
    resolveUrl(meta?.thumbnailUri) ||
    resolveUrl(meta?.displayUri) ||
    resolveUrl(meta?.artifactUri) ||
    null;
  const hq =
    resolveUrl(meta?.displayUri) ||
    resolveUrl(meta?.artifactUri) ||
    thumb;
  return {
    tokenId,
    name: meta?.name || `#${tokenId}`,
    imageUrl: thumb,
    wallpaperUrl: hq,
    collectionName:
      item.token?.contract?.alias ||
      item.token?.contract?.address?.slice(0, 8) ||
      'Tezos NFT',
    contractAddress: item.token?.contract?.address ?? '',
    chain: 'tezos',
  };
}

async function fetchPage(
  address: string,
  pageKey?: string
): Promise<{ items: NFTItem[]; nextPageKey?: string; totalCount?: number }> {
  const chain = detectChain(address);
  if (!chain) throw new Error(`無法識別地址格式: "${address}"`);
  if (chain === 'tezos') return fetchTezosPage(address, pageKey);
  return fetchEthPage(address, pageKey);
}

async function fetchTezosPage(
  address: string,
  pageKey?: string
): Promise<{ items: NFTItem[]; nextPageKey?: string; totalCount?: number }> {
  const offset = pageKey ? parseInt(pageKey, 10) : 0;
  const url =
    `https://api.tzkt.io/v1/tokens/balances` +
    `?account=${address}&limit=${PAGE_SIZE}&offset=${offset}` +
    `&token.standard=fa2`;

  console.log('[TzKT] GET', url);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[TzKT] error', res.status, body);
    throw new Error(`TzKT error ${res.status}`);
  }
  const data: any[] = await res.json();
  const items = data
    .map(parseTezosNFT)
    .filter((x): x is NFTItem => x !== null);

  // offset-based pagination：若回傳滿 PAGE_SIZE 筆，就可能還有下一頁
  const nextOffset = offset + PAGE_SIZE;
  return {
    items,
    nextPageKey: data.length === PAGE_SIZE ? String(nextOffset) : undefined,
    totalCount: undefined, // TzKT 需額外 count 請求，先省略
  };
}

async function fetchEthPage(
  address: string,
  pageKey?: string
): Promise<{ items: NFTItem[]; nextPageKey?: string; totalCount?: number }> {
  if (ALCHEMY_API_KEY === 'YOUR_ALCHEMY_API_KEY') {
    const start = pageKey ? parseInt(pageKey) : 0;
    return {
      items: Array.from({ length: PAGE_SIZE }, (_, i) => ({
        tokenId: String(start + i + 1),
        name: `Demo NFT #${start + i + 1}`,
        imageUrl: `https://picsum.photos/seed/nft${start + i}/300/300`,
        wallpaperUrl: `https://picsum.photos/seed/nft${start + i}/800/800`,
        collectionName: 'Demo Collection',
        contractAddress: '0x0000000000000000000000000000000000000000',
        chain: 'ethereum' as Chain,
      })),
      nextPageKey: start + PAGE_SIZE < 60 ? String(start + PAGE_SIZE) : undefined,
      totalCount: 60,
    };
  }

  const normalizedAddress = address.toLowerCase();
  const params = new URLSearchParams({
    owner: normalizedAddress,
    withMetadata: 'true',
    pageSize: String(PAGE_SIZE),
  });
  if (pageKey) params.set('pageKey', pageKey);

  const urlV3 = `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_API_KEY}/getNFTsForOwner?${params}`;
  const urlV2 = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}/getNFTs?${params}`;

  const fetchWithRetry = async (url: string, retries = 2): Promise<Response> => {
    for (let i = 0; i <= retries; i++) {
      const r = await fetch(url);
      if (r.status !== 503 || i === retries) return r;
      await new Promise(res => setTimeout(res, 1000 * (i + 1)));
    }
    return fetch(url);
  };

  console.log('[Alchemy] GET v3', urlV3);
  let res = await fetchWithRetry(urlV3);
  if (res.status === 400) {
    console.warn('[Alchemy] v3 failed, trying v2...');
    res = await fetchWithRetry(urlV2);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[Alchemy] error', res.status, body);
    throw new Error(`Alchemy error ${res.status}: ${body}`);
  }
  const data = await res.json();
  return {
    items: (data.ownedNfts ?? []).map(parseNFT),
    nextPageKey: data.pageKey,
    totalCount: data.totalCount,
  };
}

async function fetchAllNftsForAuto(
  address: string,
  options?: { forceRefresh?: boolean }
): Promise<NFTItem[]> {
  const chain = detectChain(address);
  if (!chain) return [];

  const force = options?.forceRefresh ?? false;
  if (!force) {
    const cached = await readCachedAutoList(address);
    if (cached && Date.now() - cached.ts < AUTO_LIST_TTL_MS) {
      return cached.items;
    }
    // stale 或無 cache：往下走網路抓
  }

  const items: NFTItem[] = [];
  let pageKey: string | undefined = undefined;
  const MAX_PAGES = 25;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result =
      chain === 'tezos' ? await fetchTezosPage(address, pageKey) : await fetchEthPage(address, pageKey);
    items.push(...result.items);
    if (!result.nextPageKey) break;
    pageKey = result.nextPageKey;
  }

  // 抓失敗（空陣列）不寫 cache，避免把空清單卡進來
  if (items.length > 0) {
    await writeCachedAutoList(address, { items, ts: Date.now() });
  }
  return items;
}

async function setAsWallpaper(nft: NFTItem, address: string, preloadedUri?: string): Promise<void> {
  // 桌布優先用高畫質 wallpaperUrl，fallback 到 imageUrl
  const targetUrl = nft.wallpaperUrl || nft.imageUrl;
  if (!targetUrl) throw new Error('此 NFT 沒有圖片');

  let localUri: string;
  if (preloadedUri) {
    localUri = preloadedUri;
  } else {
    const dest = `${FileSystem.cacheDirectory}nft_wallpaper.jpg`;
    const { status } = await FileSystem.downloadAsync(targetUrl, dest, { headers: DOWNLOAD_HEADERS });
    if (status !== 200) throw new Error('圖片下載失敗');
    localUri = dest;
  }

  // 直接設為桌布，不開系統選單
  await setWallpaperDirect(localUri);

  // 儲存紀錄到 AsyncStorage
  const record: WallpaperRecord = {
    nft,
    setDate: new Date().toDateString(),
    address,
  };
  await AsyncStorage.setItem(STORAGE_KEY_WALLPAPER, JSON.stringify(record));
  // 同步寫到 native SharedPreferences，讓 dialog 與 native worker 共享同一份狀態
  try {
    await recordNativeWallpaper({
      setDate: record.setDate,
      address: record.address,
      nft: {
        chain: nft.chain,
        contractAddress: nft.contractAddress,
        tokenId: nft.tokenId,
        name: nft.name,
        collectionName: nft.collectionName,
        imageUrl: nft.imageUrl ?? '',
        wallpaperUrl: nft.wallpaperUrl ?? nft.imageUrl ?? '',
      },
    });
  } catch {
    // 寫不到 native 不影響主流程（iOS 或 native module 載入失敗）
  }
}

// ─── NFT Card ────────────────────────────────────────────────────────────────

function NFTCard({
  item,
  selected,
  onPress,
}: {
  item: NFTItem;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {item.imageUrl ? (
        <Image
          source={{ uri: item.imageUrl }}
          style={styles.image}
          contentFit="cover"
          transition={300}
          placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
        />
      ) : (
        <View style={[styles.image, styles.noImage]}>
          <Text style={styles.noImageText}>🖼️</Text>
        </View>
      )}
      {selected && (
        <View style={styles.selectedBadge}>
          <Text style={styles.selectedBadgeText}>✓</Text>
        </View>
      )}
      <View style={[styles.chainBadge, item.chain === 'tezos' && styles.chainBadgeTezos]}>
        <Text style={styles.chainBadgeText}>{item.chain === 'tezos' ? 'XTZ' : 'ETH'}</Text>
      </View>
      <View style={styles.cardInfo}>
        <Text style={styles.nftName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.collectionName} numberOfLines={1}>{item.collectionName}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Wallet Chip ─────────────────────────────────────────────────────────────

function shortAddr(addr: string) {
  return `${addr.slice(0, 5)}…${addr.slice(-4)}`;
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

type Props = {
  wallets: string[];
  onAddWallet?: () => void;
  onRemoveWallet?: (address: string) => void;
};

export default function NFTScreen({ wallets, onAddWallet, onRemoveWallet }: Props) {
  const { t } = useTranslation();
  const [selectedAddress, setSelectedAddress] = useState<string>(wallets[0] ?? '');

  // wallets 變動時，若目前選取的地址已不在清單中，切回第一個
  useEffect(() => {
    if (!wallets.includes(selectedAddress) && wallets.length > 0) {
      setSelectedAddress(wallets[0]);
    }
  }, [wallets]);

  const address = selectedAddress;
  const [nfts, setNfts] = useState<NFTItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination
  const [pageHistory, setPageHistory] = useState<(string | undefined)[]>([undefined]); // stack of pageKeys
  const [currentPage, setCurrentPage] = useState(1);
  const [nextPageKey, setNextPageKey] = useState<string | undefined>();
  const [totalCount, setTotalCount] = useState<number | undefined>();

  // UI state
  const [selectedNFT, setSelectedNFT] = useState<NFTItem | null>(null);
  const [settingWallpaper, setSettingWallpaper] = useState(false);
  const [currentWallpaper, setCurrentWallpaper] = useState<WallpaperRecord | null>(null);
  // 開 App 時提示目前桌布 NFT（每次 App 啟動只顯示一次）
  const [wallpaperNotice, setWallpaperNotice] = useState<WallpaperRecord | null>(null);
  const wallpaperNoticeChecked = useRef(false);
  // 排程去重：避免每次 render 都呼叫 WorkManager.enqueueUniquePeriodicWork 把 worker reset
  const lastScheduledKey = useRef<string>('');
  // 等 interval 從 AsyncStorage 載入後才開始排程（避免「daily → 15min」flip 排兩次）
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // JS auto-wallpaper lock：防止平行多次觸發
  const autoWallpaperBusy = useRef(false);
  const autoEnabled = true;
  const [interval, setIntervalPref] = useState<WallpaperInterval>('daily');
  const [showIntervalOptions, setShowIntervalOptions] = useState(false);
  const [autoTick, setAutoTick] = useState(0);
  const [workerDebug, setWorkerDebug] = useState<WorkerDebugStatus | null>(null);

  // 預先下載：選取 NFT 後立即在背景下載，加快設為桌布速度
  const preloadedKey = useRef<string | null>(null); // contractAddress-tokenId

  useEffect(() => {
    const preloadTarget = selectedNFT?.wallpaperUrl || selectedNFT?.imageUrl;
    if (!preloadTarget) return;
    const key = `${selectedNFT!.contractAddress}-${selectedNFT!.tokenId}`;
    preloadedKey.current = null; // reset
    FileSystem.downloadAsync(preloadTarget, PRELOAD_URI, { headers: DOWNLOAD_HEADERS })
      .then(({ status }) => {
        if (status === 200) {
          preloadedKey.current = key;
          console.log('[Preload] 下載完成:', key);
        } else {
          console.warn('[Preload] 下載失敗，status:', status);
        }
      })
      .catch(e => console.warn('[Preload] 下載錯誤:', e?.message));
  }, [selectedNFT]);

  // 自動換桌布：啟用後每分鐘檢查一次（每 15 分鐘最多更新一次）
  useEffect(() => {
    if (!autoEnabled) return;
    const id = setInterval(() => setAutoTick(t => t + 1), 60 * 1000);
    return () => clearInterval(id);
  }, [autoEnabled]);

  // Debug: 週期讀取 Worker 最後執行狀態
  useEffect(() => {
    if (!DEBUG_SHOW_WORKER_STATUS || Platform.OS !== 'android') return;

    const fetchDebugStatus = async () => {
      try {
        const status = await getWorkerDebugStatus();
        setWorkerDebug(status);
      } catch {
        // debug 資訊不影響主流程
      }
    };

    fetchDebugStatus();
    const id = setInterval(fetchDebugStatus, 10 * 1000);
    return () => clearInterval(id);
  }, [autoEnabled]);

  // 自動換桌布：NFT 載入完成或週期檢查時觸發
  useEffect(() => {
    if (!autoEnabled || loading) return;
    // Lock: 避免同一 JS context 內多次平行觸發（mount 多次 / deps 連續變動）
    if (autoWallpaperBusy.current) return;
    autoWallpaperBusy.current = true;

    const now = Date.now();
    AsyncStorage.multiGet([STORAGE_KEY_WALLPAPER, STORAGE_KEY_AUTO_INDEX, STORAGE_KEY_AUTO_LAST_TS]).then(
      async ([[, wallRaw], [, idxRaw], [, lastTsRaw]]) => {
      try {
        const wall: WallpaperRecord | null = wallRaw ? JSON.parse(wallRaw) : null;
        const lastTs = lastTsRaw ? parseInt(lastTsRaw, 10) : 0;
        if (!Number.isNaN(lastTs) && lastTs > 0 && now - lastTs < INTERVAL_MS[interval]) return;

        // 立即 claim 時間戳：JS bundle 重啟時這條 lock 沒了，但 AUTO_LAST_TS 持久化
        // 後續 effect / JS reload 讀到新 lastTs 就會 skip
        await AsyncStorage.setItem(STORAGE_KEY_AUTO_LAST_TS, String(now));

        const autoNfts = await fetchAllNftsForAuto(address);
        if (autoNfts.length === 0) {
          console.warn('[AutoWallpaper] 找不到可用 NFT（auto list empty）');
          return;
        }

        const parsedIdx = idxRaw ? parseInt(idxRaw, 10) : -1;
        const prevIdx = Number.isNaN(parsedIdx) ? -1 : parsedIdx;
        const nextIdx = (() => {
          if (autoNfts.length <= 1) return 0;
          let candidate = Math.floor(Math.random() * autoNfts.length);
          if (candidate === prevIdx) {
            candidate =
              (candidate + 1 + Math.floor(Math.random() * (autoNfts.length - 1))) % autoNfts.length;
          }
          return candidate;
        })();
        const nft = autoNfts[nextIdx];
        const targetUrl = nft?.wallpaperUrl || nft?.imageUrl;
        if (!targetUrl) return;

        console.log('[AutoWallpaper] 自動換桌布:', nft.name, '(index', nextIdx, ')');
        try {
          const dest = `${FileSystem.cacheDirectory}nft_wallpaper_auto.jpg`;
          const { status } = await FileSystem.downloadAsync(targetUrl, dest, { headers: DOWNLOAD_HEADERS });
          if (status !== 200) throw new Error('下載失敗');
          await setWallpaperDirect(dest);
          const record: WallpaperRecord = { nft, setDate: new Date(now).toDateString(), address };
          await AsyncStorage.multiSet([
            [STORAGE_KEY_WALLPAPER, JSON.stringify(record)],
            [STORAGE_KEY_AUTO_INDEX, String(nextIdx)],
            [STORAGE_KEY_AUTO_LAST_TS, String(now)],
          ]);
          try {
            await recordNativeWallpaper({
              setDate: record.setDate,
              address: record.address,
              nft: {
                chain: nft.chain,
                contractAddress: nft.contractAddress,
                tokenId: nft.tokenId,
                name: nft.name,
                collectionName: nft.collectionName,
                imageUrl: nft.imageUrl ?? '',
                wallpaperUrl: nft.wallpaperUrl ?? nft.imageUrl ?? '',
              },
            });
          } catch {}
          setCurrentWallpaper(record);
          console.log('[AutoWallpaper] 完成（15 分鐘排程）');
        } catch (e: any) {
          console.warn('[AutoWallpaper] 失敗:', e?.message);
        }
      } finally {
        autoWallpaperBusy.current = false;
      }
      }
    ).catch(e => {
      autoWallpaperBusy.current = false;
      console.warn('[AutoWallpaper] multiGet 失敗:', e?.message);
    });
  }, [autoEnabled, loading, address, autoTick, interval]);

  const loadPage = useCallback(
    async (pageKey: string | undefined, options?: { forceRefresh?: boolean }) => {
      const force = options?.forceRefresh ?? false;
      setError(null);
      setSelectedNFT(null);

      let showedCached = false;
      if (!force) {
        const cached = await readCachedPage(address, pageKey);
        if (cached) {
          setNfts(cached.items);
          setNextPageKey(cached.nextPageKey);
          if (cached.totalCount) setTotalCount(cached.totalCount);
          showedCached = true;
          if (Date.now() - cached.ts < NFT_LIST_TTL_MS) {
            setLoading(false);
            return; // 新鮮 cache，跳過網路
          }
          // stale：先讓 UI 顯示舊資料，背景繼續 refresh
        }
      }

      if (!showedCached) setLoading(true);
      try {
        const result = await fetchPage(address, pageKey);
        setNfts(result.items);
        setNextPageKey(result.nextPageKey);
        if (result.totalCount) setTotalCount(result.totalCount);
        await writeCachedPage(address, pageKey, {
          items: result.items,
          nextPageKey: result.nextPageKey,
          totalCount: result.totalCount,
          ts: Date.now(),
        });
      } catch (e: any) {
        if (!showedCached) setError(e?.message ?? '載入失敗');
        else console.warn('[NFTList] background refresh failed:', e?.message);
      } finally {
        setLoading(false);
      }
    },
    [address]
  );

  // 重置到第一頁並重新拉取（按重新整理鈕：清掉這個 address 的所有 cache）
  const refreshList = useCallback(() => {
    setPageHistory([undefined]);
    setCurrentPage(1);
    setNextPageKey(undefined);
    setTotalCount(undefined);
    clearPageCacheFor(address);
    clearAutoListCache(address);
    loadPage(undefined, { forceRefresh: true });
  }, [loadPage, address]);

  // 切換錢包時重置並重新載入
  useEffect(() => {
    setPageHistory([undefined]);
    setCurrentPage(1);
    setNextPageKey(undefined);
    setTotalCount(undefined);
    setSelectedNFT(null);
  }, [selectedAddress]);

  // 首次載入 + 讀取設定，自動模式永遠啟用
  useEffect(() => {
    loadPage(undefined);

    // Native SharedPreferences 為唯一真實來源（worker 與 JS 手動設定都會寫這裡）
    // 失敗或回傳 null 才退回 AsyncStorage
    (async () => {
      let record: WallpaperRecord | null = null;
      try {
        const native = await getNativeCurrentWallpaper();
        if (native?.nft?.contractAddress) {
          record = {
            nft: {
              chain: (native.nft.chain || 'ethereum') as Chain,
              contractAddress: native.nft.contractAddress,
              tokenId: native.nft.tokenId,
              name: native.nft.name,
              collectionName: native.nft.collectionName,
              imageUrl: native.nft.imageUrl || null,
              wallpaperUrl: native.nft.wallpaperUrl || native.nft.imageUrl || null,
            },
            setDate: native.setDate || new Date().toDateString(),
            address: native.address || '',
          };
          // 寫回 AsyncStorage，讓兩邊保持一致
          await AsyncStorage.setItem(STORAGE_KEY_WALLPAPER, JSON.stringify(record));
        }
      } catch {
        // native bridge 失敗，往下退回 AsyncStorage
      }

      if (!record) {
        try {
          const wallRaw = await AsyncStorage.getItem(STORAGE_KEY_WALLPAPER);
          if (wallRaw) record = JSON.parse(wallRaw) as WallpaperRecord;
        } catch {}
      }

      if (record) {
        setCurrentWallpaper(record);
        if (!wallpaperNoticeChecked.current && record.nft) {
          setWallpaperNotice(record);
        }
      }
      wallpaperNoticeChecked.current = true;

      try {
        const savedInterval = await AsyncStorage.getItem(STORAGE_KEY_INTERVAL);
        if (savedInterval === '15min' || savedInterval === 'daily') {
          setIntervalPref(savedInterval);
        }
      } catch {}
      // 一定要在 setIntervalPref 之後設，這樣排程 effect 第一次跑就拿到正確的 interval
      setSettingsLoaded(true);
    })();
  }, [loadPage]);

  // 每次 address 或 interval 變更都重新排程 Worker，並確認電池優化豁免
  useEffect(() => {
    // 等 AsyncStorage 載入完才排程，避免 'daily' (初始) → '15min' (storage) 排兩次造成 worker reset
    if (!settingsLoaded) return;
    // 同 address+interval 只排一次（即便 React 多次 render / StrictMode 雙 render）
    const key = `${address}|${interval}`;
    if (lastScheduledKey.current === key) return;
    lastScheduledKey.current = key;

    saveWalletSettings(address, ALCHEMY_API_KEY)
      .then(() => scheduleDailyWallpaper(true, interval))
      .then(() => {
        console.log('[AutoWallpaper] WorkManager 已排程, interval=', interval);
        return isBatteryOptimizationIgnored();
      })
      .then(ignored => {
        if (!ignored) {
          Alert.alert(
            t('battery_opt_title'),
            t('battery_opt_msg'),
            [
              {
                text: t('battery_opt_allow'),
                onPress: () => requestBatteryOptimizationExemption().catch(() => {}),
              },
              { text: t('cancel'), style: 'cancel' },
            ]
          );
        }
      })
      .catch(e => console.warn('[AutoWallpaper] 排程失敗:', e?.message));
  }, [address, interval, settingsLoaded]);

  const goNextPage = useCallback(() => {
    if (!nextPageKey) return;
    setPageHistory(h => [...h, nextPageKey]);
    setCurrentPage(p => p + 1);
    loadPage(nextPageKey);
  }, [nextPageKey, loadPage]);

  const goPrevPage = useCallback(() => {
    if (currentPage <= 1) return;
    const newHistory = [...pageHistory];
    newHistory.pop(); // remove current
    const prevKey = newHistory[newHistory.length - 1];
    setPageHistory(newHistory);
    setCurrentPage(p => p - 1);
    loadPage(prevKey);
  }, [currentPage, pageHistory, loadPage]);

  const handleSetWallpaper = useCallback(async () => {
    if (!selectedNFT) {
      Alert.alert(t('select_nft_first'), t('select_nft_first_msg'));
      return;
    }
    setSettingWallpaper(true);
    try {
      const key = `${selectedNFT.contractAddress}-${selectedNFT.tokenId}`;
      const preloaded = preloadedKey.current === key ? PRELOAD_URI : undefined;
      await setAsWallpaper(selectedNFT, address, preloaded);
      setCurrentWallpaper({
        nft: selectedNFT,
        setDate: new Date().toDateString(),
        address,
      });
      Alert.alert(t('wallpaper_done'), '');
    } catch (e: any) {
      Alert.alert(t('wallpaper_failed'), e?.message ?? t('retry'));
    } finally {
      setSettingWallpaper(false);
    }
  }, [selectedNFT, address]);

  const promptRemoveWallet = useCallback(
    (addr: string) => {
      Alert.alert(t('remove_wallet'), `${t('remove_wallet_confirm')}\n\n${addr}`, [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('remove'),
          style: 'destructive',
          onPress: () => onRemoveWallet?.(addr),
        },
      ]);
    },
    [t, onRemoveWallet]
  );

  const today = new Date().toDateString();
  const wallpaperSetToday =
    currentWallpaper?.setDate === today && currentWallpaper.address === address;

  return (
    <>
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('my_nfts')}</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={refreshList} style={styles.refreshBtn} disabled={loading}>
          <Text style={[styles.refreshText, loading && { opacity: 0.4 }]}>↻</Text>
        </TouchableOpacity>
      </View>

      {/* Wallet Chips + Gear */}
      <View style={styles.walletSection}>
        <View style={styles.walletRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.walletChips} style={{ flex: 1 }}>
            {wallets.map(addr => {
              const chain = detectChain(addr);
              const isSelected = addr === selectedAddress;
              return (
                <View
                  key={addr}
                  style={[
                    styles.walletChip,
                    isSelected && styles.walletChipSelected,
                    chain === 'tezos' && styles.walletChipTezos,
                    isSelected && chain === 'tezos' && styles.walletChipTezosSelected,
                  ]}
                >
                  <TouchableOpacity
                    style={styles.walletChipMain}
                    onPress={() => setSelectedAddress(addr)}
                    onLongPress={() => promptRemoveWallet(addr)}
                  >
                    <Text
                      style={[styles.walletChipLabel, isSelected && styles.walletChipLabelSelected]}
                      numberOfLines={1}
                    >
                      {chain === 'tezos' ? 'XTZ' : 'ETH'} {shortAddr(addr)}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.walletChipMenuBtn}
                    onPress={() => promptRemoveWallet(addr)}
                    accessibilityRole="button"
                    accessibilityLabel={t('remove_wallet')}
                    hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }}
                  >
                    <Text style={styles.walletChipMenuIcon}>⋮</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
            {wallets.length < 10 && (
              <TouchableOpacity style={styles.walletChipAdd} onPress={onAddWallet}>
                <Text style={styles.walletChipAddText}>＋</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
          <TouchableOpacity
            style={[styles.gearBtn, showIntervalOptions && styles.gearBtnActive]}
            onPress={() => setShowIntervalOptions(v => !v)}
          >
            <Text style={styles.gearIcon}>⚙</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.walletRowHint}>{t('wallet_row_hint')}</Text>
      </View>

      {/* 更新頻率選項（點齒輪展開） */}
      {showIntervalOptions && (
        <View style={styles.intervalPanel}>
          <Text style={styles.intervalLabel}>{t('interval_label')}：</Text>
          {(['15min', 'daily'] as WallpaperInterval[]).map(opt => (
            <TouchableOpacity
              key={opt}
              style={[styles.intervalChip, interval === opt && styles.intervalChipActive]}
              onPress={() => {
                setIntervalPref(opt);
                AsyncStorage.setItem(STORAGE_KEY_INTERVAL, opt);
              }}
            >
              <Text style={[styles.intervalChipText, interval === opt && styles.intervalChipTextActive]}>
                {t(opt === '15min' ? 'interval_15min' : 'interval_daily')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Set Wallpaper Bar */}
      <View style={styles.wallpaperBar}>
        <View style={{ flex: 1 }}>
          {wallpaperSetToday ? (
            <Text style={styles.wallpaperHint}>{t('wallpaper_today', { name: currentWallpaper!.nft.name })}</Text>
          ) : currentWallpaper ? (
            <Text style={styles.wallpaperHint}>{t('wallpaper_last', { name: currentWallpaper.nft.name })}</Text>
          ) : (
            <Text style={styles.wallpaperHint}>
              {selectedNFT ? t('wallpaper_selected', { name: selectedNFT.name }) : t('wallpaper_select_hint')}
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={[styles.wallpaperBtn, settingWallpaper && styles.btnDisabled]}
          onPress={handleSetWallpaper}
          disabled={settingWallpaper}
        >
          {settingWallpaper ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.wallpaperBtnText}>{t('set_wallpaper')}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* 每日換桌布提示 */}
      {!wallpaperSetToday && currentWallpaper && currentWallpaper.address === address && (
        <View style={styles.dailyBanner}>
          <Text style={styles.dailyBannerText}>{t('daily_banner')}</Text>
        </View>
      )}
      {DEBUG_SHOW_WORKER_STATUS && Platform.OS === 'android' && (
        <View style={styles.debugBanner}>
          <Text style={styles.debugTitle}>[DEBUG] Worker 狀態</Text>
          <Text style={styles.debugText}>
            lastRun: {workerDebug?.lastRunAt ? new Date(workerDebug.lastRunAt).toLocaleString() : 'never'}
          </Text>
          <Text style={styles.debugText}>result: {workerDebug?.lastResult ?? 'unknown'}</Text>
          <Text style={styles.debugText}>message: {workerDebug?.lastMessage || '-'}</Text>
          <Text style={styles.debugText}>index: {workerDebug?.currentIndex ?? 0}</Text>
        </View>
      )}

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#7c3aed" />
          <Text style={styles.loadingText}>{t('loading_nfts')}</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{t('load_failed', { error })}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={refreshList}>
            <Text style={styles.retryText}>{t('retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : nfts.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🔍</Text>
          <Text style={styles.emptyText}>{t('empty_nfts')}</Text>
          <Text style={styles.emptySubtext}>{t('empty_nfts_sub')}</Text>
        </View>
      ) : (
        <View style={styles.listSection}>
          <FlatList
            data={nfts}
            keyExtractor={item => `${item.contractAddress}-${item.tokenId}`}
            numColumns={2}
            style={styles.nftList}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={styles.row}
            renderItem={({ item }) => (
              <NFTCard
                item={item}
                selected={
                  selectedNFT?.contractAddress === item.contractAddress &&
                  selectedNFT?.tokenId === item.tokenId
                }
                onPress={() =>
                  setSelectedNFT(prev =>
                    prev?.contractAddress === item.contractAddress &&
                    prev?.tokenId === item.tokenId
                      ? null
                      : item
                  )
                }
              />
            )}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <Text style={styles.count}>
                {t('page_info', { page: currentPage })}
                {totalCount ? t('total_count', { count: totalCount }) : ''}
                {t('page_select_hint')}
              </Text>
            }
          />

          {/* Pagination */}
          <View style={styles.pagination}>
            <TouchableOpacity
              style={[styles.pageBtn, currentPage <= 1 && styles.pageBtnDisabled]}
              onPress={goPrevPage}
              disabled={currentPage <= 1}
            >
              <Text style={styles.pageBtnText}>{t('prev_page')}</Text>
            </TouchableOpacity>
            <Text style={styles.pageNum}>
              {currentPage} / {(() => {
                const est = totalCount ? Math.ceil(totalCount / PAGE_SIZE) : 0;
                const known = nextPageKey ? currentPage + 1 : currentPage;
                return est > 0 ? Math.max(est, known) : '?';
              })()}
            </Text>
            <TouchableOpacity
              style={[styles.pageBtn, !nextPageKey && styles.pageBtnDisabled]}
              onPress={goNextPage}
              disabled={!nextPageKey}
            >
              <Text style={styles.pageBtnText}>{t('next_page')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>

    {/* 開 App 提示目前桌布 NFT */}
    <Modal
      visible={!!wallpaperNotice}
      transparent
      animationType="fade"
      onRequestClose={() => setWallpaperNotice(null)}
    >
      {wallpaperNotice && (
        <WallpaperNoticeDialog
          record={wallpaperNotice}
          onClose={() => setWallpaperNotice(null)}
        />
      )}
    </Modal>
    </>
  );
}

// ─── Wallpaper Notice Dialog ─────────────────────────────────────────────────

function WallpaperNoticeDialog({
  record,
  onClose,
}: {
  record: WallpaperRecord;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const nft = record.nft;
  const url = buildAssetUrl(nft);
  const thumbnail = resolveUrl(nft.imageUrl);

  const handleView = useCallback(async () => {
    if (!url) {
      onClose();
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      // 開啟外部瀏覽器失敗就靜默關閉
    }
    onClose();
  }, [url, onClose]);

  return (
    <View style={dialog.backdrop}>
      <View style={dialog.card}>
        <Text style={dialog.title}>{t('wallpaper_notice_title')}</Text>
        {thumbnail ? (
          <Image
            source={{ uri: thumbnail }}
            style={dialog.image}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={[dialog.image, dialog.noImage]}>
            <Text style={dialog.noImageText}>🖼️</Text>
          </View>
        )}
        <Text style={dialog.name} numberOfLines={2}>{nft.name || `#${nft.tokenId}`}</Text>
        {!!nft.collectionName && (
          <Text style={dialog.collection} numberOfLines={1}>{nft.collectionName}</Text>
        )}
        <View style={dialog.actions}>
          <TouchableOpacity style={[dialog.btn, dialog.btnSecondary]} onPress={onClose}>
            <Text style={dialog.btnTextSecondary}>{t('wallpaper_notice_close')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[dialog.btn, dialog.btnPrimary, !url && dialog.btnDisabled]}
            onPress={handleView}
            disabled={!url}
          >
            <Text style={dialog.btnTextPrimary}>{t('wallpaper_notice_view')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  backBtn: { padding: 8 },
  backText: { color: '#a78bfa', fontSize: 16 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  refreshBtn: { padding: 8 },
  walletSection: { backgroundColor: '#111827' },
  walletRow: { paddingTop: 6, flexDirection: 'row', alignItems: 'center' },
  walletRowHint: {
    color: '#6b7280',
    fontSize: 11,
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingTop: 2,
    lineHeight: 15,
  },
  gearBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    borderRadius: 18,
  },
  gearBtnActive: { backgroundColor: '#1e293b' },
  gearIcon: { fontSize: 18, color: '#6b7280' },
  walletChips: {
    paddingHorizontal: 12,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 0,
  },
  walletChip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 20,
    paddingLeft: 4,
    paddingRight: 2,
    backgroundColor: '#1f2937',
  },
  walletChipMain: { paddingVertical: 5, paddingLeft: 8, paddingRight: 4 },
  walletChipMenuBtn: { paddingVertical: 5, paddingHorizontal: 6, justifyContent: 'center' },
  walletChipMenuIcon: { color: '#9ca3af', fontSize: 16, fontWeight: '700', lineHeight: 18 },
  walletChipSelected: { borderColor: '#6366f1', backgroundColor: '#1e1b4b' },
  walletChipTezos: { borderColor: '#0d9488' },
  walletChipTezosSelected: { borderColor: '#0d9488', backgroundColor: '#042f2e' },
  walletChipLabel: { color: '#9ca3af', fontSize: 12, fontFamily: 'monospace' },
  walletChipLabelSelected: { color: '#a5b4fc', fontWeight: '700' },
  walletChipAdd: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: '#4b5563',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletChipAddText: { color: '#6b7280', fontSize: 18, lineHeight: 22 },
  refreshText: { color: '#a78bfa', fontSize: 22 },

  // Wallpaper bar
  wallpaperBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    gap: 10,
  },
  wallpaperHint: { color: '#9ca3af', fontSize: 12, flexShrink: 1 },
  wallpaperBtn: {
    backgroundColor: '#7c3aed',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  wallpaperBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  autoToggleBtn: {
    backgroundColor: '#374151',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  autoToggleBtnOn: { backgroundColor: '#065f46' },
  autoToggleText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  testWorkerBtn: {
    backgroundColor: '#1e3a5f',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  testWorkerText: { color: '#93c5fd', fontSize: 12, fontWeight: '600' },

  // Daily banner
  intervalPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  intervalLabel: { color: '#94a3b8', fontSize: 12 },
  intervalChip: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1e293b',
  },
  intervalChipActive: {
    borderColor: '#7c3aed',
    backgroundColor: '#4c1d95',
  },
  intervalChipText: { color: '#94a3b8', fontSize: 12 },
  intervalChipTextActive: { color: '#e9d5ff', fontWeight: '700' },
  dailyBanner: {
    backgroundColor: '#1e3a5f',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  dailyBannerText: { color: '#93c5fd', fontSize: 12, textAlign: 'center' },
  debugBanner: {
    backgroundColor: '#111827',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
  },
  debugTitle: { color: '#f59e0b', fontSize: 12, fontWeight: '700', marginBottom: 2 },
  debugText: { color: '#d1d5db', fontSize: 11 },

  // Grid
  listSection: { flex: 1 },
  nftList: { flex: 1 },
  count: { color: '#6b7280', fontSize: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  grid: { paddingHorizontal: 16, paddingBottom: 16 },
  row: { justifyContent: 'space-between' },
  card: {
    width: CARD_SIZE,
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#1f2937',
  },
  cardSelected: { borderColor: '#7c3aed', borderWidth: 2 },
  selectedBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#7c3aed',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedBadgeText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  chainBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  chainBadgeTezos: { backgroundColor: '#0d9488' },
  chainBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  image: { width: CARD_SIZE, height: CARD_SIZE },
  noImage: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111827' },
  noImageText: { fontSize: 40 },
  cardInfo: { padding: 10 },
  nftName: { color: '#f3f4f6', fontSize: 13, fontWeight: '600' },
  collectionName: { color: '#6b7280', fontSize: 11, marginTop: 3 },

  // Pagination
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'android' ? 44 + 12 : 12,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    backgroundColor: '#0f0f1a',
  },
  pageBtn: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#374151',
  },
  pageBtnDisabled: { opacity: 0.3 },
  pageBtnText: { color: '#a78bfa', fontSize: 14, fontWeight: '600' },
  pageNum: { color: '#e5e7eb', fontSize: 15, fontWeight: '700' },

  // Status
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingText: { color: '#9ca3af', marginTop: 16, fontSize: 15 },
  errorText: { color: '#f87171', fontSize: 14, marginBottom: 16, textAlign: 'center' },
  retryBtn: { backgroundColor: '#7c3aed', paddingVertical: 12, paddingHorizontal: 32, borderRadius: 10 },
  retryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: '#e5e7eb', fontSize: 18, fontWeight: '600' },
  emptySubtext: { color: '#6b7280', fontSize: 13, marginTop: 6 },
});

const dialog = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 12,
  },
  title: {
    color: '#a78bfa',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  image: {
    width: 220,
    height: 220,
    borderRadius: 12,
    backgroundColor: '#0f0f1a',
    marginBottom: 16,
  },
  noImage: { alignItems: 'center', justifyContent: 'center' },
  noImageText: { fontSize: 48 },
  name: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  collection: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  btn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondary: {
    backgroundColor: '#374151',
  },
  btnPrimary: {
    backgroundColor: '#7c3aed',
  },
  btnDisabled: { opacity: 0.4 },
  btnTextSecondary: { color: '#e5e7eb', fontSize: 15, fontWeight: '600' },
  btnTextPrimary: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
});
