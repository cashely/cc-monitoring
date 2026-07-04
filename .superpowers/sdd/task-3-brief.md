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

