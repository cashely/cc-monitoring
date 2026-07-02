import { loadConfig } from '../../config/index.js'

export async function testCommand(): Promise<void> {
  const config = await loadConfig()

  console.log('Testing connection to target...')
  try {
    const res = await fetch(config.proxy.target, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000)
    })
    console.log(`Success! Target reachable. Status: ${res.status}`)
  } catch (err) {
    console.error('Connection failed:', (err as Error).message)
  }
}
