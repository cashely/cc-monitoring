import nodeMachineId from 'node-machine-id'

// 缓存机器ID，启动时获取一次
let cachedMachineId: string = ''

/**
 * 获取机器唯一ID（原始ID，非哈希版本）
 * 结果会被缓存，后续调用直接返回缓存值
 */
export async function getMachineId(): Promise<string> {
  if (cachedMachineId) {
    return cachedMachineId
  }
  // original = true: 获取原始机器ID
  const id = await (nodeMachineId as any).machineId(true)
  cachedMachineId = id || 'unknown'
  return cachedMachineId
}

/**
 * 同步获取已缓存的机器ID
 * 如果尚未缓存，返回 null
 */
export function getMachineIdSync(): string | null {
  return cachedMachineId || null
}

/**
 * 预加载机器ID（在启动时调用）
 */
export async function preloadMachineId(): Promise<void> {
  await getMachineId()
}
