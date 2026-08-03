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
      className="flex items-center justify-center w-8 h-8 rounded bg-bg-secondary text-text-primary text-sm hover:bg-bg-hover"
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
