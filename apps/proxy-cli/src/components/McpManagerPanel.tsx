import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Button, Modal, Select, Input, Switch, Tag, Tooltip, Popconfirm } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, ApiOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { fetchMcpServers, createMcpServer, updateMcpServer, deleteMcpServer, reconnectMcpServer } from '../api/mcp'
import type { McpServerWithStatus, McpServerInput, TransportType } from '../types/mcp'

interface McpManagerPanelProps {
  isOpen: boolean
  onClose: () => void
}

const EMPTY_INPUT: McpServerInput = {
  name: '',
  transport_type: 'stdio',
  command: '',
  args: [],
  env: {},
  url: '',
  headers: {},
  enabled: true
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string }> = {
  connected: { color: '#10B981', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.3)' },
  disconnected: { color: '#EF4444', bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.3)' },
  connecting: { color: '#F59E0B', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.3)' },
  not_connected: { color: '#94A3B8', bg: 'rgba(148,163,184,0.15)', border: 'rgba(148,163,184,0.3)' },
  disabled: { color: '#64748B', bg: 'rgba(100,116,139,0.15)', border: 'rgba(100,116,139,0.3)' }
}

export function McpManagerPanel({ isOpen, onClose }: McpManagerPanelProps): JSX.Element | null {
  const { t } = useTranslation('mcp')
  const [servers, setServers] = useState<McpServerWithStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<McpServerInput>({ ...EMPTY_INPUT })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const loadServers = useCallback(async () => {
    try {
      const data = await fetchMcpServers()
      setServers(data.servers)
    } catch {
      // keep existing state
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      setMessage(null)
      loadServers()
    }
  }, [isOpen, loadServers])

  // Auto-refresh connection status
  useEffect(() => {
    if (!isOpen) return
    const timer = setInterval(loadServers, 5000)
    return () => clearInterval(timer)
  }, [isOpen, loadServers])

  if (!isOpen) return null

  const openAddModal = () => {
    setEditingId(null)
    setForm({ ...EMPTY_INPUT })
    setEditModalOpen(true)
  }

  const openEditModal = (server: McpServerWithStatus) => {
    setEditingId(server.id)
    const input: McpServerInput = {
      name: server.name,
      transport_type: server.transport_type,
      command: server.command ?? undefined,
      args: server.args ? JSON.parse(server.args) : undefined,
      env: server.env ? JSON.parse(server.env) : undefined,
      url: server.url ?? undefined,
      headers: server.headers ? JSON.parse(server.headers) : undefined,
      enabled: server.enabled
    }
    setForm(input)
    setEditModalOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)

    try {
      if (editingId) {
        const result = await updateMcpServer(editingId, form)
        if (result.success) {
          setMessage(t('message.updatedSuccess'))
          setEditModalOpen(false)
          await loadServers()
        } else {
          setMessage(result.error || t('message.networkError'))
        }
      } else {
        const result = await createMcpServer(form)
        if (result.success) {
          setMessage(t('message.createdSuccess'))
          setEditModalOpen(false)
          await loadServers()
        } else {
          setMessage(result.error || t('message.networkError'))
        }
      }
    } catch {
      setMessage(t('message.networkError'))
    }

    setSaving(false)
  }

  const handleDelete = async (id: number) => {
    const result = await deleteMcpServer(id)
    if (result.success) {
      setMessage(t('message.deletedSuccess'))
      await loadServers()
    } else {
      setMessage(result.error || t('message.networkError'))
    }
  }

  const handleReconnect = async (id: number) => {
    const result = await reconnectMcpServer(id)
    if (result.success) {
      setMessage(t('message.reconnectSuccess'))
      await loadServers()
    } else {
      setMessage(result.error || t('message.networkError'))
    }
  }

  const handleToggleEnabled = async (server: McpServerWithStatus) => {
    const result = await updateMcpServer(server.id, { enabled: !server.enabled })
    if (result.success) {
      await loadServers()
    }
  }

  const handleFormChange = (field: keyof McpServerInput, value: any) => {
    if (field === 'transport_type') {
      // Reset transport-specific fields when switching type
      setForm(prev => ({ ...prev, transport_type: value, command: undefined, args: undefined, env: undefined, url: undefined, headers: undefined }))
    } else {
      setForm(prev => ({ ...prev, [field]: value }))
    }
  }

  const isStdio = form.transport_type === 'stdio'
  const isHttp = form.transport_type === 'sse' || form.transport_type === 'streamable-http'

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-bg-primary rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
          <h3 className="text-base font-medium flex items-center gap-2">
            <ApiOutlined />
            {t('heading')}
          </h3>
          <div className="flex gap-2">
            <Button icon={<PlusOutlined />} onClick={openAddModal}>
              {t('action.add')}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={loadServers} loading={loading}>
              {t('refresh')}
            </Button>
            <Button type="text" onClick={onClose}>✕</Button>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className="p-2 mb-2 rounded bg-success/10 text-success text-xs">{message}</div>
        )}

        {/* Server list */}
        {servers.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-xs">
            {t('empty')}
          </div>
        ) : (
          <div className="space-y-2">
            {servers.map(server => (
              <div key={server.id} className="glass rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-sm">{server.name}</span>
                    <Tag style={{
                      fontSize: 11,
                      color: STATUS_CONFIG[server.status]?.color,
                      background: STATUS_CONFIG[server.status]?.bg,
                      borderColor: STATUS_CONFIG[server.status]?.border
                    }}>
                      {t(`status.${server.status}`)}
                    </Tag>
                    <Tag style={{ fontSize: 11 }}>{t(`transportType.${server.transport_type === 'streamable-http' ? 'streamableHttp' : server.transport_type}`)}</Tag>
                    {server.toolCount > 0 && (
                      <span className="text-xs text-text-muted">
                        {server.toolCount} {t('label.toolCount')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch
                      size="small"
                      checked={server.enabled}
                      onChange={() => handleToggleEnabled(server)}
                    />
                    <Tooltip title={t('action.reconnect')}>
                      <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={() => handleReconnect(server.id)}
                        disabled={server.status === 'connecting'}
                      />
                    </Tooltip>
                    <Tooltip title={t('action.edit')}>
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => openEditModal(server)}
                      />
                    </Tooltip>
                    <Popconfirm
                      title={t('message.confirmDelete')}
                      onConfirm={() => handleDelete(server.id)}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </div>
                </div>
                {/* Connection detail */}
                <div className="mt-1 text-xs text-text-muted">
                  {server.transport_type === 'stdio' && server.command && (
                    <span>$ {server.command} {server.args ? JSON.parse(server.args).join(' ') : ''}</span>
                  )}
                  {server.transport_type !== 'stdio' && server.url && (
                    <span>{server.url}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit/Add Modal */}
        <Modal
          open={editModalOpen}
          title={editingId ? t('modal.editTitle') : t('modal.addTitle')}
          onCancel={() => setEditModalOpen(false)}
          onOk={handleSave}
          okText={saving ? t('action.saving') : t('action.save')}
          confirmLoading={saving}
          width={560}
          styles={{ body: { padding: '16px 0' } }}
        >
          <div className="space-y-3 px-4">
            {/* Name */}
            <div>
              <label className="text-xs text-text-muted mb-1 block">{t('label.name')}</label>
              <Input
                value={form.name}
                onChange={e => handleFormChange('name', e.target.value)}
                size="small"
                placeholder="my-mcp-server"
              />
            </div>

            {/* Transport type */}
            <div>
              <label className="text-xs text-text-muted mb-1 block">{t('label.transportType')}</label>
              <Select
                value={form.transport_type}
                onChange={v => handleFormChange('transport_type', v)}
                size="small"
                options={[
                  { value: 'stdio', label: t('transportType.stdio') },
                  { value: 'sse', label: t('transportType.sse') },
                  { value: 'streamable-http', label: t('transportType.streamableHttp') }
                ]}
                style={{ width: '100%' }}
              />
            </div>

            {/* STDIO fields */}
            {isStdio && (
              <>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">{t('label.command')}</label>
                  <Input
                    value={form.command || ''}
                    onChange={e => handleFormChange('command', e.target.value)}
                    size="small"
                    placeholder="npx (args fill below)"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">{t('label.args')}</label>
                  <Input
                    value={form.args?.join(' ') || ''}
                    onChange={e => handleFormChange('args', e.target.value.trim() ? e.target.value.trim().split(/\s+/) : undefined)}
                    size="small"
                    placeholder="/path/to/dir (space-separated)"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">{t('label.env')} (JSON)</label>
                  <Input
                    value={form.env ? JSON.stringify(form.env) : ''}
                    onChange={e => {
                      try {
                        handleFormChange('env', e.target.value.trim() ? JSON.parse(e.target.value) : undefined)
                      } catch { /* ignore parse errors while typing */ }
                    }}
                    size="small"
                    placeholder='{"KEY": "value"}'
                  />
                </div>
              </>
            )}

            {/* HTTP fields */}
            {isHttp && (
              <>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">{t('label.url')}</label>
                  <Input
                    value={form.url || ''}
                    onChange={e => handleFormChange('url', e.target.value)}
                    size="small"
                    placeholder="http://localhost:3000/mcp"
                  />
                </div>
                {form.transport_type === 'streamable-http' && (
                  <div>
                    <label className="text-xs text-text-muted mb-1 block">{t('label.headers')} (JSON)</label>
                    <Input
                      value={form.headers ? JSON.stringify(form.headers) : ''}
                      onChange={e => {
                        try {
                          handleFormChange('headers', e.target.value.trim() ? JSON.parse(e.target.value) : undefined)
                        } catch { /* ignore */ }
                      }
                      }
                      size="small"
                      placeholder='{"Authorization": "Bearer xxx"}'
                    />
                  </div>
                )}
              </>
            )}

            {/* Enabled */}
            <div className="flex items-center gap-2">
              <Switch size="small" checked={form.enabled} onChange={v => handleFormChange('enabled', v)} />
              <span className="text-xs">{t('label.enabled')}</span>
            </div>
          </div>
        </Modal>
      </div>
    </div>,
    document.body
  )
}
