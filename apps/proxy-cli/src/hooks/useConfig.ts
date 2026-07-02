import { useState, useEffect } from 'react'
import { fetchConfig } from '../api'
import type { AppConfig, VersionInfo } from '../types'

interface ConfigState {
  config: AppConfig | null
  versions: VersionInfo | null
  loading: boolean
  error: string | null
}

export function useConfig(): ConfigState {
  const [state, setState] = useState<ConfigState>({
    config: null,
    versions: null,
    loading: true,
    error: null
  })

  useEffect(() => {
    fetchConfig()
      .then((data) => {
        setState({
          config: data.config,
          versions: data.versions,
          loading: false,
          error: null
        })
      })
      .catch((err) => {
        setState({
          config: null,
          versions: null,
          loading: false,
          error: err.message
        })
      })
  }, [])

  return state
}