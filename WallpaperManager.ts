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

/** 啟用或停用自動換桌布（Android WorkManager，間隔由原生端設定） */
export async function scheduleDailyWallpaper(enabled: boolean): Promise<void> {
  checkModule();
  return WallpaperModule.scheduleDailyWallpaper(enabled);
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
