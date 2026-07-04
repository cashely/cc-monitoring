export interface Provider {
  id: number
  name: string
  base_url: string | null
  api_key: string | null
  model: string | null
  haiku_model?: string | null
  sonnet_model?: string | null
  opus_model?: string | null
  subagent_model?: string | null
  provider: string
  default: boolean
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
}

export interface ProviderValidationError {
  index: number
  field: string
  message: string
}

export interface ProviderSaveResult {
  success: boolean
  errors?: ProviderValidationError[]
  error?: string
}
