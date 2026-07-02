import path from 'path'

/**
 * Mock for esm-dirname in CJS Jest test environment.
 *
 * The real module uses import.meta.url which is not available in CJS.
 * This mock uses __dirname (available in CJS) to derive caller directories.
 */

// This mock lives in src/utils/__mocks/, so __dirname points here.
// Use it as the base for resolving relative paths.
const utilsDirname = __dirname

export function getCallerDirname(relativePath: string): string {
  return path.resolve(utilsDirname, relativePath)
}

export function getCurrentModuleUrl(): string {
  // CJS test env has no import.meta; return a stable file URL for this mock.
  return `file://${__filename}`
}

export { utilsDirname }
