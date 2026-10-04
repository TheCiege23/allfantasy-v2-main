import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))
import { WeekHistoryNotice } from '@/components/core-app/WeekHistoryNotice'
describe('partial weekly history notice', () => {
  it('explains incomplete data and retries the same league and view', () => {
    const retryHref = '/core/week?league=my-league&view=rivalries'
    render(<WeekHistoryNotice retryHref={retryHref} />)
    expect(screen.getByRole('status').textContent).toContain('may be incomplete')
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe(retryHref)
  })
})
