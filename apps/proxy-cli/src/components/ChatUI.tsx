import { useRef, useEffect, useState, useMemo } from 'react'
import { Bubble, Sender, CodeHighlighter, Mermaid } from '@ant-design/x'
import XMarkdown, { type ComponentProps } from '@ant-design/x-markdown'
import { Button, Tooltip } from 'antd'
import { PlusOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useChat } from '../hooks/useChat'

const Code: React.FC<ComponentProps> = (props) => {
  const { className, children } = props
  const lang = className?.match(/language-(\w+)/)?.[1] || ''

  if (typeof children !== 'string') return null
  if (lang === 'mermaid') {
    return <Mermaid>{children}</Mermaid>
  }
  return <CodeHighlighter lang={lang}>{children}</CodeHighlighter>
}

export function ChatUI(): JSX.Element {
  const { t } = useTranslation('app')
  const { messages, loading, error, sendMessage, newConversation } = useChat()
  const listRef = useRef<HTMLDivElement>(null)
  const [inputValue, setInputValue] = useState('')

  // 自动滚动到底部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  const handleSubmit = (content: string) => {
    if (!content.trim()) return
    sendMessage(content.trim())
    setInputValue('')
  }

  const items = useMemo(() => messages.map((msg) => ({
    key: msg.id,
    content: msg.content,
    role: msg.role as 'user' | 'assistant',
    loading: msg.role === 'assistant' && loading && !msg.content,
    contentRender: msg.role === 'assistant'
      ? (content: string) => (
          <XMarkdown components={{ code: Code }} paragraphTag="div">
            {content}
          </XMarkdown>
        )
      : undefined,
  })), [messages, loading])

  return (
    <div className="bg-bg-card rounded-lg overflow-hidden flex flex-col h-101.25">
      {/* 对话记录 */}
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-2"
      >
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            {t('chat.placeholder')}
          </div>
        )}
        <Bubble.List
          items={items}
          role={{
            assistant: {
              placement: 'start',
              avatar: <RobotOutlined style={{ backgroundColor: '#1677ff', color: '#fff', borderRadius: '50%', padding: '4px', fontSize: '24px' }} />,
              variant: 'filled',
            },
            user: {
              placement: 'end',
              avatar: <UserOutlined style={{ backgroundColor: '#52c41a', color: '#fff', borderRadius: '50%', padding: '4px', fontSize: '24px' }} />,
              variant: 'filled',
            },
          }}
          style={{ height: '100%' }}
          className="chat-bubble-list"
        />
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="px-4 py-1 text-text-primary text-xs bg-red-900/30">
          {t('chat.errorPrefix')}{error}
        </div>
      )}

      {/* 输入框区域 */}
      <div className="px-3 py-3">
        <div className="bg-bg-secondary rounded-lg p-2 flex items-center gap-2">
          <Tooltip title={t('chat.newConversation')}>
            <Button
              type="text"
              icon={<PlusOutlined />}
              onClick={newConversation}
              size="small"
            />
          </Tooltip>
          <Sender
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSubmit}
            placeholder={t('chat.placeholder')}
            loading={loading}
            style={{ flex: 1 }}
          />
        </div>
      </div>
    </div>
  )
}
