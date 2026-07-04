import { StatusApiResponse, StatusHistoryResponse, AppConfig, ValidationError, VersionInfo } from '../types'
import { RequestSummary } from '../types/request'
import { StatsData, TodayStats } from '../types/stats'

const API_BASE = '/ui/api'

export async function fetchStatus(): Promise<StatusApiResponse> {
  const res = await fetch(`${API_BASE}/status`)
  return res.json()
}

export async function fetchStatusHistory(durationMs: number = 3600000): Promise<StatusHistoryResponse> {
  const res = await fetch(`${API_BASE}/status/history?duration=${durationMs}`)
  return res.json()
}

export async function fetchConfig(): Promise<{ config: AppConfig; versions: VersionInfo; configPath?: string }> {
  const res = await fetch(`${API_BASE}/config`)
  return res.json()
}

export async function saveConfig(config: AppConfig, reload: boolean = false): Promise<{ success: boolean; errors?: ValidationError[]; reloaded?: boolean; reloadError?: string; restartingIn?: number }> {
  const res = await fetch(`${API_BASE}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...config, reload })
  })
  return res.json()
}

export async function fetchRequests(limit: number = 1000): Promise<{ requests: RequestSummary[] }> {
  const res = await fetch(`${API_BASE}/requests?limit=${limit}`)
  return res.json()
}

export async function controlProcess(action: 'start' | 'stop' | 'restart'): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action })
  })
  return res.json()
}

export async function fetchStats(): Promise<StatsData> {
  const res = await fetch(`${API_BASE}/stats`)
  return res.json()
}

export async function fetchTodayStats(): Promise<TodayStats> {
  // 以浏览器本地时区的今日 00:00 作为查询起点，保证「今日」边界随用户时区
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const res = await fetch(`${API_BASE}/stats/today?since=${encodeURIComponent(midnight.toISOString())}`)
  return res.json()
}

export { fetchProviders, saveProviders } from './providers'
