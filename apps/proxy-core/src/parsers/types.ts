// apps/proxy-core/src/parsers/types.ts
export interface ParserLoader {
  supportedExtensions: string[]
  parse(buffer: Buffer, filename: string): Promise<string>
}
