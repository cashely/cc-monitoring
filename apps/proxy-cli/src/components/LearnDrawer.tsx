import { useEffect } from 'react'
import { Drawer, Empty, Spin } from 'antd'
import { LoadingOutlined, CheckCircleOutlined } from '@ant-design/icons'
import XMarkdown from '@ant-design/x-markdown'
import { useTranslation } from 'react-i18next'
import { useLearnStream } from '../hooks/useLearnStream'
import type { LearnRound, LearnTask } from '../hooks/useLearnStream'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolBlock } from './ToolBlock'
import type { ThinkingBlock as ThinkingBlockType } from '../types/chat'

interface LearnDrawerProps {
  open: boolean
  task: LearnTask | null
  onClose: () => void
}

// 单轮卡片：标题 + thinking 折叠块 + 文本 + 工具块；当前轮高亮
function RoundCard({
  round,
  active,
  streaming
}: {
  round: LearnRound
  active: boolean
  streaming: boolean
}): React.ReactNode {
  const { t } = useTranslation('app')
  const thinkingBlock: ThinkingBlockType = {
    type: 'thinking',
    id: `think-${round.roundIndex}`,
    content: round.thinking
  }

  return (
    <div
      className="glass rounded-lg p-3 my-2"
      style={active ? { border: '1px solid var(--color-secondary)' } : undefined}
    >
      <div
        className="flex items-center gap-2 text-sm"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {active && streaming ? (
          <LoadingOutlined style={{ color: 'var(--color-secondary)' }} />
        ) : (
          <CheckCircleOutlined style={{ color: 'var(--color-success)' }} />
        )}
        <span className="font-medium">
          {t('chat.roundLabel', { n: round.roundIndex + 1 })}
        </span>
        {active && streaming && (
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('chat.roundLearning')}
          </span>
        )}
      </div>

      {round.thinking.trim() && (
        <ThinkingBlock block={thinkingBlock} streaming={active && streaming} />
      )}

      {round.text && (
        <div className="text-xs" style={{ color: 'var(--chat-text-color)' }}>
          <XMarkdown paragraphTag="div">{round.text}</XMarkdown>
        </div>
      )}

      {round.tools.map(tool => (
        <ToolBlock key={tool.id} block={tool} />
      ))}
    </div>
  )
}

// 学习任务抽屉：顶部来源 + 按 round 分组渲染流式过程
export function LearnDrawer({ open, task, onClose }: LearnDrawerProps): JSX.Element {
  const { t } = useTranslation('app')
  const { rounds, status, error, start, cancel } = useLearnStream()

  // task 就绪即启动流式（每次任务都是新对象）
  useEffect(() => {
    if (open && task) {
      start(task)
    }
  }, [open, task, start])

  const handleClose = () => {
    cancel()
    onClose()
  }

  return (
    <Drawer
      title={t('chat.learnDrawerTitle')}
      open={open}
      onClose={handleClose}
      width={600}
    >
      {task && (
        <div className="glass rounded-lg px-3 py-2 mb-3">
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('chat.learnSource')}：
          </span>
          <span
            className="text-xs"
            style={{ color: 'var(--color-text-secondary)', wordBreak: 'break-all' }}
          >
            {task.label ?? task.payload}
          </span>
        </div>
      )}

      {status === 'streaming' && rounds.length === 0 && (
        <div className="flex justify-center py-6">
          <Spin tip={t('chat.learnPreparing')} />
        </div>
      )}

      {error && (
        <div className="text-xs px-3 py-2 mb-2" style={{ color: 'var(--color-error)' }}>
          {t('chat.errorPrefix')}
          {error}
        </div>
      )}

      {rounds.length === 0 && status !== 'streaming' && !error ? (
        <Empty className="py-8" />
      ) : (
        rounds.map((round, i) => (
          <RoundCard
            key={round.roundIndex}
            round={round}
            active={i === rounds.length - 1}
            streaming={status === 'streaming'}
          />
        ))
      )}

      {status === 'done' && rounds.length > 0 && (
        <div className="text-xs mt-3" style={{ color: 'var(--color-success)' }}>
          {t('chat.roundDone')}
        </div>
      )}
    </Drawer>
  )
}
