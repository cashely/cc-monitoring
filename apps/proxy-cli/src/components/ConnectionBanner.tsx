import { useTranslation } from 'react-i18next'

export function ConnectionBanner({ connected }: { connected: boolean }) {
  const { t } = useTranslation('app')

  if (connected) return null

  return (
    <div className="bg-red-500 text-white px-4 py-2 text-center font-medium fixed top-0 left-0 right-0 z-50">
      {t('connection.disconnected')}
    </div>
  )
}
