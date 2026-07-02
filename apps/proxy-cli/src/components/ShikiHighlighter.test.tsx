import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ShikiHighlighter } from './ShikiHighlighter'

// Mock shiki
vi.mock('shiki', () => ({
  codeToHtml: vi.fn().mockResolvedValue('<pre class="shiki">test</pre>')
}))

describe('ShikiHighlighter', () => {
  it('should render highlighted code', async () => {
    const { container } = render(<ShikiHighlighter code='{"test": true}' lang="json" />)

    await screen.findByText('test')

    const shikiDiv = container.querySelector('.shiki-container')
    expect(shikiDiv).not.toBeNull()
    expect(shikiDiv!.className).toContain('shiki-container')
  })

  it('should use default github-dark theme', async () => {
    render(<ShikiHighlighter code='test' lang="json" />)

    await screen.findByText('test')

    expect(vi.mocked(await import('shiki')).codeToHtml).toHaveBeenCalledWith(
      'test',
      { lang: 'json', theme: 'github-dark' }
    )
  })
})
