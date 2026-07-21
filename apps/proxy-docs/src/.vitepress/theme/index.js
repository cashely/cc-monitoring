// apps/proxy-docs/src/.vitepress/theme/index.js
import DefaultTheme from 'vitepress/theme'

export default DefaultTheme

export const enhanceApp = ({ app }) => {
  // Mermaid rendering happens client-only via onMounted in MermaidVue component
  // Registered globally so any page can use it, but we also auto-render
  // .language-mermaid blocks via the setup hook below
}

if (typeof window !== 'undefined') {
  // Client-side only: render mermaid blocks after each page load
  import('./mermaid-client.js')
}
