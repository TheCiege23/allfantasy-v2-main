/**
 * Demo league service — the one entry point every demo page and API route uses.
 *
 *   config → load real source → stable aliases → allowlist view → redactor scrub → leak assert
 *
 * The leak assertion is the last thing before any response: the serialized view is
 * scanned for every real identifier of the source league, and a non-zero count FAILS
 * CLOSED (the demo shows "unavailable") rather than shipping. Logs carry counts only.
 *
 * A short in-process cache (per source league) keeps a burst of public traffic from
 * re-reading the source on every request. Sixty seconds is far below the source's own
 * sync cadence, so the demo stays as live as the league itself.
 */
import 'server-only'
import { getDemoSourceConfig, ensureTeamAliases } from './config'
import { loadDemoSource } from './source'
import { buildDemoLeagueView } from './view'
import { DemoRedactor } from './redactor'
import type { DemoLeagueView, DemoUnavailable } from './types'

const CACHE_TTL_MS = 60_000

export const NEUTRAL_PLACEHOLDER = '[name hidden]'

export type DemoContext = {
  view: DemoLeagueView
  /** Replaces a real identifier with its ALIAS. For data we built ourselves. */
  redactor: DemoRedactor
  /**
   * Replaces a real identifier with a NEUTRAL placeholder. For text a VISITOR supplied, or a
   * model echoed back: mapping a typed real name to its alias would confirm who the alias is.
   */
  neutralRedactor: DemoRedactor
}

type CacheEntry = { at: number; sourceId: string; ctx: DemoContext }
let cache: CacheEntry | null = null

/** Drop the cached view (after the source changes, and in tests). */
export function resetDemoCache(): void {
  cache = null
}

export async function getDemoContext(): Promise<DemoContext | DemoUnavailable> {
  const cfg = await getDemoSourceConfig()
  if (!cfg) return { demo: true, available: false, reason: 'not_configured' }

  if (cache && cache.sourceId === cfg.leagueId && Date.now() - cache.at < CACHE_TTL_MS) return cache.ctx

  try {
    const src = await loadDemoSource(cfg.leagueId)
    if (!src) return { demo: true, available: false, reason: 'source_missing' }

    const aliases = await ensureTeamAliases(cfg.leagueId, src.teams.map((t) => t.key))
    const built = buildDemoLeagueView(src, aliases)
    const redactor = new DemoRedactor(built.sensitive, built.protectedStrings)

    let view = redactor.scrubDeep(built.view)
    if (redactor.countLeaks(JSON.stringify(view)) > 0) {
      // Free-text commissioner headlines are the only field not built from an alias.
      view = { ...view, alerts: view.alerts.filter((a) => a.kind !== 'commissioner') }
    }
    const leaks = redactor.countLeaks(JSON.stringify(view))
    if (leaks > 0) {
      console.error('[demo-league] refusing to serve: identifiers survived anonymization', { count: leaks })
      return { demo: true, available: false, reason: 'error' }
    }
    if (redactor.stats.replaced > 0) {
      console.warn('[demo-league] redactor replaced identifiers the allowlist let through', {
        count: redactor.stats.replaced,
      })
    }

    const neutralRedactor = new DemoRedactor(
      built.sensitive.map((t) => ({ value: t.value, replacement: NEUTRAL_PLACEHOLDER })),
      built.protectedStrings,
    )
    const ctx: DemoContext = { view, redactor, neutralRedactor }
    cache = { at: Date.now(), sourceId: cfg.leagueId, ctx }
    return ctx
  } catch (error) {
    // Never log the error object itself: a Prisma error can echo query values.
    console.error('[demo-league] build failed', { name: error instanceof Error ? error.name : 'unknown' })
    return { demo: true, available: false, reason: 'error' }
  }
}

export async function getDemoLeagueView(): Promise<DemoLeagueView | DemoUnavailable> {
  const ctx = await getDemoContext()
  return 'view' in ctx ? ctx.view : ctx
}

export function isDemoUnavailable(v: unknown): v is DemoUnavailable {
  return Boolean(v && typeof v === 'object' && (v as { available?: unknown }).available === false)
}

/**
 * Serialize a response body for a demo API route, re-scrubbing and re-asserting on the
 * FINAL bytes — so anything a route adds after the view (a Chimmy answer, a trade
 * verdict) passes the same wall.
 */
export function demoJsonBody(ctx: DemoContext, body: unknown): { ok: true; text: string } | { ok: false } {
  const scrubbed = ctx.redactor.scrubDeep(body)
  const text = JSON.stringify(scrubbed)
  const leaks = ctx.redactor.countLeaks(text)
  if (leaks > 0) {
    console.error('[demo-league] response blocked: identifiers survived scrub', { count: leaks })
    return { ok: false }
  }
  return { ok: true, text }
}
