# Settings Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move config action buttons from ConfigEditor to header top-right as a gear icon hover dropdown, add "View Docs" item, remove ConfigEditor title.

**Architecture:** New SettingsDropdown component in header right side using CSS hover (group/group-hover) for dropdown trigger. ProviderManagerModal and McpManagerPanel state lifted from ConfigEditor to App. ConfigEditor stripped down to just server info cards.

**Tech Stack:** React, Tailwind CSS, lucide-react icons, Ant Design icons, react-i18next, existing glass CSS classes.

## Global Constraints

- Colors: `var(--color-*)` only — no hardcoded hex colors
- Glass effect: `.glass-strong` on dropdown panel
- Font: 12px (`text-xs`) for all UI text
- Theme: dark/light compatible via `.light` class
- Ant Design: ConfigProvider `fontSize: 12`
- ESM: relative imports must have `.js` extension
- All i18n keys must have both `en` and `zh` translations

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/proxy-cli/src/components/SettingsDropdown.tsx` | **Create** | Gear icon + hover dropdown with 4 menu items |
| `apps/proxy-cli/src/App.tsx` | **Modify** | Add SettingsDropdown to header, add modal state, render ProviderManagerModal + McpManagerPanel |
| `apps/proxy-cli/src/components/ConfigEditor.tsx` | **Modify** | Remove title row, 3 action buttons, modal state, ProviderManagerModal + McpManagerPanel rendering |
| `apps/proxy-cli/src/i18n/locales/en/settings.json` | **Create** | English i18n keys for SettingsDropdown menu items |
| `apps/proxy-cli/src/i18n/locales/zh/settings.json` | **Create** | Chinese i18n keys for SettingsDropdown menu items |

---

### Task 1: Create SettingsDropdown i18n keys

**Files:**
- Create: `apps/proxy-cli/src/i18n/locales/en/settings.json`
- Create: `apps/proxy-cli/src/i18n/locales/zh/settings.json`

**Interfaces:**
- Produces: i18n namespace `settings` with keys used by Task 2

- [ ] **Step 1: Create English i18n file**

```json
{
  "menu": {
    "restart": "Restart Server",
    "providers": "Manage Providers",
    "mcpServers": "MCP Servers",
    "viewDocs": "View Docs"
  }
}
```

- [ ] **Step 2: Create Chinese i18n file**

```json
{
  "menu": {
    "restart": "重启服务",
    "providers": "管理供应商",
    "mcpServers": "MCP Servers",
    "viewDocs": "查看文档"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/proxy-cli/src/i18n/locales/en/settings.json apps/proxy-cli/src/i18n/locales/zh/settings.json
git commit -m "feat: add SettingsDropdown i18n keys (en + zh)"
```

---

### Task 2: Create SettingsDropdown component

**Files:**
- Create: `apps/proxy-cli/src/components/SettingsDropdown.tsx`

**Interfaces:**
- Consumes: i18n namespace `settings` from Task 1, `controlProcess` from `../api`, `ProviderManagerModal` from `./ProviderManagerModal`, `McpManagerPanel` from `./McpManagerPanel`
- Produces: `SettingsDropdown` React component exported for Task 3

- [ ] **Step 1: Create SettingsDropdown.tsx**

```tsx
import { useState } from 'react'
import { Settings, RefreshCw, DatabaseZap, BookOpen } from 'lucide-react'
import { ApiOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { controlProcess } from '../api'
import { ProviderManagerModal } from './ProviderManagerModal'
import { McpManagerPanel } from './McpManagerPanel'

export function SettingsDropdown(): JSX.Element {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const [isRestarting, setIsRestarting] = useState(false)
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false)
  const [isMcpPanelOpen, setIsMcpPanelOpen] = useState(false)

  const handleRestart = async () => {
    setIsRestarting(true)
    try {
      await controlProcess('restart')
    } catch {
      // 请求可能失败（连接被拒绝），但服务可能正在重启
    }
    // UI端延迟2秒再开始轮询，配合服务端延迟1秒重启
    await new Promise(resolve => setTimeout(resolve, 2000))

    const startTime = Date.now()
    const minWaitTime = 3000

    const pollInterval = setInterval(async () => {
      const elapsed = Date.now() - startTime
      try {
        if (elapsed >= minWaitTime) {
          clearInterval(pollInterval)
          setIsRestarting(false)
        }
      } catch {
        // 重启过程中请求可能失败，继续轮询
      }
    }, 800)

    // 45秒超时保护
    setTimeout(() => {
      clearInterval(pollInterval)
      setIsRestarting(current => {
        if (current) setIsRestarting(false)
        return false
      })
    }, 45000)
  }

  const handleViewDocs = () => {
    window.open(location.origin + '/docs', '_blank')
  }

  return (
    <>
      <div className="relative group/settings">
        <button
          className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-bg-hover transition-colors"
          aria-label={t('menu.viewDocs')}
        >
          <Settings size={16} className="text-text-muted group-hover/settings:text-text-primary transition-colors" />
        </button>

        {/* Dropdown — appears on hover */}
        <div className="absolute right-0 top-full mt-1 w-48 glass-strong rounded-xl py-1 opacity-0 invisible group-hover/settings:opacity-100 group-hover/settings:visible transition-all duration-200 z-50">
          <button
            onClick={handleRestart}
            disabled={isRestarting}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={14} className={isRestarting ? 'animate-spin' : ''} />
            {isRestarting ? tc('action.restarting') : t('menu.restart')}
          </button>
          <button
            onClick={() => setIsProviderModalOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-hover transition-colors"
          >
            <DatabaseZap size={14} />
            {t('menu.providers')}
          </button>
          <button
            onClick={() => setIsMcpPanelOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-hover transition-colors"
          >
            <ApiOutlined style={{ fontSize: 14 }} />
            {t('menu.mcpServers')}
          </button>
          <div className="my-1 border-t border-border" />
          <button
            onClick={handleViewDocs}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-hover transition-colors"
          >
            <BookOpen size={14} />
            {t('menu.viewDocs')}
          </button>
        </div>
      </div>

      <ProviderManagerModal
        isOpen={isProviderModalOpen}
        onClose={() => setIsProviderModalOpen(false)}
      />
      <McpManagerPanel
        isOpen={isMcpPanelOpen}
        onClose={() => setIsMcpPanelOpen(false)}
      />
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/proxy-cli/src/components/SettingsDropdown.tsx
git commit -m "feat: create SettingsDropdown component with hover dropdown"
```

---

### Task 3: Integrate SettingsDropdown into App header + lift modal state

**Files:**
- Modify: `apps/proxy-cli/src/App.tsx:1-86`

**Interfaces:**
- Consumes: `SettingsDropdown` component from Task 2
- Produces: App header now includes SettingsDropdown between LanguageSwitcher and ThemeSwitcher

- [ ] **Step 1: Add SettingsDropdown import to App.tsx**

In `App.tsx`, add after line 6 (`import { ThemeSwitcher }`):

```tsx
import { SettingsDropdown } from './components/SettingsDropdown'
```

- [ ] **Step 2: Insert SettingsDropdown into header right side**

In `App.tsx`, change the header right `<div className="flex items-center gap-2">` block (lines 41-50). Insert `<SettingsDropdown />` between `<LanguageSwitcher />` and `<ThemeSwitcher />`:

```tsx
<div className="flex items-center gap-2">
  {versions && (
    <span className="text-xs text-text-muted">
      {t('versions.claudeCode')}: {versions.claudeVersion}
      <span className="ml-1 text-text-muted">机器码: {versions.machineId ?? ''}</span>
    </span>
  )}
  <LanguageSwitcher />
  <SettingsDropdown />
  <ThemeSwitcher />
</div>
```

- [ ] **Step 3: Commit**

```bash
git add apps/proxy-cli/src/App.tsx
git commit -m "feat: add SettingsDropdown to App header"
```

---

### Task 4: Remove title row, action buttons, and modal state from ConfigEditor

**Files:**
- Modify: `apps/proxy-cli/src/components/ConfigEditor.tsx:1-178`

**Interfaces:**
- Consumes: none (pure removal)
- Produces: ConfigEditor with only server info cards, no title/action buttons/modals

- [ ] **Step 1: Remove unused imports**

Remove these imports from ConfigEditor.tsx:
- `useState` (keep — `isSyncing` and `isRestarting` state removed, but `message`, `messageType`, `configPath`, `isSyncing` remain, so keep `useState`)
- Actually `useState` is still needed for `message`, `messageType`, `configPath`, `isSyncing` — keep it
- Remove `DatabaseZap` from lucide-react import (no longer used)
- Remove `RefreshCw` from lucide-react import (no longer used)
- Remove `ApiOutlined` from ant-design/icons import (no longer used)
- Remove `Button` from antd import (keep `Tooltip` — still used for sync button)
- Remove `ProviderManagerModal` import (moved to SettingsDropdown)
- Remove `McpManagerPanel` import (moved to SettingsDropdown)
- Remove `controlProcess` from api import (moved to SettingsDropdown)

Updated import block:
```tsx
import { useState, useEffect } from 'react'
import { Tooltip } from 'antd'
import { Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from 'antd'
import { fetchConfig, syncClaudeSettings } from '../api'
import { GlowCard } from './GlowCard'
import { TOKEN_COLORS } from './chart-theme'
```

Wait — `Button` is still needed for the sync button (line 143). Keep it. Remove only the unused ones.

Final import block:
```tsx
import { useState, useEffect } from 'react'
import { Button, Tooltip } from 'antd'
import { Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { fetchConfig, syncClaudeSettings } from '../api'
import { GlowCard } from './GlowCard'
import { TOKEN_COLORS } from './chart-theme'
```

- [ ] **Step 2: Remove unused state variables**

Remove these state declarations:
- `isRestarting` (line 16)
- `isProviderModalOpen` (line 17)
- `isMcpPanelOpen` (line 18)

Keep: `message`, `messageType`, `configPath`, `isSyncing`

- [ ] **Step 3: Remove handleRestart function**

Remove entire `handleRestart` function (lines 48-95).

- [ ] **Step 4: Remove title row with three action buttons**

Remove the `<h3>` block (lines 99-124) — the entire heading row with "Configuration" title and three buttons.

- [ ] **Step 5: Remove ProviderManagerModal and McpManagerPanel rendering**

Remove lines 168-175 (the ProviderManagerModal and McpManagerPanel JSX).

- [ ] **Step 6: Verify resulting ConfigEditor.tsx**

The resulting component should look like:

```tsx
import { useState, useEffect } from 'react'
import { Button, Tooltip } from 'antd'
import { Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { fetchConfig, syncClaudeSettings } from '../api'
import { GlowCard } from './GlowCard'
import { TOKEN_COLORS } from './chart-theme'

export function ConfigEditor(): JSX.Element {
  const { t } = useTranslation('config')
  const [message, setMessage] = useState<string | null>(null)
  const [messageType, setMessageType] = useState<'success' | 'error' | 'restarting'>('success')
  const [configPath, setConfigPath] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)

  useEffect(() => {
    fetchConfig().then(data => {
      if ('configPath' in data) {
        setConfigPath(data.configPath as string)
      }
    }).catch(() => {
      // 忽略获取配置路径失败
    })
  }, [])

  const handleSyncClaudeConfig = async () => {
    setIsSyncing(true)
    setMessage(null)
    try {
      const result = await syncClaudeSettings()
      setMessage(result.message)
      setMessageType(result.success ? 'success' : 'error')
      setTimeout(() => setMessage(null), 5000)
    } catch {
      setMessage(t('message.restartFailed'))
      setMessageType('error')
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h4 className="text-xs font-medium mb-2 text-text-muted">{t('section.server')}</h4>
        <div className="space-y-2">
          <GlowCard color={TOKEN_COLORS.input}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-text-muted mb-1">{t('common:label.address')}</div>
                <div className="text-text-primary font-mono text-xs">
                  http://localhost:9527
                </div>
              </div>
              <Tooltip title={t('action.syncClaudeConfig')}>
                <Button
                  type="text"
                  size="small"
                  icon={<Link2 size={14} />}
                  loading={isSyncing}
                  onClick={handleSyncClaudeConfig}
                  className="!p-0 flex items-center"
                />
              </Tooltip>
            </div>
          </GlowCard>
          <GlowCard color={TOKEN_COLORS.output}>
            <div className="text-xs font-medium text-text-muted mb-1">{t('common:label.configPath')}</div>
            <div className="text-text-primary font-mono text-xs break-all">
              {configPath ? configPath.replace(/\/config\.json$/, '') : '~/.cc-monitoring'}
            </div>
          </GlowCard>
        </div>
      </div>

      {message && (
        <div className={`p-2 mb-2 rounded ${
          messageType === 'success' ? 'bg-success/10 text-success' :
          messageType === 'restarting' ? 'bg-warning/10 text-warning animate-pulse' :
          'bg-error/10 text-error'
        }`}>
          {message}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/proxy-cli/src/components/ConfigEditor.tsx
git commit -m "refactor: remove title row, action buttons, and modal state from ConfigEditor"
```

---

### Task 5: Build verification

**Files:** none (verification only)

- [ ] **Step 1: Run build**

```bash
cd apps/proxy-cli && npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 2: Verify header shows gear icon, hover shows dropdown, 4 menu items functional**

Run the app and verify:
1. Header right side has gear icon between LanguageSwitcher and ThemeSwitcher
2. Hover on gear → dropdown appears with: Restart, Manage Providers, MCP Servers, View Docs
3. ConfigEditor panel no longer has title row or action buttons
4. Click "Manage Providers" → ProviderManagerModal opens
5. Click "MCP Servers" → McpManagerPanel opens
6. Click "View Docs" → opens `/docs` in new tab
7. Click "Restart" → restart flow works (spinning icon, disabled state)
8. Dark/light themes both work

- [ ] **Step 3: Final commit (if any build fixes needed)**

```bash
git add -A
git commit -m "fix: any build issues from SettingsDropdown integration"
```

---

## Self-Review

**1. Spec coverage:**
- Remove config title → Task 4 Step 4 ✓
- Move 3 buttons to header → Task 2 + Task 3 ✓
- Gear icon dropdown → Task 2 ✓
- Hover trigger → Task 2 (CSS group/group-hover) ✓
- 4 menu items (restart, providers, MCP, docs) → Task 2 ✓
- Docs opens in new tab → Task 2 (window.open) ✓
- Dynamic docs URL (location.origin) → Task 2 ✓
- Dark/light compatible → Task 2 (glass-strong, var(--color-*)) ✓

**2. Placeholder scan:** No TBD/TODO found. All steps have actual code. ✓

**3. Type consistency:** `SettingsDropdown` component signature matches usage in App.tsx (no props needed — all state internal). ✓
