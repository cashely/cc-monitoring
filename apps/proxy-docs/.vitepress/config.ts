// apps/proxy-docs/.vitepress/config.ts
import { defineConfig } from 'vitepress'
import { MermaidMarkdown, MermaidPlugin } from 'vitepress-plugin-mermaid'

export default defineConfig({
  title: 'CC Monitoring',
  description: 'Claude Code 代理 + 监控系统文档',
  lang: 'zh-CN',

  srcDir: 'src',
  outDir: 'src/.vitepress/dist',

  markdown: {
    preConfig(md) {
      md.use(MermaidMarkdown)
    }
  },

  vite: {
    plugins: [MermaidPlugin()],
    ssr: {
      noExternal: ['mermaid'],
    },
  },

  themeConfig: {
    nav: [
      { text: '概览', link: '/overview' },
      { text: '快速开始', link: '/quickstart' },
      { text: 'Proxy Core', link: '/proxy-core/' },
      { text: 'Proxy CLI', link: '/proxy-cli/' },
      { text: 'Proxy Admin', link: '/proxy-admin/' },
    ],

    sidebar: {
      '/proxy-core/': [
        {
          text: 'Proxy Core',
          items: [
            { text: '模块概览', link: '/proxy-core/' },
            { text: '入口与启动', link: '/proxy-core/entry' },
            { text: 'CLI 命令', link: '/proxy-core/cli' },
            { text: '代理转发', link: '/proxy-core/proxy' },
            { text: 'UI 路由', link: '/proxy-core/ui-routes' },
            { text: '供应商管理', link: '/proxy-core/providers' },
            { text: '配置与日志', link: '/proxy-core/config' },
            { text: '数据层', link: '/proxy-core/data-layer' },
            { text: '统计与历史', link: '/proxy-core/stats' },
            { text: '工具注入', link: '/proxy-core/tool' },
            { text: 'PM2 集成', link: '/proxy-core/pm2' },
            { text: '工具函数', link: '/proxy-core/utilities' },
            { text: 'Chat API', link: '/proxy-core/chat-api' },
          ]
        }
      ],
      '/proxy-cli/': [
        {
          text: 'Proxy CLI',
          items: [
            { text: '模块概览', link: '/proxy-cli/' },
            { text: '应用外壳', link: '/proxy-cli/app-shell' },
            { text: '数据 Hooks', link: '/proxy-cli/data-hooks' },
            { text: 'API 层', link: '/proxy-cli/api-layer' },
            { text: '状态组件', link: '/proxy-cli/components-status' },
            { text: '统计组件', link: '/proxy-cli/components-stats' },
            { text: '请求组件', link: '/proxy-cli/components-requests' },
            { text: '配置组件', link: '/proxy-cli/components-config' },
            { text: '通用组件', link: '/proxy-cli/components-common' },
            { text: '工具与国际化', link: '/proxy-cli/utils-and-i18n' },
          ]
        }
      ],
      '/proxy-admin/': [
        {
          text: 'Proxy Admin',
          items: [
            { text: '模块概览', link: '/proxy-admin/' },
            { text: '路由与认证', link: '/proxy-admin/routing-and-auth' },
            { text: '布局与菜单', link: '/proxy-admin/layout-and-menu' },
            { text: '页面', link: '/proxy-admin/pages' },
            { text: '服务与 Mock', link: '/proxy-admin/services-and-mock' },
            { text: '环境与构建', link: '/proxy-admin/env-and-build' },
          ]
        }
      ],
    },

    siteTitle: 'CC Monitoring',
    search: { provider: 'local' },
  }
})
