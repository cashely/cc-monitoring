import fs from 'fs/promises'
import path from 'path'
import { AppConfigSchema, validateConfig } from '../schema'
import { loadConfig, saveConfig, resetConfig, ConfigError } from '../index'

const VALID_CONFIG = {
  server: { port: 3000, host: 'localhost' },
  proxy: {
    target: 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic',
    changeOrigin: true
  },
  logging: { level: 'info', file: 'logs/proxy.log' }
}

describe('AppConfigSchema', () => {
  it('parses a valid config', () => {
    const result = AppConfigSchema.safeParse(VALID_CONFIG)
    expect(result.success).toBe(true)
  })

  it('rejects invalid port (out of range)', () => {
    const config = { ...VALID_CONFIG, server: { ...VALID_CONFIG.server, port: 0 } }
    const result = AppConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
  })

  it('rejects invalid port (> 65535)', () => {
    const config = { ...VALID_CONFIG, server: { ...VALID_CONFIG.server, port: 70000 } }
    const result = AppConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
  })

  it('rejects empty host', () => {
    const config = { ...VALID_CONFIG, server: { ...VALID_CONFIG.server, host: '' } }
    const result = AppConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
  })

  it('rejects invalid URL for proxy target', () => {
    const config = { ...VALID_CONFIG, proxy: { ...VALID_CONFIG.proxy, target: 'not-a-url' } }
    const result = AppConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
  })

  it('accepts optional rewritePrefix', () => {
    const config = { ...VALID_CONFIG, proxy: { ...VALID_CONFIG.proxy, rewritePrefix: '/api' } }
    const result = AppConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.proxy.rewritePrefix).toBe('/api')
    }
  })

  it('rejects invalid log level', () => {
    const config = { ...VALID_CONFIG, logging: { ...VALID_CONFIG.logging, level: 'verbose' } }
    const result = AppConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
  })

  it('rejects empty log file', () => {
    const config = { ...VALID_CONFIG, logging: { ...VALID_CONFIG.logging, file: '' } }
    const result = AppConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
  })
})

describe('validateConfig', () => {
  it('returns valid result for correct config', () => {
    const result = validateConfig(VALID_CONFIG)
    expect(result.valid).toBe(true)
    expect(result.data).toEqual(VALID_CONFIG)
  })

  it('returns invalid result with errors for bad config', () => {
    const result = validateConfig({ server: { port: 0, host: '' } })
    expect(result.valid).toBe(false)
    expect(result.errors).toBeDefined()
    expect(result.errors!.length).toBeGreaterThan(0)
  })

  it('errors have field and message', () => {
    const result = validateConfig({ server: { port: 0, host: '' } })
    expect(result.valid).toBe(false)
    const error = result.errors![0]
    expect(error).toHaveProperty('field')
    expect(error).toHaveProperty('message')
  })
})

describe('loadConfig', () => {
  const tmpDir = path.join(process.cwd(), '__test_config_tmp__')
  const configPath = path.join(tmpDir, 'config.json')

  beforeAll(async () => {
    await fs.mkdir(tmpDir, { recursive: true })
    await fs.writeFile(configPath, JSON.stringify(VALID_CONFIG, null, 2))
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('loads a valid config file', async () => {
    const config = await loadConfig(configPath)
    expect(config).toEqual(VALID_CONFIG)
  })

  it('throws ConfigError for invalid config file', async () => {
    await fs.writeFile(configPath, JSON.stringify({ bad: true }))
    await expect(loadConfig(configPath)).rejects.toThrow(ConfigError)
  })

  it('throws for non-existent file', async () => {
    await expect(loadConfig(path.join(tmpDir, 'nonexistent.json'))).rejects.toThrow()
  })
})

describe('saveConfig', () => {
  const tmpDir = path.join(process.cwd(), '__test_config_save_tmp__')
  const configPath = path.join(tmpDir, 'save-config.json')

  beforeAll(async () => {
    await fs.mkdir(tmpDir, { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('saves a valid config to file', async () => {
    await saveConfig(VALID_CONFIG as any, configPath)
    const content = await fs.readFile(configPath, 'utf-8')
    expect(JSON.parse(content)).toEqual(VALID_CONFIG)
  })

  it('throws ConfigError for invalid config', async () => {
    await expect(saveConfig({ bad: true } as any, configPath)).rejects.toThrow(ConfigError)
  })
})

describe('resetConfig', () => {
  const tmpDir = path.join(process.cwd(), '__test_config_reset_tmp__')
  const configPath = path.join(tmpDir, 'reset-config.json')

  beforeAll(async () => {
    await fs.mkdir(tmpDir, { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('writes default config to file', async () => {
    await resetConfig(configPath)
    const content = await fs.readFile(configPath, 'utf-8')
    const parsed = JSON.parse(content)
    expect(parsed.server.port).toBe(3000)
    expect(parsed.server.host).toBe('localhost')
    expect(parsed.proxy.target).toBe('https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic')
    expect(parsed.proxy.changeOrigin).toBe(true)
    expect(parsed.logging.level).toBe('info')
    expect(parsed.logging.file).toBe('logs/proxy.log')
  })
})

describe('ConfigError', () => {
  it('has correct name', () => {
    const err = new ConfigError('test')
    expect(err.name).toBe('ConfigError')
    expect(err.message).toBe('test')
  })

  it('is an Error instance', () => {
    const err = new ConfigError('test')
    expect(err).toBeInstanceOf(Error)
  })
})
