import { useState, useRef } from 'react'
import { Button, Tooltip, message } from 'antd'
import { PlusOutlined, UploadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { uploadDoc } from '../api/docs'

interface ChatToolbarProps {
  onNewConversation: () => void
}

const ACCEPTED_EXTENSIONS = '.md,.docx,.xlsx,.xls'

export function ChatToolbar({ onNewConversation }: ChatToolbarProps) {
  const { t } = useTranslation('app')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 清空 input value 以便同一文件可重复上传
    e.target.value = ''

    setUploading(true)
    try {
      const result = await uploadDoc(file)
      if (result.success) {
        message.success(t('chat.uploadSuccess'))
      } else {
        message.error(t('chat.uploadError', { error: result.error }))
      }
    } catch {
      message.error(t('chat.uploadError', { error: 'Network error' }))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <Tooltip title={t('chat.newConversation')}>
        <Button type="text" icon={<PlusOutlined />} onClick={onNewConversation} size="small" />
      </Tooltip>
      <Tooltip title={t('chat.uploadFile')}>
        <Button
          type="text"
          icon={<UploadOutlined />}
          onClick={handleUploadClick}
          loading={uploading}
          size="small"
        />
      </Tooltip>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </div>
  )
}
