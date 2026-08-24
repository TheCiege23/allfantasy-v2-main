import 'server-only'

import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import type { Dash34Data, Dash34League } from '@/components/core-app/screens/Dashboard34'

/**
 * ONE URGENCY VOICE for the /core home.
 *
 * `deriveOutstandingIssues` can only detect stale_sync and draft_upcoming
 * today, while `getDash34Data`'s brief states two stronger facts from reads it
 * already performed: leagues with a starter who cannot play (the injury feed
 * joined to lineup slots — `priority: 'urgent'`) and leagues drafting right
 * now (`priority: 'draft'`). Dashboard3A's Ask Chimmy card and its
 * "Nothing is waiting on you" empty state key off the issues array alone, so
 * without this merge the queue could read clean while the brief on the same
 * screen says a starter is ruled out.
 *
 * Rules:
 *  - Nothing is invented. Every synthesized row restates a fact dash34
 *    derived from data on file; when dash34 is null (every non-home screen,
 *    or a failed read) the input passes through untouched.
 *  - The league name lives IN the title: Dashboard3A appends `— leagueName`
 *    only when the title lacks it, and LeagueHome renders the title alone.
 *  - `deadline: null` — dash34 knows the fact, not the lock instant, and an
 *    invented deadline is exactly the lie this codebase refuses to tell.
 *    Synthesized rows are PREPENDED instead: a starter ruled out or a draft
 *    live now outranks a scheduled deadline, and the derived queue's sort
 *    only ordered the rows it emitted.
 *  - One row per fact: a league the draft_upcoming detector already covers
 *    (`<id>:draft`) is not restated by the drafting row.
 */

function titleCasePlatform(platform: string): string {
  const p = platform.toLowerCase()
  if (p === 'espn') return 'ESPN'
  if (p === 'mfl') return 'MFL'
  return p.charAt(0).toUpperCase() + p.slice(1)
}

export function mergeDash34Issues(derived: CoreIssue[], dash34: Dash34Data | null): CoreIssue[] {
  if (!dash34) return derived
  // allLeagues is the uncapped ranked list (needs + quiet); `leagues` is capped
  // at 8. An urgent league pushed past the cap still deserves a row.
  const ranked: Dash34League[] = dash34.allLeagues ?? dash34.leagues ?? []
  if (ranked.length === 0) return derived

  const seenIds = new Set(derived.map((i) => i.id))
  const synthesized: CoreIssue[] = []

  for (const l of ranked) {
    if (l.priority === 'urgent') {
      const id = `${l.id}:starter-out`
      if (seenIds.has(id)) continue
      synthesized.push({
        id,
        severity: 'bad',
        glyph: '⚑',
        title: `Starter who cannot play — ${l.name}`,
        meta: `${titleCasePlatform(l.platform)} › Lineup · a starter is ruled out`,
        leagueId: l.id,
        leagueName: l.name,
        platform: l.platform,
        deadline: null,
        action: {
          label: 'See who is flagged',
          href: `/core/my-team?league=${encodeURIComponent(l.id)}`,
          external: false,
        },
      })
    } else if (l.priority === 'draft') {
      const id = `${l.id}:drafting`
      if (seenIds.has(id) || seenIds.has(`${l.id}:draft`)) continue
      synthesized.push({
        id,
        severity: 'bad',
        glyph: '▤',
        title: `Draft is live — ${l.name}`,
        meta: `${titleCasePlatform(l.platform)} › Draft · on the clock now`,
        leagueId: l.id,
        leagueName: l.name,
        platform: l.platform,
        deadline: null,
        action: {
          label: 'Open Draft HQ',
          href: `/core/draft-hq?league=${encodeURIComponent(l.id)}`,
          external: false,
        },
      })
    }
  }

  if (synthesized.length === 0) return derived
  return [...synthesized, ...derived]
}
