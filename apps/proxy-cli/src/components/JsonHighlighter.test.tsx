import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { JsonHighlighter } from './JsonHighlighter'

describe('JsonHighlighter', () => {
  it('should render highlighted JSON code', () => {
    render(<JsonHighlighter code='{"test": true}' lang="json" />)

    const codeEl = screen.getByText(/"test"/)
    expect(codeEl).toBeInTheDocument()
  })

  it('should render with hljs container class', () => {
    const { container } = render(<JsonHighlighter code='{"key": 1}' lang="json" />)

    const hljsDiv = container.querySelector('.hljs')
    expect(hljsDiv).not.toBeNull()
  })

  it('should render pre/code structure', () => {
    const { container } = render(<JsonHighlighter code='{}' lang="json" />)

    expect(container.querySelector('pre')).not.toBeNull()
    expect(container.querySelector('code.language-json')).not.toBeNull()
  })
})
