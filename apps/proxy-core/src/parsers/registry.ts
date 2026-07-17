// apps/proxy-core/src/parsers/registry.ts
import type { ParserLoader } from './types.js'

export class ParserRegistry {
  private loaders: Map<string, ParserLoader> = new Map()

  register(loader: ParserLoader): void {
    for (const ext of loader.supportedExtensions) {
      this.loaders.set(ext.toLowerCase(), loader)
    }
  }

  getSupportedExtensions(): string[] {
    return Array.from(this.loaders.keys())
  }

  async parse(buffer: Buffer, filename: string): Promise<string> {
    const ext = this.getExtension(filename)
    const loader = this.loaders.get(ext)
    if (!loader) {
      throw new Error(
        `Unsupported file type: "${ext}". Supported types: ${this.getSupportedExtensions().join(', ')}`
      )
    }
    return loader.parse(buffer, filename)
  }

  private getExtension(filename: string): string {
    const dotIndex = filename.lastIndexOf('.')
    if (dotIndex === -1) throw new Error(`File has no extension: "${filename}"`)
    return filename.slice(dotIndex).toLowerCase()
  }
}
