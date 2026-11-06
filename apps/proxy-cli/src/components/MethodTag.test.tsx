import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MethodTag } from './MethodTag'

describe('MethodTag', () => {
  it('未传状态码时按方法着色（POST 蓝色）', () => {
    render(<MethodTag method="POST" />)
    expect(screen.getByText('POST')).toHaveStyle({
      backgroundColor: 'rgba(59, 130, 246, 0.2)',
      color: '#3B82F6'
    })
  })

  it('2xx 状态码着绿色系', () => {
    render(<MethodTag method="POST" statusCode={200} />)
    const tag = screen.getByText('POST')
    expect(tag).toHaveStyle({
      backgroundColor: 'rgba(16, 185, 129, 0.2)',
      color: '#10B981'
    })
  })

  it('非 2xx 状态码着红色系', () => {
    render(<MethodTag method="POST" statusCode={500} />)
    const tag = screen.getByText('POST')
    expect(tag).toHaveStyle({
      backgroundColor: 'rgba(239, 68, 68, 0.2)',
      color: '#EF4444'
    })
  })

  it('4xx 状态码着红色系', () => {
    render(<MethodTag method="GET" statusCode={404} />)
    expect(screen.getByText('GET')).toHaveStyle({
      backgroundColor: 'rgba(239, 68, 68, 0.2)',
      color: '#EF4444'
    })
  })
})
