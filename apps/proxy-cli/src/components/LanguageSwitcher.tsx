import { useTranslation } from 'react-i18next'

export function LanguageSwitcher(): JSX.Element {
  const { i18n } = useTranslation()

  const toggleLanguage = () => {
    const nextLng = i18n.language === 'zh' ? 'en' : 'zh'
    i18n.changeLanguage(nextLng)
  }

  return (
    <button
      onClick={toggleLanguage}
      title={i18n.language === 'zh' ? 'Switch to English' : '切换为中文'}
      className="px-3 py-1 rounded border border-border bg-bg-secondary text-text-primary text-sm hover:bg-bg-hover transition-colors"
    >
      {i18n.language === 'zh' ? 'EN' : '中'}
    </button>
  )
}