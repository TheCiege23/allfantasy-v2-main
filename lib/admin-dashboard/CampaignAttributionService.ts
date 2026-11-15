/**
 * Admin campaign/social attribution reporting.
 *
 * Authoritative source: first-party `AnalyticsEvent` rows only. GA4 and Meta Pixel are
 * deliberately NOT read here — per the launch decision they are separate, labeled
 * comparison sources and their estimates are never summed with confirmed application
 * events. Anything this module reports is a real row in our own database.
 *
 * The hard rule everywhere below: a stage with no emitter reports `not_implemented`
 * with a NULL value, never 0. A zero and an unbuilt pipeline look identical on a
 * dashboard, and that is exactly how a launch metric becomes a lie.
 *
 * INDEX CONTRACT — `AnalyticsEvent` has `@@index([event, createdAt])` but NO standalone
 * index on `createdAt`. Every query here therefore filters on an explicit event-name set
 * AND a bounded date range so it stays index-backed. A date-only filter would full-scan
 * a table that already holds tens of thousands of rows.
 */
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { ACQUISITION, MONETIZATION } from "@/lib/analytics/eventNames"
import { ATTRIBUTION_LINK_EVENT } from "@/lib/analytics/linkAttributionToUser"

/**
 * How a metric's number should be read. These are NOT interchangeable, and the UI must
 * render them differently:
 *  - `confirmed`        a real count, including a real 0
 *  - `no_activity`      pipeline works, nothing happened in this window
 *  - `not_implemented`  no emitter exists yet — the number is unknowable, not zero
 *  - `unavailable`      we could not determine it
 *  - `query_failed`     the query errored
 */
export type MetricStatus = "confirmed" | "no_activity" | "not_implemented" | "unavailable" | "query_failed"

export type Metric = {
  key: string
  label: string
  /** Null whenever status is anything other than `confirmed`/`no_activity`. */
  value: number | null
  status: MetricStatus
  /** What this number counts, in one sentence — shown on hover in the admin UI. */
  definition: string
  /** The authoritative origin, e.g. "AnalyticsEvent.acquisition.signup_completed". */
  source: string
  /** Why it is unavailable/not implemented, when it is. */
  note: string | null
}

export type CampaignRow = {
  platform: string
  source: string | null
  medium: string | null
  campaign: string | null
  content: string | null
  campaignId: string | null
  landingPath: string | null
  uniqueVisitors: number
  events: number
  landingViews: number
  signupsCompleted: number
  /** DISTINCT users who completed a league import (2026-11-15). */
  importsCompleted: number
  dashboardsActivated: number
  attributionLinked: number
  firstActivity: string | null
  latestActivity: string | null
  /** Each is null when its denominator is 0 — never 0, which would read as a real failure. */
  visitorToSignupRate: number | null
  /** Distinct users with a completed import ÷ accounts created. */
  signupToImportRate: number | null
  signupToActivationRate: number | null
  visitorToActivationRate: number | null
}

export type CampaignAttributionReport = {
  environment: string
  window: { days: number; fromIso: string; toIso: string }
  calculatedAtIso: string
  /** Newest attribution-bearing event in range; null when the window is empty. */
  lastEventAtIso: string | null
  freshness: "fresh" | "delayed" | "stale" | "no_data"
  /** Total attribution-bearing rows scanned — the sample size behind every number here. */
  sampleSize: number
  /** Campaign rows are grouped by first touch — the acquisition question. Never mixed with latest touch. */
  attributionGrouping: "first_touch"
  /** Each null when its denominator is 0, never 0 — a 0% would read as a real failure. */
  conversions: {
    visitorToSignup: number | null
    /** Accounts that confirmed their email ÷ accounts created (email sign-ups confirm; OAuth is born verified). */
    signupToEmailVerified: number | null
    /** Distinct users who started an import ÷ accounts created. */
    signupToImportStarted: number | null
    /** Distinct users who completed an import ÷ distinct users who started one. */
    importStartedToCompleted: number | null
    signupToActivation: number | null
    visitorToActivation: number | null
  }
  summary: Metric[]
  campaigns: CampaignRow[]
  campaignsTruncated: boolean
  /**
   * Which surface sends paying subscribers (2026-11-15): per `entry_source` — e.g. `lock_player_depth`
   * for the /core player-depth lock — distinct users who started a checkout and distinct Stripe sessions
   * that paid, in the window. `unknown` = a checkout from a surface that does not tag itself yet.
   */
  upgradesByEntry: { entrySource: string; checkoutsStarted: number; trialsStarted: number; paid: number; checkoutToPaidRate: number | null }[]
  /** Per-stage build status, so the UI can say "not built yet" instead of showing 0. */
  stageInventory: { stage: string; status: MetricStatus; note: string }[]
  errors: string[]
}

/** Stages that have a real emitter today. Keep in sync with the emitters. */
const IMPLEMENTED_EVENTS = [
  ACQUISITION.LANDING_VIEWED,
  ACQUISITION.SIGNUP_COMPLETED,
  ACQUISITION.EMAIL_VERIFIED,
  ACQUISITION.IMPORT_STARTED,
  ACQUISITION.IMPORT_COMPLETED,
  ACQUISITION.DASHBOARD_ACTIVATED,
  ATTRIBUTION_LINK_EVENT,
] as const

/**
 * Stages required by the launch funnel that have NO emitter yet. Listed explicitly so the
 * admin UI reports them as unbuilt rather than silently omitting them (an omitted stage
 * reads as "not applicable"; an explicit one reads as "work remaining").
 */
const UNIMPLEMENTED_STAGES: { stage: string; note: string }[] = [
  { stage: "start_clicked", note: "No emitter on the /start CTA." },
  { stage: "signup_started", note: "No emitter; only completion is recorded." },
  { stage: "onboarding_started", note: "No emitter." },
  { stage: "onboarding_completed", note: "No emitter." },
  { stage: "returning_authenticated", note: "No emitter. attribution_linked is idempotent and is NOT a proxy." },
  { stage: "support_requested", note: "Deferred to the Support phase." },
]

const MAX_WINDOW_DAYS = 365
const DEFAULT_WINDOW_DAYS = 30
const MAX_CAMPAIGN_ROWS = 200

export type CampaignFilters = {
  windowDays?: number
  platform?: string | null
  campaign?: string | null
  content?: string | null
  /** Bounds the campaign table; the report flags truncation rather than hiding it. */
  limit?: number
}

function clampWindowDays(raw: number | undefined): number {
  if (!Number.isFinite(raw) || raw === undefined) return DEFAULT_WINDOW_DAYS
  return Math.min(Math.max(Math.trunc(raw), 1), MAX_WINDOW_DAYS)
}

/** Null denominator-safe rate. Returns null rather than 0 so "no data" never reads as "0%". */
function rate(numerator: number, denominator: number): number | null {
  if (!denominator) return null
  return Number((numerator / denominator).toFixed(4))
}

function toNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "number") return value
  return Number(value ?? 0)
}

function resolveFreshness(lastEventAt: Date | null, now: Date): CampaignAttributionReport["freshness"] {
  if (!lastEventAt) return "no_data"
  const ageMs = now.getTime() - lastEventAt.getTime()
  if (ageMs <= 60 * 60 * 1000) return "fresh"
  if (ageMs <= 24 * 60 * 60 * 1000) return "delayed"
  return "stale"
}

export async function getCampaignAttributionReport(
  filters: CampaignFilters = {},
): Promise<CampaignAttributionReport> {
  const now = new Date()
  const windowDays = clampWindowDays(filters.windowDays)
  const from = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000)
  const limit = Math.min(Math.max(filters.limit ?? MAX_CAMPAIGN_ROWS, 1), MAX_CAMPAIGN_ROWS)
  const errors: string[] = []

  const events = Prisma.join(IMPLEMENTED_EVENTS.map((e) => Prisma.sql`${e}`))

  // Optional equality filters, parameterized. Never interpolated as raw strings.
  const platformFilter = filters.platform
    ? Prisma.sql`AND meta->>'first_platform' = ${filters.platform}`
    : Prisma.empty
  const campaignFilter = filters.campaign
    ? Prisma.sql`AND meta->>'first_campaign' = ${filters.campaign}`
    : Prisma.empty
  const contentFilter = filters.content
    ? Prisma.sql`AND meta->>'first_content' = ${filters.content}`
    : Prisma.empty

  let campaigns: CampaignRow[] = []
  let campaignsTruncated = false
  let totalsRow: {
    unique_visitors: unknown
    events: unknown
    landing_views: unknown
    signups: unknown
    email_verified: unknown
    imports_started: unknown
    imports_completed: unknown
    activations: unknown
    linked: unknown
    last_event: Date | null
  } | null = null

  try {
    const rows = await prisma.$queryRaw<
      Array<{
        platform: string | null
        source: string | null
        medium: string | null
        campaign: string | null
        content: string | null
        campaign_id: string | null
        landing_path: string | null
        unique_visitors: unknown
        events: unknown
        landing_views: unknown
        signups: unknown
        imports_completed: unknown
        activations: unknown
        linked: unknown
        first_activity: Date | null
        latest_activity: Date | null
      }>
    >(Prisma.sql`
      SELECT
        meta->>'first_platform'    AS platform,
        meta->>'first_source'      AS source,
        meta->>'first_medium'      AS medium,
        meta->>'first_campaign'    AS campaign,
        meta->>'first_content'     AS content,
        meta->>'first_campaign_id' AS campaign_id,
        meta->>'first_landing_path' AS landing_path,
        COUNT(DISTINCT "sessionId")                                        AS unique_visitors,
        COUNT(*)                                                           AS events,
        COUNT(*) FILTER (WHERE event = ${ACQUISITION.LANDING_VIEWED})      AS landing_views,
        COUNT(*) FILTER (WHERE event = ${ACQUISITION.SIGNUP_COMPLETED})    AS signups,
        COUNT(DISTINCT "userId") FILTER (WHERE event = ${ACQUISITION.IMPORT_COMPLETED}) AS imports_completed,
        COUNT(*) FILTER (WHERE event = ${ACQUISITION.DASHBOARD_ACTIVATED}) AS activations,
        COUNT(*) FILTER (WHERE event = ${ATTRIBUTION_LINK_EVENT})          AS linked,
        MIN("createdAt")                                                   AS first_activity,
        MAX("createdAt")                                                   AS latest_activity
      FROM "AnalyticsEvent"
      WHERE event IN (${events})
        AND "createdAt" >= ${from}
        AND "createdAt" <= ${now}
        AND meta->>'first_platform' IS NOT NULL
        ${platformFilter}
        ${campaignFilter}
        ${contentFilter}
      GROUP BY 1,2,3,4,5,6,7
      ORDER BY unique_visitors DESC, events DESC
      LIMIT ${limit + 1}
    `)

    campaignsTruncated = rows.length > limit
    campaigns = rows.slice(0, limit).map((r) => {
      const uniqueVisitors = toNumber(r.unique_visitors)
      const signupsCompleted = toNumber(r.signups)
      const importsCompleted = toNumber(r.imports_completed)
      const dashboardsActivated = toNumber(r.activations)
      return {
        platform: r.platform ?? "other",
        source: r.source,
        medium: r.medium,
        campaign: r.campaign,
        content: r.content,
        campaignId: r.campaign_id,
        landingPath: r.landing_path,
        uniqueVisitors,
        events: toNumber(r.events),
        landingViews: toNumber(r.landing_views),
        signupsCompleted,
        importsCompleted,
        dashboardsActivated,
        attributionLinked: toNumber(r.linked),
        firstActivity: r.first_activity?.toISOString() ?? null,
        latestActivity: r.latest_activity?.toISOString() ?? null,
        visitorToSignupRate: rate(signupsCompleted, uniqueVisitors),
        signupToImportRate: rate(importsCompleted, signupsCompleted),
        signupToActivationRate: rate(dashboardsActivated, signupsCompleted),
        visitorToActivationRate: rate(dashboardsActivated, uniqueVisitors),
      }
    })
  } catch (error) {
    errors.push(`campaign breakdown query failed: ${error instanceof Error ? error.message : "unknown"}`)
  }

  try {
    const totals = await prisma.$queryRaw<
      Array<{
        unique_visitors: unknown
        events: unknown
        landing_views: unknown
        signups: unknown
        email_verified: unknown
        imports_started: unknown
        imports_completed: unknown
        activations: unknown
        linked: unknown
        last_event: Date | null
      }>
    >(Prisma.sql`
      SELECT
        COUNT(DISTINCT "sessionId")                                        AS unique_visitors,
        COUNT(*)                                                           AS events,
        COUNT(*) FILTER (WHERE event = ${ACQUISITION.LANDING_VIEWED})      AS landing_views,
        COUNT(*) FILTER (WHERE event = ${ACQUISITION.SIGNUP_COMPLETED})    AS signups,
        COUNT(DISTINCT "userId") FILTER (WHERE event = ${ACQUISITION.EMAIL_VERIFIED})   AS email_verified,
        COUNT(DISTINCT "userId") FILTER (WHERE event = ${ACQUISITION.IMPORT_STARTED})   AS imports_started,
        COUNT(DISTINCT "userId") FILTER (WHERE event = ${ACQUISITION.IMPORT_COMPLETED}) AS imports_completed,
        COUNT(*) FILTER (WHERE event = ${ACQUISITION.DASHBOARD_ACTIVATED}) AS activations,
        COUNT(*) FILTER (WHERE event = ${ATTRIBUTION_LINK_EVENT})          AS linked,
        MAX("createdAt")                                                   AS last_event
      FROM "AnalyticsEvent"
      WHERE event IN (${events})
        AND "createdAt" >= ${from}
        AND "createdAt" <= ${now}
    `)
    totalsRow = totals[0] ?? null
  } catch (error) {
    errors.push(`summary query failed: ${error instanceof Error ? error.message : "unknown"}`)
  }

  let upgradesByEntry: CampaignAttributionReport["upgradesByEntry"] = []
  try {
    const rows = await prisma.$queryRaw<Array<{ entry_source: string | null; started: unknown; trials: unknown; paid: unknown }>>(Prisma.sql`
      SELECT
        COALESCE(meta->>'entry_source', 'unknown') AS entry_source,
        COUNT(DISTINCT "userId") FILTER (WHERE event = ${MONETIZATION.CHECKOUT_STARTED}) AS started,
        COUNT(DISTINCT meta->>'stripe_session_id') FILTER (WHERE event = ${MONETIZATION.TRIAL_STARTED}) AS trials,
        COUNT(DISTINCT meta->>'stripe_session_id') FILTER (WHERE event = ${MONETIZATION.PAID_CONVERSION_CONFIRMED}) AS paid
      FROM "AnalyticsEvent"
      WHERE event IN (${MONETIZATION.CHECKOUT_STARTED}, ${MONETIZATION.TRIAL_STARTED}, ${MONETIZATION.PAID_CONVERSION_CONFIRMED})
        AND "createdAt" >= ${from}
        AND "createdAt" <= ${now}
      GROUP BY 1
      ORDER BY paid DESC, started DESC
      LIMIT 50
    `)
    upgradesByEntry = rows.map((r) => {
      const checkoutsStarted = toNumber(r.started)
      const paid = toNumber(r.paid)
      // `paid` includes a trial's first real charge (recorded once per subscription, from_trial: true).
      return { entrySource: r.entry_source ?? "unknown", checkoutsStarted, trialsStarted: toNumber(r.trials), paid, checkoutToPaidRate: rate(paid, checkoutsStarted) }
    })
  } catch (error) {
    errors.push(`upgrades-by-entry query failed: ${error instanceof Error ? error.message : "unknown"}`)
  }

  // Bind to a local so TypeScript narrows the null away; a `queryFailed` boolean does not
  // narrow the outer `let`, and the values below must never be read from a failed query.
  const totals = totalsRow
  const queryFailed = totals === null
  const sampleSize = totals ? toNumber(totals.events) : 0
  const uniqueVisitors = totals ? toNumber(totals.unique_visitors) : 0
  const landingViews = totals ? toNumber(totals.landing_views) : 0
  const signups = totals ? toNumber(totals.signups) : 0
  const emailVerified = totals ? toNumber(totals.email_verified) : 0
  const importsStarted = totals ? toNumber(totals.imports_started) : 0
  const importsCompleted = totals ? toNumber(totals.imports_completed) : 0
  const activations = totals ? toNumber(totals.activations) : 0
  const linked = totals ? toNumber(totals.linked) : 0
  const lastEventAt = totals ? totals.last_event : null

  // A real count and a failed query must never render the same. When the query failed we
  // report `query_failed` with a null value rather than the 0 the accumulator holds.
  const countMetric = (key: string, label: string, value: number, definition: string, source: string): Metric => {
    if (queryFailed) {
      return { key, label, value: null, status: "query_failed", definition, source, note: "Summary query failed." }
    }
    if (sampleSize === 0) {
      return {
        key,
        label,
        value: null,
        status: "no_activity",
        definition,
        source,
        note: "No attribution-bearing events in this window.",
      }
    }
    return { key, label, value, status: "confirmed", definition, source, note: null }
  }

  const summary: Metric[] = [
    countMetric(
      "landing_viewed",
      "Landing views",
      landingViews,
      "Client-fired, server-validated: requires the server-set anonymous id and is deduplicated to one per visitor per 30 minutes. A floor, not a census — ad-blockers can suppress it.",
      `AnalyticsEvent.${ACQUISITION.LANDING_VIEWED}`,
    ),
    countMetric(
      "dashboard_activated",
      "Dashboards activated",
      activations,
      "First successful authenticated dashboard load with at least one usable AF or imported league. Idempotent per user; failed context and zero-league states never count.",
      `AnalyticsEvent.${ACQUISITION.DASHBOARD_ACTIVATED}`,
    ),
    countMetric(
      "unique_visitors",
      "Unique attributed visitors",
      uniqueVisitors,
      "Distinct af_anon_id values on attribution-bearing events in range.",
      "AnalyticsEvent.sessionId",
    ),
    countMetric(
      "signups_completed",
      "Accounts created",
      signups,
      "Committed AppUser rows, emitted server-side after account creation. A redirect never counts.",
      `AnalyticsEvent.${ACQUISITION.SIGNUP_COMPLETED}`,
    ),
    countMetric(
      "email_verified",
      "Emails confirmed",
      emailVerified,
      "Distinct accounts that confirmed their email for the first time (emitted on /verify/email). OAuth sign-ups are born verified and never emit it. Since 2026-11-15 confirming no longer gates the import.",
      `AnalyticsEvent.${ACQUISITION.EMAIL_VERIFIED}`,
    ),
    countMetric(
      "import_started",
      "Imports started",
      importsStarted,
      "Distinct users whose import request was accepted — a supported provider at discovery or preview. Retries count once. Emitted since 2026-11-15.",
      `AnalyticsEvent.${ACQUISITION.IMPORT_STARTED}`,
    ),
    countMetric(
      "import_completed",
      "Imports completed",
      importsCompleted,
      "Distinct users with at least one successful import commit (a league now on the account, including joining a leaguemate's import). Emitted since 2026-11-15.",
      `AnalyticsEvent.${ACQUISITION.IMPORT_COMPLETED}`,
    ),
    countMetric(
      "attribution_linked",
      "Anonymous journeys joined to an account",
      linked,
      "Idempotent per (user, anonymous id) pair, so repeat logins do not inflate it.",
      `AnalyticsEvent.${ATTRIBUTION_LINK_EVENT}`,
    ),
    ...UNIMPLEMENTED_STAGES.map(({ stage, note }) => ({
      key: stage,
      label: stage.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      value: null,
      status: "not_implemented" as const,
      definition: "Required launch-funnel stage.",
      source: "—",
      note,
    })),
  ]

  return {
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    window: { days: windowDays, fromIso: from.toISOString(), toIso: now.toISOString() },
    calculatedAtIso: now.toISOString(),
    lastEventAtIso: lastEventAt?.toISOString() ?? null,
    freshness: queryFailed ? "no_data" : resolveFreshness(lastEventAt, now),
    sampleSize,
    summary,
    campaigns,
    campaignsTruncated,
    upgradesByEntry,
    // Every campaign row is grouped by FIRST-touch (`meta->>'first_*'`), the acquisition
    // question: which campaign originally earned this visitor. Latest-touch data is stored
    // on every row and is available for a future re-engagement view, but the two are never
    // mixed in one total — summing them would double-count a visitor who arrived twice.
    attributionGrouping: "first_touch",
    conversions: {
      visitorToSignup: rate(signups, uniqueVisitors),
      signupToEmailVerified: rate(emailVerified, signups),
      signupToImportStarted: rate(importsStarted, signups),
      importStartedToCompleted: rate(importsCompleted, importsStarted),
      signupToActivation: rate(activations, signups),
      visitorToActivation: rate(activations, uniqueVisitors),
    },
    stageInventory: [
      { stage: ACQUISITION.LANDING_VIEWED, status: "confirmed", note: "Client beacon, server-validated + deduplicated (30 min)." },
      { stage: ACQUISITION.SIGNUP_COMPLETED, status: "confirmed", note: "Emitted at both email and OAuth signup paths." },
      { stage: ACQUISITION.EMAIL_VERIFIED, status: "confirmed", note: "Emitted on the first confirmation of an account's email (/verify/email), since 2026-11-15." },
      { stage: ACQUISITION.IMPORT_STARTED, status: "confirmed", note: "Emitted by import discover and preview on an accepted request, since 2026-11-15. Counted per distinct user." },
      { stage: ACQUISITION.IMPORT_COMPLETED, status: "confirmed", note: "Emitted on every successful import commit, since 2026-11-15. Counted per distinct user." },
      { stage: MONETIZATION.CHECKOUT_STARTED, status: "confirmed", note: "Emitted when a subscription Stripe Checkout Session is created, since 2026-11-15, with entry_source. See upgradesByEntry." },
      { stage: MONETIZATION.PAID_CONVERSION_CONFIRMED, status: "confirmed", note: "Webhook-confirmed (checkout.session.completed, after the paid-state check), since 2026-11-15. Counted per distinct Stripe session." },
      { stage: ACQUISITION.DASHBOARD_ACTIVATED, status: "confirmed", note: "Server-side on the /dashboard success path; idempotent per user." },
      { stage: ATTRIBUTION_LINK_EVENT, status: "confirmed", note: "Emitted in the NextAuth signIn event." },
      ...UNIMPLEMENTED_STAGES.map(({ stage, note }) => ({ stage, status: "not_implemented" as const, note })),
    ],
    errors,
  }
}
