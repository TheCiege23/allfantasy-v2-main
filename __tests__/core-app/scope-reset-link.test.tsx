// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, onClick, ...rest }: { href: string; children: ReactNode; onClick?: () => void }) => (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        event.preventDefault()
        onClick?.()
      }}
    >
      {children}
    </a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch() {}, push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/core',
}))

import { ScopeResetLink } from '@/components/core-app/ScopeSwitcher'
import { SCOPE_COOKIE } from '@/lib/core-app/homeScope'

afterEach(() => {
  cleanup()
  document.cookie = `${SCOPE_COOKIE}=; path=/; max-age=0`
})

describe('ScopeResetLink', () => {
  it('shows every league AND forgets the remembered filter, so the next Home tap stays unfiltered', () => {
    document.cookie = `${SCOPE_COOKIE}=${encodeURIComponent('sport:NBA')}; path=/`
    expect(document.cookie).toContain(`${SCOPE_COOKIE}=`)
    render(<ScopeResetLink>Show all leagues</ScopeResetLink>)
    const link = screen.getByRole('link', { name: 'Show all leagues' })
    expect(link.getAttribute('href')).toBe('/core?scope=all')
    fireEvent.click(link)
    expect(document.cookie).not.toContain(`${SCOPE_COOKIE}=sport`)
  })
})
