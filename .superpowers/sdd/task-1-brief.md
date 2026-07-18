### Task 1: Parser 接口 + Registry + MdLoader

**Files:**
- Create: `apps/proxy-core/src/parsers/types.ts`
- Create: `apps/proxy-core/src/parsers/registry.ts`
- Create: `apps/proxy-core/src/parsers/md-loader.ts`
- Create: `apps/proxy-core/src/parsers/index.ts`

**Interfaces:**
- Produces: `ParserLoader` interface, `ParserRegistry` class with `register(loader)`, `parse(buffer, filename)`, `getSupportedExtensions()`, `registry` singleton export

- [ ] **Step 1: 创建 types.ts — ParserLoader 接口**

```typescript
// apps/proxy-core/src/parsers/types.ts
export interface ParserLoader {
  supportedExtensions: string[]
  parse(buffer: Buffer, filename: string): Promise<string>
}
```

- [ ] **Step 2: 创建 registry.ts — ParserRegistry 类**

```typescript
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
```

- [ ] **Step 3: 创建 md-loader.ts — MdLoader**

```typescript
// apps/proxy-core/src/parsers/md-loader.ts
import type { ParserLoader } from './types.js'

export class MdLoader implements ParserLoader {
  supportedExtensions = ['.md', '.markdown']

  async parse(buffer: Buffer, _filename: string): Promise<string> {
    return buffer.toString('utf-8')
  }
}
```

- [ ] **Step 4: 创建 index.ts — registry 实例 + 注册 MdLoader**

```typescript
// apps/proxy-core/src/parsers/index.ts
import { ParserRegistry } from './registry.js'
import { MdLoader } from './md-loader.js'

const registry = new ParserRegistry()
registry.register(new MdLoader())

export { registry }
```

- [ ] **Step 5: Commit**

```bash
git add apps/proxy-core/src/parsers/
git commit -m "feat: add pluggable ParserRegistry with MdLoader"
```

---

