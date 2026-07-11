import { useTranslation } from 'react-i18next'

export function ChatUI(): JSX.Element {
  const { t } = useTranslation('app')

  return (
    <div className="bg-bg-card rounded-lg p-4 h-full flex flex-col">
      <h2 className="text-sm font-semibold mb-4">{t('chat.title')}</h2>
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        {t('chat.placeholder')}
      </div>
    </div>
  )
}
