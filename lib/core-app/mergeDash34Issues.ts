import 'server-only'

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

/**
 * Just the part of `WeekBoard` this needs.
 *
 * ⚠ STRUCTURAL RATHER THAN `Pick<WeekBoard, 'coinFlips'>` SO THE SCHEDULE STAYS OPTIONAL AT EVERY
 * OTHER CALL SITE. `mergeDash34Issues` runs on LeagueHome too, which loads no week board; a
 * required parameter would have made a screen that cannot answer the question pass `null` anyway.
 */
export type CoinFlipSchedule = {
  coinFlips: ReadonlyArray<{
    leagueId: string
    leagueName: string
    platform: string
    href: string
    projection: { margin: number } | null
  }>
}

export function mergeDash34Issues(
  derived: CoreIssue[],
  dash34: Dash34Data | null,
  /** The week board, where the caller holds one. Absent means "not read", never "no close games". */
  schedule?: CoinFlipSchedule | null,
  /**
   * Leagues holding a provider trade offer that is waiting on the viewer, from the urgency cache.
   * Absent means "not read", never "no offers" — see `readPendingOfferLeagues`.
   *
   * ⚠ IF A FIFTH INPUT EVER ARRIVES, MAKE THESE AN OPTIONS BAG. Two optional positionals is as far
   * as this should go before the call sites stop being readable.
   */
  pendingOffers?: ReadonlyArray<{ leagueId: string; waiting: number }> | null,
): CoreIssue[] {
  /*
   * ⚠ NO EARLY RETURN ON A MISSING `dash34`, WHICH THERE USED TO BE. The two inputs fail
   * independently: the summary read can reject while the week board resolves perfectly well, and
   * bailing on the first would have thrown away close-matchup rows the caller had already paid for.
   * An empty `ranked` simply means the loop below contributes nothing.
   */
  // allLeagues is the uncapped ranked list (needs + quiet); `leagues` is capped
  // at 8. An urgent league pushed past the cap still deserves a row.
  const ranked: Dash34League[] = dash34?.allLeagues ?? dash34?.leagues ?? []

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
          meta: `${titleCasePlatform(l.platform)} › Lineup · a slot with nobody in it scores zero`,
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
      const kickoff = kickoffInstant(l.hurtStarterKickoffAt)
      synthesized.push({
        id,
        severity: 'bad',
        glyph: '⚑',
        title: `Starter who cannot play — ${l.name}`,
        meta: `${titleCasePlatform(l.platform)} › Lineup · a starter is ruled out${
          /* The absolute clock, not a countdown: the card renders "IN 1h 04m" from `deadline`
             itself, and a second relative string baked in here would drift against it the moment
             the page sat open. `kickoffClock` pins locale and zone so the server paint and the
             client hydration produce the same characters. */
          kickoff ? ` · kicks off ${kickoffClock(kickoff.toISOString())}` : ''
        }`,
        leagueId: l.id,
        leagueName: l.name,
        platform: l.platform,
        deadline: kickoff,
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

  /*
   * ⚠ OFFERS BEFORE COIN FLIPS, AND BOTH AFTER THE LOOP. An offer is somebody waiting on a reply;
   * a coin flip is a game that happens to be close. Same severity, so `rankDecisions` keeps their
   * arrival order — which makes this line the tie-break, and worth being deliberate about.
   */
  synthesized.push(...pendingOfferRows(pendingOffers, ranked, synthesized))
  synthesized.push(...coinFlipRows(schedule, synthesized))

  if (synthesized.length === 0) return derived
  return [...synthesized, ...derived]
}

/** Above this many rows of one kind they collapse into one — see `coinFlipRows`. */
const COIN_FLIP_ROW_LIMIT = 3

/**
 * "Pending trades" — the brief's third kind of action (2026-09-17 decisions).
 *
 * ⚠ THIS COSTS NO PROVIDER CALL. `deriveOutstandingIssues` used to declare `trade_offer`
 * unavailable because "pending offers are not ingested", which stopped being true:
 * `lib/provider-trades/scanPendingSleeperTrades.ts` reads them, `lib/core-app/recentTrades.ts`
 * already runs that scan on the home, and its `onPendingOffers` hook writes the per-league counts
 * into the urgency cache row the Trades badge reads. This restates that stored fact with the league
 * attached; the caller passes what it read, and nothing here fetches.
 *
 * ⚠ READ-ONLY, LIKE EVERY OTHER ROW. Sleeper's public API offers no write endpoint, so the action
 * opens OUR trades screen for that league rather than pretending to accept or decline. The scanner's
 * own header carries the same rule for the same reason.
 *
 * ⚠ `warn`, FOR THE SAME REASON AS A COIN FLIP: somebody is waiting on a reply, but nothing is
 * broken, so it must not outrank an empty slot. And no deadline — an offer can expire, and we hold
 * no expiry for one, so claiming an instant would invent it.
 *
 * ⚠ ONLY LEAGUES THE SUMMARY CAN NAME. A row reading "Trade offer waiting — a1b2c3" is worse than
 * no row; an id the dash34 list does not carry is skipped rather than printed raw.
 */
function pendingOfferRows(
  offers: ReadonlyArray<{ leagueId: string; waiting: number }> | null | undefined,
  ranked: readonly Dash34League[],
  already: readonly CoreIssue[],
): CoreIssue[] {
  if (!offers || offers.length === 0) return []

  const nameById = new Map(ranked.map((l) => [l.id, l]))
  const spokenFor = new Set(already.map((i) => i.leagueId).filter((id): id is string => id != null))
  const fresh = offers
    .filter((o) => o.waiting > 0 && !spokenFor.has(o.leagueId) && nameById.has(o.leagueId))
    .map((o) => ({ ...o, league: nameById.get(o.leagueId)! }))
  if (fresh.length === 0) return []

  const total = fresh.reduce((sum, o) => sum + o.waiting, 0)

  if (fresh.length > COIN_FLIP_ROW_LIMIT) {
    return [
      {
        id: 'trade-offer:aggregate',
        severity: 'warn',
        glyph: '⇄',
        title: `${total} trade ${total === 1 ? 'offer is' : 'offers are'} waiting on you`,
        meta: `Across ${fresh.length} leagues › Trades · proposed to you and not answered`,
        leagueId: null,
        leagueName: null,
        platform: null,
        deadline: null,
        action: { label: 'Open Trades', href: '/core/trades', external: false },
      },
    ]
  }

  return fresh.map((o) => ({
    id: `${o.leagueId}:trade-offer`,
    severity: 'warn' as const,
    glyph: '⇄',
    title: `${o.waiting} trade ${o.waiting === 1 ? 'offer' : 'offers'} waiting — ${o.league.name}`,
    meta: `${titleCasePlatform(o.league.platform)} › Trades · proposed to you and not answered`,
    leagueId: o.leagueId,
    leagueName: o.league.name,
    platform: o.league.platform,
    deadline: null,
    action: {
      label: 'See the offer',
      href: `/core/trades?league=${encodeURIComponent(o.leagueId)}`,
      external: false,
    },
  }))
}

/**
 * "Close matchups" — the brief's fifth kind of action (2026-09-17 decisions).
 *
 * A coin flip is the one matchup where a lineup decision actually changes the result, which is why
 * `/core/week` leads with them. The queue could not say so: it is built from dash34 and the derived
 * detectors, and neither reads the schedule.
 *
 * ⚠ `warn`, NOT `bad`, AND THAT IS THE WHOLE PLACEMENT. Nothing is broken — no slot is empty, no
 * starter is out — so a coin flip must never outrank something that has already gone wrong.
 * `rankDecisions` puts every `bad` row above every `warn`, so these land under the real problems.
 * `info` would be too low: an untimed `info` sinks below TIMED info, which would file "your week is
 * on a knife edge" beneath "a draft in thirty days".
 *
 * ⚠ AND NO DEADLINE, BECAUSE THE BOARD HOLDS NONE. `WeekMatchup` carries the projection and the
 * opponent; the only kickoff on `WeekBoard` is `firstKickoffAt`, which is the week's first game
 * across every league — not this matchup's. Using it would put a confident instant on a row it does
 * not describe, which is the lie the starter-out note above exists to avoid.
 *
 * ⚠ SUPPRESSED FOR A LEAGUE THAT ALREADY HAS A ROW. A league with an empty slot is already being
 * sent to its lineup; telling the reader twice about the same league is how a five-row queue stops
 * being five decisions.
 *
 * ⚠ COLLAPSED ABOVE A HANDFUL, the same rule and for the same reason as the stale-sync rows in
 * `deriveOutstandingIssues`: one account there produced 604 identical rows and buried the queue.
 * A 61-league manager can easily hold ten coin flips, and ten rows saying the same sentence is one
 * fact about the week, not ten facts about ten leagues.
 */
function coinFlipRows(
  schedule: CoinFlipSchedule | null | undefined,
  already: readonly CoreIssue[],
): CoreIssue[] {
  const flips = schedule?.coinFlips ?? []
  if (flips.length === 0) return []

  const spokenFor = new Set(already.map((i) => i.leagueId).filter((id): id is string => id != null))
  const fresh = flips.filter((m) => !spokenFor.has(m.leagueId))
  if (fresh.length === 0) return []

  if (fresh.length > COIN_FLIP_ROW_LIMIT) {
    return [
      {
        id: 'coin-flip:aggregate',
        severity: 'warn',
        glyph: '⚖',
        title: `${fresh.length} matchups are coin flips this week`,
        meta: 'Across your leagues › Matchup · close enough that a lineup decision swings them',
        // Deliberately not pinned to one league: it is about all of them, and naming an arbitrary
        // member would make the row lie about what it stands for.
        leagueId: null,
        leagueName: null,
        platform: null,
        deadline: null,
        action: { label: 'See your week', href: '/core/week', external: false },
      },
    ]
  }

  return fresh.map((m) => ({
    id: `${m.leagueId}:coin-flip`,
    severity: 'warn' as const,
    glyph: '⚖',
    title: `Coin flip this week — ${m.leagueName}`,
    meta: `${titleCasePlatform(m.platform)} › Matchup · ${
      m.projection ? `${Math.abs(m.projection.margin).toFixed(1)} projected points apart` : 'projected close'
    }`,
    leagueId: m.leagueId,
    leagueName: m.leagueName,
    platform: m.platform,
    deadline: null,
    action: { label: 'See the matchup', href: m.href, external: false },
  }))
}
