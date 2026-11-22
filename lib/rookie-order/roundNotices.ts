/**
 * ROOKIE ORDER ROUND NOTICES — the live rookie order (./liveRookieOrderService.ts) refreshes itself as
 * the playoffs go, and after each round that locks more picks the commissioner is told which ones, and
 * (when the commissioner chose it) the league chat is too. Part of the AF Commissioner automation the
 * live order already sits behind (`commissioner_automation`).
 *
 * Stored beside the live order's other settings, at `League.settings.rookie_draft_order.live`:
 *   roundNotices      { notify, chat } — the commissioner's choices; notify defaults ON, chat OFF.
 *   lastRoundNotice   { season, phase, lockedTeamIds, at } — what the last notice covered, written by
 *                     the sweep, so a round is announced once.
 *
 * A notice fires when a team's pick becomes locked that was not locked at the last notice, or when the
 * order turns final. A pick never unlocks once locked, so the set only grows within a season; a new
 * season starts from nothing. Pure.
 */
import type { RookieOrderResult, RookieOrderSlot } from './rookieOrderEngine'

export type RoundNoticeSettings = { notify: boolean; chat: boolean }

export type LastRoundNotice = {
  /** The season whose results the order came from. */
  season: number
  phase: RookieOrderResult['phase']
  lockedTeamIds: string[]
  at: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function liveRookieOrderRaw(leagueSettings: unknown): Record<string, unknown> {
  return asRecord(asRecord(asRecord(leagueSettings).rookie_draft_order).live)
}

export function readRoundNoticeSettings(leagueSettings: unknown): RoundNoticeSettings {
  const r = asRecord(liveRookieOrderRaw(leagueSettings).roundNotices)
  return { notify: r.notify !== false, chat: r.chat === true }
}

export function parseRoundNoticeSettings(raw: unknown, fallback: RoundNoticeSettings): RoundNoticeSettings {
  const r = asRecord(raw)
  return {
    notify: typeof r.notify === 'boolean' ? r.notify : fallback.notify,
    chat: typeof r.chat === 'boolean' ? r.chat : fallback.chat,
  }
}

export function readLastRoundNotice(leagueSettings: unknown): LastRoundNotice | null {
  const r = asRecord(liveRookieOrderRaw(leagueSettings).lastRoundNotice)
  if (typeof r.season !== 'number' || !Array.isArray(r.lockedTeamIds)) return null
  const phase = r.phase === 'final' || r.phase === 'playoffs' || r.phase === 'regular_season' ? r.phase : 'playoffs'
  return { season: r.season, phase, lockedTeamIds: r.lockedTeamIds.map(String), at: typeof r.at === 'string' ? r.at : '' }
}

export type RoundNoticeChange = {
  season: number
  /** Picks locked since the last notice, in draft order. */
  newlyLocked: RookieOrderSlot[]
  lockedCount: number
  total: number
  /** The order turned final with this notice. */
  final: boolean
  /** Unique per step of the season: the notification's dedupe key and the chat post's id. */
  key: string
  next: LastRoundNotice
}

/** What changed since the last notice, or null when there is nothing to announce. */
export function roundNoticeChange(input: {
  leagueId: string
  season: number
  result: Pick<RookieOrderResult, 'phase' | 'slots'>
  last: LastRoundNotice | null
  now?: Date
}): RoundNoticeChange | null {
  const { result } = input
  if (result.phase === 'regular_season') return null
  const prior = input.last && input.last.season === input.season ? input.last : null
  const before = new Set(prior?.lockedTeamIds ?? [])
  const locked = result.slots.filter((s) => s.status === 'locked')
  const newlyLocked = locked.filter((s) => !before.has(s.teamId)).sort((a, b) => a.slot - b.slot)
  const final = result.phase === 'final' && prior?.phase !== 'final'
  if (newlyLocked.length === 0 && !final) return null
  return {
    season: input.season,
    newlyLocked,
    lockedCount: locked.length,
    total: result.slots.length,
    final,
    key: `rookie-order-round:${input.leagueId}:${input.season}:${locked.length}${final ? ':final' : ''}`,
    next: {
      season: input.season,
      phase: result.phase,
      lockedTeamIds: [...new Set([...before, ...locked.map((s) => s.teamId)])],
      at: (input.now ?? new Date()).toISOString(),
    },
  }
}

export type NoticeLanguage = 'en' | 'es'

export function pickLabel(slot: number): string {
  return `1.${String(slot).padStart(2, '0')}`
}

const MAX_LISTED = 6

function listPicks(slots: readonly RookieOrderSlot[], lang: NoticeLanguage): string {
  const shown = slots.slice(0, MAX_LISTED).map((s) => `${pickLabel(s.slot)} ${s.name}`)
  const more = slots.length - shown.length
  if (more > 0) shown.push(lang === 'es' ? `y ${more} más` : `and ${more} more`)
  return shown.join(', ')
}

/** The commissioner's notice and the chat post, in the reader's language. */
export function roundNoticeText(change: RoundNoticeChange, draftSeason: number, lang: NoticeLanguage): { title: string; body: string; chat: string } {
  const picks = listPicks(change.newlyLocked, lang)
  if (lang === 'es') {
    if (change.final) {
      return {
        title: `El orden del draft de novatos ${draftSeason} es final`,
        body: `${picks ? `Se fijaron: ${picks}. ` : ''}Las ${change.total} selecciones están fijadas y guardadas; el draft de novatos ${draftSeason} usará este orden.`,
        chat: `El orden del draft de novatos ${draftSeason} es final.${picks ? ` Últimas selecciones fijadas: ${picks}.` : ''}`,
      }
    }
    return {
      title: 'Orden del draft de novatos actualizado',
      body: `Se fijaron: ${picks}. ${change.lockedCount} de ${change.total} selecciones están fijadas; el resto depende de los playoffs.`,
      chat: `Orden del draft de novatos ${draftSeason}: ${picks} ya están fijadas (${change.lockedCount} de ${change.total}).`,
    }
  }
  if (change.final) {
    return {
      title: `The ${draftSeason} rookie draft order is final`,
      body: `${picks ? `Locked: ${picks}. ` : ''}All ${change.total} picks are set and saved; the ${draftSeason} rookie draft will use this order.`,
      chat: `The ${draftSeason} rookie draft order is final.${picks ? ` Last picks locked: ${picks}.` : ''}`,
    }
  }
  return {
    title: 'Rookie draft order updated',
    body: `Locked: ${picks}. ${change.lockedCount} of ${change.total} picks are set; the rest depend on the playoffs.`,
    chat: `${draftSeason} rookie draft order: ${picks} ${change.newlyLocked.length === 1 ? 'is' : 'are'} locked in (${change.lockedCount} of ${change.total}).`,
  }
}

/** For Chimmy: the round notices in one line, or null when automation is off. */
export function describeRoundNotices(input: { automation: boolean; settings: RoundNoticeSettings; last: LastRoundNotice | null }): string | null {
  if (!input.automation) return null
  const where = input.settings.notify && input.settings.chat ? 'tells the commissioner and posts in league chat' : input.settings.notify ? 'tells the commissioner' : input.settings.chat ? 'posts in league chat' : 'saves itself without announcing'
  const last = input.last
    ? ` Last update: ${input.last.lockedTeamIds.length} picks locked${input.last.phase === 'final' ? ', order final' : ''}${input.last.at ? ` (${input.last.at.slice(0, 10)})` : ''}.`
    : ''
  return `The live rookie draft order updates itself after each playoff round and ${where} when picks lock.${last}`
}
