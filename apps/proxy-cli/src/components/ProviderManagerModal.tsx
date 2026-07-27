import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button, Tooltip, Checkbox } from 'antd'
import { CloseOutlined, DeleteOutlined, CheckOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { fetchProviders, saveProviders } from '../api/providers'
import type { Provider, ProviderInput, ProviderValidationError } from '../types/providers'

interface ProviderManagerModalProps {
  isOpen: boolean
  onClose: () => void
}

const EMPTY_ROW: ProviderInput = {
  name: '',
  base_url: '',
  api_key: '',
  model: '',
  haiku_model: '',
  sonnet_model: '',
  opus_model: '',
  subagent_model: '',
  provider: '',
  default: false,
  is_openai_compatible: false
}

const FIELDS: Array<{ key: keyof ProviderInput; i18nKey: string }> = [
  { key: 'name', i18nKey: 'providers:label.name' },
  { key: 'base_url', i18nKey: 'providers:label.baseUrl' },
  { key: 'api_key', i18nKey: 'providers:label.apiKey' },
  { key: 'model', i18nKey: 'providers:label.model' },
  { key: 'haiku_model', i18nKey: 'providers:label.haikuModel' },
  { key: 'sonnet_model', i18nKey: 'providers:label.sonnetModel' },
  { key: 'opus_model', i18nKey: 'providers:label.opusModel' },
  { key: 'subagent_model', i18nKey: 'providers:label.subagentModel' },
  { key: 'provider', i18nKey: 'providers:label.provider' },
  { key: 'is_openai_compatible', i18nKey: 'providers:label.openaiCompatible' }
]

function providerToInput(p: Provider): ProviderInput {
  return {
    name: p.name,
    base_url: p.base_url ?? '',
    api_key: p.api_key ?? '',
    model: p.model ?? '',
    haiku_model: p.haiku_model ?? '',
    sonnet_model: p.sonnet_model ?? '',
    opus_model: p.opus_model ?? '',
    subagent_model: p.subagent_model ?? '',
    provider: p.provider,
    default: p.default,
    is_openai_compatible: p.is_openai_compatible ?? false
  }
}

function formatErrors(errors: ProviderValidationError[], t: (key: string, opts?: Record<string, unknown>) => string): string[] {
  return errors.map(e => t('providers:error.fieldMessage', { row: e.index + 1, field: e.field, message: e.message }))
}

export function ProviderManagerModal({ isOpen, onClose }: ProviderManagerModalProps): JSX.Element | null {
  const { t } = useTranslation()
  const [rows, setRows] = useState<ProviderInput[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!message || messageType !== 'success') return
    const timer = setTimeout(() => {
      if (mountedRef.current) setMessage(null)
    }, 3000)
    return () => clearTimeout(timer)
  }, [message, messageType])

  const loadProviders = useCallback(async () => {
    try {
      const data = await fetchProviders()
      setRows(data.providers.map(providerToInput))
    } catch {
      // Keep empty state
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      setMessage(null)
      setValidationErrors([])
      loadProviders()
    }
  }, [isOpen, loadProviders])

  if (!isOpen) return null

  const handleAddRow = () => {
    setRows([...rows, { ...EMPTY_ROW }])
  }

  const handleDeleteRow = (index: number) => {
    if (!window.confirm(t('providers:confirmDelete'))) return
    setRows(rows.filter((_, i) => i !== index))
  }

  const handleActivate = (index: number) => {
    setRows(rows.map((row, i) => ({ ...row, default: i === index })))
  }

  const handleFieldChange = (index: number, field: keyof ProviderInput, value: string | boolean) => {
    setRows(rows.map((row, i) => i === index ? { ...row, [field]: value } : row))
  }

  const handleSave = async () => {
    setIsSaving(true)
    setMessage(null)
    setValidationErrors([])

    try {
      const result = await saveProviders(rows)
      if (result.success) {
        setMessage(t('providers:message.savedSuccess'))
        setMessageType('success')
      } else if (result.errors) {
        setValidationErrors(formatErrors(result.errors, t))
      } else if (result.error) {
        setMessage(result.error)
        setMessageType('error')
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('providers:message.networkError'))
      setMessageType('error')
    }

    setIsSaving(false)
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-bg-primary rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-auto p-6">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
          <h3 className="text-base font-medium">{t('providers:heading')}</h3>
          <Button
            type="text"
            icon={<CloseOutlined />}
            onClick={onClose}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {FIELDS.map(f => (
                  <th key={f.key} className="px-2 py-2 text-left text-text-muted whitespace-nowrap">{t(f.i18nKey)}</th>
                ))}
                <th className="px-2 py-2 text-left text-text-muted">{t('providers:label.action')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-border/50">
                  {FIELDS.map(f => (
                    <td key={f.key} className="px-1 py-1">
                      {f.key === 'is_openai_compatible' ? (
                        <Checkbox
                          checked={!!row[f.key]}
                          onChange={(e) => handleFieldChange(rowIndex, f.key, e.target.checked)}
                        />
                      ) : (
                        <input
                          type="text"
                          value={row[f.key] as string}
                          onChange={(e) => handleFieldChange(rowIndex, f.key, e.target.value)}
                          className="w-full px-2 py-1 rounded border border-border bg-bg-secondary text-text-primary focus:border-primary focus:outline-none transition-colors text-xs"
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-1 py-1 whitespace-nowrap flex gap-1">
                    <Button
                      type={row.default ? 'primary' : 'default'}
                      size="small"
                      icon={row.default ? <CheckOutlined /> : undefined}
                      onClick={() => handleActivate(rowIndex)}
                      disabled={row.default}
                    >
                      {row.default ? t('providers:action.activated') : t('providers:action.activate')}
                    </Button>
                    <Tooltip title={t('providers:action.delete')}>
                      <Button
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => handleDeleteRow(rowIndex)}
                      />
                    </Tooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <Button onClick={handleAddRow}>
            {t('providers:action.add')}
          </Button>
        </div>

        {validationErrors.length > 0 && (
          <div className="bg-error/10 p-2 mt-4 rounded">
            {validationErrors.map((err, i) => (
              <div key={i} className="text-error text-xs">{err}</div>
            ))}
          </div>
        )}

        {message && (
          <div className={`p-2 mt-4 rounded ${messageType === 'success' ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}`}>
            {message}
          </div>
        )}

        <div className="flex gap-2 mt-4 pt-2 border-t border-border">
          <Button
            type="primary"
            onClick={handleSave}
            loading={isSaving}
          >
            {isSaving ? t('providers:action.saving') : t('providers:action.save')}
          </Button>
          <Button onClick={onClose}>
            {t('providers:action.close')}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
