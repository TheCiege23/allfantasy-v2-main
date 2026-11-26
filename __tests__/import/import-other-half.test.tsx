// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImportOtherHalfPicker } from '@/components/import/ImportOtherHalfPicker'
import {
  asksForOtherHalf,
  importOtherHalfHref,
  NO_OTHER_HALF,
  pairWithLeagueIdFor,
  platformLabel,
  type OtherHalfChoice,
} from '@/lib/league-import/otherHalf'

afterEach(cleanup)

describe('when the confirm screen asks for the other half', () => {
  it('asks for a C2C or devy league in a sport a college + pro franchise is built from', () => {
    expect(asksForOtherHalf({ leagueType: 'c2c', sport: 'NFL' })).toBe(true)
    expect(asksForOtherHalf({ leagueType: 'devy', sport: 'nba' })).toBe(true)
    expect(asksForOtherHalf({ leagueType: 'dynasty', sport: 'NFL' })).toBe(false)
    expect(asksForOtherHalf({ leagueType: 'c2c', sport: 'MLB' })).toBe(false)
  })
  it('always asks when this import was opened to be the other half', () => {
    expect(asksForOtherHalf({ leagueType: 'dynasty', sport: 'NCAAF', pairWith: 'peach' })).toBe(true)
  })
  it('sends a league id only for a picked league', () => {
    expect(pairWithLeagueIdFor({ kind: 'link', leagueId: 'lg-1', name: 'Cream Bowl' })).toBe('lg-1')
    expect(pairWithLeagueIdFor({ kind: 'later' })).toBeNull()
    expect(pairWithLeagueIdFor(NO_OTHER_HALF)).toBeNull()
    expect(importOtherHalfHref('a b')).toBe('/import?pairWith=a%20b')
    expect(platformLabel('fantrax')).toBe('Fantrax')
    expect(platformLabel('espn')).toBe('ESPN')
  })
})

const CREAM = { leagueId: 'cream', name: 'Cream Bowl', platform: 'fantrax', sport: 'NCAAF', season: 2026 }
const OTHER = { leagueId: 'ncaa2', name: 'Saturday Club', platform: 'sleeper', sport: 'NCAAF', season: 2025 }

function Harness(props: { load: (s: string) => Promise<unknown>; preferLeagueId?: string; onPick?: (c: OtherHalfChoice) => void }) {
  const [value, setValue] = useState<OtherHalfChoice>(NO_OTHER_HALF)
  return (
    <ImportOtherHalfPicker
      sport="NFL"
      preferLeagueId={props.preferLeagueId}
      value={value}
      onChange={(c) => {
        setValue(c)
        props.onPick?.(c)
      }}
      load={props.load as never}
    />
  )
}

describe('ImportOtherHalfPicker', () => {
  it('lists the leagues that could be the college half, and starts on "no other half"', async () => {
    const load = vi.fn(async () => ({ needRole: 'college', candidates: [CREAM, OTHER] }))
    render(<Harness load={load} />)
    expect(screen.getByText('Where’s the college half?')).toBeTruthy()
    expect(await screen.findByText('Cream Bowl')).toBeTruthy()
    expect(screen.getByText('Fantrax · NCAAF · 2026')).toBeTruthy()
    expect(load).toHaveBeenCalledWith('NFL')
    expect((screen.getByDisplayValue('none') as HTMLInputElement).checked).toBe(true)
  })

  it('picks a league, or "import it next"', async () => {
    const onPick = vi.fn()
    render(<Harness load={async () => ({ needRole: 'college', candidates: [CREAM] })} onPick={onPick} />)
    fireEvent.click(await screen.findByText('Cream Bowl'))
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'link', leagueId: 'cream', name: 'Cream Bowl' })
    fireEvent.click(screen.getByText('It’s not on AllFantasy yet'))
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'later' })
  })

  it('preselects the league this import was opened for, and only a real candidate', async () => {
    const onPick = vi.fn()
    render(<Harness load={async () => ({ needRole: 'college', candidates: [CREAM, OTHER] })} preferLeagueId="ncaa2" onPick={onPick} />)
    await waitFor(() => expect(onPick).toHaveBeenCalledWith({ kind: 'link', leagueId: 'ncaa2', name: 'Saturday Club' }))
    cleanup()
    const none = vi.fn()
    render(<Harness load={async () => ({ needRole: 'college', candidates: [CREAM] })} preferLeagueId="not-mine" onPick={none} />)
    await screen.findByText('Cream Bowl')
    expect(none).not.toHaveBeenCalled()
  })

  it('says so when no league is free to link, and still offers "import it next"', async () => {
    render(<Harness load={async () => ({ needRole: 'pro', candidates: [] })} />)
    expect(await screen.findByTestId('import-other-half-empty')).toBeTruthy()
    expect(screen.getByText('Where’s the pro half?')).toBeTruthy()
    expect(screen.getByText('It’s not on AllFantasy yet')).toBeTruthy()
  })

  it('a failed lookup does not block the import', async () => {
    render(<Harness load={async () => null} />)
    expect(await screen.findByTestId('import-other-half-failed')).toBeTruthy()
    expect(screen.getByText('There’s no other half')).toBeTruthy()
  })
})
