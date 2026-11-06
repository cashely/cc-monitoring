import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ModelTag } from './ModelTag'

describe('ModelTag', () => {
  it('renders model string', () => {
    render(<ModelTag model="claude-3-5-sonnet" />)
    expect(screen.getByText('claude-3-5-sonnet')).toBeInTheDocument()
  })

  it('has purple color styles', () => {
    const { container } = render(<ModelTag model="claude-3-opus" />)
    const tag = container.firstChild as HTMLElement
    expect(tag).toHaveStyle({
      backgroundColor: 'rgba(168, 85, 247, 0.2)',
      color: '#A855F7',
      borderColor: 'rgba(168, 85, 247, 0.3)'
    })
  })

  it('has tag styling classes', () => {
    const { container } = render(<ModelTag model="claude-3-haiku" />)
    const tag = container.firstChild as HTMLElement
    expect(tag).toHaveClass('px-2')
    expect(tag).toHaveClass('py-0.5')
    expect(tag).toHaveClass('text-xs')
    expect(tag).toHaveClass('font-semibold')
    expect(tag).toHaveClass('rounded')
    expect(tag).toHaveClass('border')
  })
})
