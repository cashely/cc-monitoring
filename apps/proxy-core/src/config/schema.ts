import { z } from 'zod'

export const AppConfigSchema = z.object({
  server: z.object({
    port: z.number().int().min(1).max(65535),
    host: z.string().min(1)
  }),
  proxy: z.object({
    target: z.string().url(),
    changeOrigin: z.boolean(),
    rewritePrefix: z.string().optional(),
    apiKey: z.string().min(1).optional() // Proxy API key (optional, replace client key if configured)
  }),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    file: z.string().min(1),
    maxSize: z.string().default('10m'),
    interval: z.string().default('1d'),
    compress: z.boolean().default(true)
  }),
  storage: z.object({
    type: z.enum(['sqlite']).default('sqlite'),
    path: z.string().min(1).default('logs/proxy.db'),
    maxDays: z.number().int().min(0).default(7) // 0 or negative = no cleanup (keep all)
  }).optional().default({ type: 'sqlite', path: 'logs/proxy.db', maxDays: 7 }),
  auth: z.object({
    token: z.string().min(1)
  }).optional()
})

export type AppConfig = z.infer<typeof AppConfigSchema>

export function validateConfig(config: unknown): ValidationResult {
  const result = AppConfigSchema.safeParse(config)
  if (result.success) {
    return { valid: true, data: result.data }
  }
  return {
    valid: false,
    errors: result.error.errors.map(e => ({
      field: e.path.join('.'),
      message: e.message
    }))
  }
}

interface ValidationResult {
  valid: boolean
  data?: AppConfig
  errors?: Array<{ field: string; message: string }>
}
