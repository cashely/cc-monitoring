// apps/proxy-core/src/parsers/md-loader.ts
import type { ParserLoader } from './types.js'

export class MdLoader implements ParserLoader {
  supportedExtensions = ['.md', '.markdown']

  async parse(buffer: Buffer, _filename: string): Promise<string> {
    return buffer.toString('utf-8')
  }
}
