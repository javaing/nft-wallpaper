export default {
  // QR Scanner
  loading_camera: 'カメラの権限を読み込み中...',
  camera_permission_required: 'QRコードをスキャンするにはカメラの権限が必要です',
  grant_camera: 'カメラの権限を付与',
  cancel: 'キャンセル',
  retry: '再試行',
  unrecognized_qr: '認識できません',
  unrecognized_qr_msg: 'このQRコードはサポートされているウォレットアドレスではありません\n(Ethereum / Tezos対応)',
  scan_hint: 'ウォレットのQRコードに向けてください',
  scan_hint2: 'EthereumとTezosのアドレスに対応',

  // Login
  app_title: 'NFT Wallpaper',
  app_subtitle: 'EthereumまたはTezosウォレットを接続して\nNFTを毎日の壁紙に設定しましょう',
  metamask_login: '🦊 MetaMaskでログイン',
  metamask_install: '🦊 MetaMaskをインストール',
  metamask_detecting: 'MetaMaskを検出中...',
  metamask_connecting: '接続中...',
  metamask_install_hint: 'Google Playを開く',
  metamask_not_installed_title: 'MetaMaskがインストールされていません',
  metamask_not_installed_msg: '先にGoogle PlayからMetaMaskをインストールしてください。',
  go_install: 'インストール',
  connect_failed: '接続失敗',
  connect_failed_msg: 'MetaMaskに接続できませんでした。もう一度お試しください。',
  or: 'または',
  scan_qr: '📷 ウォレットQRコードをスキャン',
  metamask_download_hint: 'MetaMaskはGoogle Play / App Storeで入手できます',

  // NFT Screen header
  my_nfts: 'マイNFT',
  back: '← 戻る',

  // Wallpaper notice dialog (アプリ起動時)
  wallpaper_notice_title: '現在の壁紙',
  wallpaper_notice_close: '閉じる',
  wallpaper_notice_view: '詳細を見る',

  // Wallpaper bar
  wallpaper_select_hint: 'NFTを選択して壁紙に設定',
  wallpaper_selected: '選択中：{{name}}',
  wallpaper_today: '✅ 今日の壁紙：{{name}}',
  wallpaper_last: '⏰ 前回設定：{{name}}',
  set_wallpaper: '🖼 壁紙に設定',
  daily_banner: '📅 今日はまだ壁紙を変えていません！新しいNFTを選びましょう',

  // NFT list
  page_info: '{{page}}ページ目',
  total_count: '（全{{count}}件）',
  page_select_hint: ' · タップして選択後、壁紙に設定',
  loading_nfts: 'NFTを読み込み中...',
  load_failed: '読み込み失敗：{{error}}',
  empty_nfts: 'このウォレットにNFTはありません',
  empty_nfts_sub: 'Ethereumメインネットとテゾスのみ表示',
  prev_page: '← 前へ',
  next_page: '次へ →',

  // Wallpaper actions
  select_nft_first: '先にNFTを選択してください',
  select_nft_first_msg: 'NFT画像をタップしてから「壁紙に設定」を押してください',
  wallpaper_done: '✅ 壁紙を設定しました！',
  wallpaper_failed: '設定失敗',
  no_image: 'このNFTには画像がありません',
  download_failed: '画像のダウンロードに失敗しました',

  // Auto wallpaper
  auto_wallpaper: '自動壁紙変更',
  auto_on: 'オン',
  auto_off: 'オフ',
  interval_label: '更新頻度',
  interval_15min: '15分ごと',
  interval_daily: '毎日',
  battery_opt_title: 'バッテリー最適化',
  battery_opt_msg: 'バックグラウンドで壁紙を自動更新するため、バッテリー最適化の対象から除外することをお勧めします。',
  battery_opt_allow: '設定する',

  // Wallet chips
  add_wallet: '+ ウォレット追加',
  remove_wallet: 'ウォレットを削除',
  remove_wallet_confirm: 'このウォレットを削除しますか？',
  wallet_row_hint: 'タップで切替。長押しまたは右の ⋮ でこのアドレスを削除できます。',
  remove: '削除',
  eth_chain: 'ETH',
  tezos_chain: 'XTZ',
} as const;
