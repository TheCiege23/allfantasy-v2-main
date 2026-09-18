import 'server-only'
import { verificationStamp } from './lineupVerification'

import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import type { Dash34Data, Dash34League } from '@/components/core-app/screens/Dashboard34'
/* Client-safe by construction (no 'server-only', no prisma) — see its header. */
import { kickoffClock } from '@/lib/core-app/lineupLock'

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
 *  - One row per fact: a league the draft_upcoming detector already covers
 *    (`<id>:draft`) is not restated by the drafting row.
 *
 * ⚠ A STARTER-OUT ROW NOW CARRIES A DEADLINE, AND THE REST STILL DO NOT.
 *
 * This header used to say `deadline: null` for every synthesized row, because "dash34 knows the
 * fact, not the lock instant". Half of that was an accident of what the loader happened to emit
 * rather than something unknowable: `getDash34Data` already resolves each flagged starter's
 * kickoff while counting him, and now carries it out as `hurtStarterKickoffAt`. The rule the
 * sentence was protecting is unchanged and still absolute — never invent a deadline — so:
 *
 *   `:starter-out`  the kickoff of the SOONEST-playing starter the row is about, when NFL and
 *                   resolvable. Null otherwise, which is honest: no lock time held.
 *   `:empty-slot`   null, always. There is no player in the slot, so there is no kickoff to read,
 *                   and the league's first game is a different claim from this slot's lock.
 *   `:drafting`     null. A draft on the clock is happening NOW; a deadline would misdescribe it.
 *
 * ⚠ AND IT IS A KICKOFF, NOT A LEAGUE LOCK RULE — see `Dash34League.hurtStarterKickoffAt`. A
 * league that locks every lineup at the week's first game locks earlier than this says. The meta
 * therefore states the kickoff ("kicks off Sun 1:00p ET") rather than claiming an editable window.
 *
 * ⚠ WHAT THIS DOES TO THE ORDER, WHICH IS THE POINT. Synthesized rows are still PREPENDED, but
 * `rankDecisions` (lib/core-app/decisionQueue.ts) is what the home actually orders by, and its
 * rule 2 puts an untimed `bad` row above a timed one — an untimed `bad` states something that has
 * already happened. So empty slots and live drafts keep the head of the queue, and starter-out
 * rows now sort AMONG THEMSELVES by who kicks off first instead of by league order. That is the
 * whole win: with nine leagues flagged, the one locking in forty minutes is no longer behind
 * eight that lock on Monday night purely because of where it sat in the list.
 */

function titleCasePlatform(platform: string): string {
  const p = platform.toLowerCase()
  if (p === 'espn') return 'ESPN'
  if (p === 'mfl') return 'MFL'
  return p.charAt(0).toUpperCase() + p.slice(1)
}

/**
 * The kickoff as a `Date`, or null.
 *
 * ⚠ AN UNPARSEABLE STAMP IS "NO LOCK TIME", NOT `Invalid Date`. A NaN date would reach
 * `rankDecisions`, whose comparator already defends itself against one — but it would also reach
 * the card, which would render a deadline chip built from NaN. Rejected here instead, once.
 */
function kickoffInstant(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? null : at
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
    /*
     * ⚠ AN EMPTY SLOT IS ITS OWN ROW, AND IT COMES FIRST. A starter ruled out
     * might still be active by Sunday; a slot with nobody in it is a
     * guaranteed zero that has already happened. Both leagues rank 'urgent',
     * so without a separate row the queue would say "starter who cannot play"
     * about a league whose real problem is that nobody is in the slot at all.
     */
    if ((l.emptyStarters ?? 0) > 0) {
      const id = `${l.id}:empty-slot`
      if (!seenIds.has(id)) {
        const n = l.emptyStarters ?? 0
        synthesized.push({
          id,
          severity: 'bad',
          glyph: '□',
          title: `${n} empty starting ${n === 1 ? 'slot' : 'slots'} — ${l.name}`,
          meta: `${titleCasePlatform(l.platform)} › Lineup · a slot with nobody in it scores zero${l.lineupVerification ? ` · ${verificationStamp(l.lineupVerification.checkedAt)}` : ''}`,
          leagueId: l.id,
          leagueName: l.name,
          platform: l.platform,
          deadline: null,
          action: {
            label: 'Fill the slot',
            href: `/core/my-team?league=${encodeURIComponent(l.id)}`,
            external: false,
          },
        })
      }
    }

    if (l.priority === 'urgent') {
      const id = `${l.id}:starter-out`
      /*
       * `priority` is 'urgent' for an empty slot too, so this row must confirm
       * there is actually a flagged starter — otherwise a league whose only
       * problem is an unfilled slot would be reported as having a player who
       * cannot play, which is a different and untrue thing.
       */
      if (seenIds.has(id) || (l.hurtStarters ?? 0) === 0) continue
      const flagged = l.flaggedStarters?.[0]
      const checked = l.lineupVerification
      const kickoff = kickoffInstant(l.hurtStarterKickoffAt)
      synthesized.push({
        id,
        severity: 'bad',
        glyph: '⚑',
        title: flagged ? `${flagged.name} · ${flagged.slot} · ${flagged.status} — ${l.name}` : `Starter who cannot play — ${l.name}`,
        meta: `${titleCasePlatform(l.platform)} › Lineup${checked?.week != null ? ` · Week ${checked.week}` : ''} · ${flagged ? `Listed ${flagged.status} in your starting lineup${(l.flaggedStarters?.length ?? 0) > 1 ? `; ${l.flaggedStarters!.length - 1} more flagged` : ''}` : 'a starter is ruled out'}${
          /* The absolute clock, not a countdown: the card renders "IN 1h 04m" from `deadline`
             itself, and a second relative string baked in here would drift against it the moment
             the page sat open. `kickoffClock` pins locale and zone so the server paint and the
             client hydration produce the same characters. It is the SOONEST flagged starter's
             kickoff, which is the row's deadline — not necessarily `flagged` (the first one). */
          kickoff ? ` · kicks off ${kickoffClock(kickoff.toISOString())}` : ''
        }${checked ? ` · ${verificationStamp(checked.checkedAt)}` : ''}`,
        leagueId: l.id,
        leagueName: l.name,
        platform: l.platform,
        deadline: kickoff,
        action: {
          label: flagged ? `Review ${flagged.name}` : 'See who is flagged',
          href: `/core/my-team?league=${encodeURIComponent(l.id)}${flagged ? `#lineup-player-${encodeURIComponent(flagged.playerId)}` : ''}`,
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
