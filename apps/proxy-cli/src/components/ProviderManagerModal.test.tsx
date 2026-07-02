import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ProviderManagerModal } from './ProviderManagerModal'
import type { Provider } from '../types/providers'

const mockProviders: Provider[] = [
  {
    id: 1,
    name: 'aliyun',
    base_url: 'https://example.com',
    api_key: 'sk-xxx',
    model: 'claude-3',
    haiku_model: 'claude-3-haiku',
    sonnet_model: 'claude-3-sonnet',
    opus_model: 'claude-3-opus',
    subagent_model: 'claude-3-haiku',
    provider: 'anthropic',
    default: true
  },
  {
    id: 2,
    name: 'openai',
    base_url: 'https://api.openai.com',
    api_key: 'sk-yyy',
    model: 'gpt-4',
    provider: 'openai',
    default: false
  }
]

const mockFetchProviders = vi.fn().mockResolvedValue({ providers: mockProviders })
const mockSaveProviders = vi.fn().mockResolvedValue({ success: true })

vi.mock('../api/providers', () => ({
  fetchProviders: (...args: any[]) => mockFetchProviders(...args),
  saveProviders: (...args: any[]) => mockSaveProviders(...args)
}))

describe('ProviderManagerModal', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchProviders.mockResolvedValue({ providers: mockProviders })
    mockSaveProviders.mockResolvedValue({ success: true })
  })

  test('renders nothing when isOpen=false', () => {
    render(<ProviderManagerModal isOpen={false} onClose={onClose} />)
    expect(screen.queryByText('供应商管理')).toBeNull()
  })

  test('renders provider table when isOpen=true', async () => {
    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('供应商管理')).toBeDefined())
    expect(screen.getByText('名称')).toBeDefined()
    expect(screen.getByText('操作')).toBeDefined()
    await waitFor(() => expect(screen.getByDisplayValue('aliyun')).toBeDefined())
  })

  test('loads providers on open', async () => {
    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(mockFetchProviders).toHaveBeenCalled())
  })

  test('adds new row with 9 empty fields on "添加" button click', async () => {
    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByDisplayValue('aliyun')).toBeDefined())

    const inputsBefore = screen.getAllByRole('textbox').length
    fireEvent.click(screen.getByText('添加'))

    const inputsAfter = screen.getAllByRole('textbox').length
    expect(inputsAfter).toBe(inputsBefore + 9)
  })

  test('removes row on delete with confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByDisplayValue('aliyun')).toBeDefined())

    const deleteButtons = screen.getAllByText('删除')
    fireEvent.click(deleteButtons[0])

    expect(confirmSpy).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByDisplayValue('aliyun')).toBeNull())

    confirmSpy.mockRestore()
  })

  test('keeps row when delete is cancelled (window.confirm returns false)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByDisplayValue('aliyun')).toBeDefined())

    const deleteButtons = screen.getAllByText('删除')
    fireEvent.click(deleteButtons[0])

    expect(confirmSpy).toHaveBeenCalledWith('确认删除此供应商？')
    expect(screen.getByDisplayValue('aliyun')).toBeDefined()

    confirmSpy.mockRestore()
  })

  test('updates field on input change', async () => {
    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByDisplayValue('aliyun')).toBeDefined())

    const nameInput = screen.getByDisplayValue('aliyun')
    fireEvent.change(nameInput, { target: { value: 'aliyun-updated' } })

    expect(screen.getByDisplayValue('aliyun-updated')).toBeDefined()
  })

  test('shows loading state during save', async () => {
    mockSaveProviders.mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve({ success: true }), 100)
    }))

    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByDisplayValue('aliyun')).toBeDefined())

    fireEvent.click(screen.getByText('保存'))

    expect(screen.getByText('保存中...')).toBeDefined()

    await waitFor(() => expect(screen.getByText('保存成功')).toBeDefined())
  })

  test('displays success message after save', async () => {
    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByDisplayValue('aliyun')).toBeDefined())

    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(screen.getByText('保存成功')).toBeDefined())
  })

  test('displays formatted validation errors', async () => {
    mockSaveProviders.mockResolvedValueOnce({
      success: false,
      errors: [
        { index: 0, field: 'name', message: '必填' },
        { index: 2, field: 'base_url', message: 'URL格式错误' }
      ]
    })

    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByDisplayValue('aliyun')).toBeDefined())

    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => {
      expect(screen.getByText('第1行: name 必填')).toBeDefined()
      expect(screen.getByText('第3行: base_url URL格式错误')).toBeDefined()
    })
  })

  test('shows error message when saveProviders throws network error', async () => {
    mockSaveProviders.mockRejectedValueOnce(new Error('网络错误'))

    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByDisplayValue('aliyun')).toBeDefined())

    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(screen.getByText('网络错误')).toBeDefined())
  })

  test('shows generic error message when saveProviders throws non-Error', async () => {
    mockSaveProviders.mockRejectedValueOnce('unknown failure')

    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByDisplayValue('aliyun')).toBeDefined())

    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(screen.getByText('网络错误')).toBeDefined())
  })

  test('shows server error message from result.error field', async () => {
    mockSaveProviders.mockResolvedValueOnce({
      success: false,
      error: '服务器内部错误'
    })

    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByDisplayValue('aliyun')).toBeDefined())

    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(screen.getByText('服务器内部错误')).toBeDefined())
  })

  test('keeps empty rows when fetchProviders throws error', async () => {
    mockFetchProviders.mockRejectedValueOnce(new Error('fetch failed'))

    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('供应商管理')).toBeDefined())
    expect(screen.queryByDisplayValue('aliyun')).toBeNull()
  })

  test('renders activated button as disabled for default provider', async () => {
    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByDisplayValue('aliyun')).toBeDefined())

    const activatedButtons = screen.getAllByText('已激活')
    expect(activatedButtons.length).toBe(1)
    expect((activatedButtons[0] as HTMLButtonElement).disabled).toBe(true)
  })

  test('renders activate button for non-default provider', async () => {
    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByDisplayValue('aliyun')).toBeDefined())

    const activateButtons = screen.getAllByText('激活')
    expect(activateButtons.length).toBe(1)
    expect((activateButtons[0] as HTMLButtonElement).disabled).toBe(false)
  })

  test('clicking activate sets only that row as default', async () => {
    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByDisplayValue('aliyun')).toBeDefined())

    // Initially aliyun is active (disabled), openai is not
    expect(screen.getAllByText('已激活').length).toBe(1)
    expect(screen.getAllByText('激活').length).toBe(1)

    // Click activate on openai row
    fireEvent.click(screen.getByText('激活'))

    // Now openai should be activated, aliyun should show activate button
    await waitFor(() => {
      expect(screen.getAllByText('已激活').length).toBe(1)
      expect(screen.getAllByText('激活').length).toBe(1)
    })

    // The activated button should now be in the openai row (second row)
    // Verify by checking the activated button's row contains 'openai' value
    const activatedButton = screen.getAllByText('已激活')[0] as HTMLButtonElement
    const row = activatedButton.closest('tr')
    // row has inputs; check any input in that row matches openai-related value
    const inputs = row?.querySelectorAll('input')
    const values = Array.from(inputs || []).map(i => i.value)
    expect(values.some(v => v === 'openai')).toBe(true)
  })

  test('includes default flag in save payload', async () => {
    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByDisplayValue('aliyun')).toBeDefined())

    // Click save with default state (aliyun active)
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(mockSaveProviders).toHaveBeenCalled())
    const payload = mockSaveProviders.mock.calls[0][0] as any[]
    const aliyun = payload.find(p => p.name === 'aliyun')
    const openai = payload.find(p => p.name === 'openai')
    expect(aliyun.default).toBe(true)
    expect(openai.default).toBe(false)
  })

  test('calls onClose when backdrop is clicked', async () => {
    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('供应商管理')).toBeDefined())

    const backdrop = document.querySelector('.fixed.inset-0')
    fireEvent.click(backdrop!)

    expect(onClose).toHaveBeenCalled()
  })

  test('closes on "关闭" button click', async () => {
    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('供应商管理')).toBeDefined())

    fireEvent.click(screen.getAllByText('关闭')[0])

    expect(onClose).toHaveBeenCalled()
  })
})

// Separate suite for timer-based tests that need fake timers
describe('ProviderManagerModal timer cleanup', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockFetchProviders.mockResolvedValue({ providers: mockProviders })
    mockSaveProviders.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('clears success message after 3 seconds', async () => {
    render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    // Flush the initial loadProviders effect
    await act(async () => {
      // Let the fetch resolve under fake timers
    })
    // Wait for data to appear
    await act(async () => {
      vi.advanceTimersByTime(0)
    })

    expect(screen.getByDisplayValue('aliyun')).toBeDefined()

    // Trigger save
    fireEvent.click(screen.getByText('保存'))

    // Let the save resolve
    await act(async () => {
      vi.advanceTimersByTime(0)
    })

    expect(screen.getByText('保存成功')).toBeDefined()

    // Advance 3 seconds
    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(screen.queryByText('保存成功')).toBeNull()
  })

  test('timer is cleaned up on unmount (no setState after unmount)', async () => {
    const { unmount } = render(<ProviderManagerModal isOpen={true} onClose={onClose} />)
    await act(async () => {
      vi.advanceTimersByTime(0)
    })

    expect(screen.getByDisplayValue('aliyun')).toBeDefined()

    fireEvent.click(screen.getByText('保存'))

    await act(async () => {
      vi.advanceTimersByTime(0)
    })

    expect(screen.getByText('保存成功')).toBeDefined()

    // Unmount before 3 seconds pass
    unmount()

    // Advance timers -- the cleanup useEffect should have cleared the timer
    // so no setState on unmounted component
    act(() => {
      vi.advanceTimersByTime(3000)
    })

    // No error thrown (React would warn about setState on unmounted)
    // Test passes by not throwing
  })
})
