import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RequestDetails } from '../types/request'
import { Tabs } from './Tabs'
import { DiffPanel } from './DiffPanel'

interface Props {
  leftId: string
  rightId: string
  onClose: () => void
}

interface LoadState {
  left?: RequestDetails
  right?: RequestDetails
  loading: boolean
  errorLeft?: string
  errorRight?: string
}

function stringify(value: unknown): string {
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function RequestCompareModal({ leftId, rightId, onClose }: Props): JSX.Element {
  const { t } = useTranslation('app')
  const [state, setState] = useState<LoadState>({ loading: true })

  useEffect(() => {
    let cancelled = false
    setState({ loading: true })

    Promise.allSettled([
      fetch(`/ui/api/requests/${leftId}`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<RequestDetails>
      }),
      fetch(`/ui/api/requests/${rightId}`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<RequestDetails>
      }),
    ]).then(([l, r]) => {
      if (cancelled) return
      setState({
        loading: false,
        left: l.status === 'fulfilled' ? l.value : undefined,
        right: r.status === 'fulfilled' ? r.value : undefined,
        errorLeft: l.status === 'rejected' ? String(l.reason?.message ?? l.reason) : undefined,
        errorRight: r.status === 'rejected' ? String(r.reason?.message ?? r.reason) : undefined,
      })
    })

    return () => {
      cancelled = true
    }
  }, [leftId, rightId])

  if (state.loading) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={onClose}
      >
        <div
          className="bg-bg-primary rounded-lg p-8 text-text-muted"
          onClick={(e) => e.stopPropagation()}
        >
          {t('requests.loading')}
        </div>
      </div>
    )
  }

  const left = state.left
  const right = state.right

  const tabs = [
    { id: 'reqHeaders', label: '请求 Headers' },
    { id: 'reqBody', label: '请求 Body' },
    { id: 'resHeaders', label: '响应 Headers' },
    { id: 'resBody', label: '响应 Body' },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary rounded-lg max-w-6xl w-[90vw] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex justify-between items-center p-3 border-b border-border">
          <h2 className="text-lg font-semibold">{t('requests.compareTitle')}</h2>
          <button
            aria-label={t('requests.compareClose')}
            onClick={onClose}
            className="text-text-muted hover:text-text-primary px-3 py-1 rounded hover:bg-bg-hover"
          >
            ✕
          </button>
        </header>

        {(state.errorLeft || state.errorRight) && (
          <div className="p-3 bg-error/10 text-error text-sm">
            {state.errorLeft && <div>{t('requests.compareLeft')}: {t('requests.compareLoadFailed')} - {state.errorLeft}</div>}
            {state.errorRight && <div>{t('requests.compareRight')}: {t('requests.compareLoadFailed')} - {state.errorRight}</div>}
          </div>
        )}

        <div className="flex-1 overflow-hidden p-3">
          <Tabs
            tabs={tabs}
            defaultTab="reqHeaders"
            children={{
              reqHeaders: (
                <DiffPanel
                  leftText={stringify(left?.request.headers)}
                  rightText={stringify(right?.request.headers)}
                />
              ),
              reqBody: (
                <DiffPanel
                  leftText={stringify(left?.request.body)}
                  rightText={stringify(right?.request.body)}
                />
              ),
              resHeaders: (
                <DiffPanel
                  leftText={stringify(left?.response?.headers)}
                  rightText={stringify(right?.response?.headers)}
                />
              ),
              resBody: (
                <DiffPanel
                  leftText={stringify(left?.response?.events)}
                  rightText={stringify(right?.response?.events)}
                />
              ),
            }}
          />
        </div>
      </div>
    </div>
  )
}
