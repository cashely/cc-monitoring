# proxy-cli / 通用组件

## 本文档覆盖的源文件

- `apps/proxy-cli/src/components/Tabs.tsx`
- `apps/proxy-cli/src/components/MethodTag.tsx`
- `apps/proxy-cli/src/components/ModelTag.tsx`
- `apps/proxy-cli/src/components/ShikiHighlighter.tsx`
- `apps/proxy-cli/src/components/LanguageSwitcher.tsx`
- `apps/proxy-cli/src/components/GlowCard.tsx`（已在 [components-stats.md](./components-stats.md#glowcard) 详述，本文只列引用点）

## Tabs

`apps/proxy-cli/src/components/Tabs.tsx`。轻量 tab 容器：

```tsx
interface Props {
  tabs: { id: string; label: string }[]
  defaultTab?: string
  children: Record<string, React.ReactNode>   // key = tab.id
}
```

- 内部 `activeTab` state
- tab 栏：横向 button 列，激活项底部 2px 边线 + 前景色变化
- 内容区：`children[activeTab]`

使用点：`RequestCard`（Headers/Body/reqHeaders/resBody 四 tab） + `RequestCompareModal`。

**约束**：`children` 是对象而非 React children，key 必须精确匹配 `tabs[].id`。

## MethodTag

`apps/proxy-cli/src/components/MethodTag.tsx`。HTTP method 徽章。

```tsx
interface Props { method: string; statusCode?: number }
```

- **无 statusCode**：按 method 上色 —— GET 绿、POST 蓝、PUT/PATCH 琥珀、DELETE 红、HEAD/OPTIONS 灰
- **有 statusCode**：**覆盖** method 色 —— 2xx 绿、非 2xx 红

设计意图：请求列表里 method 一眼分类；status 出错时更醒目（红色覆盖蓝色 POST）。

## ModelTag

`apps/proxy-cli/src/components/ModelTag.tsx`。极简：

```tsx
export function ModelTag({ model }): JSX.Element {
  return (
    <span className="px-2 py-0.5 text-xs font-semibold rounded border bg-purple-500/20 text-purple-600 border-purple-500/30">
      {model}
    </span>
  )
}
```

紫色徽章。用在 `RequestCard` 头部显示转发后的 model。

## ShikiHighlighter

`apps/proxy-cli/src/components/ShikiHighlighter.tsx`。JSON/Markdown 语法高亮。

```tsx
interface Props {
  code: string
  lang: 'json' | 'markdown'
  theme?: string   // 默认 'github-dark'
}

export function ShikiHighlighter({ code, lang, theme = 'github-dark' }: Props) {
  const [html, setHtml] = useState('')
  useEffect(() => { codeToHtml(code, { lang, theme }).then(setHtml) }, [code, lang, theme])
  return <div className="max-h-[400px] overflow-y-auto ..." dangerouslySetInnerHTML={{ __html: html }} />
}
```

- **异步渲染**：`codeToHtml` 是 async，首次 render 是空 div，第二次 render 有内容
- **容器最大高度 400px**：防止巨型 JSON 拉长页面，超出滚动
- **`dangerouslySetInnerHTML`**：Shiki 产出的 HTML 已经 escape，安全
- **样式复写**：`[&_pre]:m-0 [&_pre]:p-0 [&_pre]:bg-transparent` 移除 Shiki 自带样式

Shiki 4 采用 bundled themes/languages，`github-dark` 主题打包体积友好。

## LanguageSwitcher

`apps/proxy-cli/src/components/LanguageSwitcher.tsx`：

```tsx
const toggleLanguage = () => {
  i18n.changeLanguage(i18n.language === 'zh' ? 'en' : 'zh')
}
```

按钮显示**对面**语言（当前中文 → 显示 `EN`，反之显示 `中`）+ `Languages` 图标。title tooltip 是完整语言名。

## GlowCard

见 [components-stats.md](./components-stats.md#glowcard)。用在：

- `TodayStatsCards`（5 张彩色卡）
- `ConfigEditor`（Address 蓝 + ConfigPath 绿）

## 通用视觉规范

从多处组件汇总：

| 用途 | 颜色 | 语义 CSS 变量 |
|---|---|---|
| 主背景 | 深灰 | `bg-primary` |
| 次背景 | 更深灰 | `bg-secondary` |
| 卡片背景 | 中灰 | `bg-card` |
| hover | 浅灰 | `bg-hover` |
| 主文字 | 白色 | `text-primary` |
| 次文字 | 中灰 | `text-muted` |
| 三级文字 | 深灰 | `text-secondary` |
| 边框 | 深灰 | `border` |
| 主色/品牌 | 蓝 `#3B82F6` | `primary` |
| 成功 | 绿 | `success` |
| 警告 | 黄/橙 | `warning` |
| 错误 | 红 | `error` |
| 强调 | 青 | `accent` |

`TOKEN_COLORS` 中的四色专用于 Token 分类：

- Input = Primary 蓝
- Output = Success 绿
- Cache Read = Warning 橙
- Cache Create = Info 青蓝

## 相关

- 主 Layout → [app-shell.md](./app-shell.md)
- Chart 主题 → [components-status.md](./components-status.md#chart-theme)
