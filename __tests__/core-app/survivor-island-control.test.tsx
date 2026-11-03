import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SurvivorIslandControl } from '@/components/core-app/survivor/SurvivorIslandControl'
import { survivorIslandControlMessages } from '@/lib/core-app/messages/survivorIslandControl'
import { missingMessages } from '@/lib/i18n/messages'
import { islandHealth, islandTodo, type IslandControlFacts } from '@/lib/core-app/survivorIslandControl'

/** Island control: a Survivor commissioner's league health and weekly to-do, at the top of the Commissioner screen. */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const running: IslandControlFacts = {
  league: { leagueSize: 12 },
  shell: { survivorChatChannels: 3, exileLeagueLinked: true },
  operations: { claimedManagers: 12, draft: { status: 'completed', picksMade: 180, totalPicks: 180 }, exileActive: true, automationNeedsAttention: false, readinessIssues: [] },
  council: { status: 'revealed', isRevealed: true },
  config: { exileReturnEnabled: true },
  todo: { items: [] },
}

describe('islandHealth', () => {
  it('lights every torch for a league that is running itself', () => {
    expect(islandHealth(running).map((t) => [t.id, t.state])).toEqual([
      ['draft', 'lit'], ['castaways', 'lit'], ['council', 'lit'], ['automation', 'lit'], ['exile', 'lit'], ['chat', 'lit'],
    ])
  })

  it('dims what is in progress and puts out what needs the commissioner', () => {
    const t = Object.fromEntries(islandHealth({
      ...running,
      operations: { claimedManagers: 9, draft: { status: 'in_progress', picksMade: 40, totalPicks: 180 }, automationNeedsAttention: true },
      council: { status: 'voting', isRevealed: false },
      shell: { survivorChatChannels: 0, exileLeagueLinked: false },
    }).map((x) => [x.id, x]))
    expect(t.draft).toMatchObject({ state: 'low', detail: { key: 'draftPicks', n: 40, of: 180 } })
    expect(t.castaways).toMatchObject({ state: 'low', detail: { key: 'seats', n: 9, of: 12 } })
    expect(t.council.state).toBe('low')
    expect(t.automation).toMatchObject({ state: 'out', detail: { key: 'autoNeedsYou' } })
    // Before the draft is done, a missing Exile league or tribe chat is expected, not a fault.
    expect(t.exile.state).toBe('low')
    expect(t.chat.state).toBe('low')
  })

  it('drops the Exile torch when the league plays without Exile, and copes with an empty dashboard', () => {
    expect(islandHealth({ ...running, config: { exileReturnEnabled: false } }).some((t) => t.id === 'exile')).toBe(false)
    expect(islandHealth({}).map((t) => t.state)).toEqual(['out', 'low', 'lit', 'lit', 'low', 'low'])
  })

  it('puts action items before heads-ups', () => {
    const item = (id: string, tone: 'action' | 'heads_up') => ({ id, tone, title: id, body: '', href: '/x', cta: 'Go' })
    expect(islandTodo({ todo: { items: [item('a', 'heads_up'), item('b', 'action'), item('c', 'heads_up'), item('d', 'action')] } }).map((i) => i.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('has every line in Spanish', () => {
    expect(missingMessages(survivorIslandControlMessages, 'es')).toEqual([])
  })
})

describe('SurvivorIslandControl', () => {
  it('draws the torches and the to-do with its links', async () => {
    const facts = { ok: true, ...running, operations: { ...running.operations, automationNeedsAttention: true }, todo: { items: [{ id: 'resume', tone: 'action', title: 'Resume the season', body: 'Paused since Tuesday.', href: '/survivor/L1/commissioner#resume', cta: 'Resume' }] } }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(facts), { status: 200 })))
    const { container } = render(<SurvivorIslandControl leagueId="L1" />)
    await waitFor(() => expect(screen.getByText('Resume the season')).toBeTruthy())
    expect(container.querySelectorAll('.sv-hc').length).toBe(6)
    expect(container.querySelector('.sv-hc[data-state="out"] strong')?.textContent).toBe('Automation')
    expect(screen.getByText('5 of 6 torches lit')).toBeTruthy()
    expect(screen.getByText('Resume').getAttribute('href')).toBe('/survivor/L1/commissioner#resume')
  })

  it('says all is well when there is nothing to do', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, ...running }), { status: 200 })))
    render(<SurvivorIslandControl leagueId="L1" />)
    await waitFor(() => expect(screen.getByText('Nothing needs you. Chimmy is running the island.')).toBeTruthy())
  })

  it('renders nothing for someone who does not run the league', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })))
    const { container } = render(<SurvivorIslandControl leagueId="L1" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})

describe('the core page', () => {
  it('opens a Survivor league’s Commissioner screen with the banner and Island control', () => {
    const page = readFileSync(resolve(process.cwd(), 'app/core/(shell)/[[...screen]]/page.tsx'), 'utf8')
    expect(page).toMatch(/\{survivorControl\}\s*<CommissionerHub /)
  })
})
