import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import catalog from '@/design-refs/native-league-handoff/survivor-theme/idols/catalog.json'
import { idolDefinition } from '@/lib/survivor/survivorIdolCatalog'
import { SurvivorIdolPlay } from '@/components/survivor/SurvivorIdolPlay'
import { SurvivorVoteRevealScrolls } from '@/components/league/survivor/SurvivorVoteRevealScrolls'
let fetchMock: any
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ playable: true, deadline: '2099-10-20T20:00:00Z', targets: [{ userId: 'b', name: 'Manager B', disabled: false }, { userId: 'c', name: 'Manager C', disabled: true, reason: 'Immune this week' }] }) }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('vote steal selects a manager, disables immunity, confirms and reports two private votes', async () => {
  const finished = vi.fn()
  render(<SurvivorIdolPlay leagueId="l" idolId="i" powerType="vote_steal" onFinished={finished} />)
  const victim = await screen.findByRole('button', { name: /Manager B/ })
  expect((screen.getByRole('button', { name: /Manager C/ }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(victim); fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(fetchMock).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Play Vote steal' }))
  expect(await screen.findByRole('heading', { name: 'Played in secret' })).toBeTruthy()
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ idolId: 'i', stolenVoterUserId: 'b' })
  expect(fetchMock.mock.calls[1][0]).toBe('/api/leagues/l/survivor/play-vote-steal')
  expect(screen.getByText(/You can now cast 2 votes/)).toBeTruthy()
  expect(finished).toHaveBeenCalledTimes(1)
})
it('immunity has one confirm, displays server deadline, and sends no target', async () => {
  render(<SurvivorIdolPlay leagueId="l" idolId="shield" powerType="vote_shield" onFinished={vi.fn()} />)
  await waitFor(() => expect(document.querySelector('time')?.dateTime).toBe('2099-10-20T20:00:00Z'))
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  expect(screen.queryByRole('button', { name: /Manager B/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Play Immunity idol' }))
  await screen.findByRole('heading', { name: 'Played in secret' })
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ idolId: 'shield' })
  expect(fetchMock.mock.calls[1][0]).toBe('/api/leagues/l/survivor/play-idol')
})
it.each(catalog.filter(i => !['steal-three', 'immunity', 'vote-steal', 'extra-vote'].includes(i.id)))('renders catalog card $id and its unsupported state', async entry => {
  const definition = idolDefinition(entry.id.replace(/-/g, '_'))
  expect(definition.when).toBe(entry.when)
  expect(definition.target).toBe(entry.target)
  expect(definition.needsTarget).toBe(entry.target.startsWith('One '))
  render(<SurvivorIdolPlay leagueId="l" idolId="i" powerType={entry.id.replace(/-/g, '_')} onFinished={vi.fn()} />)
  expect(screen.getByRole('heading', { name: entry.name })).toBeTruthy()
  expect(screen.getByText(entry.when)).toBeTruthy()
  expect(screen.getByText(entry.target)).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Not playable yet' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Play / })).toBeNull()
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
})
it('prints the Taken stamp from the canonical server tally at the read', () => {
  render(<SurvivorVoteRevealScrolls revealMode="all_at_once" scrolls={[{ order: 1, targetName: 'Manager B', status: 'taken_by_vote_steal', isExtraVote: false }]} eliminatedName={null} isTie={false} tiePhase={null} />)
  fireEvent.click(screen.getByRole('button', { name: 'Break the seal' }))
  const slip = screen.getByRole('list', { name: 'Votes read' }).querySelector('li')
  expect(slip?.textContent).toBe('Only voteManager BTaken · Does not count')
})
