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

