import os from 'os'
import path from 'path'
import fs from 'fs'

// 统一数据目录：三平台一致，锚定到用户主目录下的 .cc-monitoring
// 作为 npm 包全局安装后，config/logs/db 不再依赖 process.cwd()
export const dataDir = path.join(os.homedir(), '.cc-monitoring')
export const logsDir = path.join(dataDir, 'logs')

// CLI 全局 --config 选项写入的覆盖路径（运行时设置）
let configPathOverride: string | null = null

export function setConfigPathOverride(absPath: string): void {
  configPathOverride = absPath
}

// config 路径优先级：--config > CONFIG_PATH 环境变量 > 默认数据目录
export function getConfigPath(): string {
  return configPathOverride || process.env.CONFIG_PATH || path.join(dataDir, 'config.json')
}

// 将绝对路径转换为用户友好的显示路径（用 ~ 代替 home dir）
export function getDisplayPath(absPath: string): string {
  const home = os.homedir()
  if (absPath.startsWith(home)) {
    return absPath.replace(home, '~')
  }
  return absPath
}

// 确保数据目录与日志目录存在
export function ensureDataDirs(): void {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true })
  }
}
