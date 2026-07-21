// apps/proxy-docs/src/.vitepress/theme/mermaid-client.js
// Client-side mermaid renderer — dynamic import avoids SSR CJS issues

async function init() {
  const mermaid = await import('mermaid')
  mermaid.default.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
  })
  await renderAll(mermaid.default)

  // Re-render on SPA navigation
  window.addEventListener('hashchange', () => setTimeout(() => renderAll(mermaid.default), 200))
}

async function renderAll(mermaid) {
  const blocks = document.querySelectorAll('.language-mermaid')
  if (!blocks.length) return

  let i = 0
  for (const block of blocks) {
    const code = block.textContent
    const id = `mermaid-svg-${i++}`
    const container = document.createElement('div')
    container.className = 'mermaid-wrapper'

    const pre = block.parentElement
    if (pre && pre.tagName === 'PRE') {
      pre.replaceWith(container)
    }

    try {
      const { svg } = await mermaid.render(id, code)
      container.innerHTML = svg
    } catch (err) {
      container.innerHTML = `<pre style="color:red">Mermaid error: ${err.message}</pre>`
    }
  }
}

init()
