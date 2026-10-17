import { kickoffClock } from './lineupLock'
import { lineupFixLink, type PlatformLink } from './platformLinks'
import type { LeagueImpact, ReplacementOption } from './playerImpact'
import { playerLock, type Kickoffs } from './swapLegality'
import type { MoveTone } from './playerMoves'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/**
 * One start/sit call per league for the player on the card (Phase 3, 2026-09-27).
 *
 * 🛑 COMPUTED, NEVER GENERATED. Every call is arithmetic over numbers already on the card — both
 * sides scored under THAT league's scoring (playerImpact.ts), his designation, and the week's
 * kickoffs — and `why` names them, so a reader can check it. "Ask Chimmy" is the separate, paid
 * conversation; this is the free answer it starts from.
 *
 * The calls, in order:
 *   locked  — his game (or the swap partner's) has kicked off: nothing can move.
 *   sit     — he starts and is ruled out, or a movable bench player out-scores him here.
 *   start   — he is on your bench and out-scores the starter he would replace here.
 *   hold    — the lineup is already right, as far as the numbers go.
 *
 * Client-safe: pure, no prisma.
 */

export type LeagueCallKind = 'sit' | 'start' | 'hold' | 'locked'

export type LeagueCall = {
  leagueId: string
  leagueName: string
  platform: string
  kind: LeagueCallKind
  tone: MoveTone | 'none'
  headline: string
  why: string
  /** The swap that makes the call, when one exists: who comes in and who goes out (Sleeper ids). */
  swap: { startId: string; startName: string; benchId: string; benchName: string } | null
  /**
   * Where to make the change: the platform's VERIFIED lineup screen, or a native league's in-app
   * editor (platformLinks.lineupFixLink) — null when neither exists (MFL / Fantrax / Fleaflicker).
   */
  fix?: PlatformLink | null
}

function fmt(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}`
}

/**
 * When his club's inactive list lands — 90 minutes before its kickoff, the NFL's rule — as an ET
 * clock ("Sun 11:30a ET"), or null when his kickoff is not on file.
 */
export function inactiveListClock(team: string | null, kickoffs: Kickoffs): string | null {
  const club = normalizeTeamAbbrev(team)
  const kickoff = club ? kickoffs[club] : null
  if (!kickoff) return null
  const t = new Date(kickoff).getTime()
  return Number.isFinite(t) ? kickoffClock(new Date(t - 90 * 60_000).toISOString()) : null
}

/** The best bench player who can come in now: BENCH only (IR/taxi cannot start directly), not locked, not himself hurt. */
function bestMovable(options: readonly ReplacementOption[], kickoffs: Kickoffs, nowIso: string): ReplacementOption | null {
  const movable = options.filter((o) => o.from === 'BENCH' && !playerLock(o.team, kickoffs, nowIso).locked && !/\b(out|ir|doubtful|suspended)\b/i.test(o.injuryStatus ?? ''))
  if (movable.length === 0) return null
  return [...movable].sort((a, b) => (b.afPoints ?? -Infinity) - (a.afPoints ?? -Infinity))[0] ?? null
}

export function leagueCall(args: {
  impact: LeagueImpact
  player: { sleeperId: string; name: string; team: string | null }
  /** His readiness tone from the injury feed: 'bad' = ruled out. */
  readinessTone: MoveTone | null
  kickoffs: Kickoffs
  nowIso: string
}): LeagueCall {
  const { impact, player, readinessTone, kickoffs, nowIso } = args
  const base = {
    leagueId: impact.leagueId,
    leagueName: impact.leagueName,
    platform: impact.platform,
    fix: lineupFixLink({
      id: impact.leagueId,
      platform: impact.platform,
      platformLeagueId: impact.platformLeagueId,
      season: impact.season,
      name: impact.leagueName,
      teamId: impact.teamExternalId,
    }),
  }
  const lock = playerLock(player.team, kickoffs, nowIso)
  if (lock.locked) {
    return { ...base, kind: 'locked', tone: 'none', headline: 'Locked', why: `His game ${lock.label} — nothing can move now.`, swap: null }
  }

  if (impact.isStarting) {
    const options = impact.replacements.available ? impact.replacements.data : []
    const best = bestMovable(options, kickoffs, nowIso)
    if (readinessTone === 'bad') {
      return best
        ? {
            ...base,
            kind: 'sit',
            tone: 'bad',
            headline: `Sit him — start ${best.name}`,
            why: `He is ruled out. ${best.name} is your best bench option here${best.afPoints != null ? ` (${best.afPoints.toFixed(1)} projected under this league's scoring)` : ''}.`,
            swap: { startId: best.playerId, startName: best.name, benchId: player.sleeperId, benchName: player.name },
          }
        : { ...base, kind: 'sit', tone: 'bad', headline: 'Sit him', why: 'He is ruled out, and no bench player here can come in for him now.', swap: null }
    }
    if (best && best.delta != null && best.delta > 0) {
      return {
        ...base,
        kind: 'sit',
        tone: 'warn',
        headline: `Start ${best.name} instead`,
        why: `${best.name} projects ${fmt(best.delta)} over him under this league's scoring.`,
        swap: { startId: best.playerId, startName: best.name, benchId: player.sleeperId, benchName: player.name },
      }
    }
    /*
     * ⚠ THE GAME-DAY CASE: QUESTIONABLE, AND NOBODY IS CLEARLY BETTER. "Keep him in" alone leaves the
     * manager to rediscover the plan at 11:30. So the call names the fallback — the best bench player
     * who can still come in — and WHEN the question is answered: the inactive list lands about 90
     * minutes before HIS kickoff. The swap is carried so Ask Chimmy (and a later "swap now") start
     * from the contingency, not from scratch.
     */
    if (readinessTone === 'warn') {
      const inactivesAt = inactiveListClock(player.team, kickoffs)
      const when = inactivesAt ? ` Inactives are announced around ${inactivesAt}.` : ''
      return best
        ? {
            ...base,
            kind: 'hold',
            tone: 'warn',
            headline: `Keep him in — have ${best.name} ready`,
            why: `He is questionable and nobody on your bench out-projects him here. If he is ruled out, start ${best.name}.${when}`,
            swap: { startId: best.playerId, startName: best.name, benchId: player.sleeperId, benchName: player.name },
          }
        : { ...base, kind: 'hold', tone: 'warn', headline: 'Keep him in — no backup', why: `He is questionable and no bench player here can come in for him.${when}`, swap: null }
    }
    return { ...base, kind: 'hold', tone: 'good', headline: 'Keep him in', why: 'Nobody on your bench out-projects him here.', swap: null }
  }

  const so = impact.startOver
  if (so && so.delta > 0 && readinessTone !== 'bad') {
    const partnerLocked = playerLock(so.team, kickoffs, nowIso)
    if (partnerLocked.locked) {
      return { ...base, kind: 'locked', tone: 'none', headline: 'Locked', why: `He would replace ${so.name}, whose game ${partnerLocked.label}.`, swap: null }
    }
    return {
      ...base,
      kind: 'start',
      tone: 'good',
      headline: `Start him over ${so.name}`,
      why: `He projects ${fmt(so.delta)} over ${so.name}${so.slot ? ` at ${so.slot}` : ''} under this league's scoring.`,
      swap: { startId: player.sleeperId, startName: player.name, benchId: so.playerId, benchName: so.name },
    }
  }
  return { ...base, kind: 'hold', tone: 'none', headline: 'Bench is right', why: readinessTone === 'bad' ? 'He is ruled out.' : 'He does not out-project a starter here.', swap: null }
}

/**
 * The prefilled question for "Ask Chimmy" — names the league, the player and the call, so the answer starts where the card left off.
 * In the reader's language: it lands in the composer, where he reads it before sending.
 */
export function chimmyAsk(call: LeagueCall, playerName: string, language: string = 'en'): string {
  if (language === 'es') {
    if (call.kind === 'hold' && call.swap) {
      return `En ${call.leagueName}: ${playerName} es dudoso. ¿Lo mantengo o alineo a ${call.swap.startName}?`
    }
    return call.swap
      ? `En ${call.leagueName}: ¿debería ${call.kind === 'start' ? `alinear a ${playerName} por delante de ${call.swap.benchName}` : `sentar a ${playerName} y alinear a ${call.swap.startName}`} esta semana?`
      : `En ${call.leagueName}: ¿qué debería hacer con ${playerName} esta semana?`
  }
  if (call.kind === 'hold' && call.swap) {
    return `In ${call.leagueName}: ${playerName} is questionable — should I keep him in or start ${call.swap.startName}?`
  }
  return call.swap
    ? `In ${call.leagueName}: should I ${call.kind === 'start' ? `start ${playerName} over ${call.swap.benchName}` : `bench ${playerName} for ${call.swap.startName}`} this week?`
    : `In ${call.leagueName}: what should I do with ${playerName} this week?`
}
