import { render as rtlRender } from '@testing-library/react'
import type { RenderOptions, RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { ThemeProvider } from '../hooks/useTheme'

// RTL render + ThemeProvider，签名与 RTL render 兼容
export function render(
  ui: ReactElement,
  options: RenderOptions = {}
): RenderResult {
  const Wrapper = ({ children }: { children: ReactNode }) => {
    const UserWrapper = options.wrapper
    return (
      <ThemeProvider>
        {UserWrapper ? <UserWrapper>{children}</UserWrapper> : children}
      </ThemeProvider>
    )
  }
  return rtlRender(ui, { ...options, wrapper: Wrapper })
}

export { screen, fireEvent, act, waitFor } from '@testing-library/react'
