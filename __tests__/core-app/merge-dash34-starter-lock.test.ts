import { describe, expect, it } from 'vitest'
import { mergeDash34Issues } from '@/lib/core-app/mergeDash34Issues'
import { rankDecisions } from '@/lib/core-app/decisionQueue'
import type { Dash34Data, Dash34League } from '@/components/core-app/screens/Dashboard34'

/**
 * The starter-out row's lock instant — `Dash34League.hurtStarterKickoffAt` → `CoreIssue.deadline`.
 *
 * ⚠ THE POINT OF THE FILE IS THE ORDER, NOT THE FIELD. Before this, every synthesized row carried
 * `deadline: null`, so nine flagged leagues tied and `rankDecisions` fell through to arrival
 * order — the league locking in forty minutes sat wherever the league list happened to put it.
 * The ordering assertions below fail if the deadline is ever dropped back to null, which a field
 * assertion on its own would not catch.
 */

const KICK = (iso: string) => new Date(iso).toISOString()

function league(over: Partial<Dash34League> & { id: string }): Dash34League {
  return {
    name: over.id,
    platform: 'sleeper' as Dash34League['platform'],
    href: `/core?league=${over.id}`,
    ...over,
  } as Dash34League
}

function data(leagues: Dash34League[]): Dash34Data {
  return { leagues, allLeagues: leagues, totalLeagues: leagues.length } as unknown as Dash34Data
}

const ids = (rows: ReturnType<typeof mergeDash34Issues>) => rows.map((r) => r.id)

describe('mergeDash34Issues — the starter-out lock', () => {
  it('carries the flagged starter kickoff onto the row as its deadline', () => {
    const at = KICK('2026-09-20T17:00:00Z')
    const [row] = mergeDash34Issues(
      [],
      data([league({ id: 'a', priority: 'urgent', hurtStarters: 1, hurtStarterKickoffAt: at })]),
    )
    expect(row!.id).toBe('a:starter-out')
    expect(row!.deadline).toBeInstanceOf(Date)
    expect((row!.deadline as Date).toISOString()).toBe(at)
  })

  it('states the kickoff as an absolute pinned clock, never a countdown that can drift', () => {
    const [row] = mergeDash34Issues(
      [],
      data([
        league({
          id: 'a',
          priority: 'urgent',
          hurtStarters: 1,
          hurtStarterKickoffAt: KICK('2026-09-20T17:00:00Z'),
        }),
      ]),
    )
    expect(row!.meta).toContain('kicks off Sun 1:00p ET')
    expect(row!.meta).not.toMatch(/\bin \d/i)
  })

  it('ranks two flagged leagues by who kicks off first, not by league order', () => {
    const late = league({
      id: 'late',
      priority: 'urgent',
      hurtStarters: 1,
      hurtStarterKickoffAt: KICK('2026-09-22T00:15:00Z'),
    })
    const soon = league({
      id: 'soon',
      priority: 'urgent',
      hurtStarters: 1,
      hurtStarterKickoffAt: KICK('2026-09-20T17:00:00Z'),
    })
    // `late` is first in the league list, so arrival order alone would keep it first.
    const merged = mergeDash34Issues([], data([late, soon]))
    expect(ids(merged)).toEqual(['late:starter-out', 'soon:starter-out'])
    expect(ids(rankDecisions(merged))).toEqual(['soon:starter-out', 'late:starter-out'])
  })

  it('leaves a league with no kickoff on file untimed rather than guessing one', () => {
    const [row] = mergeDash34Issues(
      [],
      data([league({ id: 'nba', priority: 'urgent', hurtStarters: 1, hurtStarterKickoffAt: null })]),
    )
    expect(row!.deadline).toBeNull()
    expect(row!.meta).not.toContain('kicks off')
  })

  it('treats an unparseable stamp as no lock time, never as an Invalid Date', () => {
    const [row] = mergeDash34Issues(
      [],
      data([
        league({
          id: 'junk',
          priority: 'urgent',
          hurtStarters: 1,
          hurtStarterKickoffAt: 'not a date',
        }),
      ]),
    )
    expect(row!.deadline).toBeNull()
  })

  it('keeps the empty slot untimed and ahead of a timed starter — a zero already scored', () => {
    const merged = mergeDash34Issues(
      [],
      data([
        league({
          id: 'hurt',
          priority: 'urgent',
          hurtStarters: 1,
          hurtStarterKickoffAt: KICK('2026-09-20T17:00:00Z'),
        }),
        league({ id: 'empty', priority: 'urgent', emptyStarters: 2 }),
      ]),
    )
    const empty = merged.find((r) => r.id === 'empty:empty-slot')
    expect(empty!.deadline).toBeNull()
    expect(ids(rankDecisions(merged))).toEqual(['empty:empty-slot', 'hurt:starter-out'])
  })
})
