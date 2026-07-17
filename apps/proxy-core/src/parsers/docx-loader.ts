// apps/proxy-core/src/parsers/docx-loader.ts
import mammoth from 'mammoth'
import type { ParserLoader } from './types.js'

export class DocxLoader implements ParserLoader {
  supportedExtensions = ['.docx']

  async parse(buffer: Buffer, _filename: string): Promise<string> {
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }
}
