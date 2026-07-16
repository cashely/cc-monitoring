import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'

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
      className="flex items-center justify-center w-8 h-8 rounded border border-border bg-bg-secondary text-text-primary text-sm hover:bg-bg-hover"
    >
      <Languages size={16} />
    </button>
  )
}