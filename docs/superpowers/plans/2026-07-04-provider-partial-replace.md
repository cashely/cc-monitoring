# 供应商配置部分替换实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现供应商配置部分替换功能，允许激活供应商只替换有配置的字段（base_url、api_key、model）。

**Architecture:** 
- 数据库迁移（schema v4）允许字段为 NULL
- 修改验证逻辑允许部分字段为空
- 修改 proxy 转发逻辑实现部分替换
- 修改 UI 支持部分字段输入

**Tech Stack:** TypeScript, SQLite, React, Fastify, better-sqlite3

**Global Constraints:**
- 保持向后兼容：现有全填配置继续工作
- 热生效：无需重启服务器
- 遵循现有代码风格和项目结构

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/proxy-core/src/utils/db.ts` | Modify | Add schema v4 migration |
| `apps/proxy-core/src/utils/providers-db.ts` | Modify | Update interfaces and validation |
| `apps/proxy-core/src/server/proxy.ts` | Modify | Update resolveProxyTarget and forwarding logic |
| `apps/proxy-cli/src/components/ProviderManagerModal.tsx` | Modify | Update UI validation |

---

### Task 1: Create New Branch and Database Migration

**Files:**
- Modify: `apps/proxy-core/src/utils/db.ts:83-90`

**Interfaces:**
- Consumes: None
- Produces: `applySchemaV4()` function that removes NOT NULL constraints

- [ ] **Step 1: Create new branch**

```bash
git checkout -b feature/provider-partial-replace
```

- [ ] **Step 2: Add schema v4 migration to db.ts**

Add after `applySchemaV3`:

```typescript
export function applySchemaV4(db: Database.Database) {
  // Remove NOT NULL constraints from base_url, api_key, model
  // SQLite doesn't support ALTER COLUMN, so rebuild the table
  const columns = db.prepare("PRAGMA table_info(providers)").all() as { name: string }[]
  const hasNotNullColumns = columns.some(c => ['base_url', 'api_key', 'model'].includes(c.name))
  
  if (hasNotNullColumns) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS providers_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        base_url TEXT,
        api_key TEXT,
        model TEXT,
        haiku_model TEXT,
        sonnet_model TEXT,
        opus_model TEXT,
        subagent_model TEXT,
        provider TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
    db.exec(`
      INSERT INTO providers_new
      SELECT id, name, base_url, api_key, model, haiku_model, sonnet_model, opus_model, subagent_model, provider, is_default, created_at, updated_at
      FROM providers
    `)
    db.exec('DROP TABLE providers')
    db.exec('ALTER TABLE providers_new RENAME TO providers')
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_name ON providers(name)')
  }
}
```

- [ ] **Step 3: Update initDatabase to apply v4 migration**

In `initDatabase()` function, add:

```typescript
if (currentVersion < 4) {
  applySchemaV4(db)
  db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (4)').run()
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/proxy-core/src/utils/db.ts
git commit -m "feat: add schema v4 migration for nullable provider fields"
```

---

### Task 2: Update Providers Data Layer Interfaces and Validation

**Files:**
- Modify: `apps/proxy-core/src/utils/providers-db.ts`

**Interfaces:**
- Consumes: None
- Produces: Updated `Provider`, `ProviderInput` interfaces; updated validation logic

- [ ] **Step 1: Update Provider and ProviderInput interfaces**

Change from:
```typescript
export interface Provider {
  id: number
  name: string
  base_url: string
  api_key: string
  model: string
  haiku_model: string | null
  sonnet_model: string | null
  opus_model: string | null
  subagent_model: string | null
  provider: string
  default: boolean
  created_at: string
  updated_at: string
}

export interface ProviderInput {
  name: string
  base_url: string
  api_key: string
  model: string
  haiku_model?: string
  sonnet_model?: string
  opus_model?: string
  subagent_model?: string
  provider: string
  default?: boolean
}
```

To:
```typescript
export interface Provider {
  id: number
  name: string
  base_url: string | null
  api_key: string | null
  model: string | null
  haiku_model: string | null
  sonnet_model: string | null
  opus_model: string | null
  subagent_model: string | null
  provider: string
  default: boolean
  created_at: string
  updated_at: string
}

export interface ProviderInput {
  name: string
  base_url?: string
  api_key?: string
  model?: string
  haiku_model?: string
  sonnet_model?: string
  opus_model?: string
  subagent_model?: string
  provider: string
  default?: boolean
}
```

- [ ] **Step 2: Update REQUIRED_FIELDS and validateProvider**

Change:
```typescript
const REQUIRED_FIELDS: (keyof ProviderInput)[] = ['name', 'base_url', 'api_key', 'model', 'provider']
```

To:
```typescript
const REQUIRED_FIELDS: (keyof ProviderInput)[] = ['name', 'provider']
```

Update `validateProvider` function:

```typescript
export function validateProvider(input: ProviderInput): ProviderValidationError[] {
  const errors: ProviderValidationError[] = []

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    const value = input[field]
    if (typeof value === 'boolean') {
      continue
    }
    if (!value || (value as string).trim() === '') {
      errors.push({ field, message: `${field} is required` })
    }
  }

  // At least one of the optional fields should have a value
  const hasOptionalValue = 
    (input.base_url && input.base_url.trim() !== '') ||
    (input.api_key && input.api_key.trim() !== '') ||
    (input.model && input.model.trim() !== '') ||
    (input.haiku_model && input.haiku_model.trim() !== '') ||
    (input.sonnet_model && input.sonnet_model.trim() !== '') ||
    (input.opus_model && input.opus_model.trim() !== '') ||
    (input.subagent_model && input.subagent_model.trim() !== '')

  if (errors.length === 0 && !hasOptionalValue) {
    errors.push({ field: 'base_url', message: 'at least one field (base_url, api_key, model, etc.) should have a value' })
  }

  // Validate base_url format only if provided
  if (input.base_url && input.base_url.trim() !== '') {
    try {
      const url = new URL(input.base_url)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        errors.push({ field: 'base_url', message: 'base_url must be a valid HTTP or HTTPS URL' })
      }
    } catch {
      errors.push({ field: 'base_url', message: 'base_url must be a valid URL' })
    }
  }

  return errors
}
```

- [ ] **Step 3: Update saveProviders to handle empty strings as NULL**

In `saveProviders` function, when inserting, convert empty strings to null:

```typescript
export function saveProviders(db: Database.Database, providers: ProviderInput[]): void {
  const deleteAll = db.prepare('DELETE FROM providers')
  const insertOne = db.prepare(`
    INSERT INTO providers (name, base_url, api_key, model, haiku_model, sonnet_model, opus_model, subagent_model, provider, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const transaction = db.transaction(() => {
    deleteAll.run()
    for (const p of providers) {
      insertOne.run(
        p.name,
        p.base_url && p.base_url.trim() !== '' ? p.base_url : null,
        p.api_key && p.api_key.trim() !== '' ? p.api_key : null,
        p.model && p.model.trim() !== '' ? p.model : null,
        p.haiku_model && p.haiku_model.trim() !== '' ? p.haiku_model : null,
        p.sonnet_model && p.sonnet_model.trim() !== '' ? p.sonnet_model : null,
        p.opus_model && p.opus_model.trim() !== '' ? p.opus_model : null,
        p.subagent_model && p.subagent_model.trim() !== '' ? p.subagent_model : null,
        p.provider,
        p.default ? 1 : 0
      )
    }
  })

  transaction()
}
```

- [ ] **Step 4: Update listProviders to handle null correctly**

Current code is already okay - it maps `is_default` but other nulls pass through fine.

- [ ] **Step 5: Commit**

```bash
git add apps/proxy-core/src/utils/providers-db.ts
git commit -m "feat: update provider interfaces and validation for partial fields"
```

---

### Task 3: Update Proxy Forwarding Logic for Partial Replacement

**Files:**
- Modify: `apps/proxy-core/src/server/proxy.ts:24-64,158-165`

**Interfaces:**
- Consumes: Updated `Provider` interface (nullable fields)
- Produces: Updated `ResolvedTarget` with `model?: string`, updated forwarding logic

- [ ] **Step 1: Update ResolvedTarget interface**

Change:
```typescript
interface ResolvedTarget {
  baseUrl: string
  targetPath: string
  apiKey?: string
}
```

To:
```typescript
interface ResolvedTarget {
  baseUrl: string
  targetPath: string
  apiKey?: string
  model?: string
}
```

- [ ] **Step 2: Update resolveProxyTarget function**

Rewrite the function to handle partial replacement:

```typescript
export function resolveProxyTarget(proxyConfig: ProxyConfig): ResolvedTarget {
  // Default to config values
  let baseUrl: string
  let targetPath: string
  let apiKey: string | undefined = proxyConfig.apiKey
  let model: string | undefined

  // Parse config target as base
  const configUrl = new URL(proxyConfig.target)
  baseUrl = configUrl.origin
  targetPath = configUrl.pathname.replace(/\/$/, '')

  try {
    const db = getDatabase()
    const active = db.prepare(
      'SELECT base_url, api_key, model FROM providers WHERE is_default = 1 LIMIT 1'
    ).get() as { base_url: string | null, api_key: string | null, model: string | null } | undefined

    if (active) {
      // Replace base_url only if provided
      if (active.base_url && active.base_url.trim() !== '') {
        const providerUrl = new URL(active.base_url)
        baseUrl = providerUrl.origin
        targetPath = providerUrl.pathname.replace(/\/$/, '')
      }

      // Replace api_key only if provided
      if (active.api_key && active.api_key.trim() !== '') {
        apiKey = active.api_key
      }

      // Replace model only if provided
      if (active.model && active.model.trim() !== '') {
        model = active.model
      }
    }
  } catch {
    // DB not initialized yet or read error - use config defaults
  }

  return { baseUrl, targetPath, apiKey, model }
}
```

- [ ] **Step 3: Update forwarding logic to replace model in request body**

In the fastify route handler, after `resolveProxyTarget` call, add:

```typescript
// Replace model if provider has one configured
const originalModel = request.body?.model
if (resolved.model && request.body && typeof request.body === 'object') {
  request.body.model = resolved.model
}
```

Also update the `requestData.model` assignment to use `originalModel` (so logs show what the client sent):

```typescript
model: originalModel,
```

Find the line:
```typescript
model: request.body?.model,
```

Change to:
```typescript
model: originalModel,
```

- [ ] **Step 4: Commit**

```bash
git add apps/proxy-core/src/server/proxy.ts
git commit -m "feat: implement partial replacement for provider fields"
```

---

### Task 4: Update UI Provider Manager

**Files:**
- Modify: `apps/proxy-cli/src/components/ProviderManagerModal.tsx`

**Interfaces:**
- Consumes: Updated API (same endpoint, just allows empty fields now)
- Produces: Updated UI with relaxed validation

- [ ] **Step 1: Update EMPTY_ROW**

Change:
```typescript
const EMPTY_ROW: ProviderInput = {
  name: '',
  base_url: '',
  api_key: '',
  model: '',
  haiku_model: '',
  sonnet_model: '',
  opus_model: '',
  subagent_model: '',
  provider: '',
  default: false
}
```

To (already the same - okay):

```typescript
const EMPTY_ROW: ProviderInput = {
  name: '',
  base_url: '',
  api_key: '',
  model: '',
  haiku_model: '',
  sonnet_model: '',
  opus_model: '',
  subagent_model: '',
  provider: '',
  default: false
}
```

- [ ] **Step 2: Update providerToInput function**

Change:
```typescript
function providerToInput(p: Provider): ProviderInput {
  return {
    name: p.name,
    base_url: p.base_url,
    api_key: p.api_key,
    model: p.model,
    haiku_model: p.haiku_model ?? '',
    sonnet_model: p.sonnet_model ?? '',
    opus_model: p.opus_model ?? '',
    subagent_model: p.subagent_model ?? '',
    provider: p.provider,
    default: p.default
  }
}
```

To (handle nulls):
```typescript
function providerToInput(p: Provider): ProviderInput {
  return {
    name: p.name,
    base_url: p.base_url ?? '',
    api_key: p.api_key ?? '',
    model: p.model ?? '',
    haiku_model: p.haiku_model ?? '',
    sonnet_model: p.sonnet_model ?? '',
    opus_model: p.opus_model ?? '',
    subagent_model: p.subagent_model ?? '',
    provider: p.provider,
    default: p.default
  }
}
```

- [ ] **Step 3: Check API types are updated**

Check `apps/proxy-cli/src/types/providers.ts` - it should mirror `ProviderInput`. Update if necessary.

(Note: If the types file doesn't exist or is outdated, update it too.)

- [ ] **Step 4: Commit**

```bash
git add apps/proxy-cli/src/components/ProviderManagerModal.tsx
# Check and commit types file too if needed
git commit -m "feat: update UI provider manager for partial fields"
```

---

### Task 5: Test and Verify

**Files:** None - manual testing

- [ ] **Step 1: Build the project**

```bash
pnpm build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Run any tests**

```bash
pnpm test
```

Expected: Tests pass.

- [ ] **Step 3: Manual test - create provider with only base_url**

1. Start proxy: `pnpm start`
2. Open UI: `pnpm ui`
3. Open provider manager
4. Add provider with:
   - name: "test-base-url-only"
   - base_url: "https://example.com/api"
   - provider: "anthropic"
   - (leave api_key, model empty)
5. Activate it and save
6. Verify requests use the new base_url but keep original api_key and model

- [ ] **Step 4: Manual test - create provider with only api_key**

1. Add provider with:
   - name: "test-api-key-only"
   - api_key: "sk-test123"
   - provider: "anthropic"
2. Activate it and save
3. Verify requests use the new api_key but keep original base_url and model

- [ ] **Step 5: Commit (if needed, just a merge commit or final check)**

```bash
git status
# If clean, proceed to merge
```

---

## Self-Review Checklist

**1. Spec Coverage:**
- ✓ Database migration (schema v4) - Task 1
- ✓ Data layer interfaces and validation - Task 2
- ✓ Proxy partial replacement logic - Task 3
- ✓ UI updates - Task 4
- ✓ Testing - Task 5

**2. Placeholder Scan:**
- No "TBD"/"TODO"
- All code blocks complete
- All commands exact

**3. Type Consistency:**
- Interfaces consistent across tasks
- `Provider`/`ProviderInput` nullable fields match
- `ResolvedTarget.model` added consistently

---

Plan complete and saved to `docs/superpowers/plans/2026-07-04-provider-partial-replace.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
