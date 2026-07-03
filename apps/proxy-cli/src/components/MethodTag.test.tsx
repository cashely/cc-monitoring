import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MethodTag } from './MethodTag'

describe('MethodTag', () => {
  it('未传状态码时按方法着色（POST 蓝色）', () => {
    render(<MethodTag method="POST" />)
    expect(screen.getByText('POST')).toHaveClass('bg-blue-500/20')
  })

  it('2xx 状态码着绿色系', () => {
    render(<MethodTag method="POST" statusCode={200} />)
    const tag = screen.getByText('POST')
    expect(tag).toHaveClass('bg-emerald-500/20')
    expect(tag).toHaveClass('text-emerald-600')
  })

  it('非 2xx 状态码着红色系', () => {
    render(<MethodTag method="POST" statusCode={500} />)
    const tag = screen.getByText('POST')
    expect(tag).toHaveClass('bg-red-500/20')
    expect(tag).toHaveClass('text-red-600')
  })

  it('4xx 状态码着红色系', () => {
    render(<MethodTag method="GET" statusCode={404} />)
    expect(screen.getByText('GET')).toHaveClass('bg-red-500/20')
  })
})
