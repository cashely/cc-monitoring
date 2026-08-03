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

