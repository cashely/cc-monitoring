import { useState, useRef } from 'react'
import { Button, Tooltip, Dropdown, message } from 'antd'
import {
  PlusOutlined,
  UploadOutlined,
  QuestionOutlined,
  ReadOutlined,
  BulbOutlined,
  DownOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { uploadDoc } from '../api/docs'
import type { ChatMode } from '../hooks/useChat'
import type { ThinkingLevel } from '../types/chat'

interface ChatToolbarProps {
  onNewConversation: () => void
  mode: ChatMode
  onModeChange: (m: ChatMode) => void
  thinkingLevel: ThinkingLevel
  onThinkingLevelChange: (level: ThinkingLevel) => void
}

const ACCEPTED_EXTENSIONS = '.md,.docx,.xlsx,.xls'

// 思考等级选项：off=关闭 / low=低 / medium=中 / high=高
// （类型中的 minimal 不在 UI 暴露，避免档位过多）
const THINKING_OPTIONS: { value: ThinkingLevel; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' }
]

export function ChatToolbar({
  onNewConversation,
  mode,
  onModeChange,
  thinkingLevel,
  onThinkingLevelChange
}: ChatToolbarProps) {
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

  const currentLabel =
    THINKING_OPTIONS.find(o => o.value === thinkingLevel)?.label ?? '关闭'

  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <Tooltip title={t('chat.newConversation')}>
        <Button type="text" icon={<PlusOutlined />} onClick={onNewConversation} size="small" className="chat-toolbar-btn" />
      </Tooltip>
      <div className="w-px h-4 bg-border" />
      {/* 模式切换：问答（只读搜知识库）/ 学习（浏览器抓网页写知识库） */}
      <Tooltip title={mode === 'chat' ? t('chat.modeChatTip') : t('chat.modeLearnTip')}>
        <Button
          type="text"
          icon={mode === 'chat' ? <QuestionOutlined /> : <ReadOutlined />}
          onClick={() => onModeChange(mode === 'chat' ? 'learn' : 'chat')}
          size="small"
          className="chat-toolbar-btn"
        >
          {mode === 'chat' ? t('chat.modeChat') : t('chat.modeLearn')}
        </Button>
      </Tooltip>
      <div className="w-px h-4 bg-border" />
      {/* 思考等级选择器：透传到后端 reasoning_effort */}
      <Dropdown
        trigger={['click']}
        menu={{
          selectedKeys: [thinkingLevel],
          items: THINKING_OPTIONS.map(o => ({ key: o.value, label: o.label })),
          onClick: ({ key }) => onThinkingLevelChange(key as ThinkingLevel)
        }}
      >
        <Button
          type="text"
          icon={<BulbOutlined />}
          size="small"
          className="chat-toolbar-btn"
        >
          思考 · {currentLabel}
          <DownOutlined style={{ fontSize: '10px', marginLeft: 4 }} />
        </Button>
      </Dropdown>
      <div className="w-px h-4 bg-border" />
      <Tooltip title={t('chat.uploadFile')}>
        <Button
          type="text"
          icon={<UploadOutlined />}
          onClick={handleUploadClick}
          loading={uploading}
          size="small"
          className="chat-toolbar-btn"
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
