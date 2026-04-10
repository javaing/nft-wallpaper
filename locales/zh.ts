export default {
  // QR Scanner
  loading_camera: '載入相機權限中...',
  camera_permission_required: '需要相機權限才能掃描 QR Code',
  grant_camera: '授予相機權限',
  cancel: '取消',
  retry: '重試',
  unrecognized_qr: '無法識別',
  unrecognized_qr_msg: '此 QR Code 不是支援的錢包地址格式\n(支援 Ethereum / Tezos)',
  scan_hint: '對準錢包的 QR Code 進行掃描',
  scan_hint2: '支援 Ethereum 與 Tezos 地址',

  // Login
  app_title: 'NFT Wallpaper',
  app_subtitle: '連結你的以太坊或 Tezos 錢包\n將 NFT 設為每日桌布',
  metamask_login: '🦊 使用 MetaMask 登入',
  metamask_install: '🦊 安裝 MetaMask',
  metamask_detecting: '偵測 MetaMask...',
  metamask_connecting: '連線中...',
  metamask_install_hint: '點擊前往 Google Play 下載',
  metamask_not_installed_title: '尚未安裝 MetaMask',
  metamask_not_installed_msg: '請先從 Google Play 安裝 MetaMask 應用程式。',
  go_install: '前往安裝',
  connect_failed: '連線失敗',
  connect_failed_msg: '無法連線至 MetaMask，請重試。',
  or: '或',
  scan_qr: '📷 掃描錢包 QR Code',
  metamask_download_hint: 'MetaMask App 可在 Google Play / App Store 下載',

  // NFT Screen header
  my_nfts: '我的 NFT',
  back: '← 返回',

  // Wallpaper bar
  wallpaper_select_hint: '點選 NFT 後設為桌布',
  wallpaper_selected: '已選：{{name}}',
  wallpaper_today: '✅ 今日桌布：{{name}}',
  wallpaper_last: '⏰ 上次設定：{{name}}',
  set_wallpaper: '🖼 設為桌布',
  daily_banner: '📅 今天還沒換桌布！選一張新的 NFT 吧',

  // NFT list
  page_info: '第 {{page}} 頁',
  total_count: '，共 {{count}} 個',
  page_select_hint: ' · 點擊選取後按「設為桌布」',
  loading_nfts: '載入 NFT 中...',
  load_failed: '載入失敗：{{error}}',
  empty_nfts: '此錢包沒有 NFT',
  empty_nfts_sub: '只顯示以太坊主網與 Tezos 的 NFT',
  prev_page: '← 上一頁',
  next_page: '下一頁 →',

  // Wallpaper actions
  select_nft_first: '請先選擇 NFT',
  select_nft_first_msg: '點擊一張 NFT 圖片後再按「設為桌布」',
  wallpaper_done: '✅ 桌布已設定！',
  wallpaper_failed: '設定失敗',
  no_image: '此 NFT 沒有圖片',
  download_failed: '圖片下載失敗',

  // Auto wallpaper
  auto_wallpaper: '自動換桌布',
  auto_on: '開啟',
  auto_off: '關閉',
  interval_label: '更新頻率',
  interval_15min: '每 15 分鐘',
  interval_daily: '每日',
  battery_opt_title: '建議關閉電池優化',
  battery_opt_msg: '為確保桌布能在背景自動更換，請允許此 App 不受電池優化限制。',
  battery_opt_allow: '立即設定',

  // Wallet chips
  add_wallet: '+ 新增錢包',
  remove_wallet: '移除此錢包',
  remove_wallet_confirm: '確定要移除此錢包嗎？',
  remove: '移除',
  eth_chain: 'ETH',
  tezos_chain: 'XTZ',
} as const;
