import path from 'path'

/**
 * ESM-compatible __dirname for this module.
 *
 * In ESM runtime, __dirname is undefined. This module computes its own
 * directory path using import.meta.url, which can then be used to derive
 * other paths relative to known locations.
 *
 * In CJS test environments (Jest), import.meta is not available, so this
 * module should be mocked to return a suitable path.
 */
const thisDirname: string = (() => {
  try {
    // ESM context
    return path.dirname(new URL(import.meta.url).pathname)
  } catch {
    // CJS fallback (Jest/ts-jest compiles to CJS)
    return typeof __dirname !== 'undefined' ? __dirname : process.cwd()
  }
})()

/**
 * Get the directory of a source file relative to this utility's location.
 *
 * Since this file lives in `packages/core/src/utils/`, callers can derive
 * their own __dirname by combining thisDirname with a relative offset.
 *
 * @param relativePath - Path relative to this file's directory to reach
 *                       the caller's directory (e.g. '../server' from ui-route.ts)
 * @returns Absolute path of the caller's directory
 *
 * Example: getCallerDirname('../server') => packages/core/src/server
 */
export function getCallerDirname(relativePath: string): string {
  return path.resolve(thisDirname, relativePath)
}

/**
 * Direct export of this module's __dirname for simple relative path derivation.
 */
export { thisDirname as utilsDirname }
