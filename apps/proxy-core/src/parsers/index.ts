// apps/proxy-core/src/parsers/index.ts
import { ParserRegistry } from './registry.js'
import { MdLoader } from './md-loader.js'

const registry = new ParserRegistry()
registry.register(new MdLoader())

export { registry }
