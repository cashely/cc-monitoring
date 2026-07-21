// apps/proxy-core/src/parsers/xlsx-loader.ts
import type { ParserLoader } from './types.js'

export class XlsxLoader implements ParserLoader {
  supportedExtensions = ['.xlsx', '.xls']

  async parse(buffer: Buffer, _filename: string): Promise<string> {
    const XLSX = await import('xlsx')
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
