import { useState } from 'react'
import { DownOutlined, RightOutlined, ToolOutlined, LoadingOutlined } from '@ant-design/icons'
import type { ToolBlock as ToolBlockType } from '../types/chat'

interface ToolBlockProps {
  block: ToolBlockType
}

// 格式化耗时：<1s 显示 ms，>=1s 显示 s
function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// 工具调用块：常驻一行状态，点击展开参数/结果；错误态自动展开
export function ToolBlock({ block }: ToolBlockProps) {
  // null = 跟随默认策略（isError → 展开，否则折叠）；用户手动覆盖
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)

  const expanded = userExpanded !== null ? userExpanded : block.isError === true

  const isRunning = block.status === 'running'
  const isError = block.isError === true

  // 参数 JSON 格式化（args 可能为 undefined / 任意类型）
  const argsText =
    block.args === undefined
      ? ''
      : typeof block.args === 'string'
        ? block.args
        : JSON.stringify(block.args, null, 2)

  return (
    <div
      className="glass rounded-lg px-3 py-2 my-1"
      style={
        isError
          ? { border: '1px solid var(--color-error)' }
          : undefined
      }
    >
      <div
        className="flex items-center gap-2 cursor-pointer text-xs"
        style={{ color: isError ? 'var(--color-error)' : 'var(--color-text-secondary)' }}
        onClick={() => setUserExpanded(!expanded)}
      >
        {expanded ? (
          <DownOutlined style={{ fontSize: '10px' }} />
        ) : (
          <RightOutlined style={{ fontSize: '10px' }} />
        )}
        <ToolOutlined style={{ fontSize: '12px' }} />
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {block.toolName || '(unnamed)'}
        </span>
        {isRunning && (
          <span className="flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
            <LoadingOutlined style={{ fontSize: '10px' }} />
            运行中…
          </span>
        )}
        {!isRunning && block.durationMs !== undefined && (
          <span style={{ color: 'var(--color-text-muted)' }}>
            {formatDuration(block.durationMs)}
          </span>
        )}
        {isError && <span>· 出错</span>}
      </div>

      {expanded && (
        <div className="mt-2 flex flex-col gap-2">
          {argsText && (
            <div>
              <div
                className="text-xs mb-1"
                style={{ color: 'var(--color-text-muted)' }}
              >
                参数
              </div>
              <pre
                className="max-h-40 overflow-auto text-xs"
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  color: 'var(--color-text-secondary)',
                  background: 'var(--color-bg-primary)',
                  padding: '8px',
                  borderRadius: '6px',
                  margin: 0
                }}
              >
                {argsText}
              </pre>
            </div>
          )}
          {block.result !== undefined && block.result !== '' && (
            <div>
              <div
                className="text-xs mb-1"
                style={{ color: 'var(--color-text-muted)' }}
              >
                结果
              </div>
              <pre
                className="max-h-40 overflow-auto text-xs whitespace-pre-wrap"
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  color: isError ? 'var(--color-error)' : 'var(--color-text-secondary)',
                  background: 'var(--color-bg-primary)',
                  padding: '8px',
                  borderRadius: '6px',
                  margin: 0
                }}
              >
                {block.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
