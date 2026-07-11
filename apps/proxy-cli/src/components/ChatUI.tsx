import { useRef, useEffect } from 'react'
import { Bubble, Sender } from '@ant-design/x'
import { Button, Tooltip } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useChat } from '../hooks/useChat'

export function ChatUI(): JSX.Element {
  const { t } = useTranslation('app')
  const { messages, loading, error, sendMessage, newConversation } = useChat()
  const listRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  const handleSubmit = (content: string) => {
    if (!content.trim()) return
    sendMessage(content.trim())
  }

  const items = messages.map((msg) => ({
    key: msg.id,
    content: msg.content,
    role: msg.role as 'user' | 'assistant',
    loading: msg.role === 'assistant' && loading && !msg.content,
  }))

  return (
    <div className="bg-bg-card rounded-lg h-full flex flex-col">
      {/* 对话记录 */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 py-2"
      >
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            {t('chat.placeholder')}
          </div>
        )}
        <Bubble.List
          items={items}
          style={{ height: '100%' }}
        />
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="px-4 py-1 text-text-primary text-xs bg-red-900/30">
          {t('chat.errorPrefix')}{error}
        </div>
      )}

      {/* 输入框区域 */}
      <div className="px-4 py-2 border-t border-border flex items-center gap-2">
        <Tooltip title={t('chat.newConversation')}>
          <Button
            type="text"
            icon={<PlusOutlined />}
            onClick={newConversation}
            size="small"
          />
        </Tooltip>
        <Sender
          onSubmit={handleSubmit}
          placeholder={t('chat.placeholder')}
          loading={loading}
          style={{ flex: 1 }}
        />
      </div>
    </div>
  )
}
