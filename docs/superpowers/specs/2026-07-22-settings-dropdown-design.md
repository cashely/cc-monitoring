# Settings Dropdown in Header — Design Spec

## Goal

Move config action buttons (restart, provider mgmt, MCP servers) from ConfigEditor title row to header top-right as a gear icon hover dropdown. Add "View Docs" menu item. Remove ConfigEditor title.

## Approach

New `SettingsDropdown` component in header right side. State lifted from ConfigEditor to App.

## Components

### SettingsDropdown (`apps/proxy-cli/src/components/SettingsDropdown.tsx`)

- Gear icon: `lucide-react` `Settings` icon, 16px
- Hover trigger: CSS `group` + `group-hover:visible/opacity` — no JS state for menu open/close
- Dropdown menu: `.glass-strong` background, `var(--color-*)` colors, 12px font, light/dark compatible
- Menu items (top to bottom):
  1. **Restart** — `<RefreshCw>` icon, calls `handleRestart()`, spinning animation while restarting
  2. **Provider Management** — `<DatabaseZap>` icon, triggers `onProviderModalOpen()`
  3. **MCP Servers** — `<ApiOutlined>` icon, triggers `onMcpPanelOpen()`
  4. **View Docs** — `<BookOpen>` icon, `window.open(location.origin + '/docs', '_blank')`

Props:
```
onProviderModalOpen: () => void
onMcpPanelOpen: () => void
```

`handleRestart` lives inside SettingsDropdown (same logic as ConfigEditor's current version — calls `/ui/api/server/restart` API).

### ConfigEditor changes

- **Remove** `<h3>` title row (heading text + three action buttons) entirely
- **Remove** `handleRestart`, `isProviderModalOpen`, `isMcpPanelOpen` state and related functions
- **Remove** ProviderManagerModal and McpManagerPanel rendering (moved to App)
- Content starts directly from Server address card / config path card

### App.tsx changes

- Header right side: insert `<SettingsDropdown>` between LanguageSwitcher and ThemeSwitcher (order: [version info] [LanguageSwitcher] [SettingsDropdown] [ThemeSwitcher])
- Add `isProviderModalOpen` / `isMcpPanelOpen` state to App
- Render `<ProviderManagerModal>` and `<McpManagerPanel>` at App level
- Remove ConfigEditor's provider/mcp related props if any

## Style Constraints

- Colors: `var(--color-*)` only, no hardcoded colors
- Glass effect: `.glass-strong` on dropdown panel
- Font: 12px (`text-xs`)
- Theme: dark/light compatible via `.light` class
- Dropdown positioning: absolute, right-aligned under gear icon

## Verification

1. Header shows gear icon in top-right
2. Hover on gear → dropdown appears with 4 items
3. Each menu item works (restart, provider modal, MCP panel, docs opens in new tab)
4. ConfigEditor no title row, no action buttons
5. Dark/light themes both work
6. Mobile: dropdown hover works on desktop; no mobile-specific handling needed (not in scope)
