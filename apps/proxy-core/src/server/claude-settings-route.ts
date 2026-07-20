import { FastifyInstance } from 'fastify'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { isClaudeInstalled } from '../utils/version.js'

interface SyncResult {
  success: boolean
  message: string
  alreadyMatched?: boolean
}

function getClaudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

function buildServerAddress(config: any): string {
  const host = config.server.host === '0.0.0.0' ? 'localhost' : config.server.host
  return `http://${host}:${config.server.port}`
}

export async function setupClaudeSettingsRoutes(fastify: FastifyInstance, config: any): Promise<void> {
  fastify.post('/ui/api/claude-settings/sync', async (request, reply) => {
    // 1. 检测 Claude Code 是否安装
    if (!isClaudeInstalled()) {
      return reply.send({
        success: false,
        message: '未检测到 Claude Code，请安装完以后重试'
      } satisfies SyncResult)
    }

    // 2. 检测 settings.json 是否存在
    const settingsPath = getClaudeSettingsPath()
    if (!fs.existsSync(settingsPath)) {
      return reply.send({
        success: false,
        message: '未检测到配置文件，请手动修改'
      } satisfies SyncResult)
    }

    // 3. 读取 settings.json
    let settings: any
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8')
      settings = JSON.parse(raw)
    } catch {
      return reply.code(500).send({
        success: false,
        message: '配置文件格式错误，请手动检查'
      } satisfies SyncResult)
    }

    // 4. 构建当前 ccm 服务地址
    const serverAddress = buildServerAddress(config)
    const currentBaseUrl = settings?.env?.ANTHROPIC_BASE_URL

    // 5. 比较
    if (currentBaseUrl === serverAddress) {
      return reply.send({
        success: true,
        message: '已使用 CCM 的配置，无需改动',
        alreadyMatched: true
      } satisfies SyncResult)
    }

    // 6. 备份旧值 + 设置新值
    if (!settings.env) {
      settings.env = {}
    }
    if (currentBaseUrl) {
      settings.env.ANTHROPIC_BASE_URL_CCM_BACKUP = currentBaseUrl
    }
    settings.env.ANTHROPIC_BASE_URL = serverAddress

    // 7. 写回 settings.json
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
    } catch (err: any) {
      return reply.code(500).send({
        success: false,
        message: `写入配置文件失败: ${err.message}`
      } satisfies SyncResult)
    }

    return reply.send({
      success: true,
      message: '修改成功，请重启 Claude 终端生效',
      alreadyMatched: false
    } satisfies SyncResult)
  })
}
