/**
 * What the island banner shows for a Survivor league, from its summary
 * (`/api/leagues/[leagueId]/survivor/summary`). Pure, so the scene, the headline and the clock can be
 * tested without rendering.
 */
import type { SurvivorSummary } from '@/components/survivor/types'
import { SURVIVOR_ISLAND_SCENES, type SurvivorIslandScene } from '@/lib/survivor/survivorSettingsScreen'

export type IslandScene = SurvivorIslandScene

export type IslandMoment =
  | { kind: 'pre_draft' }
  | { kind: 'finale_open' }
  | { kind: 'crowned'; winnerName: string | null }
  | { kind: 'reading'; tribeName: string | null }
  | { kind: 'council'; tribeName: string | null; mine: boolean }
  | { kind: 'challenge'; title: string | null }
  | { kind: 'merged' }
  | { kind: 'camp' }

export type IslandClock = { at: string; label: 'council' | 'challenge' | 'jury' }

export type IslandView = {
  scene: IslandScene
  moment: IslandMoment
  clock: IslandClock | null
  week: number | null
  sport: string | null
  myTribe: { id: string; name: string; color: string | null } | null
  castawaysLeft: number
  castawaysTotal: number
}

const isOpenCouncil = (c: SurvivorSummary['council']) => Boolean(c && !c.closedAt && !c.isRevealed)
const isReading = (c: SurvivorSummary['council']) => Boolean(c && c.isRevealed && c.revealComplete === false)

/**
 * The banner for this moment. The commissioner can pin a scene on Island control
 * (summary.config.islandScene); a pinned scene replaces the art only, so the headline and the clock
 * still follow the season. 'auto', a missing value or an unknown one follows the season too.
 */
export function islandView(s: SurvivorSummary | null | undefined): IslandView {
  const v = seasonView(s)
  const pinned = s?.config?.islandScene
  return pinned && (SURVIVOR_ISLAND_SCENES as readonly string[]).includes(pinned) ? { ...v, scene: pinned as IslandScene } : v
}

function seasonView(s: SurvivorSummary | null | undefined): IslandView {
  if (!s) return { scene: 'beach', moment: { kind: 'camp' }, clock: null, week: null, sport: null, myTribe: null, castawaysLeft: 0, castawaysTotal: 0 }
  const tribeName = (id: string | null | undefined) => (id ? s.tribes.find((t) => t.id === id)?.name ?? null : null)
  const names = s.rosterDisplayNames ?? {}
  const formed = s.tribes.some((t) => t.members.length > 0)
  const left = s.tribes.reduce((n, t) => n + t.members.length, 0)
  const out = s.tribes.reduce((n, t) => n + (t.outMembers?.length ?? 0), 0)
  const mine = s.myTribeId ? s.tribes.find((t) => t.id === s.myTribeId) ?? null : null
  const base = {
    week: s.currentWeek > 0 ? s.currentWeek : null,
    sport: s.seasonCalendar?.sport ?? null,
    myTribe: mine ? { id: mine.id, name: mine.name, color: mine.colorHex ?? null } : null,
    castawaysLeft: left,
    castawaysTotal: left + out,
  }
  const openChallenge = s.challenges.find((c) => c.status === 'open') ?? null

  if (s.finale?.winnerRosterId) return { ...base, scene: 'finale', moment: { kind: 'crowned', winnerName: names[s.finale.winnerRosterId] ?? null }, clock: null }
  if (s.finale?.open) return { ...base, scene: 'finale', moment: { kind: 'finale_open' }, clock: null }
  if (!formed) return { ...base, scene: 'beach', moment: { kind: 'pre_draft' }, clock: null }
  if (isReading(s.council)) return { ...base, scene: 'tribal', moment: { kind: 'reading', tribeName: tribeName(s.council?.attendingTribeId) }, clock: null }
  if (isOpenCouncil(s.council) && s.council) {
    const attending = s.council.attendingTribeId
    return {
      ...base,
      scene: 'tribal',
      moment: { kind: 'council', tribeName: tribeName(attending), mine: attending == null || attending === s.myTribeId },
      clock: { at: s.council.voteDeadlineAt, label: 'council' },
    }
  }
  if (openChallenge) {
    return {
      ...base,
      scene: s.merged ? 'merge' : 'jungle',
      moment: { kind: 'challenge', title: openChallenge.title ?? null },
      clock: openChallenge.lockAt ? { at: openChallenge.lockAt, label: 'challenge' } : null,
    }
  }
  if (s.merged) return { ...base, scene: 'merge', moment: { kind: 'merged' }, clock: null }
  return { ...base, scene: 'beach', moment: { kind: 'camp' }, clock: null }
}

/** "2d 06:15", "06:15", or null once the moment has passed. */
export function clockText(at: string, now: number): string | null {
  const ms = Date.parse(at) - now
  if (!Number.isFinite(ms) || ms <= 0) return null
  const mins = Math.floor(ms / 60_000)
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  const hm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  return d > 0 ? `${d}d ${hm}` : hm
}

const TRIBE_FALLBACK = ['#3f9fc4', '#c8613a', '#7cae5a', '#9b83d6']

/** A tribe's colour: the commissioner's, else a fixed one per slot so tribes never share a colour by accident. */
export function tribeColor(t: { colorHex?: string | null; slotIndex: number }): string {
  const c = t.colorHex?.trim()
  return c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : TRIBE_FALLBACK[Math.abs(t.slotIndex) % TRIBE_FALLBACK.length]
}

export type SportBall = 'football' | 'basketball' | 'puck' | 'baseball' | 'soccer' | null

export function sportBall(sport: string | null | undefined): SportBall {
  const s = (sport ?? '').toUpperCase()
  if (s === 'NFL' || s === 'NCAAF' || s === 'NCAAFB') return 'football'
  if (s === 'NBA' || s === 'NCAAB' || s === 'NCAABB' || s === 'WNBA') return 'basketball'
  if (s === 'NHL') return 'puck'
  if (s === 'MLB') return 'baseball'
  if (s === 'SOCCER' || s === 'MLS' || s === 'EPL') return 'soccer'
  return null
}
