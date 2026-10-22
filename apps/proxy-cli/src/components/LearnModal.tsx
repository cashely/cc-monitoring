import { useEffect, useRef, useState } from 'react'
import { Modal, Input, Button, message } from 'antd'
import { GlobalOutlined, FileOutlined, CheckCircleFilled } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { uploadDoc } from '../api/docs'
import type { LearnSource, LearnTask } from '../hooks/useLearnStream'

// 与 ChatToolbar 保持一致的可学习文件类型
const ACCEPTED_EXTENSIONS = '.md,.docx,.xlsx,.xls'

interface LearnModalProps {
  open: boolean
  onClose: () => void
  onStart: (task: LearnTask) => void
}

// 学习入口弹窗：两个选项卡片（网页 / 文件），确认后把 task 交给父组件启动流式
export function LearnModal({ open, onClose, onStart }: LearnModalProps) {
  const { t } = useTranslation('app')
  const [source, setSource] = useState<LearnSource>('url')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 每次打开时重置表单
  useEffect(() => {
    if (open) {
      setSource('url')
      setUrl('')
      setFile(null)
      setUploading(false)
    }
  }, [open])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0]
    // 清空 input value 以便同一文件可重复选择
    e.target.value = ''
    if (!picked) return
    setFile(picked)
  }

  const canConfirm = source === 'url' ? url.trim().length > 0 : file !== null

  const handleConfirm = async () => {
    if (source === 'url') {
      const u = url.trim()
      if (!u) return
      onStart({ source: 'url', payload: u, label: u })
      return
    }

    if (!file) return
    setUploading(true)
    try {
      const result = await uploadDoc(file)
      if (result.success && result.markdown) {
        onStart({ source: 'file', payload: result.markdown, label: file.name })
      } else {
        message.error(t('chat.uploadError', { error: result.error ?? 'unknown' }))
      }
    } catch {
      message.error(t('chat.uploadError', { error: 'Network error' }))
    } finally {
      setUploading(false)
    }
  }

  const cards: { key: LearnSource; icon: React.ReactNode; title: string; desc: string }[] = [
    {
      key: 'url',
      icon: <GlobalOutlined style={{ fontSize: '18px', color: 'var(--color-secondary)' }} />,
      title: t('chat.learnFromWeb'),
      desc: t('chat.learnFromWebDesc')
    },
    {
      key: 'file',
      icon: <FileOutlined style={{ fontSize: '18px', color: 'var(--color-accent)' }} />,
      title: t('chat.learnFromFile'),
      desc: t('chat.learnFromFileDesc')
    }
  ]

  return (
    <Modal
      title={t('chat.learnModalTitle')}
      open={open}
      onCancel={onClose}
      width={480}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t('chat.learnCancel')}
        </Button>,
        <Button
          key="start"
          type="primary"
          loading={uploading}
          disabled={!canConfirm}
          onClick={handleConfirm}
        >
          {t('chat.learnStart')}
        </Button>
      ]}
    >
      <div className="flex gap-2">
        {cards.map(card => {
          const selected = source === card.key
          return (
            <div
              key={card.key}
              className="glass rounded-lg p-3 flex-1 cursor-pointer transition-colors"
              style={
                selected
                  ? { border: '1px solid var(--color-secondary)' }
                  : undefined
              }
              onClick={() => setSource(card.key)}
            >
              <div className="flex items-center justify-between">
                {card.icon}
                {selected && (
                  <CheckCircleFilled style={{ color: 'var(--color-secondary)', fontSize: '12px' }} />
                )}
              </div>
              <div className="text-sm mt-2" style={{ color: 'var(--color-text-primary)' }}>
                {card.title}
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {card.desc}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-3">
        {source === 'url' ? (
          <Input
            placeholder={t('chat.learnUrlPlaceholder')}
            value={url}
            onChange={e => setUrl(e.target.value)}
            className="text-xs"
          />
        ) : (
          <div className="flex items-center gap-2">
            <Button onClick={() => fileInputRef.current?.click()} className="text-xs">
              {t('chat.learnPickFile')}
            </Button>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {file ? file.name : ''}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}
