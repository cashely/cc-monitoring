import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getCallerDirname } from './esm-dirname.js'
import { getMachineIdSync } from './machine-id.js'

/**
 * 获取项目版本（从 proxy-core 自身 package.json）
 *
 * 基于模块自身位置定位，而非 cwd：本文件位于 src/utils（编译后 dist/utils），
 * 向上两级即包根。全局安装 / PM2 守护进程下 cwd 不确定，故不能用 path.resolve('package.json')。
 */
export function getProjectVersion(): string {
  try {
    const pkgPath = path.join(getCallerDirname('../..'), 'package.json')
    const projectPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    return projectPkg.version || 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * 获取 Claude Code 版本
 * 策略：优先执行命令（最可靠），失败则尝试读取 package.json
 */
export function getClaudeVersion(): string {
  // 策略1：执行命令（最可靠，跨平台）
  try {
    const version = execSync('claude --version', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'] // 捕获输出，避免污染日志
    }).trim()
    return version || 'unknown'
  } catch {
    // 命令失败，继续 fallback
  }

  // 策略2：尝试从 npm 全局目录读取（fallback）
  try {
    // 获取 npm 全局根目录（跨版本管理器）
    const npmRoot = execSync('npm root -g', {
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()

    const pkgPath = path.join(npmRoot, '@anthropic-ai/claude-code/package.json')
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      return pkg.version || 'unknown'
    }
  } catch {
    // fallback 失败
  }

  // 策略3：尝试常见路径（最后的 fallback）
  const commonPaths = [
    // macOS/Linux npm 全局
    path.join(os.homedir(), '.npm-global/lib/node_modules/@anthropic-ai/claude-code/package.json'),
    // Windows npm 全局
    path.join(os.homedir(), 'AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/package.json'),
    // pnpm 全局
    path.join(os.homedir(), '.local/share/pnpm/global/*/node_modules/@anthropic-ai/claude-code/package.json')
  ]

  for (const p of commonPaths) {
    if (p.includes('*')) {
      // Glob 模式，简化处理：只检查 base 目录是否存在
      const base = path.dirname(p)
      if (fs.existsSync(base)) {
        try {
          const dirs = fs.readdirSync(base).filter(d => !d.startsWith('.'))
          for (const dir of dirs) {
            const resolvedPath = p.replace('*', dir)
            if (fs.existsSync(resolvedPath)) {
              const pkg = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'))
              return pkg.version || 'unknown'
            }
          }
        } catch {
          continue
        }
      }
    } else if (fs.existsSync(p)) {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'))
      return pkg.version || 'unknown'
    }
  }

  return 'not installed'
}

/**
 * 检测 Claude Code 是否已安装
 * 复用 getClaudeVersion()，返回 "not installed" 即未安装
 */
export function isClaudeInstalled(): boolean {
  return getClaudeVersion() !== 'not installed'
}

/**
 * 获取版本信息（合并返回）
 */
export function getVersionInfo(): { projectVersion: string; claudeVersion: string; machineId: string } {
  const machineId = getMachineIdSync() ?? 'unknown'
  return {
    projectVersion: getProjectVersion(),
    claudeVersion: getClaudeVersion(),
    machineId,
  }
}