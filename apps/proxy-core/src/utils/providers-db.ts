import Database from 'better-sqlite3'

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
  is_openai_compatible: boolean
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
  is_openai_compatible?: boolean
}

export interface ProviderValidationError {
  index?: number
  field: string
  message: string
}

const REQUIRED_FIELDS: (keyof ProviderInput)[] = ['name', 'provider']

export function listProviders(db: Database.Database): Provider[] {
  const rows = db.prepare(
    'SELECT * FROM providers ORDER BY created_at DESC'
  ).all() as any[]
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    base_url: r.base_url,
    api_key: r.api_key,
    model: r.model,
    haiku_model: r.haiku_model,
    sonnet_model: r.sonnet_model,
    opus_model: r.opus_model,
    subagent_model: r.subagent_model,
    provider: r.provider,
    default: !!r.is_default,
    is_openai_compatible: !!r.is_openai_compatible,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }))
}

/**
 * Destructive full replacement: deletes ALL existing providers then inserts the given list.
 * Passing an empty array will wipe all provider data with no replacement.
 * Prepared statements are created per-call since this is a low-volume admin operation
 * (called only when user saves config via UI). Caching would add complexity with no
 * measurable benefit for this use case.
 */
export function saveProviders(db: Database.Database, providers: ProviderInput[]): void {
  const deleteAll = db.prepare('DELETE FROM providers')
  const insertOne = db.prepare(`
    INSERT INTO providers (name, base_url, api_key, model, haiku_model, sonnet_model, opus_model, subagent_model, provider, is_default, is_openai_compatible)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        p.default ? 1 : 0,
        p.is_openai_compatible ? 1 : 0
      )
    }
  })

  transaction()
}

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

export function validateProviders(inputs: ProviderInput[]): ProviderValidationError[] {
  const errors: ProviderValidationError[] = []

  // Validate each provider individually
  for (let i = 0; i < inputs.length; i++) {
    const providerErrors = validateProvider(inputs[i])
    for (const e of providerErrors) {
      errors.push({ ...e, index: i })
    }
  }

  // Check for duplicate names
  const names = inputs.map(p => p.name)
  const seen = new Set<string>()
  for (let i = 0; i < names.length; i++) {
    if (names[i] && seen.has(names[i])) {
      errors.push({ index: i, field: 'name', message: `duplicate name: "${names[i]}"` })
    }
    seen.add(names[i])
  }

  // Enforce at most one active provider
  const defaultCount = inputs.filter(p => p.default).length
  if (defaultCount > 1) {
    errors.push({ field: 'default', message: 'only one provider can be default' })
  }

  return errors
}
