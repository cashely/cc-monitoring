import { loadConfig, saveConfig, resetConfig } from '../../config/index.js'

export async function configCommand(action: string, key?: string, value?: string): Promise<void> {
  if (action === 'show') {
    const config = await loadConfig()
    console.log(JSON.stringify(config, null, 2))
    return
  }

  if (action === 'set' && key && value) {
    const config = await loadConfig()
    const keys = key.split('.')
    let current: any = config

    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]]
      if (!current) {
        console.error('Invalid config key')
        return
      }
    }

    const lastKey = keys[keys.length - 1]
    if (typeof current[lastKey] === 'number') {
      current[lastKey] = parseInt(value)
    } else if (typeof current[lastKey] === 'boolean') {
      current[lastKey] = value === 'true'
    } else {
      current[lastKey] = value
    }

    await saveConfig(config)
    console.log('Config updated')
    return
  }

  if (action === 'reset') {
    await resetConfig()
    console.log('Config reset to defaults')
    return
  }

  console.error('Invalid action. Use: show, set, reset')
}
