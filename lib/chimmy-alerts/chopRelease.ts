import type { FaabBidPlan, FaabPlanBid } from '@/lib/chimmy/tools/faabBidTool'
import { renderDigestEmail } from '@/lib/notifications/designedEmail'
import { escapeHtml } from '@/lib/trade-intel/tradeGradeEmail'
import { preferenceMuteReason, type ChimmyAlertPreferenceMuteReason } from './ChimmyAlertSuppressionEngine'
import { chimmyChatHref, pushSetupEmailLine, type ProactiveFrom } from './proactiveLinks'
import type { ChimmyAlertUserPreferences } from './types'

/**
 * CHIMMY'S CHOP-RELEASE ALERT — "a chopped roster just hit the wire; here is your bid plan".
 *
 * In a guillotine league the lowest scorer each week is eliminated and its WHOLE roster is released
 * to waivers — the only supply there is, bought from a budget that never refills. Chimmy promised a
 * user live on 2026-09-28 to "flag it the moment a chopped roster puts a genuine starter upgrade on
 * the wire". Nothing did; this is that.
 *
 * ── 🛑 SHIPPED OFF. `CHOP_RELEASE_ALERTS_ENABLED=1` TURNS IT ON ─────────────────────────────────
 * It sends real notifications to real people, so it does nothing — no read, no write — until the
 * worker service carries that variable. See `chopReleaseEnabled`.
 *
 * ── HOW A CHOP IS SEEN: A ROSTER THAT WENT FROM PLAYERS TO NONE ─────────────────────────────────
 * Sleeper releases a chopped roster's players, and our sync then writes that roster with an empty
 * player list. There is no chop column for an imported league (`GuillotineRosterState.choppedAt`
 * is the NATIVE league's model), so the transition is detected by comparing each run's rosters with
 * the previous run's, kept as a snapshot row in `SportsDataCache` — no schema change.
 *
 * ⚠ THE FIRST RUN ONLY SEEDS. With no snapshot on file there is no "before", and an empty roster
 * could have been chopped in week 1. Treating every already-empty roster as news would, on the day
 * the flag goes on, message every member about every chop of the season so far. So enabling it
 * starts watching; the first alert follows the first chop AFTER that.
 *
 * ⚠ A MASS EMPTYING IS NOT A CHOP. More than half the live rosters emptying in one step is a season
 * rollover, a re-import or a bad sync — never a guillotine week — and is re-seeded, not announced.
 *
 * ── WHAT IT SAYS: ONLY WHAT THE PLAN PRODUCED ───────────────────────────────────────────────────
 * The numbers are `computeFaabBidPlan`'s — the same plan Chimmy's `get_faab_bid_plan` tool reads —
 * never re-derived here. Of the plan's upgrades, the message names the ones the chopped roster
 * RELEASED (that is the news); every dollar figure is that bid's own `ceiling`, and with no ceiling
 * (remaining FAAB not on file) it names the players and gives no figure at all.
 */

export const CHOP_RELEASE_FLAG = 'CHOP_RELEASE_ALERTS_ENABLED'

/** Off unless the variable is exactly `1`. Anything else — unset, `true`, `yes` — is off. */
export function chopReleaseEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[CHOP_RELEASE_FLAG] === '1'
}

/** The alert type, as the Chimmy alert controls name types they can mute. Class is `waiver`. */
export const CHOP_RELEASE_ALERT_TYPE = 'chop_release'

/** Bids named in the phone/bell body; the rest are in Chimmy's full plan, one tap away. */
export const CHOP_RELEASE_MAX_BIDS = 3

/* ── Detection ────────────────────────────────────────────────────────────────────────────────── */

/**
 * Every player id on a roster's `playerData` — players, starters, reserve, taxi.
 *
 * ⚠ `"0"` IS NOT A PLAYER. Sleeper fills an empty starting slot with `"0"`, so a chopped roster can
 * still carry a starters array of zeros; counting them would make every chopped roster look alive.
 */
export function rosterPlayerIds(playerData: unknown): string[] {
  const pd = playerData && typeof playerData === 'object' && !Array.isArray(playerData) ? (playerData as Record<string, unknown>) : {}
  const ids = (v: unknown) => (Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x).trim())).filter((x) => x !== '' && x !== '0') : [])
  return [...new Set([...ids(pd.players), ...ids(pd.starters), ...ids(pd.reserve), ...ids(pd.taxi)])]
}

/** The league's teams and rosters, as `readLeagueTradeRows` reads them (only the fields used here). */
export type ChopLeagueRows = {
  teams: ReadonlyArray<{
    externalId: string
    platformUserId: string | null
    claimedByUserId: string | null
    teamName: string | null
    ownerName: string | null
  }>
  rosters: ReadonlyArray<{ platformUserId: string; playerData: unknown }>
}

export type ChopRosterEntry = {
  /** `playerData.source_team_id` — stable across the raw→resolved `platformUserId` change. */
  teamKey: string
  playerIds: string[]
  name: string
  claimedByUserId: string | null
}

/**
 * Each roster with its team. Keyed on the roster's `source_team_id` (the sync's own stable key for
 * a team) and matched to `LeagueTeam.externalId`; `Roster.platformUserId` may hold a RESOLVED
 * AllFantasy id rather than the Sleeper manager id, so it is only the fallback.
 */
export function pairRosters(rows: ChopLeagueRows): ChopRosterEntry[] {
  return rows.rosters.map((r) => {
    const pd = r.playerData && typeof r.playerData === 'object' ? (r.playerData as Record<string, unknown>) : {}
    const sourceTeamId = String(pd.source_team_id ?? '').trim()
    const team =
      (sourceTeamId ? rows.teams.find((t) => t.externalId === sourceTeamId) : undefined) ??
      rows.teams.find((t) => t.platformUserId != null && t.platformUserId === r.platformUserId) ??
      rows.teams.find((t) => t.externalId === r.platformUserId) ??
      null
    return {
      teamKey: sourceTeamId || team?.externalId || `pu:${r.platformUserId}`,
      playerIds: rosterPlayerIds(r.playerData),
      name: team?.teamName?.trim() || team?.ownerName?.trim() || 'A team',
      claimedByUserId: team?.claimedByUserId ?? null,
    }
  })
}

/** Each team's player ids as last seen, keyed by the team's stable key. */
export type ChopRosterSnapshot = { v: 1; rosters: Record<string, string[]> }

export type ChopDetection =
  | { kind: 'seed' }
  | { kind: 'reset'; emptied: number; wasAlive: number }
  | { kind: 'none' }
  | { kind: 'chop'; chopped: Array<{ teamKey: string; releasedIds: string[] }> }

/**
 * Which rosters went from players to none since the snapshot. A team missing from `current` (the
 * sync removed it) is not a chop — only a roster still present, and now empty, is.
 */
export function detectChops(
  previous: ChopRosterSnapshot | null,
  current: ReadonlyArray<{ teamKey: string; playerIds: readonly string[] }>,
): ChopDetection {
  if (!previous || previous.v !== 1 || !previous.rosters || typeof previous.rosters !== 'object') return { kind: 'seed' }
  const wasAlive = Object.values(previous.rosters).filter((ids) => Array.isArray(ids) && ids.length > 0).length
  const chopped = current
    .filter((c) => c.playerIds.length === 0)
    .flatMap((c) => {
      const before = previous.rosters[c.teamKey]
      return Array.isArray(before) && before.length > 0 ? [{ teamKey: c.teamKey, releasedIds: [...before] }] : []
    })
  if (chopped.length === 0) return { kind: 'none' }
  const aliveNow = current.filter((c) => c.playerIds.length > 0).length
  if (aliveNow === 0 || chopped.length > Math.max(1, Math.floor(wasAlive / 2))) {
    return { kind: 'reset', emptied: chopped.length, wasAlive }
  }
  return { kind: 'chop', chopped }
}

export function snapshotOf(current: ReadonlyArray<{ teamKey: string; playerIds: readonly string[] }>): ChopRosterSnapshot {
  const rosters: Record<string, string[]> = {}
  for (const c of current) rosters[c.teamKey] = [...c.playerIds].sort()
  return { v: 1, rosters }
}

/** True when the snapshot would change — so an unchanged league writes nothing. */
export function snapshotChanged(previous: ChopRosterSnapshot | null, next: ChopRosterSnapshot): boolean {
  return JSON.stringify(previous ?? null) !== JSON.stringify(next)
}

/* ── Keys ─────────────────────────────────────────────────────────────────────────────────────── */

/** Where a league's roster snapshot is kept in `SportsDataCache`. */
export function chopSnapshotKey(leagueId: string): string {
  return `chop-release:rosters:${leagueId}`
}

/**
 * `chop-release:<leagueId>:<season>-w<week>` — one per user per league per week; the dispatcher and
 * the claim both append `:<userId>`.
 */
export function chopReleaseDedupeKey(leagueId: string, season: number | string, week: number): string {
  return `chop-release:${leagueId}:${season}-w${week}`
}

/* ── Whether you asked not to hear it ─────────────────────────────────────────────────────────── */

/** The Chimmy alert controls' Waivers class, this type, or this league — the engine's own rule. */
export function chopReleaseMutedBy(
  prefs: ChimmyAlertUserPreferences | null | undefined,
  leagueId?: string | null,
): ChimmyAlertPreferenceMuteReason | null {
  return preferenceMuteReason({ class: 'waiver', type: CHOP_RELEASE_ALERT_TYPE, leagueId: leagueId ?? null }, prefs)
}

/* ── What it says ─────────────────────────────────────────────────────────────────────────────── */

const money = (n: number) => `$${Math.round(n)}`

function shortName(name: string, max = 32): string {
  const t = name.trim() || 'your league'
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function teamsPhrase(names: readonly string[]): string {
  const n = names.map((x) => x.trim() || 'A team')
  if (n.length <= 1) return `${n[0] ?? 'A team'} was chopped`
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]} were chopped`
}

function benches(b: FaabPlanBid): string {
  return b.displacedName ? ` (benches ${b.displacedName})` : ''
}

export const CHOP_RELEASE_PROMPT = 'A team was just chopped in this league. What should I bid on waivers?'

export function chopReleaseHref(leagueId: string, from: ProactiveFrom = 'chop_release'): string {
  return chimmyChatHref({ prompt: CHOP_RELEASE_PROMPT, leagueId, from })
}

export type ChopReleaseMessage = {
  title: string
  body: string
  actionHref: string
  /** What the message told the user to do — for the notification's meta and the run's report. */
  kind: 'bid' | 'name_only' | 'save' | 'nothing_released'
  /** The released upgrades named (ids), best first. */
  namedIds: string[]
  email: { subject: string; html: string }
}

/**
 * The message for one surviving member, or null when the plan gives nothing true to say (it was
 * refused, found no pool, could not calculate, or is not an elimination plan).
 */
export function renderChopRelease(args: {
  leagueId: string
  leagueName: string
  choppedTeamNames: readonly string[]
  releasedIds: readonly string[]
  plan: FaabBidPlan
  baseUrl?: string | null
}): ChopReleaseMessage | null {
  const { plan } = args
  if (plan.status !== 'ok') return null
  if (plan.outcome !== 'bid' && plan.outcome !== 'save') return null

  const released = new Set(args.releasedIds)
  const n = released.size
  const lead = `${teamsPhrase(args.choppedTeamNames)} — ${n} player${n === 1 ? '' : 's'} hit waivers.`
  const league = shortName(args.leagueName)
  const hold = plan.remaining != null ? `hold your ${money(plan.remaining)}` : 'hold your FAAB'

  const named = plan.outcome === 'bid' ? plan.upgrades.filter((b) => released.has(b.id)) : []
  const shown = named.slice(0, CHOP_RELEASE_MAX_BIDS)
  const more = named.length - shown.length
  const moreLine = more > 0 ? ` (+${more} more in your plan.)` : ''

  let kind: ChopReleaseMessage['kind']
  let title: string
  let action: string
  if (plan.outcome === 'save') {
    kind = 'save'
    title = `Chop in ${league}: nothing to chase`
    action = `Nothing released improves your lineup — ${hold}.`
  } else if (shown.length === 0) {
    // The plan wants bids, just not on anyone this roster released: say that, and no figure.
    kind = 'nothing_released'
    title = `Chop in ${league}: nothing to chase`
    action = 'Nothing released improves your lineup. Your full bid plan is a tap away.'
  } else if (shown.every((b) => b.ceiling != null)) {
    kind = 'bid'
    title = `Chop in ${league}: Chimmy's bid plan`
    const [first, ...rest] = shown
    const parts = [
      `bid up to ${money(first!.ceiling!)} on ${first!.name}${benches(first!)}`,
      ...rest.map((b) => `${money(b.ceiling!)} on ${b.name}${benches(b)}`),
    ]
    action = `Your plan: ${parts.join(', ')}.${moreLine}`
  } else {
    // No ceiling means the plan had no remaining FAAB on file — name them, state no dollar figure.
    kind = 'name_only'
    title = `Chop in ${league}: upgrades on the wire`
    action = `Upgrades for you: ${shown.map((b) => `${b.name}${benches(b)}`).join(', ')}.${moreLine} Your remaining FAAB isn't on file, so no bid amounts.`
  }

  const body = `${lead} ${action}`
  const base = args.baseUrl ?? ''
  const html = renderDigestEmail({
    eyebrow: `Chimmy · Chop in ${args.leagueName.trim() || 'your league'}`,
    title: teamsPhrase(args.choppedTeamNames),
    sub:
      "Every released player was priced under this league's scoring against your best legal lineup. Rosters as of the last sync, and unrostered isn't always claimable — confirm on Sleeper before you bid.",
    bodyHtml:
      `<div style="margin:0 0 12px 0;color:#d4d4d8">${escapeHtml(lead)}</div>` +
      `<div style="margin:0 0 12px 0;color:#ffffff;font-weight:700">${escapeHtml(action)}</div>` +
      pushSetupEmailLine(escapeHtml(base)),
    cta: { href: `${base}${chopReleaseHref(args.leagueId, 'chop_release_email')}`, label: 'Ask Chimmy for the full plan' },
    baseUrl: args.baseUrl ?? null,
  })

  return {
    title,
    body,
    actionHref: chopReleaseHref(args.leagueId),
    kind,
    namedIds: shown.map((b) => b.id),
    email: { subject: title, html },
  }
}
