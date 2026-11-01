import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { translations } from '@/lib/i18n/translations'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => translations.en[key] ?? key }) }))
import { DeleteLeagueFromAfPanel } from '@/app/league/[leagueId]/components/DeleteLeagueFromAfPanel'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('requires the exact name before permanently deleting a native league', async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, deletedLeague: true }) }))
  vi.stubGlobal('fetch', fetcher)
  render(<DeleteLeagueFromAfPanel leagueId="l1" currentUserId="u1" leagueOwnerUserId="u1" platform="allfantasy" leagueName="Test League" />)
  fireEvent.click(screen.getByTestId('delete-league-af-open'))
  const confirm = screen.getByTestId('delete-league-af-confirm') as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  const input = screen.getByLabelText('Type Test League to confirm')
  fireEvent.change(input, { target: { value: 'Test league' } })
  expect(confirm.disabled).toBe(true)
  fireEvent.change(input, { target: { value: 'Test League' } })
  expect(confirm.disabled).toBe(false)
  fireEvent.click(confirm)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  expect(fetcher).toHaveBeenCalledWith('/api/league/l1?permanent=1', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ leagueName: 'Test League' }) }))
})
