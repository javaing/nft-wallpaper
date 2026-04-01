import 'react-native-get-random-values';
import '@ethersproject/shims';

// BackHandler.removeEventListener was removed in RN 0.73+
// react-native-modal (inside @walletconnect/modal-react-native) still calls it
import { BackHandler } from 'react-native';
if (typeof (BackHandler as any).removeEventListener === 'undefined') {
  (BackHandler as any).removeEventListener = () => {};
}
