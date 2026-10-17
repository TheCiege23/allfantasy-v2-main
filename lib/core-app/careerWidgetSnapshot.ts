import type { CareerAward } from './careerAwards'
import { buildLegacyStakes } from './careerMilestones'
import { isUnfiltered, type CareerData } from './careerModel'

/**
 * What the iOS "Your career" widget shows (live-career plan, phase 6) — built from the same
 * `CareerData`, stakes and milestones the Career screen renders, so the home screen can never
 * show a number the app does not.
 *
 * ⚠ FLAT AND VERSIONED. The Swift side (`CareerSnapshot` in ios-app/ios/App/CareerWidget) decodes
 * these exact keys; a renamed key there silently shows the empty "open the app" state. Bump `v`
 * and teach the widget the new shape before changing one.
 *
 * ⚠ WHOLE CAREER ONLY. A filtered board (one platform, one era) would put "2 titles" on the home
 * screen for someone with six. Null under a filter: the widget keeps its last whole-career snapshot.
 */
export type CareerWidgetSnapshot = {
  v: 1
  handle: string | null
  level: number | null
  levelName: string | null
  titles: number
  record: string | null
  nextTitle: string | null
  nextShort: string | null
  stakeTitle: string | null
  stakeRing: number | null
  updatedAt: string
}

export function buildCareerWidgetSnapshot(
  data: CareerData,
  awards: CareerAward[],
  now: Date,
): CareerWidgetSnapshot | null {
  if (!isUnfiltered(data.filter)) return null
  const legacy = buildLegacyStakes(data, awards)
  const stake = legacy.stakes.at(0) ?? null
  const next = legacy.milestones.at(0) ?? null
  return {
    v: 1,
    handle: data.handle,
    level: data.level,
    levelName: data.levelName,
    titles: data.championships,
    record: data.games > 0 ? `${data.wins}-${data.losses}${data.ties ? `-${data.ties}` : ''}` : null,
    nextTitle: next?.title ?? null,
    nextShort: next?.short ?? null,
    stakeTitle: stake?.title ?? null,
    stakeRing: stake?.ringNumber ?? null,
    updatedAt: now.toISOString(),
  }
}

/** The snapshot without its timestamp — two renders of the same career compare equal. */
export function snapshotFingerprint(s: CareerWidgetSnapshot): string {
  const { updatedAt: _ignored, ...rest } = s
  void _ignored
  return JSON.stringify(rest)
}
