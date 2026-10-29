import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { defaultSeasonBlueprint, seasonBlueprintSchema } from '@/lib/tournament/seasonBlueprint'
import { seasonArtCatalog, seasonArtPath, seasonLeaguePresentation } from '@/lib/tournament/seasonArtwork'
import { seasonContractHash } from '@/lib/tournament/seasonCalendarVerification'
import { SeasonIdentityEditor } from '@/components/tournament/SeasonIdentityEditor'
import { SeasonLeagueReveal } from '@/components/tournament/SeasonLeagueReveal'
import { nextSeasonNominator } from '@/lib/tournament/seasonAuctionPolicy'

describe('supplied tournament identity', () => {
  it('keeps old contracts unchanged and validates every supplied preset', () => {
    const config = { ...defaultSeasonBlueprint(), name: 'Art pilot' }
    expect(seasonBlueprintSchema.parse(config)).not.toHaveProperty('artwork')
    expect(seasonContractHash(seasonBlueprintSchema.parse(config))).toBe(seasonContractHash(config))
    expect(seasonArtCatalog.pairs).toHaveLength(20)
    expect(seasonArtCatalog.library).toHaveLength(50)
    expect(seasonArtPath('library', '../../private')).toBe('/artwork/tournaments/identity/library/basketball.svg')
    expect(seasonLeaguePresentation({ seasonTournament: { contract: config, key: 'stage-1-league-1' } })).toBeUndefined()
  })
  it('creates a capacity-matched preset with editable text and allowed local assets', () => {
    const change = vi.fn(), config = { ...defaultSeasonBlueprint(), name: 'Art pilot' }
    render(<SeasonIdentityEditor config={config} onChange={change} />)
    fireEvent.click(screen.getByRole('button', { name: 'Angelic / Demonic' }))
    const next = change.mock.calls[0]![0]
    expect(next.divisions).toEqual(['Angelic', 'Demonic'])
    expect(next.leagueNames).toHaveLength(8)
    expect(next.artwork.leagues).toHaveLength(8)
    expect(seasonBlueprintSchema.safeParse(next).success).toBe(true)
    expect(seasonLeaguePresentation({ seasonTournament: { key: 'stage-1-league-2', contract: next } })).toMatchObject({ division: 'Demonic', name: 'Beast Demonic', art: { sideId: 'demonic', emblemId: 'beast' } })
    expect(seasonBlueprintSchema.safeParse({ ...next, artwork: { ...next.artwork, leagues: [{ sideId: 'evil', emblemId: 'https://bad.test/image.svg' }] } }).success).toBe(false)
    expect(seasonContractHash(next)).not.toBe(seasonContractHash(config))
  })
  it('reveals only the supplied saved assignment without a mutation request', () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    render(<SeasonLeagueReveal timezone="America/New_York" assignment={{ key: 'stage-1-league-1', name: 'Smoke Angelic', division: 'Angelic', art: { sideId: 'angelic', emblemId: 'smoke' }, teams: 8, draftSlot: 3, startsAt: '2026-10-19T18:00:00Z' }} />)
    expect(screen.queryByText('Smoke Angelic')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reveal my league' }))
    expect(screen.getByRole('figure', { name: 'Smoke Angelic · Angelic' })).toBeInTheDocument()
    expect(screen.getByText('8 teams · Draft slot 3')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
    fetch.mockRestore()
  })
})

it('skips full and insolvent auction nominators, wraps and preserves empty pick rows', () => {
  const order = ['a', 'b', 'c'].map(rosterId => ({ rosterId })), picks = [{ rosterId: 'a', playerName: 'One', position: 'PG' }, { rosterId: 'c', playerName: '', position: '' }]
  expect(nextSeasonNominator(order, 0, picks, 1, { a: 100, b: 0, c: 1 }, 1)).toBe(2)
  expect(nextSeasonNominator(order, 3, picks, 1, { a: 100, b: 0, c: 1 }, 1)).toBe(2)
  expect(nextSeasonNominator(order, 0, picks, 1, { a: 100, b: 0, c: 0 }, 1)).toBeNull()
})
