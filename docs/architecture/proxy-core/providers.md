# proxy-core / 供应商管理

## 本文档覆盖的源文件

- `apps/proxy-core/src/server/providers-route.ts`
- `apps/proxy-core/src/utils/providers-db.ts`
- `apps/proxy-core/src/server/proxy.ts:40-88`（`resolveProxyTarget`）
- `apps/proxy-core/src/server/proxy.ts:98-115`（`getProxyModel`）
- `apps/proxy-core/src/utils/db.ts:68-131`（v2/v3/v4 schema）

## 用途

「供应商」= 一组可切换的上游 AI API 配置（base_url + api_key + 多档模型）。用户可以在 UI 里维护多个 provider，激活其中一个作为「当前」，proxy 转发时会按激活项覆盖 `config.json` 的对应字段。

## 数据模型

SQLite `providers` 表（`db.ts:68-131`，v2 建表、v3 加 `is_default`、v4 放开 NOT NULL）：

| 字段 | 类型 | 备注 |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `name` | TEXT UNIQUE NOT NULL | 主键之外的唯一键 |
| `base_url` | TEXT (nullable) | 完整 URL，含 API 前缀 |
| `api_key` | TEXT (nullable) | |
| `model` | TEXT (nullable) | 主 model 覆盖 |
| `haiku_model` | TEXT (nullable) | Anthropic 分档预留 |
| `sonnet_model` | TEXT (nullable) | |
| `opus_model` | TEXT (nullable) | |
| `subagent_model` | TEXT (nullable) | 子 agent 单独 model 预留 |
| `provider` | TEXT NOT NULL | 分类标签（"anthropic"/"aliyun"/"volces"...） |
| `is_default` | INTEGER NOT NULL DEFAULT 0 | 激活标记，全表最多 1 个为 1 |
| `created_at` | TEXT DEFAULT CURRENT_TIMESTAMP | |
| `updated_at` | TEXT DEFAULT CURRENT_TIMESTAMP | |

索引：`idx_providers_name` UNIQUE。

`haiku_model / sonnet_model / opus_model` **现已参与转发**：`resolveProxyTarget` 读取 tier models 并返回，由 `getProxyModel` 根据请求的原始 model 按 tier 映射替换。`subagent_model` 目前仅存储，不参与转发——为将来子 agent 单独 model 预留。

## Schema 迁移的三步

`applySchemaV2`：建表 + 唯一索引，NOT NULL 约束加在 `base_url / api_key / model`（`db.ts:68-86`）。

`applySchemaV3`：`PRAGMA table_info` 检测 `is_default` 是否存在，缺失则 `ALTER TABLE ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`（`db.ts:88-95`）。ADD COLUMN 是 SQLite 支持的少数原地变更之一，且带 DEFAULT 时不阻塞。

`applySchemaV4`：SQLite 不能直接 `ALTER COLUMN` 去除 NOT NULL，只能**重建表**：新建 `providers_new`（无 NOT NULL） → `INSERT INTO providers_new SELECT ... FROM providers` → `DROP TABLE providers` → `ALTER TABLE providers_new RENAME TO providers` → 重建索引（`db.ts:97-132`）。整个过程带条件（仅当检测到 NOT NULL 列时才触发），idempotent-safe。

放开 NOT NULL 是为支持「部分覆盖」：一个 provider 只需要指定要替换的字段，其它字段留 NULL 表示「用 config.json 默认」。

## `resolveProxyTarget`

`apps/proxy-core/src/server/proxy.ts:40-88`。每次业务请求进入 handler 都同步跑一次：

```ts
const active = db.prepare(
  'SELECT base_url, api_key, model, haiku_model, sonnet_model, opus_model FROM providers WHERE is_default = 1 LIMIT 1'
).get()

if (active) {
  if (active.base_url?.trim()) { /* 覆盖 baseUrl/targetPath */ }
  if (active.api_key?.trim())  { apiKey = active.api_key }
  if (active.model?.trim())       { model = active.model }
  if (active.haiku_model?.trim()) { haiku_model = active.haiku_model }
  if (active.sonnet_model?.trim()) { sonnet_model = active.sonnet_model }
  if (active.opus_model?.trim())  { opus_model = active.opus_model }
}
```

返回 `{ baseUrl, targetPath, apiKey?, model?, haiku_model?, sonnet_model?, opus_model? }`。

**部分覆盖语义**：

- 只填 `base_url` → 换目标但复用 config.json 的 key（多数场景：切上游 endpoint）
- 只填 `api_key` → 换 key 但复用 target（多账户轮换）
- 只填 `model` → 强制所有请求跑同一 model（灰度、成本控制）
- 填 tier models（如 `sonnet_model`）→ 按 `getProxyModel` 映射，haiku/sonnet/opus 分别走不同模型
- 三者组合 → 完全独立的 provider

## `getProxyModel`

`apps/proxy-core/src/server/proxy.ts:98-115`。根据请求的原始 model 和 provider tier 配置选择替换 model：

```ts
claude-haiku*   → haiku_model (fallback: model → undefined)
claude-sonnet*  → sonnet_model (fallback: model → undefined)
claude-opus*    → opus_model (fallback: model → undefined)
其它            → model (fallback: undefined)
```

**fallback 链**：tier 专属 model → 通用 `model` → undefined（不替换）。这让一个 provider 可以只配一个通用 model（所有 tier 都用它），也可以精细到每个 tier 不同 model。

**使用场景**：国内模型通常不区分 tier，一个 `model` 字段就够了。但如果用 Anthropic 直连或不同 tier 跑不同供应商，`haiku_model / sonnet_model / opus_model` 让一次切换覆盖所有 tier。

**同步查询开销**：better-sqlite3 是同步 API，单行 UNIQUE 索引 SELECT 微秒级，无缓存。热切换时下一次请求立即生效，不需要重启进程。

**异常兜底**：`try/catch` 内部若 DB 未 initDatabase / URL 解析失败 / 表不存在，直接 fallback 到 `config.proxy.target` 的解析结果。

## Node 层：`utils/providers-db.ts`

三类函数：

### `listProviders(db)`

```ts
SELECT * FROM providers ORDER BY created_at DESC
```

每行把 `is_default: number` 转为 `default: boolean` 后返回。

### `saveProviders(db, providers[])`

**Destructive full replacement**：先 `DELETE FROM providers`，再逐行 INSERT，全部在一个 SQLite transaction 内。空数组 → 清空全表。

`INSERT` 中每个可选字段：`p.base_url?.trim() ? p.base_url : null` — 空串统一转 NULL，避免 UNIQUE / 逻辑判断上「非空空串」和「NULL」混淆。

`is_default` 从 boolean 转 `1 | 0`。

**为什么全量替换而不是 upsert**：前端 UI 是「一张表格 → 保存整表」的模式，实现上更简单，避免局部同步的边界（同一 id 改名、id 冲突等）。

**开销**：只在用户点「保存」时触发（低频运维操作），准备语句每次 new 也无性能问题。

### `validateProvider` / `validateProviders`

**单个校验**（`providers-db.ts:85-126`）：

- 必填字段：`name`、`provider`（trim 后非空）
- 「至少填一个可选字段」：`base_url / api_key / model / haiku_model / sonnet_model / opus_model / subagent_model` 至少有一个非空——防止用户建一个只有名字的空 provider
- `base_url` 若填了必须是 `http:` 或 `https:` 协议的合法 URL

**批量校验**（`providers-db.ts:128-156`）：

- 逐个跑 `validateProvider`，错误项挂 `index`
- 检查 `name` 重复
- 检查 `default: true` 最多 1 个

任何一条不通过就整批拒绝，返回 `ProviderValidationError[]`。

## REST 端点

`apps/proxy-core/src/server/providers-route.ts`：

### GET /ui/api/providers

无认证。`listProviders` 结果封装到 `{ providers }`。异常返回 500。

### POST /ui/api/providers

**认证**（`checkAuth`）。请求体：

```ts
{ providers: ProviderInput[] }
```

流程：

1. Bearer 认证
2. 请求体存在 + `providers` 是数组
3. `validateProviders(providers)` → 错误列表非空 → 400 + `{ errors }`
4. `saveProviders(db, providers)`（事务）
5. `{ success: true }`

## 前端交互

`ProviderManagerModal`（`apps/proxy-cli/src/components/ProviderManagerModal.tsx`）：

- 打开时 `fetchProviders()` 装填表格
- 每行 9 个字段 + 「激活 / 删除」按钮；「激活」把该行 `default = true`、其它行 `default = false`
- 「保存」调 `saveProviders(rows)`：全量提交
- 错误分两种：`errors[]`（字段级）分行显示；`error`（顶层字符串）单条显示

详见 [../proxy-cli/components-config.md](../proxy-cli/components-config.md)。

## 切换与广播

供应商切换**不广播事件**。前端保存成功后无 WebSocket 通知，其它连接需要手动刷新 `ProviderManagerModal`。业务请求端不受影响：`resolveProxyTarget` 下次 SELECT 就拿到新的激活项。

## 相关文档

- Schema 迁移全景 → [data-layer.md](./data-layer.md)
- 前端管理界面 → [../proxy-cli/components-config.md](../proxy-cli/components-config.md)
- `resolveProxyTarget` 在 handler 中的位置 → [proxy-forwarding.md](./proxy-forwarding.md#公用步骤)
