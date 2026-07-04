# 供应商配置部分替换功能设计文档

**日期**：2026-07-04  
**状态**：待实现

## 概述

允许供应商配置部分字段为空，激活的供应商只替换有配置的字段，未配置的字段沿用 config.json 或客户端原值。

## 背景

当前实现要求供应商配置的 `base_url`、`api_key`、`model` 等字段必填，且激活供应商时全量替换所有字段。用户希望更灵活：只配置需要替换的字段，未配置的继续用原有配置。

## 需求

### 功能需求

1. **字段范围**：先处理 `base_url`、`api_key`、`model` 三个字段
2. **优先级逻辑**：
   - `base_url`：激活供应商配置 → config.json `proxy.target`
   - `api_key`：激活供应商配置 → config.json `proxy.apiKey` → 客户端请求头
   - `model`：激活供应商配置 → 客户端 `request.body.model`
3. **验证规则**：供应商记录至少有一个字段有值即可，无需全填
4. **激活逻辑**：保持 `is_default = 1` 的单条激活机制

### 非功能需求

1. 热生效：无需重启服务器，变更后立即生效
2. 向后兼容：现有全填的配置继续正常工作

## 设计

### 1. 数据库迁移 (Schema V4)

SQLite 不直接支持 ALTER COLUMN 删除 NOT NULL 约束，需要重建表。

**迁移步骤**：
```sql
-- 1. 创建新表
CREATE TABLE providers_new (
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
);

-- 2. 复制数据
INSERT INTO providers_new 
SELECT id, name, base_url, api_key, model, haiku_model, sonnet_model, opus_model, subagent_model, provider, is_default, created_at, updated_at
FROM providers;

-- 3. 替换表
DROP TABLE providers;
ALTER TABLE providers_new RENAME TO providers;

-- 4. 重建索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_name ON providers(name);
```

### 2. 数据层修改 (providers-db.ts)

**接口变更**：
- `Provider`：`base_url`、`api_key`、`model` 改为可选
- `ProviderInput`：同上

**验证逻辑变更**：
- `validateProvider`：不再强制 `base_url`、`api_key`、`model` 必填
- 新增规则：至少有一个字段有值（name 始终必填）
- `validateProviders`：保持"最多一个激活"的规则

### 3. Proxy 转发逻辑修改 (proxy.ts)

**ResolvedTarget 接口**：
```typescript
interface ResolvedTarget {
  baseUrl: string
  targetPath: string
  apiKey?: string
  model?: string  // 新增
}
```

**resolveProxyTarget 函数**：
- 读取激活供应商的 `base_url`、`api_key`、`model`
- 只有非空值才替换
- `base_url`：DB（非空）→ config.json `proxy.target`
- `api_key`：DB（非空）→ config.json `proxy.apiKey` → undefined（不替换）
- `model`：DB（非空）→ undefined（不替换）

**转发逻辑**：
- 在发送 fetch 请求前，如果 `resolved.model` 存在，替换 `request.body.model`

### 4. UI 修改 (ProviderManagerModal.tsx)

- 修改验证逻辑：不再强制字段必填
- 移除输入框的必填视觉样式
- 保持"至少一个激活"的交互逻辑

## 实现计划

1. 新建分支 `feature/provider-partial-replace`
2. 数据库迁移（schema v4）
3. providers-db.ts 接口和验证逻辑
4. proxy.ts 转发逻辑
5. UI 修改
6. 测试
7. 提交 PR

## 风险评估

- **数据库迁移风险**：重建表操作需要谨慎，先备份数据
- **向后兼容风险**：确保现有全填配置继续工作
