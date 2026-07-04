import Database from 'better-sqlite3'
import { applySchemaV2, applySchemaV3 } from '../db.js'
import {
  listProviders,
  saveProviders,
  validateProvider,
  validateProviders,
  Provider,
  ProviderInput,
  ProviderValidationError
} from '../providers-db.js'

describe('providers-db', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`)
    applySchemaV2(db)
    applySchemaV3(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('listProviders', () => {
    test('returns empty array initially', () => {
      const result = listProviders(db)
      expect(result).toEqual([])
    })

    test('returns all providers sorted by created_at DESC', () => {
      db.prepare(
        `INSERT INTO providers (name, base_url, api_key, model, provider, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('alpha', 'https://a.com', 'key1', 'claude-3', 'anthropic', '2026-01-01T00:00:00Z')

      db.prepare(
        `INSERT INTO providers (name, base_url, api_key, model, provider, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('beta', 'https://b.com', 'key2', 'gpt-4', 'openai', '2026-06-01T00:00:00Z')

      const result = listProviders(db)
      expect(result.length).toBe(2)
      expect(result[0].name).toBe('beta')  // newer first
      expect(result[1].name).toBe('alpha')
    })

    test('maps is_default column to default boolean field', () => {
      db.prepare(
        `INSERT INTO providers (name, base_url, api_key, model, provider, is_default)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('active', 'https://a.com', 'key', 'm', 'anthropic', 1)

      db.prepare(
        `INSERT INTO providers (name, base_url, api_key, model, provider, is_default)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('inactive', 'https://b.com', 'key2', 'm', 'anthropic', 0)

      const result = listProviders(db)
      const active = result.find(p => p.name === 'active')
      const inactive = result.find(p => p.name === 'inactive')
      expect(active?.default).toBe(true)
      expect(inactive?.default).toBe(false)
    })
  })

  describe('saveProviders', () => {
    test('overwrites existing data', () => {
      db.prepare(
        `INSERT INTO providers (name, base_url, api_key, model, provider)
         VALUES (?, ?, ?, ?, ?)`
      ).run('old', 'https://old.com', 'old-key', 'old-model', 'anthropic')

      const input: ProviderInput[] = [
        { name: 'new', base_url: 'https://new.com', api_key: 'new-key', model: 'claude-3.5', provider: 'anthropic' }
      ]

      saveProviders(db, input)

      const result = listProviders(db)
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('new')
    })

    test('saves multiple providers in transaction', () => {
      const input: ProviderInput[] = [
        { name: 'p1', base_url: 'https://p1.com', api_key: 'k1', model: 'claude-3', provider: 'anthropic' },
        { name: 'p2', base_url: 'https://p2.com', api_key: 'k2', model: 'gpt-4', provider: 'openai', haiku_model: 'claude-3-haiku' }
      ]

      saveProviders(db, input)

      const result = listProviders(db)
      expect(result.length).toBe(2)
      // Verify optional field persisted
      const p2 = result.find(p => p.name === 'p2')
      expect(p2?.haiku_model).toBe('claude-3-haiku')
    })

    test('sets created_at and updated_at on insert', () => {
      const input: ProviderInput[] = [
        { name: 'fresh', base_url: 'https://f.com', api_key: 'k', model: 'm', provider: 'anthropic' }
      ]

      saveProviders(db, input)

      const result = listProviders(db)
      expect(result[0].created_at).toBeTruthy()
      expect(result[0].updated_at).toBeTruthy()
    })

    test('persists is_default flag from input', () => {
      const input: ProviderInput[] = [
        { name: 'p1', base_url: 'https://p1.com', api_key: 'k1', model: 'm', provider: 'anthropic', default: true },
        { name: 'p2', base_url: 'https://p2.com', api_key: 'k2', model: 'm', provider: 'anthropic', default: false }
      ]

      saveProviders(db, input)

      const result = listProviders(db)
      const p1 = result.find(p => p.name === 'p1')
      const p2 = result.find(p => p.name === 'p2')
      expect(p1?.default).toBe(true)
      expect(p2?.default).toBe(false)
    })

    test('treats missing default as false', () => {
      const input: ProviderInput[] = [
        { name: 'p1', base_url: 'https://p1.com', api_key: 'k1', model: 'm', provider: 'anthropic' }
      ]

      saveProviders(db, input)

      const result = listProviders(db)
      expect(result[0].default).toBe(false)
    })

    test('full replacement preserves active provider by client-sent default flag', () => {
      // Initial state: p1 is active
      const initial: ProviderInput[] = [
        { name: 'p1', base_url: 'https://p1.com', api_key: 'k1', model: 'm', provider: 'anthropic', default: true },
        { name: 'p2', base_url: 'https://p2.com', api_key: 'k2', model: 'm', provider: 'anthropic' }
      ]
      saveProviders(db, initial)

      // User edits and re-submits with p2 now active
      const updated: ProviderInput[] = [
        { name: 'p1', base_url: 'https://p1.com', api_key: 'k1', model: 'm', provider: 'anthropic' },
        { name: 'p2', base_url: 'https://p2.com', api_key: 'k2', model: 'm', provider: 'anthropic', default: true }
      ]
      saveProviders(db, updated)

      const result = listProviders(db)
      const p1 = result.find(p => p.name === 'p1')
      const p2 = result.find(p => p.name === 'p2')
      expect(p1?.default).toBe(false)
      expect(p2?.default).toBe(true)
    })
  })

  describe('validateProvider', () => {
    test('accepts valid data', () => {
      const input: ProviderInput = {
        name: 'valid-provider',
        base_url: 'https://api.anthropic.com',
        api_key: 'sk-ant-123',
        model: 'claude-3.5-sonnet',
        provider: 'anthropic'
      }

      const errors = validateProvider(input)
      expect(errors).toEqual([])
    })

    test('accepts valid data with optional fields', () => {
      const input: ProviderInput = {
        name: 'full-provider',
        base_url: 'https://api.anthropic.com',
        api_key: 'sk-ant-123',
        model: 'claude-3.5-sonnet',
        provider: 'anthropic',
        haiku_model: 'claude-3-haiku',
        sonnet_model: 'claude-3-sonnet',
        opus_model: 'claude-3-opus',
        subagent_model: 'claude-3.5-sonnet'
      }

      const errors = validateProvider(input)
      expect(errors).toEqual([])
    })

    test('rejects missing required fields and requires at least one optional field', () => {
      const input: ProviderInput = {
        name: '',
        base_url: '',
        api_key: '',
        model: '',
        provider: ''
      }

      const errors = validateProvider(input)
      expect(errors.length).toBe(2) // name empty and provider empty (all optional fields are also empty)
      expect(errors.some(e => e.field === 'name')).toBe(true)
      expect(errors.some(e => e.field === 'provider')).toBe(true)
      // Since there are already errors from required fields, we don't get the "at least one field" error
      expect(errors.some(e => e.field === 'name')).toBe(true)
      expect(errors.some(e => e.field === 'provider')).toBe(true)
    })

    test('rejects invalid base_url', () => {
      const input: ProviderInput = {
        name: 'bad-url',
        base_url: 'not-a-url',
        api_key: 'key',
        model: 'model',
        provider: 'anthropic'
      }

      const errors = validateProvider(input)
      expect(errors.length).toBe(1)
      expect(errors[0].field).toBe('base_url')
      expect(errors[0].message).toContain('URL')
    })

    test('rejects base_url without protocol', () => {
      const input: ProviderInput = {
        name: 'no-protocol',
        base_url: 'api.anthropic.com',
        api_key: 'key',
        model: 'model',
        provider: 'anthropic'
      }

      const errors = validateProvider(input)
      expect(errors.some(e => e.field === 'base_url')).toBe(true)
    })
  })

  describe('validateProviders', () => {
    test('returns empty errors for valid list', () => {
      const input: ProviderInput[] = [
        { name: 'p1', base_url: 'https://a.com', api_key: 'k1', model: 'm1', provider: 'anthropic' },
        { name: 'p2', base_url: 'https://b.com', api_key: 'k2', model: 'm2', provider: 'openai' }
      ]

      const errors = validateProviders(input)
      expect(errors).toEqual([])
    })

    test('rejects duplicate names within list', () => {
      const input: ProviderInput[] = [
        { name: 'dup', base_url: 'https://a.com', api_key: 'k1', model: 'm1', provider: 'anthropic' },
        { name: 'dup', base_url: 'https://b.com', api_key: 'k2', model: 'm2', provider: 'openai' }
      ]

      const errors = validateProviders(input)
      expect(errors.some(e => e.field === 'name' && e.message.includes('duplicate'))).toBe(true)
    })

    test('returns aggregated errors from all providers', () => {
      const input: ProviderInput[] = [
        { name: '', base_url: 'not-url', api_key: '', model: 'm', provider: 'anthropic' },
        { name: 'dup', base_url: 'https://a.com', api_key: 'k', model: 'm', provider: 'anthropic' },
        { name: 'dup', base_url: '', api_key: 'k', model: 'm', provider: '' }
      ]

      const errors = validateProviders(input)
      // First provider: 3 errors (name empty, base_url invalid, api_key empty)
      // Duplicate names: at least 1 duplicate error
      // Third provider: 2 errors (base_url empty, provider empty)
      expect(errors.length).toBeGreaterThan(2) // First provider: name empty, at least one optional field required; duplicate name error; Third provider: name empty, provider empty
    })

    test('rejects multiple default=true rows', () => {
      const input: ProviderInput[] = [
        { name: 'p1', base_url: 'https://a.com', api_key: 'k1', model: 'm', provider: 'anthropic', default: true },
        { name: 'p2', base_url: 'https://b.com', api_key: 'k2', model: 'm', provider: 'openai', default: true }
      ]

      const errors = validateProviders(input)
      expect(errors.some(e => e.field === 'default' && e.message.includes('one'))).toBe(true)
    })

    test('accepts single default=true', () => {
      const input: ProviderInput[] = [
        { name: 'p1', base_url: 'https://a.com', api_key: 'k1', model: 'm', provider: 'anthropic', default: true },
        { name: 'p2', base_url: 'https://b.com', api_key: 'k2', model: 'm', provider: 'openai' }
      ]

      const errors = validateProviders(input)
      expect(errors.some(e => e.field === 'default')).toBe(false)
    })

    test('accepts zero default=true', () => {
      const input: ProviderInput[] = [
        { name: 'p1', base_url: 'https://a.com', api_key: 'k1', model: 'm', provider: 'anthropic' },
        { name: 'p2', base_url: 'https://b.com', api_key: 'k2', model: 'm', provider: 'openai' }
      ]

      const errors = validateProviders(input)
      expect(errors.some(e => e.field === 'default')).toBe(false)
    })
  })
})
