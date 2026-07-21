// apps/proxy-core/src/parsers/docx-loader.ts
import type { ParserLoader } from './types.js'

export class DocxLoader implements ParserLoader {
  supportedExtensions = ['.docx']

  async parse(buffer: Buffer, _filename: string): Promise<string> {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }
}
