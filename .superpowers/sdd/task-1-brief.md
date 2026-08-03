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

