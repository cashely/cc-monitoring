import { useState, useMemo } from 'react'
import { Bubble, Sender, CodeHighlighter, Mermaid } from '@ant-design/x'
import XMarkdown, { type ComponentProps } from '@ant-design/x-markdown'
import { RobotOutlined, UserOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useChat } from '../hooks/useChat'
import { ChatToolbar } from './ChatToolbar'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolBlock } from './ToolBlock'
import type { ContentBlock, TextBlock, ThinkingBlock as ThinkingBlockType, ToolBlock as ToolBlockType } from '../types/chat'

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

// 渲染单个 content block 为 React 节点
// streamingBlockIndex: 当前正在接收 delta 的 block 下标（仅 thinking 块用）
function renderBlock(block: ContentBlock, index: number, streamingBlockIndex: number | null): React.ReactNode {
  switch (block.type) {
    case 'text': {
      const tb = block as TextBlock
      if (!tb.content) return null
      return (
        <XMarkdown key={block.id} components={{ code: Code }} paragraphTag="div">
          {tb.content}
        </XMarkdown>
      )
    }
    case 'thinking': {
      const tb = block as ThinkingBlockType
      const streaming = streamingBlockIndex === index
      return <ThinkingBlock key={block.id} block={tb} streaming={streaming} />
    }
    case 'tool': {
      const tb = block as ToolBlockType
      return <ToolBlock key={block.id} block={tb} />
    }
    default:
      return null
  }
}

export function ChatUI(): JSX.Element {
  const { t } = useTranslation('app')
  const {
    messages,
    loading,
    error,
    sendMessage,
    newConversation,
    thinkingLevel,
    setThinkingLevel
  } = useChat()
  const [inputValue, setInputValue] = useState('')

  const handleSubmit = (content: string) => {
    if (!content.trim()) return
    sendMessage(content.trim())
    setInputValue('')
  }

  const items = useMemo(
    () =>
      messages.map((msg) => {
        if (msg.role === 'user') {
          // user 消息：把所有 text block 拼起来当 content
          const text = msg.blocks
            .filter((b): b is TextBlock => b.type === 'text')
            .map(b => (b as TextBlock).content)
            .join('\n')
          return {
            key: msg.id,
            content: text,
            role: 'user' as const
          }
        }

        // assistant 消息：按 blocks 顺序渲染
        // 当前正在接收 delta 的 block 是最后一个 block（loading 时）
        const streamingBlockIndex = loading && msg.blocks.length > 0
          ? msg.blocks.length - 1
          : null
        const nodes = msg.blocks.map((b, i) => renderBlock(b, i, streamingBlockIndex))

        return {
          key: msg.id,
          content: <>{nodes}</>,
          role: 'assistant' as const,
          // blocks 为空且 loading 时显示原 loading 动画
          loading: loading && msg.blocks.length === 0
        }
      }),
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
        <ChatToolbar
          onNewConversation={newConversation}
          thinkingLevel={thinkingLevel}
          onThinkingLevelChange={setThinkingLevel}
        />
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
