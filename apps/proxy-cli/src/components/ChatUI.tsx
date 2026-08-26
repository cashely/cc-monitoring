import { useState, useMemo } from 'react'
import { Bubble, Sender, CodeHighlighter, Mermaid } from '@ant-design/x'
import XMarkdown, { type ComponentProps } from '@ant-design/x-markdown'
import { RobotOutlined, UserOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useChat } from '../hooks/useChat'
import { ChatToolbar } from './ChatToolbar'

const QUICK_PROMPTS = ['chat.quickQ1', 'chat.quickQ2', 'chat.quickQ3'] as const

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
  const [inputValue, setInputValue] = useState('')

  const handleSubmit = (content: string) => {
    if (!content.trim()) return
    sendMessage(content.trim())
    setInputValue('')
  }

  const items = useMemo(
    () =>
      messages.map((msg) => ({
        key: msg.id,
        content: msg.content,
        role: msg.role as 'user' | 'assistant',
        loading: msg.role === 'assistant' && loading && !msg.content,
        contentRender:
          msg.role === 'assistant'
            ? (content: string) => (
                <XMarkdown components={{ code: Code }} paragraphTag="div">
                  {content}
                </XMarkdown>
              )
            : undefined,
      })),
    [messages, loading]
  )

  return (
    <div className="glass rounded-xl overflow-hidden flex flex-col absolute inset-0" style={{ padding: 16 }}>
      <div className="flex-1 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-secondary/20">
              <RobotOutlined style={{ fontSize: '20px', color: 'var(--chat-assistant-accent)' }} />
            </div>
            <div className="text-text-primary text-sm font-medium">{t('chat.emptyTitle')}</div>
            <div className="text-text-muted text-xs">{t('chat.emptyDesc')}</div>
            <div className="flex gap-2 mt-1">
              {QUICK_PROMPTS.map((key) => (
                <button
                  key={key}
                  className="glass rounded-lg px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
                  onClick={() => sendMessage(t(key))}
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        )}
        <Bubble.List
          items={items}
          role={{
            assistant: {
              placement: 'start',
              avatar: (
                <RobotOutlined
                  style={{
                    backgroundColor: 'var(--chat-avatar-assistant)',
                    color: '#fff',
                    borderRadius: '50%',
                    padding: '4px',
                    fontSize: '24px',
                  }}
                />
              ),
              variant: 'filled',
            },
            user: {
              placement: 'end',
              avatar: (
                <UserOutlined
                  style={{
                    backgroundColor: 'var(--chat-avatar-user)',
                    color: '#fff',
                    borderRadius: '50%',
                    padding: '4px',
                    fontSize: '24px',
                  }}
                />
              ),
              variant: 'filled',
            },
          }}
          style={{ height: '100%' }}
          className="chat-bubble-list"
        />
      </div>

      {error && (
        <div className="px-4 py-1 text-text-primary text-xs bg-error/20">
          {t('chat.errorPrefix')}
          {error}
        </div>
      )}

      <div className="glass-strong px-4 py-2 flex flex-col gap-1.5">
        <ChatToolbar onNewConversation={newConversation} />
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
  )
}
