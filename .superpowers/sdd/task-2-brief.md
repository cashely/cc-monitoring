### Task 2: DocxLoader + XlsxLoader + 注册

**Files:**
- Create: `apps/proxy-core/src/parsers/docx-loader.ts`
- Create: `apps/proxy-core/src/parsers/xlsx-loader.ts`
- Modify: `apps/proxy-core/src/parsers/index.ts`

**Interfaces:**
- Consumes: `ParserLoader` interface from Task 1
- Produces: `DocxLoader`, `XlsxLoader` registered into `registry`

- [ ] **Step 1: 安装 mammoth + xlsx npm 依赖**

```bash
cd apps/proxy-core && pnpm add mammoth xlsx
```

- [ ] **Step 2: 创建 docx-loader.ts**

```typescript
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
```

- [ ] **Step 3: 创建 xlsx-loader.ts**

```typescript
// apps/proxy-core/src/parsers/xlsx-loader.ts
import XLSX from 'xlsx'
import type { ParserLoader } from './types.js'

export class XlsxLoader implements ParserLoader {
  supportedExtensions = ['.xlsx', '.xls']

  async parse(buffer: Buffer, _filename: string): Promise<string> {
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const parts: string[] = []

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      const csv = XLSX.utils.sheet_to_csv(sheet)
      // 转 CSV 为 markdown table
      const mdTable = csvToMarkdownTable(csv)
      parts.push(`## ${sheetName}\n\n${mdTable}`)
    }

    return parts.join('\n\n')
  }
}

function csvToMarkdownTable(csv: string): string {
  const lines = csv.split('\n').filter(line => line.length > 0)
  if (lines.length === 0) return ''

  const rows = lines.map(line => line.split(','))
  // Header row
  const header = `| ${rows[0].join(' | ')} |`
  const separator = `| ${rows[0].map(() => '---').join(' | ')} |`
  const body = rows.slice(1).map(row => `| ${row.join(' | ')} |`).join('\n')

  return [header, separator, body].join('\n')
}
```

- [ ] **Step 4: 更新 index.ts — 注册 DocxLoader + XlsxLoader**

```typescript
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
```

- [ ] **Step 5: Commit**

```bash
git add apps/proxy-core/src/parsers/ apps/proxy-core/package.json apps/proxy-core/pnpm-lock.yaml
git commit -m "feat: add DocxLoader and XlsxLoader parsers"
```

---

