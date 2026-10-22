import { useState } from 'react'
import { Button, Tooltip, Dropdown } from 'antd'
import {
  PlusOutlined,
  ReadOutlined,
  BulbOutlined,
  DownOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { ThinkingLevel } from '../types/chat'
import type { LearnTask } from '../hooks/useLearnStream'
import { LearnModal } from './LearnModal'
import { LearnDrawer } from './LearnDrawer'

interface ChatToolbarProps {
  onNewConversation: () => void
  thinkingLevel: ThinkingLevel
  onThinkingLevelChange: (level: ThinkingLevel) => void
}

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
  thinkingLevel,
  onThinkingLevelChange
}: ChatToolbarProps) {
  const { t } = useTranslation('app')
  const [learnModalOpen, setLearnModalOpen] = useState(false)
  const [learnTask, setLearnTask] = useState<LearnTask | null>(null)

  const currentLabel =
    THINKING_OPTIONS.find(o => o.value === thinkingLevel)?.label ?? '关闭'

  const handleLearnStart = (task: LearnTask) => {
    setLearnTask(task)
    setLearnModalOpen(false)
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <Tooltip title={t('chat.newConversation')}>
        <Button type="text" icon={<PlusOutlined />} onClick={onNewConversation} size="small" className="chat-toolbar-btn" />
      </Tooltip>
      <div className="w-px h-4 bg-border" />
      {/* 学习入口：独立 Modal + Drawer，不再与问答混用 mode */}
      <Tooltip title={t('chat.learnButtonTip')}>
        <Button
          type="text"
          icon={<ReadOutlined />}
          onClick={() => setLearnModalOpen(true)}
          size="small"
          className="chat-toolbar-btn"
        >
          {t('chat.modeLearn')}
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

      <LearnModal
        open={learnModalOpen}
        onClose={() => setLearnModalOpen(false)}
        onStart={handleLearnStart}
      />
      <LearnDrawer
        open={learnTask !== null}
        task={learnTask}
        onClose={() => setLearnTask(null)}
      />
    </div>
  )
}
