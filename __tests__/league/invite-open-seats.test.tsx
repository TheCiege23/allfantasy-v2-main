import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})

import { OpenSeatLinks } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'

const SEATS = [
  { rosterId: 'cm4seat0000000000003', teamName: 'Hammer Time', ownerName: 'joe_sleeper' },
  { rosterId: 'cm4seat0000000000007', teamName: 'Gridiron Gang', ownerName: null },
]

describe('OpenSeatLinks (invite panel, step 4b-3)', () => {
  it('lists each open team and copies a link that names it', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<OpenSeatLinks inviteUrl="https://allfantasy.ai/join?code=K7QX2M" seats={SEATS} />)
    expect(screen.getByText('Hammer Time')).toBeTruthy()
    expect(screen.getByText('joe_sleeper')).toBeTruthy()
    fireEvent.click(screen.getByTestId('settings-invite-seat-copy-cm4seat0000000000007'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://allfantasy.ai/join?code=K7QX2M&team=cm4seat0000000000007'))
    expect(screen.getByTestId('settings-invite-seat-copy-cm4seat0000000000007').textContent).toBe('Copied')
  })

  it('shows the link to copy by hand when the clipboard refuses', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    render(<OpenSeatLinks inviteUrl="https://allfantasy.ai/join?code=K7QX2M" seats={SEATS} />)
    fireEvent.click(screen.getByTestId('settings-invite-seat-copy-cm4seat0000000000003'))
    await waitFor(() => expect(screen.getByTestId('settings-invite-seat-copy-failed').textContent).toContain('team=cm4seat0000000000003'))
  })

  it('renders nothing when no team is open', () => {
    const { container } = render(<OpenSeatLinks inviteUrl="https://allfantasy.ai/join?code=K7QX2M" seats={[]} />)
    expect(container.innerHTML).toBe('')
  })
})
