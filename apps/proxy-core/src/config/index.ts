import fs from 'fs/promises'
import path from 'path'
import { AppConfig, validateConfig } from './schema.js'

const DEFAULT_CONFIG_PATH = process.env.CONFIG_PATH || path.join(process.cwd(), 'config.json')

export async function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): Promise<AppConfig> {
  const content = await fs.readFile(configPath, 'utf-8')
  const raw = JSON.parse(content)
  const result = validateConfig(raw)

  if (!result.valid) {
    throw new ConfigError(`Invalid config: ${result.errors?.map(e => e.message).join(', ')}`)
  }

  // Resolve relative log path to absolute path based on config file directory
  const configDir = path.dirname(configPath)
  const config = result.data!
  if (config.logging.file && !path.isAbsolute(config.logging.file)) {
    config.logging.file = path.resolve(configDir, config.logging.file)
  }

  return config
}

export async function saveConfig(config: AppConfig, configPath: string = DEFAULT_CONFIG_PATH): Promise<void> {
  const result = validateConfig(config)
  if (!result.valid) {
    throw new ConfigError('Invalid config')
  }
  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
}

export async function resetConfig(configPath: string = DEFAULT_CONFIG_PATH): Promise<void> {
  const defaultConfig: AppConfig = {
    server: { port: 3000, host: 'localhost' },
    proxy: {
      target: 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic',
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
