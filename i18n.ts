import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import zh from './locales/zh';
import en from './locales/en';
import ja from './locales/ja';

const deviceLang = getLocales()[0]?.languageCode ?? 'zh';

// 對應手機語言代碼到我們支援的語言
function resolveLanguage(lang: string): 'zh' | 'en' | 'ja' {
  if (lang.startsWith('ja')) return 'ja';
  if (lang.startsWith('zh')) return 'zh';
  return 'en'; // 其他語言 fallback 英文
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
      ja: { translation: ja },
    },
    lng: resolveLanguage(deviceLang),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export default i18n;
