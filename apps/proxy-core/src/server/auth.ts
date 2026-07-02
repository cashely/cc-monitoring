export const AUTH_TOKEN_ENV = 'UI_AUTH_TOKEN'

export function checkAuth(request: any, config: any): boolean {
  // If no auth token configured, allow all (dev mode)
  const token = config?.auth?.token || process.env[AUTH_TOKEN_ENV]
  if (!token) return true

  const authHeader = request.headers?.authorization
  if (!authHeader) return false

  // Accept "Bearer <token>" or just "<token>"
  const provided = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader

  return provided === token
}
