# NFT Wallpaper - 設定指南

## 第一步：取得 WalletConnect Project ID

1. 前往 https://cloud.walletconnect.com/ 註冊帳號
2. 建立新專案（免費方案即可）
3. 複製 Project ID
4. 打開 `App.tsx`，將第 7 行的 `'YOUR_WALLETCONNECT_PROJECT_ID'` 換成你的 ID

```typescript
const PROJECT_ID = '貼上你的 Project ID';
```

## 第二步：安裝依賴並執行

```bash
# 安裝依賴（已完成）
npm install

# 啟動開發伺服器
npm start

# 或直接對 Android 執行
npm run android
```

## 第三步：測試 MetaMask 登入

1. 在手機上安裝 **MetaMask** App
2. 用 Expo Go 掃描 QR Code 開啟 App（或直接安裝 APK）
3. 點擊「使用 MetaMask 登入」
4. 選擇 MetaMask，手機會跳轉到 MetaMask App 確認連線
5. 確認後回到 App，即可看到錢包地址

## 目前功能

- [x] MetaMask 登入（WalletConnect v2）
- [x] 顯示以太坊錢包地址
- [x] 斷開連線
- [ ] 取得 NFT 清單（下一版）
- [ ] 設定 NFT 為桌布（下一版）
- [ ] 每日自動更新（下一版）

## 注意事項

- **Expo Go 限制**：`@walletconnect/modal-react-native` 需要原生模組，
  建議用 `npx expo run:android` 建立 dev build，或使用 Expo EAS Build。
- MetaMask deep link (`nftwallpaper://`) 已在 `app.json` 設定。
- 目前連接以太坊主網（Chain ID: 1）。

## 專案結構

```
nft-wallpaper/
├── App.tsx          # 主要畫面邏輯（MetaMask 登入 + 錢包地址顯示）
├── app.json         # Expo 設定（包含 deep link scheme）
├── index.ts         # App 入口點
└── SETUP.md         # 本設定文件
```
