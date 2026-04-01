import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TouchableOpacity, Alert, Modal, Linking, Platform } from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import { WalletConnectModal, useWalletConnectModal } from '@walletconnect/modal-react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import NFTScreen from './NFTScreen';

const STORAGE_KEY_WALLETS = 'saved_wallets_v2';

const PROJECT_ID = '33c0083faa0a50142b461c83b47624e5';

const providerMetadata = {
  name: 'NFT Wallpaper',
  description: '將你的 NFT 設為每日桌布',
  url: 'https://nftwallpaper.app',
  icons: ['https://avatars.githubusercontent.com/u/37784886'],
  redirect: {
    native: 'nftwallpaper://',
    universal: 'https://nftwallpaper.app',
  },
};

// 解析 QR Code 內容：ethereum:0x... / 0x... / tz1/tz2/tz3...
function parseWalletAddress(raw: string): string | null {
  const cleaned = raw.trim();
  const eipMatch = cleaned.match(/^ethereum:(0x[0-9a-fA-F]{40})/i);
  if (eipMatch) return eipMatch[1];
  if (/^0x[0-9a-fA-F]{40}$/i.test(cleaned)) return cleaned;
  if (/^tz[123][1-9A-HJ-NP-Za-km-z]{33}$/.test(cleaned)) return cleaned;
  return null;
}

function QRScanner({
  onScan,
  onClose,
}: {
  onScan: (address: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  const handleBarcode = useCallback(
    ({ data }: { data: string }) => {
      if (scanned) return;
      const address = parseWalletAddress(data);
      if (address) {
        setScanned(true);
        onScan(address);
      } else {
        Alert.alert(t('unrecognized_qr'), t('unrecognized_qr_msg'), [
          { text: t('retry'), onPress: () => setScanned(false) },
          { text: t('cancel'), onPress: onClose },
        ]);
        setScanned(true);
      }
    },
    [scanned, onScan, onClose, t]
  );

  if (!permission) return <View style={scanner.center}><Text style={scanner.text}>{t('loading_camera')}</Text></View>;

  if (!permission.granted) {
    return (
      <View style={scanner.center}>
        <Text style={scanner.text}>{t('camera_permission_required')}</Text>
        <TouchableOpacity style={scanner.btn} onPress={requestPermission}>
          <Text style={scanner.btnText}>{t('grant_camera')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[scanner.btn, scanner.cancelBtn]} onPress={onClose}>
          <Text style={scanner.btnText}>{t('cancel')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleBarcode}
      />
      <View style={scanner.overlay}>
        <View style={scanner.topMask} />
        <View style={scanner.middle}>
          <View style={scanner.sideMask} />
          <View style={scanner.frame}>
            <View style={[scanner.corner, scanner.tl]} />
            <View style={[scanner.corner, scanner.tr]} />
            <View style={[scanner.corner, scanner.bl]} />
            <View style={[scanner.corner, scanner.br]} />
          </View>
          <View style={scanner.sideMask} />
        </View>
        <View style={scanner.bottomMask}>
          <Text style={scanner.hint}>{t('scan_hint')}</Text>
          <Text style={scanner.hint2}>{t('scan_hint2')}</Text>
          <TouchableOpacity style={[scanner.btn, { marginTop: 16 }]} onPress={onClose}>
            <Text style={scanner.btnText}>{t('cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const METAMASK_DEEP_LINK = 'metamask://';
const METAMASK_PLAY_STORE = 'https://play.google.com/store/apps/details?id=io.metamask';

function MainScreen() {
  const { t } = useTranslation();
  const { open, isConnected, address: wcAddress, provider } = useWalletConnectModal();
  const [isLoading, setIsLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [wallets, setWallets] = useState<string[]>([]);
  const [hasMetaMask, setHasMetaMask] = useState<boolean | null>(null);
  const [appReady, setAppReady] = useState(false);

  // 啟動時讀取已儲存的錢包清單
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY_WALLETS)
      .then(raw => {
        if (raw) {
          try { setWallets(JSON.parse(raw)); } catch {}
        } else {
          // 相容舊版單一地址
          return AsyncStorage.getItem('saved_wallet_address').then(old => {
            if (old) setWallets([old]);
          });
        }
      })
      .finally(() => setAppReady(true));
  }, []);

  // WalletConnect 連線後自動加入錢包清單
  useEffect(() => {
    if (wcAddress && !wallets.includes(wcAddress)) {
      addWallet(wcAddress);
    }
  }, [wcAddress]);

  useEffect(() => {
    Linking.canOpenURL(METAMASK_DEEP_LINK)
      .then(s => setHasMetaMask(s))
      .catch(() => setHasMetaMask(false));
  }, []);

  const saveWallets = useCallback(async (list: string[]) => {
    setWallets(list);
    await AsyncStorage.setItem(STORAGE_KEY_WALLETS, JSON.stringify(list));
  }, []);

  const addWallet = useCallback(async (address: string) => {
    setWallets(prev => {
      if (prev.includes(address)) return prev;
      if (prev.length >= 10) {
        Alert.alert(t('remove_wallet'), '10');
        return prev;
      }
      const next = [...prev, address];
      AsyncStorage.setItem(STORAGE_KEY_WALLETS, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleRemoveWallet = useCallback(async (address: string) => {
    if (wcAddress === address && isConnected) {
      try { await provider?.disconnect(); } catch {}
    }
    setWallets(prev => {
      const next = prev.filter(a => a !== address);
      AsyncStorage.setItem(STORAGE_KEY_WALLETS, JSON.stringify(next));
      return next;
    });
  }, [wcAddress, isConnected, provider]);

  const handleQRScan = useCallback(async (address: string) => {
    setShowScanner(false);
    await addWallet(address);
  }, [addWallet]);

  const handleConnect = useCallback(async () => {
    if (hasMetaMask === false) {
      Alert.alert(t('metamask_not_installed_title'), t('metamask_not_installed_msg'), [
        { text: t('go_install'), onPress: () => Linking.openURL(METAMASK_PLAY_STORE) },
        { text: t('cancel'), style: 'cancel' },
      ]);
      return;
    }
    try {
      setIsLoading(true);
      await open();
    } catch {
      Alert.alert(t('connect_failed'), t('connect_failed_msg'));
    } finally {
      setIsLoading(false);
    }
  }, [open, hasMetaMask]);

  if (!appReady) return <View style={styles.container}><StatusBar style="light" /></View>;

  // 有錢包就進 NFTScreen，從那裡管理錢包
  if (wallets.length > 0) {
    return (
      <>
        <NFTScreen
          wallets={wallets}
          onAddWallet={() => setShowScanner(true)}
          onRemoveWallet={handleRemoveWallet}
        />
        <Modal visible={showScanner} animationType="slide" onRequestClose={() => setShowScanner(false)}>
          <QRScanner onScan={handleQRScan} onClose={() => setShowScanner(false)} />
        </Modal>
      </>
    );
  }

  // 登入畫面
  return (
    <>
      <View style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.card}>
          <Text style={styles.logo}>🖼️</Text>
          <Text style={styles.title}>{t('app_title')}</Text>
          <Text style={styles.subtitle}>{t('app_subtitle')}</Text>

          <TouchableOpacity
            style={[
              styles.connectButton,
              (isLoading || hasMetaMask === null) && styles.buttonDisabled,
              hasMetaMask === false && styles.connectButtonInstall,
            ]}
            onPress={handleConnect}
            disabled={isLoading || hasMetaMask === null}
          >
            <Text style={styles.connectText}>
              {isLoading ? t('metamask_connecting')
                : hasMetaMask === null ? t('metamask_detecting')
                : hasMetaMask ? t('metamask_login')
                : t('metamask_install')}
            </Text>
            {hasMetaMask === false && (
              <Text style={styles.connectSubtext}>{t('metamask_install_hint')}</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>{t('or')}</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity style={styles.qrButton} onPress={() => setShowScanner(true)}>
            <Text style={styles.qrText}>{t('scan_qr')}</Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>{t('metamask_download_hint')}</Text>
        </View>
      </View>

      <Modal visible={showScanner} animationType="slide" onRequestClose={() => setShowScanner(false)}>
        <QRScanner onScan={handleQRScan} onClose={() => setShowScanner(false)} />
      </Modal>
    </>
  );
}

export default function App() {
  return (
    <>
      <WalletConnectModal
        projectId={PROJECT_ID}
        providerMetadata={providerMetadata}
        sessionParams={{
          namespaces: {
            eip155: {
              methods: ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData'],
              chains: ['eip155:1'],
              events: ['chainChanged', 'accountsChanged'],
              rpcMap: { 1: 'https://cloudflare-eth.com' },
            },
          },
        }}
      />
      <MainScreen />
    </>
  );
}

const CORNER = 24;
const FRAME = 240;

const scanner = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#0f0f1a', alignItems: 'center', justifyContent: 'center', padding: 32 },
  text: { color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 20 },
  btn: { backgroundColor: '#7c3aed', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12, marginTop: 8, minWidth: 160, alignItems: 'center' },
  cancelBtn: { backgroundColor: '#374151' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  overlay: { flex: 1 },
  topMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  middle: { flexDirection: 'row', height: FRAME },
  sideMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  frame: { width: FRAME, height: FRAME, borderRadius: 4 },
  bottomMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', paddingTop: 24 },
  hint: { color: '#e5e7eb', fontSize: 14, textAlign: 'center' },
  hint2: { color: '#9ca3af', fontSize: 12, textAlign: 'center', marginTop: 4 },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: '#7c3aed', borderWidth: 3 },
  tl: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  tr: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  bl: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  br: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a', alignItems: 'center', justifyContent: 'center', paddingTop: 20, paddingHorizontal: 20, paddingBottom: Platform.OS === 'android' ? 44 + 20 : 20 },
  card: { backgroundColor: '#1a1a2e', borderRadius: 24, padding: 32, width: '100%', alignItems: 'center', shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 10 },
  logo: { fontSize: 64, marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '700', color: '#ffffff', marginBottom: 12 },
  subtitle: { fontSize: 15, color: '#9ca3af', textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  connectButton: { backgroundColor: '#f97316', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 14, width: '100%', alignItems: 'center', marginBottom: 8 },
  buttonDisabled: { opacity: 0.6 },
  connectButtonInstall: { backgroundColor: '#1d4ed8' },
  connectText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  connectSubtext: { color: '#bfdbfe', fontSize: 12, marginTop: 4 },
  divider: { flexDirection: 'row', alignItems: 'center', width: '100%', marginVertical: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#374151' },
  dividerText: { color: '#6b7280', fontSize: 13, marginHorizontal: 12 },
  qrButton: { borderWidth: 1.5, borderColor: '#7c3aed', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 14, width: '100%', alignItems: 'center', marginBottom: 16 },
  qrText: { color: '#a78bfa', fontSize: 16, fontWeight: '600' },
  disclaimer: { color: '#6b7280', fontSize: 12, textAlign: 'center' },
});
