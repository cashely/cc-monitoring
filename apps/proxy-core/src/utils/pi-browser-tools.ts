import { spawn } from 'node:child_process'
import { Type, type Static } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'

/**
 * 统一封装 ego-browser CLI：spawn 子进程 + 写入 Node 脚本 stdin，返回 cliLog 文本。
 * 每次调用独立进程，靠 useOrCreateTaskSpace 在同一 task space 复用 tab。
 */
export function runEgoBrowser(
  scriptBody: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  return new Promise((resolve, reject) => {
    // 头部自动注入 task space 复用调用
    const script = `const task = await useOrCreateTaskSpace('knowledge-learn')\n${scriptBody}`

    const child = spawn('ego-browser', ['nodejs'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (err: Error | null, out?: string) => {
      if (settled) return
      settled = true
      cleanup()
      if (err) {
        // 把 stderr 附加到错误里，帮助排查
        const detail = stderr.trim() ? `\n--- stderr ---\n${stderr.trim()}` : ''
        reject(new Error(`${err.message}${detail}`))
      } else {
        resolve(out ?? stdout)
      }
    }

    const timer = setTimeout(() => {
      finish(new Error(`ego-browser timed out after ${timeoutMs}ms`))
      child.kill('SIGKILL')
    }, timeoutMs)

    const onAbort = () => {
      finish(new Error('ego-browser aborted'))
      child.kill('SIGKILL')
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const cleanup = () => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        finish(new Error('ego-browser CLI not found. Please install ego-browser first.'))
      } else {
        finish(err instanceof Error ? err : new Error(String(err)))
      }
    })

    child.on('close', (code) => {
      if (settled) return
      if (code === 0) {
        // 新版 ego cliLog 走 stderr；stdout 非空用 stdout，否则回退 stderr（新旧兼容）
        const out = stdout.trim() ? stdout : stderr
        finish(null, out)
      } else {
        // 非 0 退出：stderr 可能含错误；stdout 仍作为错误消息的一部分返回
        const detail = stdout.trim() ? `\n--- stdout ---\n${stdout.trim()}` : ''
        finish(new Error(`ego-browser exited with code ${code}${detail}`))
      }
    })

    child.stdin.end(script, 'utf-8')
  })
}

// ---------- 工具实现辅助 ----------

/** 把字符串参数安全注入脚本：JSON.stringify 自动处理引号 / 反斜杠 / 换行 */
const jsLit = (v: unknown): string => JSON.stringify(v)

/** 构造 pi AgentToolResult（content + details 字段） */
const ok = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  details: undefined,
})

// ---------- 9 个 ToolDefinition ----------
// 用泛型 TParams 保证 execute 内 params 类型安全。

type NavigateParams = Static<typeof navigateSchema>
const navigateSchema = Type.Object({
  url: Type.String({ description: '目标 URL，必须是 http(s) 完整地址' }),
  wait: Type.Optional(Type.Boolean({ description: '是否等待页面加载完成，默认 true' })),
})

type SnapshotParams = Static<typeof snapshotSchema>
const snapshotSchema = Type.Object({
  scope: Type.Optional(
    Type.String({
      description: "snapshotText 的 scope：'full_page'（默认）或 'only_within_viewport'",
    }),
  ),
})

type ScreenshotParams = Static<typeof screenshotSchema>
const screenshotSchema = Type.Object({})

type ClickParams = Static<typeof clickSchema>
const clickSchema = Type.Object({
  target: Type.String({
    description: "点击目标：@N / CSS / 'xpath=...' / 'loc=...'，或 [x,y] 视口坐标数组",
  }),
  label: Type.Optional(Type.String({ description: '可选 3-6 字动作描述，用于高亮' })),
})

type TypeParams = Static<typeof typeSchema>
const typeSchema = Type.Object({
  target: Type.String({ description: '输入框定位：@N / CSS / xpath=... / loc=...' }),
  text: Type.String({ description: '要填入的文本内容' }),
  submit: Type.Optional(Type.Boolean({ description: 'true 则填完后按 Enter，默认 false' })),
})

type ScrollParams = Static<typeof scrollSchema>
const scrollSchema = Type.Object({
  direction: Type.String({
    enum: ['down', 'up', 'bottom'],
    description: "滚动方向：'down' / 'up' / 'bottom'（滚到底并触发懒加载）",
  }),
  amount: Type.Optional(Type.Number({ description: 'down/up 时的滚动像素量，默认 900' })),
})

type EvaluateParams = Static<typeof evaluateSchema>
const evaluateSchema = Type.Object({
  expression: Type.String({
    description: '页面内 JS 字符串。复杂逻辑用 IIFE：(() => { ... })()',
  }),
})

type FetchParams = Static<typeof fetchSchema>
const fetchSchema = Type.Object({
  url: Type.String({ description: '要抓取的 URL' }),
})

type PressKeyParams = Static<typeof pressKeySchema>
const pressKeySchema = Type.Object({
  key: Type.String({ description: "CDP 键名，如 'Enter' / 'Escape' / 'ArrowDown'" }),
})

export const browserTools: ToolDefinition[] = [
  {
    name: 'browser_navigate',
    label: 'browser_navigate',
    description:
      '在 ego-browser 的 knowledge-learn task space 中打开或复用 tab 到给定 URL。wait=true（默认）会等页面加载，timeout 20s。',
    parameters: navigateSchema,
    async execute(_id, params: NavigateParams, signal) {
      const url = jsLit(params.url)
      const wait = params.wait ?? true
      const body = `
await openOrReuseTab(${url}, { wait: ${wait}, timeout: 20 })
const info = await pageInfo()
cliLog(JSON.stringify(info))
`
      return ok(await runEgoBrowser(body, { signal }))
    },
  },

  {
    name: 'browser_snapshot',
    label: 'browser_snapshot',
    description:
      '获取当前页面的可访问性语义树（含 @N / loc= 引用），是后续 click/fillInput 定位元素的依据。默认 scope=full_page 覆盖整页。',
    parameters: snapshotSchema,
    async execute(_id, params: SnapshotParams, signal) {
      const scope = params.scope ?? 'full_page'
      const body = `cliLog(await snapshotText({ scope: ${jsLit(scope)} }))`
      return ok(await runEgoBrowser(body, { signal }))
    },
  },

  {
    name: 'browser_screenshot',
    label: 'browser_screenshot',
    description: '对当前页面视口截图。返回 ego 输出的图片说明 / 路径文本。',
    parameters: screenshotSchema,
    async execute(_id, _params: ScreenshotParams, signal) {
      return ok(await runEgoBrowser('cliLog(await captureScreenshot())', { signal }))
    },
  },

  {
    name: 'browser_click',
    label: 'browser_click',
    description:
      '点击元素。target 支持 @N（来自最近一次 snapshotText）、CSS 选择器、xpath=...、loc=...（推荐长期稳定引用）。label 是 3-6 字动作描述，会触发高亮动画。',
    parameters: clickSchema,
    async execute(_id, params: ClickParams, signal) {
      const target = jsLit(params.target)
      const label = params.label ? `, { label: ${jsLit(params.label)} }` : ''
      const body = `await click(${target}${label})\ncliLog('clicked: ${params.target}')`
      return ok(await runEgoBrowser(body, { signal }))
    },
  },

  {
    name: 'browser_type',
    label: 'browser_type',
    description:
      '向输入框填充文本。target 同 browser_click（@N / CSS / xpath / loc）。submit=true 时填完后按 Enter（常用于搜索框）。',
    parameters: typeSchema,
    async execute(_id, params: TypeParams, signal) {
      const target = jsLit(params.target)
      const text = jsLit(params.text)
      const submitBlock = params.submit ? `\nawait pressKey('Enter')` : ''
      const body = `
await fillInput(${target}, ${text})${submitBlock}
cliLog('filled: ${params.target}')
`
      return ok(await runEgoBrowser(body, { signal }))
    },
  },

  {
    name: 'browser_scroll',
    label: 'browser_scroll',
    description:
      '滚动页面。direction=down/up 按 amount 像素滚动；direction=bottom 自动滚到底并尝试触发懒加载（最多 20 步）。',
    parameters: scrollSchema,
    async execute(_id, params: ScrollParams, signal) {
      let body: string
      if (params.direction === 'bottom') {
        body = `
await scrollToBottomUntil(
  async () => false,
  { step: 900, wait: 1, maxSteps: 20 }
)
cliLog('scrolled to bottom')
`
      } else {
        const amount = params.amount ?? 900
        const signed = params.direction === 'down' ? amount : -amount
        body = `
await scrollBy(${signed})
cliLog('scrolled ${params.direction} ${amount}px')
`
      }
      return ok(await runEgoBrowser(body, { signal }))
    },
  },

  {
    name: 'browser_evaluate',
    label: 'browser_evaluate',
    description:
      '在页面上下文执行 JS 字符串（等价于 Runtime.evaluate），返回序列化结果。多步逻辑请包成 IIFE：(() => { ... })()。不要把它当 Puppeteer page.evaluate(fn, ...args) 用。',
    parameters: evaluateSchema,
    async execute(_id, params: EvaluateParams, signal) {
      const expr = jsLit(params.expression)
      const body = `cliLog(JSON.stringify(await js(${expr})))`
      return ok(await runEgoBrowser(body, { signal }))
    },
  },

  {
    name: 'browser_fetch',
    label: 'browser_fetch',
    description:
      '在当前浏览器页面上下文发起 fetch（复用登录态 / Cookie），返回响应正文文本。适合抓取需要鉴权的页面 JSON 或 HTML。',
    parameters: fetchSchema,
    async execute(_id, params: FetchParams, signal) {
      const url = jsLit(params.url)
      const body = `cliLog(await browserFetch(${url}))`
      return ok(await runEgoBrowser(body, { signal }))
    },
  },

  {
    name: 'browser_press_key',
    label: 'browser_press_key',
    description:
      '在当前焦点元素按下键盘按键。key 用 CDP 键名，如 "Enter" / "Escape" / "Tab" / "ArrowDown" / "Control+A"。',
    parameters: pressKeySchema,
    async execute(_id, params: PressKeyParams, signal) {
      const key = jsLit(params.key)
      const body = `await pressKey(${key})\ncliLog('pressed: ${params.key}')`
      return ok(await runEgoBrowser(body, { signal }))
    },
  },
]

