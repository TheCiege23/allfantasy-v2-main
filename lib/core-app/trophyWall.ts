import type { AwardTier, CareerAward } from './careerAwards'
import { buildLegacyStakes } from './careerMilestones'
import type { CareerData } from './careerModel'

/**
 * The trophy wall (live-career plan, phase 5 follow-up) — the Hall of Fame as a gallery: a plaque
 * per title, one open plaque for the ring still in play, and an awards cabinet.
 *
 * ⚠ EVERY PLAQUE IS A RECORDED TITLE. Same source as the list it sits beside (`data.titles`), with
 * the same refusal: no championship-week score, because none is stored (see CareerViews.tsx). The
 * "streak" badge counts consecutive recorded titles in the same league and nothing else.
 *
 * ⚠ THE OPEN PLAQUE IS A CONDITIONAL. It comes from the Career screen's own legacy stakes, so it
 * exists only for a live league on the unfiltered board, and it is styled and worded as "if you
 * win" — a dashed frame, never a ring.
 */

export type Plaque = {
  key: string
  season: number
  leagueName: string
  platform: string
  record: string | null
  settingsLabel: string | null
  /** Consecutive titles in this league ending with this season; 1 for a lone title. */
  streak: number
  /** The newest season the career has — the plaque gets the accent. */
  latest: boolean
}

export type OpenPlaque = {
  title: string
  ringNumber: number
  record: string | null
  platform: string
}

export type Medal = {
  key: string
  name: string
  tier: AwardTier
  evidence: string
  earnedSeason: number
}

export type TrophyWallData = {
  plaques: Plaque[]
  openSlot: OpenPlaque | null
  medals: Medal[]
  counts: { titles: number; finals: number | null; playoffs: number; awards: number }
}

const TIER_ORDER: Record<AwardTier, number> = { platinum: 4, gold: 3, silver: 2, bronze: 1 }

const norm = (s: string) => s.trim().toLowerCase()

export function buildTrophyWall(data: CareerData, awards: CareerAward[]): TrophyWallData {
  const titles = [...data.titles].sort((a, b) => b.season - a.season || a.leagueName.localeCompare(b.leagueName))
  const won = new Set(titles.map((t) => `${norm(t.leagueName)}|${t.season}`))
  const newest = titles.at(0)?.season ?? null

  const plaques: Plaque[] = titles.map((t, i) => {
    let streak = 1
    while (won.has(`${norm(t.leagueName)}|${t.season - streak}`)) streak += 1
    return {
      key: `${t.season}|${norm(t.leagueName)}|${i}`,
      season: t.season,
      leagueName: t.leagueName,
      platform: t.platform,
      record: t.record,
      settingsLabel: t.settingsLabel,
      streak,
      latest: newest != null && t.season === newest,
    }
  })

  const stake = buildLegacyStakes(data, awards).stakes.at(0) ?? null
  const openSlot: OpenPlaque | null = stake
    ? { title: stake.title, ringNumber: stake.ringNumber, record: stake.record, platform: stake.platform }
    : null

  const medals: Medal[] = [...awards]
    .sort((a, b) => TIER_ORDER[b.tier] - TIER_ORDER[a.tier] || b.earnedSeason - a.earnedSeason || a.name.localeCompare(b.name))
    .map((a) => ({ key: a.key, name: a.name, tier: a.tier, evidence: a.evidence, earnedSeason: a.earnedSeason }))

  return {
    plaques,
    openSlot,
    medals,
    counts: {
      titles: titles.length,
      finals: data.accomplishments.finals,
      playoffs: data.accomplishments.playoffAppearances,
      awards: awards.length,
    },
  }
}

/** `?layout=` on the Hall of Fame: force the wall or the list; absent lets the device decide. */
export type HallLayout = 'wall' | 'list' | null

export function parseHallLayout(raw: unknown): HallLayout {
  return raw === 'wall' || raw === 'list' ? raw : null
}
