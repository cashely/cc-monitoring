// apps/proxy-core/src/parsers/index.ts
import { ParserRegistry } from './registry.js'
import { MdLoader } from './md-loader.js'
import { DocxLoader } from './docx-loader.js'
import { XlsxLoader } from './xlsx-loader.js'

const registry = new ParserRegistry()
registry.register(new MdLoader())
registry.register(new DocxLoader())
registry.register(new XlsxLoader())

export { registry }
