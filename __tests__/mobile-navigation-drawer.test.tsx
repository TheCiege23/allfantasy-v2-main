import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}))

vi.mock('@/components/i18n/LanguageToggle', () => ({
  default: () => <button type="button">Language</button>,
}))

import { MobileNavigationDrawer } from '@/components/shell/MobileNavigationDrawer'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('mobile navigation drawer focus management', () => {
  it('focuses the close control, closes on Escape, and restores the opener', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'Open menu'
    document.body.appendChild(opener)
    opener.focus()

    const onClose = vi.fn()
    const { getByRole, rerender } = render(
      <MobileNavigationDrawer open onClose={onClose} />,
    )

    const closeButton = getByRole('button', { name: 'Close menu' })
    await waitFor(() => expect(closeButton).toHaveFocus())

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<MobileNavigationDrawer open={false} onClose={onClose} />)
    await waitFor(() => expect(opener).toHaveFocus())
  })
})
