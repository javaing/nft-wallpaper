export default {
  // QR Scanner
  loading_camera: 'Loading camera permission...',
  camera_permission_required: 'Camera permission is required to scan QR codes',
  grant_camera: 'Grant Camera Permission',
  cancel: 'Cancel',
  retry: 'Retry',
  unrecognized_qr: 'Unrecognized',
  unrecognized_qr_msg: 'This QR Code is not a supported wallet address\n(Ethereum / Tezos supported)',
  scan_hint: 'Point at your wallet QR Code',
  scan_hint2: 'Supports Ethereum and Tezos addresses',

  // Login
  app_title: 'NFT Wallpaper',
  app_subtitle: 'Connect your Ethereum or Tezos wallet\nand set NFTs as your daily wallpaper',
  metamask_login: '🦊 Login with MetaMask',
  metamask_install: '🦊 Install MetaMask',
  metamask_detecting: 'Detecting MetaMask...',
  metamask_connecting: 'Connecting...',
  metamask_install_hint: 'Tap to open Google Play',
  metamask_not_installed_title: 'MetaMask not installed',
  metamask_not_installed_msg: 'Please install MetaMask from Google Play first.',
  go_install: 'Install',
  connect_failed: 'Connection Failed',
  connect_failed_msg: 'Could not connect to MetaMask. Please try again.',
  or: 'or',
  scan_qr: '📷 Scan Wallet QR Code',
  metamask_download_hint: 'MetaMask is available on Google Play / App Store',

  // NFT Screen header
  my_nfts: 'My NFTs',
  back: '← Back',

  // Wallpaper bar
  wallpaper_select_hint: 'Select an NFT to set as wallpaper',
  wallpaper_selected: 'Selected: {{name}}',
  wallpaper_today: '✅ Today\'s wallpaper: {{name}}',
  wallpaper_last: '⏰ Last set: {{name}}',
  set_wallpaper: '🖼 Set Wallpaper',
  daily_banner: '📅 No wallpaper change today! Pick a new NFT',

  // NFT list
  page_info: 'Page {{page}}',
  total_count: ' of {{count}}',
  page_select_hint: ' · Tap to select, then set as wallpaper',
  loading_nfts: 'Loading NFTs...',
  load_failed: 'Failed to load: {{error}}',
  empty_nfts: 'No NFTs in this wallet',
  empty_nfts_sub: 'Shows Ethereum mainnet and Tezos NFTs only',
  prev_page: '← Prev',
  next_page: 'Next →',

  // Wallpaper actions
  select_nft_first: 'Select an NFT first',
  select_nft_first_msg: 'Tap an NFT image, then press "Set Wallpaper"',
  wallpaper_done: '✅ Wallpaper set!',
  wallpaper_failed: 'Failed',
  no_image: 'This NFT has no image',
  download_failed: 'Image download failed',

  // Auto wallpaper
  auto_wallpaper: 'Auto Wallpaper',
  auto_on: 'On',
  auto_off: 'Off',
  interval_label: 'Update interval',
  interval_15min: 'Every 15 min',
  interval_daily: 'Daily',
  battery_opt_title: 'Battery Optimization',
  battery_opt_msg: 'To ensure wallpapers update automatically in the background, please allow this app to ignore battery optimizations.',
  battery_opt_allow: 'Allow',

  // Wallet chips
  add_wallet: '+ Add Wallet',
  remove_wallet: 'Remove Wallet',
  remove_wallet_confirm: 'Remove this wallet?',
  wallet_row_hint: 'Tap to switch wallet. Long-press or tap ⋮ to remove this address.',
  remove: 'Remove',
  eth_chain: 'ETH',
  tezos_chain: 'XTZ',
} as const;
