import { useState } from 'react'

interface Tab {
  id: string
  label: string
}

interface Props {
  tabs: Tab[]
  defaultTab?: string
  children: Record<string, React.ReactNode>
}

export function Tabs({ tabs, defaultTab, children }: Props): JSX.Element {
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs[0]?.id)

  return (
    <div>
      <div className="flex border-b border-border mb-3">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm transition-colors ${
              activeTab === tab.id
                ? 'text-text-primary border-b-2 border-primary bg-bg-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="p-2">{children[activeTab]}</div>
    </div>
  )
}