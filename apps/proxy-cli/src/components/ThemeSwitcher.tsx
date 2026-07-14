import { useTranslation } from 'react-i18next'
import { Sun, Moon } from 'lucide-react'
import { useTheme } from '../hooks'

export function ThemeSwitcher(): JSX.Element {
  const { t } = useTranslation('app')
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      onClick={toggleTheme}
      title={t('theme.toggle')}
      className="flex items-center gap-1 px-2 py-1 rounded border border-border bg-bg-secondary text-text-primary text-sm hover:bg-bg-hover"
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      {theme === 'dark' ? t('theme.light') : t('theme.dark')}
    </button>
  )
}
