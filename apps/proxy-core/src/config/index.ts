import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { AppConfig, validateConfig } from './schema.js'
import { getConfigPath, ensureDataDirs } from '../utils/paths.js'

export async function loadConfig(configPath: string = getConfigPath()): Promise<AppConfig> {
  // 首次运行：config 不存在则用默认值自动初始化（写入数据目录）
  if (!fsSync.existsSync(configPath)) {
    ensureDataDirs()
    await resetConfig(configPath)
  }

  const content = await fs.readFile(configPath, 'utf-8')
  const raw = JSON.parse(content)
  const result = validateConfig(raw)

  if (!result.valid) {
    throw new ConfigError(`Invalid config: ${result.errors?.map(e => e.message).join(', ')}`)
  }

  // Resolve relative log/db paths to absolute paths based on config file directory
  const configDir = path.dirname(configPath)
  const config = result.data!
  if (config.logging.file && !path.isAbsolute(config.logging.file)) {
    config.logging.file = path.resolve(configDir, config.logging.file)
  }
  if (config.storage?.path && !path.isAbsolute(config.storage.path)) {
    config.storage.path = path.resolve(configDir, config.storage.path)
  }

  return config
}

export async function saveConfig(config: AppConfig, configPath: string = getConfigPath()): Promise<void> {
  const result = validateConfig(config)
  if (!result.valid) {
    throw new ConfigError('Invalid config')
  }
  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
}

export async function resetConfig(configPath: string = getConfigPath()): Promise<void> {
  const defaultConfig: AppConfig = {
    server: { port: 3000, host: 'localhost' },
    proxy: {
      target: 'https://ark.cn-beijing.volces.com/api/coding',
      changeOrigin: true
    },
    logging: {
      level: 'info',
      file: 'logs/proxy.log',
      maxSize: '10m',
      interval: '1d',
      compress: true
    },
    storage: {
      type: 'sqlite',
      path: 'logs/proxy.db',
      maxDays: 7
    }
  }
  await saveConfig(defaultConfig, configPath)
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}
