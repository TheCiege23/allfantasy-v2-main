/**
 * Chimmy Phase 3 — KPI Analytics Rollup Helper
 *
 * Pure aggregation over raw `AnalyticsEvent` rows (toolKey = 'chimmy_ai_chat').
 * No raw prompt / response text is ever returned — only counts and rates.
 *
 * Designed for testability: all aggregation logic is in pure functions that
 * accept an array of rows; the DB query lives in the API route.
 */

import { CHIMMY_AI_EVENT_NAMES } from './analytics-events'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal shape of a raw AnalyticsEvent row as returned from Prisma. */
export interface ChimmyRawEventRow {
  event: string
  meta: unknown
  createdAt: Date
}

/** Parsed, normalised view of a single stored event. */
export interface ChimmyNormalisedEvent {
  event_name: string
  surface: string | null
  mode: string | null
  topic: string | null
  follow_up_origin: string | null
  feedback_action: string | null
  date: string // YYYY-MM-DD (UTC)
}

interface ChimmySurfaceKPI {
  surface: string
  messages_sent: number
  responses_rendered: number
  chip_clicks: number
  followup_clicks: number
  helpful: number
  unhelpful: number
}

interface ChimmyModeKPI {
  mode: string
  messages_sent: number
  responses_rendered: number
  helpful: number
  unhelpful: number
}

interface ChimmyTopicKPI {
  topic: string
  messages_sent: number
  helpful: number
  unhelpful: number
}

interface ChimmyDayKPI {
  date: string
  messages_sent: number
  responses_rendered: number
  chip_clicks: number
  followup_clicks: number
  helpful: number
  unhelpful: number
}

interface ChimmyKPIRollup {
  period: { from: string; to: string }
  totals: {
    messages_sent: number
    responses_rendered: number
    chip_clicks: number
    followup_clicks: number
    mode_changes: number
    helpful: number
    unhelpful: number
    helpful_rate: number | null
    chip_click_through_rate: number | null
    followup_click_through_rate: number | null
    formatter_fallback_count: number
    contract_validation_failure_count: number
  }
  by_surface: ChimmySurfaceKPI[]
  by_mode: ChimmyModeKPI[]
  by_topic: ChimmyTopicKPI[]
  by_day: ChimmyDayKPI[]
  event_count: number
}

// ---------------------------------------------------------------------------
// Internal: parse meta JSON safely
// ---------------------------------------------------------------------------

function safeMeta(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as Record<string, unknown>
}

function safeString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

// ---------------------------------------------------------------------------
// normalise: raw DB row → ChimmyNormalisedEvent
// ---------------------------------------------------------------------------

export function normaliseRow(row: ChimmyRawEventRow): ChimmyNormalisedEvent {
  const meta = safeMeta(row.meta)
  const nestedMeta = safeMeta(meta['metadata'])
  return {
    event_name: row.event,
    surface: safeString(meta['surface']),
    mode: safeString(meta['mode']),
    topic: safeString(meta['topic']),
    follow_up_origin: safeString(nestedMeta['promptOrigin']),
    feedback_action: safeString(meta['action']),
    date: row.createdAt.toISOString().slice(0, 10),
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validate and parse a date range for rollup queries.
 * Returns `{ ok: true, from, to }` or `{ ok: false, error }`.
 * 'from' and 'to' are Date objects at start/end of day UTC.
 */
export function parseDateRange(
  rawFrom: string | undefined | null,
  rawTo: string | undefined | null,
): { ok: true; from: Date; to: Date } | { ok: false; error: string } {
  if (!rawFrom || !ISO_DATE_RE.test(rawFrom)) {
    return { ok: false, error: 'from must be a YYYY-MM-DD date string' }
  }
  if (!rawTo || !ISO_DATE_RE.test(rawTo)) {
    return { ok: false, error: 'to must be a YYYY-MM-DD date string' }
  }
  const from = new Date(`${rawFrom}T00:00:00.000Z`)
  const to = new Date(`${rawTo}T23:59:59.999Z`)
  if (isNaN(from.getTime())) return { ok: false, error: 'from is not a valid date' }
  if (isNaN(to.getTime())) return { ok: false, error: 'to is not a valid date' }
  if (from > to) return { ok: false, error: 'from must not be after to' }
  const maxRangeMs = 366 * 24 * 60 * 60 * 1000
  if (to.getTime() - from.getTime() > maxRangeMs) {
    return { ok: false, error: 'date range must not exceed 366 days' }
  }
  return { ok: true, from, to }
}

// ---------------------------------------------------------------------------
// buildChimmyKPIRollup — pure aggregation
// ---------------------------------------------------------------------------

function zeroSurfaceKPI(surface: string): ChimmySurfaceKPI {
  return { surface, messages_sent: 0, responses_rendered: 0, chip_clicks: 0, followup_clicks: 0, helpful: 0, unhelpful: 0 }
}
function zeroModeKPI(mode: string): ChimmyModeKPI {
  return { mode, messages_sent: 0, responses_rendered: 0, helpful: 0, unhelpful: 0 }
}
function zeroTopicKPI(topic: string): ChimmyTopicKPI {
  return { topic, messages_sent: 0, helpful: 0, unhelpful: 0 }
}
function zeroDayKPI(date: string): ChimmyDayKPI {
  return { date, messages_sent: 0, responses_rendered: 0, chip_clicks: 0, followup_clicks: 0, helpful: 0, unhelpful: 0 }
}

/**
 * Aggregate an array of normalised Chimmy events into a KPI rollup.
 *
 * Raw text is NEVER present in normalised events — forbidden-key stripping
 * happens at ingestion time (`sanitizeChimmyAnalyticsMetadata`). This
 * function never touches the metadata blob.
 */
export function buildChimmyKPIRollup(
  events: ChimmyNormalisedEvent[],
  period: { from: string; to: string },
): ChimmyKPIRollup {
  const totals = {
    messages_sent: 0,
    responses_rendered: 0,
    chip_clicks: 0,
    followup_clicks: 0,
    mode_changes: 0,
    helpful: 0,
    unhelpful: 0,
    formatter_fallback_count: 0,
    contract_validation_failure_count: 0,
  }

  const surfaceMap = new Map<string, ChimmySurfaceKPI>()
  const modeMap = new Map<string, ChimmyModeKPI>()
  const topicMap = new Map<string, ChimmyTopicKPI>()
  const dayMap = new Map<string, ChimmyDayKPI>()

  for (const ev of events) {
    const surface = ev.surface ?? 'unknown'
    const mode = ev.mode ?? 'unknown'
    const topic = ev.topic ?? null
    const date = ev.date

    if (!surfaceMap.has(surface)) surfaceMap.set(surface, zeroSurfaceKPI(surface))
    if (!modeMap.has(mode)) modeMap.set(mode, zeroModeKPI(mode))
    if (!dayMap.has(date)) dayMap.set(date, zeroDayKPI(date))

    const s = surfaceMap.get(surface)!
    const m = modeMap.get(mode)!
    const d = dayMap.get(date)!

    switch (ev.event_name) {
      case 'message_send':
        totals.messages_sent++
        s.messages_sent++
        m.messages_sent++
        d.messages_sent++
        if (topic) {
          if (!topicMap.has(topic)) topicMap.set(topic, zeroTopicKPI(topic))
          topicMap.get(topic)!.messages_sent++
        }
        break

      case 'response_rendered':
        totals.responses_rendered++
        s.responses_rendered++
        m.responses_rendered++
        d.responses_rendered++
        break

      case 'chip_click':
        totals.chip_clicks++
        s.chip_clicks++
        d.chip_clicks++
        break

      case 'followup_click':
        totals.followup_clicks++
        s.followup_clicks++
        d.followup_clicks++
        break

      case 'mode_change':
        totals.mode_changes++
        break

      case 'feedback_submit': {
        const action = ev.feedback_action ?? ''
        if (action === 'thumbs_up') {
          totals.helpful++
          s.helpful++
          m.helpful++
          if (topic) {
            if (!topicMap.has(topic)) topicMap.set(topic, zeroTopicKPI(topic))
            topicMap.get(topic)!.helpful++
          }
        } else if (action === 'thumbs_down') {
          totals.unhelpful++
          s.unhelpful++
          m.unhelpful++
          if (topic) {
            if (!topicMap.has(topic)) topicMap.set(topic, zeroTopicKPI(topic))
            topicMap.get(topic)!.unhelpful++
          }
        }
        break
      }

      case 'formatter_fallback_used':
        totals.formatter_fallback_count++
        break

      case 'contract_validation_failed':
        totals.contract_validation_failure_count++
        break
    }
  }

  const feedbackTotal = totals.helpful + totals.unhelpful
  const helpful_rate = feedbackTotal > 0 ? Number((totals.helpful / feedbackTotal).toFixed(4)) : null

  // chip click-through rate = chip_clicks / responses_rendered (chips appear after responses)
  const chip_click_through_rate =
    totals.responses_rendered > 0
      ? Number((totals.chip_clicks / totals.responses_rendered).toFixed(4))
      : null

  // followup click-through rate = followup_clicks / responses_rendered
  const followup_click_through_rate =
    totals.responses_rendered > 0
      ? Number((totals.followup_clicks / totals.responses_rendered).toFixed(4))
      : null

  return {
    period,
    totals: {
      ...totals,
      helpful_rate,
      chip_click_through_rate,
      followup_click_through_rate,
    },
    by_surface: Array.from(surfaceMap.values()).sort((a, b) => b.messages_sent - a.messages_sent),
    by_mode: Array.from(modeMap.values()).sort((a, b) => b.messages_sent - a.messages_sent),
    by_topic: Array.from(topicMap.values()).sort((a, b) => b.messages_sent - a.messages_sent),
    by_day: Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    event_count: events.length,
  }
}

// ---------------------------------------------------------------------------
// Convenience: normalise many raw rows and build rollup in one call
// ---------------------------------------------------------------------------

export function buildChimmyKPIRollupFromRaw(
  rows: ChimmyRawEventRow[],
  period: { from: string; to: string },
): ChimmyKPIRollup {
  // Guard: only count known Chimmy event names so unknown event pollution doesn't distort metrics
  const knownNames = new Set<string>(CHIMMY_AI_EVENT_NAMES)
  const events = rows
    .map(normaliseRow)
    .filter((e) => knownNames.has(e.event_name))
  return buildChimmyKPIRollup(events, period)
}
