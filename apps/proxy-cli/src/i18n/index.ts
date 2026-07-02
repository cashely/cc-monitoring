import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import zhCommon from './locales/zh/common.json'
import zhApp from './locales/zh/app.json'
import zhStatus from './locales/zh/status.json'
import zhLog from './locales/zh/log.json'
import zhConfig from './locales/zh/config.json'
import zhProviders from './locales/zh/providers.json'

import enCommon from './locales/en/common.json'
import enApp from './locales/en/app.json'
import enStatus from './locales/en/status.json'
import enLog from './locales/en/log.json'
import enConfig from './locales/en/config.json'
import enProviders from './locales/en/providers.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      zh: {
        common: zhCommon,
        app: zhApp,
        status: zhStatus,
        log: zhLog,
        config: zhConfig,
        providers: zhProviders
      },
      en: {
        common: enCommon,
        app: enApp,
        status: enStatus,
        log: enLog,
        config: enConfig,
        providers: enProviders
      }
    },
    fallbackLng: 'zh',
    ns: ['common', 'app', 'status', 'log', 'config', 'providers'],
    defaultNS: 'common',
    interpolation: {
      escapeValue: false
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng'
    }
  })

i18n.on('languageChanged', () => {
  document.title = i18n.t('app:title')
})

export default i18n