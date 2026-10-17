/**
 * PickALeague's "Needs you first" queue sorts most severe first.
 *
 * 🛑 IT NEVER DID. The rank map was keyed on 'critical' | 'high' | 'medium' | 'low', but a CoreIssue's
 * severity is an `IssueSeverity` — 'bad' | 'warn' | 'info'. Every lookup missed and fell through to
 * the same default, so the sort compared 9 with 9 and left the rows in whatever order they arrived.
 * Nothing failed: the queue rendered, just not in the order its own comment promised.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) => {
    const { prefetch: _p, ...attrs } = rest as Record<string, unknown>
    return <a href={href} {...(attrs as Record<string, string>)}>{children as never}</a>
  },
}))

import { PickALeague } from '@/components/core-app/PickALeague'
import type { CoreIssue, IssueSeverity } from '@/lib/core-app/outstandingIssues'

const issue = (id: string, severity: IssueSeverity): CoreIssue =>
  ({
    id,
    severity,
    glyph: '!',
    title: `title-${id}`,
    meta: 'meta',
    leagueId: 'L1',
    leagueName: 'League One',
    platform: 'sleeper',
    deadline: null,
  }) as CoreIssue

const leagues = [{ id: 'L1', name: 'League One' }]

/** The queue's rows, top to bottom, as the titles the user reads. */
const rowOrder = (html: string) => [...html.matchAll(/class="af-pl-row-title">title-([^<]+)</g)].map((m) => m[1])

const draw = (issues: CoreIssue[]) =>
  renderToStaticMarkup(<PickALeague tabKey="waivers" title="Waivers" blurb="b" issues={issues} leagues={leagues} />)

describe('PickALeague queue order', () => {
  it('puts a bad issue above a warn issue that arrived first', () => {
    expect(rowOrder(draw([issue('w', 'warn'), issue('b', 'bad')]))).toEqual(['b', 'w'])
  })

  it('orders bad > warn > info whatever the input order', () => {
    expect(rowOrder(draw([issue('i', 'info'), issue('w', 'warn'), issue('b', 'bad')]))).toEqual(['b', 'w', 'i'])
  })

  /*
   * deriveOutstandingIssues already sorts soonest deadline first. Within one severity that order
   * must survive, so the sort has to stay stable and tie on equal rank.
   */
  it('keeps the incoming order within one severity', () => {
    expect(rowOrder(draw([issue('w1', 'warn'), issue('b1', 'bad'), issue('w2', 'warn'), issue('b2', 'bad')]))).toEqual([
      'b1',
      'b2',
      'w1',
      'w2',
    ])
  })
})
