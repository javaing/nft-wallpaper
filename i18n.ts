import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import zh from './locales/zh';
import en from './locales/en';
import ja from './locales/ja';

const locale = getLocales()[0];
// languageCode 在部分 Android 版本可能為 null，優先用 languageTag 解析
const deviceLang = locale?.languageCode ?? locale?.languageTag ?? '';

function resolveLanguage(lang: string): 'zh' | 'en' | 'ja' {
  if (lang.startsWith('ja')) return 'ja';
  if (lang.startsWith('zh')) return 'zh';
  if (lang.length === 0) return 'en'; // 完全無法取得語言時 fallback 英文
  return 'en';
}

const resolvedLng = resolveLanguage(deviceLang);
console.log('[i18n] locale:', locale?.languageTag, '→', resolvedLng);

i18n
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
      ja: { translation: ja },
    },
    lng: resolvedLng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export default i18n;
