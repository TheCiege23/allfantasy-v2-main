import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SurvivorIdolPlay } from '@/components/survivor/SurvivorIdolPlay'
import { SurvivorIdolsView } from '@/components/survivor/SurvivorIdolsView'

let preview: any, fetchMock: any
const player = (id: string, reason: string | null = null) => ({ id, playerName: `Player ${id}`, position: 'RB', team: 'GB', disabled: Boolean(reason), unavailableReason: reason })
beforeEach(() => {
  preview = { powerType: 'triple_steal', week: 6, teams: [{ rosterId: 'victim', teamName: 'Raided team', tribe: { name: 'Koa', logoUrl: null }, weeklyAverage: 120, topPlayers: ['Player a', 'Player b', 'Player c'], players: [player('a'), player('b'), player('c'), player('locked', 'Locked - game started'), player('ir', 'On IR')] }], myBench: [player('d'), player('e'), player('f')], rosterSize: 1, maxRosterSize: 4, requiredDrops: 0, lockWarnings: [] }
  fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('steal-three-preview') ? preview : { ok: true, playerNames: ['Player a', 'Player b', 'Player c'], dropNames: [], week: 6 } }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
async function pickThree() {
  fireEvent.click(await screen.findByRole('button', { name: /Raided team/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  for (const id of ['a', 'b', 'c']) fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`Player ${id}`) }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
}
it('disables locked and IR players and skips make room with server-reported capacity', async () => {
  render(<SurvivorIdolPlay leagueId="league" idolId="idol" powerType="triple_steal" onFinished={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /Raided team/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect((screen.getByRole('checkbox', { name: /Player locked/ }) as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByRole('checkbox', { name: /Player ir/ }) as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
  for (const id of ['a', 'b', 'c']) fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`Player ${id}`) }))
  expect(screen.getByText('3 of 3 selected')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('heading', { name: 'Check the raid' })).toBeTruthy()
  expect(screen.getByText(/Steal 3 is not secret/).textContent).toContain("You can't undo it")
  expect(screen.getByText('No drops needed. You have room.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('heading', { name: 'Pick 3 from Raided team' })).toBeTruthy()
})
it('requires the server drop count and shows named players on both sides of confirm', async () => {
  preview.requiredDrops = 3; preview.rosterSize = 4
  render(<SurvivorIdolPlay leagueId="league" idolId="idol" powerType="triple_steal" onFinished={vi.fn()} />)
  await pickThree()
  expect(screen.getByRole('heading', { name: 'Make room: drop 3 from your roster' })).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
  for (const id of ['d', 'e', 'f']) fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`Player ${id}`) }))
  expect(screen.getByText('3 of 3 selected')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('heading', { name: 'Coming to you' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'To waivers' })).toBeTruthy()
  expect(screen.getByText('RB - Player d')).toBeTruthy()
})
it('returns to step 2 and refreshes disabled players on the server lock-race error', async () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('play-steal-three')) { preview.teams[0].players[0].disabled = true; preview.teams[0].players[0].unavailableReason = 'Locked - game started'; return { ok: false, json: async () => ({ code: 'player_locked', error: 'A player locked. Return to step 2.' }) } }
    return { ok: true, json: async () => preview }
  })
  render(<SurvivorIdolPlay leagueId="league" idolId="idol" powerType="triple_steal" onFinished={vi.fn()} />)
  await pickThree()
  fireEvent.click(screen.getByRole('button', { name: 'Play Steal 3' }))
  await screen.findByRole('alert')
  await waitFor(() => expect((screen.getByRole('checkbox', { name: /Player a/ }) as HTMLInputElement).disabled).toBe(true))
  expect(screen.getByText('0 of 3 selected')).toBeTruthy()
  expect(fetchMock.mock.calls.filter((call: any) => call[0].endsWith('steal-three-preview'))).toHaveLength(2)
})
it('removes the used idol from the vault while keeping the played screen visible', async () => {
  render(<SurvivorIdolsView leagueId="league" names={{}} summary={{ myRosterId: 'mine', myIdols: [{ id: 'idol', powerType: 'triple_steal', playerId: 'p' }], myActiveEffects: [] } as any} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play Steal 3' }))
  await pickThree()
  fireEvent.click(screen.getByRole('button', { name: 'Play Steal 3' }))
  expect(await screen.findByRole('heading', { name: 'The hand has struck' })).toBeTruthy()
  expect(screen.getByText(/You have no active idols/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Steal 3' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Set lineup' }).getAttribute('href')).toBe('/league/league?tab=team')
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'The hand has struck' })).toBe(document.activeElement)
  })
})
