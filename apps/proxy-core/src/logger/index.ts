import pino from 'pino'
import fs from 'fs'
import path from 'path'
import * as rotator from 'file-stream-rotator'
import type { LogConfig } from '../types/config.js'

const LEVEL_MAP: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60
}

const NUM_TO_LEVEL: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal'
}

export function createLogger(config: LogConfig): pino.Logger {
  // Ensure log directory exists
  const logDir = path.dirname(config.file)
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }

  // Rotating file stream
  // Insert %DATE% into filename for rotation pattern
  const logFile = config.file
  const basename = path.basename(logFile, '.log')
  const dirname = path.dirname(logFile)
  const patternFilename = path.join(dirname, `${basename}-%DATE%.log`)

  const rotatingStream = rotator.getStream({
    filename: patternFilename,
    frequency: 'daily',
    date_format: 'YYYY-MM-DD',
    size: config.maxSize || '10m',
    verbose: false
  })

  // Dual-output: file (rotating) + console (pretty)
  const dualStream = {
    write: (data: string) => {
      rotatingStream.write(data)
      try {
        const log = JSON.parse(data)
        const time = log.time || new Date().toISOString()
        const level = NUM_TO_LEVEL[log.level] || 'info'
        const msg = log.msg || ''
        const coloredLevel = levelColor(level)
        console.log(`[${time}] ${coloredLevel} (${process.pid}): ${cyan(msg)}${formatBindings(log)}`)
      } catch {
        console.log(data)
      }
    }
  }

  return pino({
    level: config.level,
    timestamp: pino.stdTimeFunctions.isoTime
  }, dualStream)
}

function levelColor(level: string): string {
  const colors: Record<string, string> = {
    trace: '\x1b[35mTRACE\x1b[0m',
    debug: '\x1b[36mDEBUG\x1b[0m',
    info: '\x1b[32mINFO\x1b[0m',
    warn: '\x1b[33mWARN\x1b[0m',
    error: '\x1b[31mERROR\x1b[0m',
    fatal: '\x1b[41mFATAL\x1b[0m'
  }
  return colors[level] || level
}

function cyan(text: string): string {
  return `\x1b[36m${text}\x1b[0m`
}

function formatBindings(log: any): string {
  const extras = []
  if (log.reqId) extras.push(`reqId: "${log.reqId}"`)
  if (log.req) extras.push(`req: ${JSON.stringify(log.req)}`)
  if (log.res) extras.push(`res: ${JSON.stringify(log.res)}`)
  if (log.responseTime) extras.push(`responseTime: ${log.responseTime}`)
  if (extras.length === 0) return ''
  return '\n    ' + extras.join('\n    ')
}

export async function readLogs(
  filePath: string,
  options: { limit?: number; level?: string; grep?: string }
): Promise<string[]> {
  const fs = await import('fs/promises')
  const content = await fs.readFile(filePath, 'utf-8')
  const lines = content.trim().split('\n')

  let filtered = lines

  if (options.level) {
    const numericLevel = LEVEL_MAP[options.level]
    filtered = filtered.filter(line => {
      try {
        const log = JSON.parse(line)
        if (numericLevel !== undefined) {
          return log.level === numericLevel
        }
        // fallback: match string level if present
        return log.level === options.level
      } catch {
        return false
      }
    })
  }

  if (options.grep) {
    filtered = filtered.filter(line =>
      line.toLowerCase().includes(options.grep!.toLowerCase())
    )
  }

  if (options.limit) {
    filtered = filtered.slice(-options.limit)
  }

  return filtered
}

export { LEVEL_MAP, NUM_TO_LEVEL }
