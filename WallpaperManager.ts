import { NativeModules, Platform } from 'react-native';

const { WallpaperModule } = NativeModules;

function checkModule() {
  if (Platform.OS !== 'android') throw new Error('自動設定桌布只支援 Android');
  if (!WallpaperModule) throw new Error('WallpaperModule 原生模組未載入，請重新 build APK');
}

/** 手動設定桌布（傳入 file:// URI） */
export async function setWallpaperDirect(fileUri: string): Promise<void> {
  checkModule();
  return WallpaperModule.setWallpaper(fileUri);
}

/** 儲存錢包地址與 API Key 到原生 SharedPreferences，供背景 Worker 使用 */
export async function saveWalletSettings(address: string, apiKey: string): Promise<void> {
  checkModule();
  return WallpaperModule.saveWalletSettings(address, apiKey);
}

export type WallpaperInterval = '15min' | 'daily';

/** 啟用或停用自動換桌布（Android WorkManager） */
export async function scheduleDailyWallpaper(enabled: boolean, interval: WallpaperInterval = 'daily'): Promise<void> {
  checkModule();
  return WallpaperModule.scheduleDailyWallpaper(enabled, interval);
}

/** 檢查是否已豁免電池優化 */
export async function isBatteryOptimizationIgnored(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (!NativeModules.WallpaperModule) return true;
  return NativeModules.WallpaperModule.isBatteryOptimizationIgnored();
}

/** 請求豁免電池優化（會彈出系統對話框）；回傳 true 代表已豁免 */
export async function requestBatteryOptimizationExemption(): Promise<boolean> {
  checkModule();
  return WallpaperModule.requestBatteryOptimizationExemption();
}

/** 立即觸發一次 Worker（測試用） */
export async function testWorkerNow(): Promise<void> {
  checkModule();
  return WallpaperModule.testWorkerNow();
}

export type WorkerDebugStatus = {
  lastRunAt: number;
  lastResult: string;
  lastMessage: string;
  currentIndex: number;
};

/** 讀取 Worker 偵錯狀態（僅 debug UI 使用） */
export async function getWorkerDebugStatus(): Promise<WorkerDebugStatus> {
  checkModule();
  return WallpaperModule.getWorkerDebugStatus();
}

/** Native SharedPreferences 真實的「目前桌布 NFT」記錄 */
export type NativeCurrentWallpaper = {
  setDate: string;
  address: string;
  source: 'worker' | 'manual' | '';
  setAt: number; // millis
  nft: {
    chain: 'ethereum' | 'tezos' | '';
    contractAddress: string;
    tokenId: string;
    name: string;
    collectionName: string;
    imageUrl: string;
    wallpaperUrl: string;
  };
};

/** 讀取目前實際生效的桌布 NFT（背景 Worker 或手動設定後寫入） */
export async function getCurrentWallpaper(): Promise<NativeCurrentWallpaper | null> {
  if (Platform.OS !== 'android') return null;
  if (!NativeModules.WallpaperModule) return null;
  return NativeModules.WallpaperModule.getCurrentWallpaper();
}

/** JS 端手動設定桌布後同步寫入 native，讓 Worker 與 JS 共享同一份狀態 */
export async function recordCurrentWallpaper(record: {
  setDate?: string;
  address?: string;
  nft: {
    chain: 'ethereum' | 'tezos';
    contractAddress: string;
    tokenId: string;
    name: string;
    collectionName: string;
    imageUrl: string;
    wallpaperUrl?: string;
  };
}): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!NativeModules.WallpaperModule) return;
  return NativeModules.WallpaperModule.recordCurrentWallpaper(record);
}
