import 'server-only'

/**
 * Live rookie order: settings, entitlement and the saved final order.
 *
 * Tiers (owner decision, docs/AF_COMMISSIONER_SETTINGS_SPEC.md §1.1):
 *   Free           — any commissioner can CALCULATE the live order on demand.
 *   AF Commissioner — turns on automation: the final order is saved when the title game is
 *                     decided and the next rookie draft is seated from it automatically.
 *
 * ⚠ A LAPSED SUBSCRIPTION NEVER BREAKS THE SEASON IT WAS ON. Automation turned on while entitled
 * keeps running for that season (`enabledForSeason`) even if the plan lapses or the league is
 * handed to a non-subscriber; it stops at rollover until a commissioner subscribes again.
 *
 * Stored at `League.settings.rookie_draft_order.live`, beside the older `mode`/`enabled` keys of
 * `lib/league/rookieDraftOrder.ts`, which keep working untouched.
 */

import { prisma } from '@/lib/prisma'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import {
  computeRookieOrder,
  DEFAULT_ROOKIE_ORDER_CONFIG,
  type NonPlayoffOrderMethod,
  type PlayoffOrderMethod,
  type RookieOrderConfig,
  type RookieOrderResult,
  type WithinRoundOrder,
} from './rookieOrderEngine'
import { loadRookieOrderInput, type MaxPfInfo } from './loadRookieOrderInput'

export const LIVE_ROOKIE_ORDER_FEATURE = 'commissioner_automation' as const

export type SavedFinalOrder = {
  /** The season whose results produced this order. The order is for the season after it. */
  basedOnSeason: number
  slots: { slot: number; teamId: string; rosterId: string | null; name: string }[]
  savedAt: string
}

export type LiveRookieOrderSettings = {
  enabled: boolean
  config: RookieOrderConfig
  /** The season automation was switched on in while the league was entitled. */
  enabledForSeason: number | null
  finalOrder: SavedFinalOrder | null
}

const NON_PLAYOFF: readonly NonPlayoffOrderMethod[] = ['reverse_max_pf', 'reverse_points_for', 'reverse_record']
const PLAYOFF: readonly PlayoffOrderMethod[] = ['finish_then_seed', 'reverse_record', 'reverse_max_pf']
const WITHIN: readonly WithinRoundOrder[] = ['worse_seed', 'reverse_max_pf', 'reverse_points_for']

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

export function parseRookieOrderConfig(raw: unknown): RookieOrderConfig {
  const r = asRecord(raw)
  return {
    nonPlayoff: pick(NON_PLAYOFF, r.nonPlayoff, DEFAULT_ROOKIE_ORDER_CONFIG.nonPlayoff),
    playoff: pick(PLAYOFF, r.playoff, DEFAULT_ROOKIE_ORDER_CONFIG.playoff),
    withinRound: pick(WITHIN, r.withinRound, DEFAULT_ROOKIE_ORDER_CONFIG.withinRound),
  }
}

export function readLiveRookieOrderSettings(leagueSettings: unknown): LiveRookieOrderSettings {
  const live = asRecord(asRecord(asRecord(leagueSettings).rookie_draft_order).live)
  const final = asRecord(live.finalOrder)
  const finalOrder =
    Array.isArray(final.slots) && typeof final.basedOnSeason === 'number'
      ? (final as unknown as SavedFinalOrder)
      : null
  return {
    enabled: live.enabled === true,
    config: parseRookieOrderConfig(live.config),
    enabledForSeason: typeof live.enabledForSeason === 'number' ? live.enabledForSeason : null,
    finalOrder,
  }
}

/** The league is entitled when its commissioner holds AF Commissioner (or a plan that includes it). */
export async function isLeagueEntitledToLiveRookieOrder(commissionerUserId: string): Promise<boolean> {
  const decision = await new FeatureGateService().evaluateUserFeatureAccess(commissionerUserId, LIVE_ROOKIE_ORDER_FEATURE)
  return decision.allowed
}

async function writeLiveSettings(leagueId: string, next: LiveRookieOrderSettings): Promise<void> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const settings = asRecord(league?.settings)
  const rookie = asRecord(settings.rookie_draft_order)
  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: { ...settings, rookie_draft_order: { ...rookie, live: next } } as never },
  })
}

export type LiveRookieOrderView = {
  /** The season the order is FOR. */
  draftSeason: number
  basedOnSeason: number
  source: 'native' | 'imported'
  /** The league's platform (sleeper, espn, …) — imported leagues apply the order there by hand. */
  platform: string | null
  result: RookieOrderResult
  notes: string[]
  /** Native leagues: where Max PF came from (lib/rookie-order/loadRookieOrderInput.ts). */
  maxPfInfo?: MaxPfInfo
  settings: LiveRookieOrderSettings
  /** Automation can run: entitled now, or switched on while entitled for this season. */
  automationActive: boolean
}

/**
 * Compute the live order and, when automation is active and the order is final, save it so the
 * next rookie draft is seated from it after rollover.
 */
export async function refreshLiveRookieOrder(
  leagueId: string,
  opts: { config?: RookieOrderConfig; entitled?: boolean } = {},
): Promise<LiveRookieOrderView | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, settings: true, platform: true } })
  if (!league) return null
  const loaded = await loadRookieOrderInput(leagueId)
  if (!loaded) return null

  const settings = readLiveRookieOrderSettings(league.settings)
  const config = opts.config ?? settings.config
  const result = computeRookieOrder({ ...loaded.input, config })

  const entitled = opts.entitled ?? (await isLeagueEntitledToLiveRookieOrder(league.userId))
  const automationActive = settings.enabled && (entitled || settings.enabledForSeason === loaded.season)

  let saved = settings
  const alreadySaved = settings.finalOrder?.basedOnSeason === loaded.season
  if (automationActive && result.phase === 'final' && !alreadySaved && !opts.config) {
    saved = {
      ...settings,
      finalOrder: {
        basedOnSeason: loaded.season,
        slots: result.slots.map((s) => ({
          slot: s.slot,
          teamId: s.teamId,
          rosterId: loaded.rosterIdForTeam.get(s.teamId) ?? null,
          name: s.name,
        })),
        savedAt: new Date().toISOString(),
      },
    }
    await writeLiveSettings(leagueId, saved)
  }

  return {
    draftSeason: loaded.season + 1,
    basedOnSeason: loaded.season,
    source: loaded.source,
    platform: league.platform ?? null,
    result,
    notes: loaded.notes,
    ...(loaded.maxPfInfo ? { maxPfInfo: loaded.maxPfInfo } : {}),
    settings: saved,
    automationActive,
  }
}

export async function saveLiveRookieOrderSettings(
  leagueId: string,
  input: { enabled: boolean; config: RookieOrderConfig; season: number },
): Promise<LiveRookieOrderSettings> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const current = readLiveRookieOrderSettings(league?.settings)
  const next: LiveRookieOrderSettings = {
    ...current,
    enabled: input.enabled,
    config: input.config,
    enabledForSeason: input.enabled ? input.season : current.enabledForSeason,
  }
  await writeLiveSettings(leagueId, next)
  return next
}

/**
 * The slot order the live draft should use, or null to leave the draft's default order alone.
 *
 * Uses the saved final order. It is only ever saved while automation was active, so applying it
 * to the draft that follows is part of the season it came from — a plan that lapsed at rollover
 * does not take back an order that was already earned. An order older than last season is stale
 * and ignored. Any team that cannot be matched to a draft roster means the order is not applied.
 */
export async function resolveLiveRookieDraftSlots(
  leagueId: string,
): Promise<{ slot: number; rosterId: string; displayName: string }[] | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true, settings: true } })
  if (!league) return null
  const settings = readLiveRookieOrderSettings(league.settings)
  if (!settings.enabled) return null

  let finalOrder = settings.finalOrder
  if (!finalOrder) finalOrder = (await refreshLiveRookieOrder(leagueId))?.settings.finalOrder ?? null
  if (!finalOrder || finalOrder.basedOnSeason < league.season - 1) return null

  const slots = finalOrder.slots.map((s) => ({ slot: s.slot, rosterId: s.rosterId, displayName: s.name }))
  if (slots.length === 0 || slots.some((s) => !s.rosterId)) return null
  return slots as { slot: number; rosterId: string; displayName: string }[]
}
