import { useState, useEffect } from 'react'
import { DownOutlined, RightOutlined } from '@ant-design/icons'
import type { ThinkingBlock as ThinkingBlockType } from '../types/chat'

interface ThinkingBlockProps {
  block: ThinkingBlockType
  // 是否正在接收 thinking_delta：true 时临时展开，false 时默认折叠
  streaming?: boolean
}

// 思考过程块：流式时临时展开，结束后自动折叠，用户可手动切换
export function ThinkingBlock({ block, streaming }: ThinkingBlockProps) {
  // 空内容不渲染
  if (!block.content || !block.content.trim()) return null

  // null = 跟随默认策略；true/false = 用户手动覆盖
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)

  // streaming 从 true → false 时，重置为默认折叠（"临时展开"语义）
  useEffect(() => {
    if (!streaming) setUserExpanded(null)
  }, [streaming])

  // 展开态：streaming 优先；否则用用户手动值；都没有则折叠
  const expanded = streaming || userExpanded === true

  return (
    <div className="glass-strong rounded-lg px-3 py-2 my-1">
      <div
        className="flex items-center gap-2 cursor-pointer text-xs transition-colors"
        style={{ color: 'var(--color-text-muted)' }}
        onClick={() => setUserExpanded(!expanded)}
      >
        {expanded ? (
          <DownOutlined style={{ fontSize: '10px' }} />
        ) : (
          <RightOutlined style={{ fontSize: '10px' }} />
        )}
        <span>
          💭 思考过程{streaming ? ' · 思考中…' : ' · 已折叠'}
        </span>
      </div>
      {expanded && (
        <pre
          className="mt-2 max-h-40 overflow-auto text-xs whitespace-pre-wrap"
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            color: 'var(--color-text-secondary)',
            background: 'var(--color-bg-primary)',
            padding: '8px',
            borderRadius: '6px',
            margin: '8px 0 0 0'
          }}
        >
          {block.content}
        </pre>
      )}
    </div>
  )
}
