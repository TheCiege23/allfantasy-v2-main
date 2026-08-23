import 'server-only'

import { prisma } from '@/lib/prisma'
import { SUPPORTED_SPORTS, type SupportedSport } from '@/lib/sport-scope'
import { runClearSportsHealthCheck } from '@/lib/clear-sports/client'
import { getClearSportsToolStates } from '@/lib/clear-sports'
import { getSportsData } from '@/lib/sports-router'
import { readAgentCache, writeAgentCache } from '@/lib/agents/cache'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { runImportMaximizer, type ImportMaximizerResult } from './import-maximizer'
import { ESPN_SITE_API_BASE } from '@/lib/providers/espnUrls'

type ProviderStatusLevel = 'up' | 'down' | 'degraded'
type FreshnessStatus = 'fresh' | 'stale' | 'empty'
type OverallStatus = 'up' | 'degraded' | 'down'

export interface HealthProviderEntry {
  status: ProviderStatusLevel
  lastSeen: string | null
  latencyMs?: number
  affectedFeatures?: string[]
  fallbackActive?: boolean
  fallbackSource?: string | null
  model?: string
  details?: string
}

export interface FreshnessEntry {
  status: FreshnessStatus
  age: string
  checkedAt: string
}

export interface SystemHealthSnapshot {
  timestamp: string
  overall: OverallStatus
  providers: Record<string, HealthProviderEntry>
  dataFreshness: Record<string, FreshnessEntry>
  importCompleteness: {
    leagues: {
      synced: number
      stale: number
      total: number
      lastRunAt?: string
    }
  }
  alertHistory: Array<{
    createdAt: string
    title: string
    body: string | null
    severity: string
  }>
  recoveryActions: string[]
}

const SYSTEM_HEALTH_CACHE = {
  tier: '5m',
  sport: 'GLOBAL',
  dataType: 'system_health',
  identifier: 'latest',
} as const

const ALERT_NOTIFICATION_TYPE = 'system_health_alert'

function ageLabelFromMs(ms: number | null): string {
  if (ms == null || ms < 0) return 'never'
  const hours = Math.floor(ms / (60 * 60 * 1000))
  if (hours >= 48) return `${hours}h`
  const minutes = Math.floor(ms / (60 * 1000))
  if (minutes >= 60) return `${hours}h`
  return `${Math.max(0, minutes)}m`
}

function freshnessFromDate(
  date: Date | null,
  staleAfterMs: number,
  checkedAt: string
): FreshnessEntry {
  if (!date) {
    return { status: 'empty', age: 'never', checkedAt }
  }

  const ageMs = Date.now() - date.getTime()
  return {
    status: ageMs > staleAfterMs ? 'stale' : 'fresh',
    age: ageLabelFromMs(ageMs),
    checkedAt,
  }
}

async function timedFetch(url: string, options?: RequestInit & { timeoutMs?: number }) {
  const timeoutMs = options?.timeoutMs ?? 4000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
    })
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'fetch_failed',
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function checkAnthropicHealth(): Promise<HealthProviderEntry> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    return { status: 'down', lastSeen: null, details: 'ANTHROPIC_API_KEY missing' }
  }

  const startedAt = Date.now()
  const controller = new AbortController()
  const probeTimeoutMs = 18_000
  const timeout = setTimeout(() => controller.abort(), probeTimeoutMs)
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL_SPECIALIST?.trim() || 'claude-sonnet-4-6',
        max_tokens: 4,
        system: 'Respond with OK.',
        messages: [{ role: 'user', content: 'OK' }],
      }),
    })

    const latencyMs = Date.now() - startedAt
    return {
      status: !response.ok ? 'down' : latencyMs > 5000 ? 'degraded' : 'up',
      lastSeen: new Date().toISOString(),
      latencyMs,
      model: process.env.ANTHROPIC_MODEL_SPECIALIST?.trim() || 'claude-sonnet-4-6',
      details: response.ok ? undefined : `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      status: 'down',
      lastSeen: null,
      latencyMs: Date.now() - startedAt,
      details: error instanceof Error ? error.message : 'anthropic_probe_failed',
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function checkOpenAiHealth(): Promise<HealthProviderEntry> {
  const apiKey = process.env.OPENAI_API_KEY?.trim() || process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return { status: 'down', lastSeen: null, details: 'OPENAI_API_KEY missing' }
  }

  const baseUrl =
    process.env.OPENAI_BASE_URL?.trim() ||
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim() ||
    'https://api.openai.com/v1'
  const response = await timedFetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  return {
    status: !response.ok ? 'down' : response.latencyMs > 3000 ? 'degraded' : 'up',
    lastSeen: response.ok ? new Date().toISOString() : null,
    latencyMs: response.latencyMs,
    details: response.ok ? undefined : response.error || `HTTP ${response.status}`,
  }
}

async function checkElevenLabsHealth(): Promise<HealthProviderEntry> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim()
  if (!apiKey) {
    return { status: 'down', lastSeen: null, details: 'ELEVENLABS_API_KEY missing' }
  }

  const response = await timedFetch('https://api.elevenlabs.io/v1/user/subscription', {
    headers: { 'xi-api-key': apiKey },
  })

  return {
    status: !response.ok ? 'down' : response.latencyMs > 3000 ? 'degraded' : 'up',
    lastSeen: response.ok ? new Date().toISOString() : null,
    latencyMs: response.latencyMs,
    details: response.ok ? undefined : response.error || `HTTP ${response.status}`,
  }
}

async function checkPrimaryDatabase(): Promise<HealthProviderEntry> {
  const startedAt = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    const latencyMs = Date.now() - startedAt
    return {
      status: latencyMs > 100 ? 'degraded' : 'up',
      lastSeen: new Date().toISOString(),
      latencyMs,
      details: latencyMs > 100 ? 'Primary database latency above 100ms' : undefined,
    }
  } catch (error) {
    return {
      status: 'down',
      lastSeen: null,
      latencyMs: Date.now() - startedAt,
      details: error instanceof Error ? error.message : 'database_probe_failed',
    }
  }
}

async function checkSupabase(): Promise<HealthProviderEntry> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!url) {
    return { status: 'down', lastSeen: null, details: 'NEXT_PUBLIC_SUPABASE_URL missing' }
  }

  const response = await timedFetch(`${url.replace(/\/+$/, '')}/rest/v1/`, {
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || '',
    },
  })

  return {
    status: !response.ok ? 'down' : response.latencyMs > 1000 ? 'degraded' : 'up',
    lastSeen: response.ok ? new Date().toISOString() : null,
    latencyMs: response.latencyMs,
    details: response.ok ? undefined : response.error || `HTTP ${response.status}`,
  }
}

async function checkResend(): Promise<HealthProviderEntry> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    return { status: 'down', lastSeen: null, details: 'RESEND_API_KEY missing' }
  }

  const response = await timedFetch('https://api.resend.com/domains', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  return {
    status: !response.ok ? 'down' : response.latencyMs > 3000 ? 'degraded' : 'up',
    lastSeen: response.ok ? new Date().toISOString() : null,
    latencyMs: response.latencyMs,
    details: response.ok ? undefined : response.error || `HTTP ${response.status}`,
  }
}

async function checkPublicApi(url: string, degradedAfterMs = 3000): Promise<HealthProviderEntry> {
  const response = await timedFetch(url)
  return {
    status: !response.ok ? 'down' : response.latencyMs > degradedAfterMs ? 'degraded' : 'up',
    lastSeen: response.ok ? new Date().toISOString() : null,
    latencyMs: response.latencyMs,
    details: response.ok ? undefined : response.error || `HTTP ${response.status}`,
  }
}

async function buildProviderHealth(): Promise<Record<string, HealthProviderEntry>> {
  const clearSports = await runClearSportsHealthCheck()
  const clearSportsTools = getClearSportsToolStates(clearSports.configured || clearSports.available)
  const pipelineProbe = await getSportsData({ sport: 'NFL', dataType: 'teams' }).catch(() => null)
  const clearSportsAffected = Object.keys(clearSportsTools)

  const [
    anthropic,
    openai,
    elevenLabs,
    sleeper,
    yahoo,
    espn,
    mfl,
    fantrax,
    primaryDb,
    supabase,
    resend,
  ] = await Promise.all([
    checkAnthropicHealth(),
    checkOpenAiHealth(),
    checkElevenLabsHealth(),
    checkPublicApi('https://api.sleeper.app/v1/state/nfl', 1500), // db-first-exception: live provider health probe
    checkPublicApi('https://fantasysports.yahooapis.com', 2000), // db-first-exception: live provider health probe
    checkPublicApi(`${ESPN_SITE_API_BASE}/football/nfl/scoreboard`, 2000), // db-first-exception: live provider health probe
    checkPublicApi('https://api.myfantasyleague.com/2024/export?TYPE=rules', 2000),
    checkPublicApi('https://www.fantrax.com', 2000),
    checkPrimaryDatabase(),
    checkSupabase(),
    checkResend(),
  ])

  return {
    clearsports: {
      status: clearSports.available ? 'up' : clearSports.configured ? 'degraded' : 'down',
      lastSeen: clearSports.available ? clearSports.checkedAt : null,
      latencyMs: clearSports.latencyMs,
      affectedFeatures: clearSports.available ? [] : clearSportsAffected,
      fallbackActive: Boolean(pipelineProbe && pipelineProbe.source !== 'clear_sports'),
      fallbackSource: pipelineProbe?.source ?? (clearSports.available ? null : 'cached_data'),
      details: clearSports.error,
    },
    anthropic,
    openai,
    elevenlabs: elevenLabs,
    sleeper,
    yahoo,
    espn,
    mfl,
    fantrax,
    primaryDb,
    supabase,
    resend,
  }
}

async function buildDataFreshness(): Promise<Record<string, FreshnessEntry>> {
  const checkedAt = new Date().toISOString()
  const [injuries, news, rankings] = await Promise.all([
    Promise.all(
      SUPPORTED_SPORTS.map(async (sport) => ({
        sport,
        row: await prisma.sportsInjury.findFirst({
          where: { sport },
          orderBy: [{ updatedAt: 'desc' }],
          select: { updatedAt: true },
        }),
      }))
    ),
    Promise.all(
      SUPPORTED_SPORTS.map(async (sport) => ({
        sport,
        row: await prisma.sportsNews.findFirst({
          where: { sport },
          orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
          select: { publishedAt: true, updatedAt: true },
        }),
      }))
    ),
    Promise.all(
      SUPPORTED_SPORTS.map(async (sport) => ({
        sport,
        row: await prisma.rankingsSnapshot.findFirst({
          where: { sportType: sport },
          orderBy: [{ createdAt: 'desc' }],
          select: { createdAt: true },
        }),
      }))
    ),
  ])

  const freshness: Record<string, FreshnessEntry> = {}
  for (const { sport, row } of injuries) {
    freshness[`${sport}_injuries`] = freshnessFromDate(row?.updatedAt ?? null, 24 * 60 * 60 * 1000, checkedAt)
  }
  for (const { sport, row } of news) {
    freshness[`${sport}_news`] = freshnessFromDate(
      row?.publishedAt ?? row?.updatedAt ?? null,
      24 * 60 * 60 * 1000,
      checkedAt
    )
  }
  for (const { sport, row } of rankings) {
    freshness[`${sport}_rankings`] = freshnessFromDate(row?.createdAt ?? null, 7 * 24 * 60 * 60 * 1000, checkedAt)
  }

  return freshness
}

async function buildAlertHistory() {
  const rows = await prisma.platformNotification.findMany({
    where: {
      type: ALERT_NOTIFICATION_TYPE,
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 20,
    select: {
      createdAt: true,
      title: true,
      body: true,
      severity: true,
    },
  })

  return rows.map((row) => ({
    createdAt: row.createdAt.toISOString(),
    title: row.title,
    body: row.body,
    severity: row.severity,
  }))
}

async function resolveAdminUserIds(): Promise<string[]> {
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  const users = await prisma.appUser.findMany({
    where: {
      OR: [
        { role: 'admin' },
        adminEmails.length > 0 ? { email: { in: adminEmails } } : undefined,
      ].filter(Boolean) as any,
    },
    select: { id: true },
    take: 25,
  })

  return users.map((user) => user.id)
}

async function alertAdmins(title: string, body: string, severity: 'low' | 'medium' | 'high' = 'high') {
  const userIds = await resolveAdminUserIds()
  if (userIds.length === 0) return

  await dispatchNotification({
    userIds,
    category: 'system_account',
    productType: 'shared',
    type: ALERT_NOTIFICATION_TYPE,
    title,
    body,
    severity,
  })
}

function deriveOverallStatus(providers: Record<string, HealthProviderEntry>): OverallStatus {
  const statuses = Object.values(providers).map((provider) => provider.status)
  if (statuses.some((status) => status === 'down')) return 'degraded'
  if (statuses.some((status) => status === 'degraded')) return 'degraded'
  return 'up'
}

function deriveRecoveryActions(snapshot: SystemHealthSnapshot): string[] {
  const actions: string[] = []
  if (snapshot.providers.clearsports?.status !== 'up') {
    actions.push('Extended sports cache TTL and marked ClearSports fallback mode active.')
  }
  if (snapshot.providers.anthropic?.status === 'degraded') {
    actions.push('Anthropic degraded; specialist requests should prefer faster fallback models when possible.')
  }
  if (snapshot.providers.primaryDb?.status === 'degraded') {
    actions.push('Primary DB latency is elevated; cache TTL should be extended to reduce load.')
  }
  if (snapshot.importCompleteness.leagues.stale > 0) {
    actions.push('Triggered automatic league re-sync for stale leagues.')
  }
  return actions
}

export async function getLatestSystemHealth(): Promise<SystemHealthSnapshot | null> {
  const cached = await readAgentCache<SystemHealthSnapshot>(SYSTEM_HEALTH_CACHE)
  return cached?.value ?? null
}

export async function runSystemHealthMonitor(args?: {
  runImports?: boolean
  notifyAdmins?: boolean
  preloadDrafts?: boolean
}): Promise<SystemHealthSnapshot> {
  const timestamp = new Date().toISOString()
  const [providers, dataFreshness, importResult, alertHistory] = await Promise.all([
    buildProviderHealth(),
    buildDataFreshness(),
    args?.runImports === false ? Promise.resolve<ImportMaximizerResult | null>(null) : runImportMaximizer(),
    buildAlertHistory(),
  ])

  if (args?.preloadDrafts) {
    await preloadUpcomingDrafts().catch(() => null)
  }

  const importCompleteness = importResult
    ? {
        leagues: {
          synced: importResult.totals.resynced + importResult.totals.fresh,
          stale: importResult.totals.stale,
          total: importResult.totals.total,
          lastRunAt: importResult.completedAt,
        },
      }
    : {
        leagues: {
          synced: 0,
          stale: 0,
          total: 0,
        },
      }

  const snapshot: SystemHealthSnapshot = {
    timestamp,
    overall: deriveOverallStatus(providers),
    providers,
    dataFreshness,
    importCompleteness,
    alertHistory,
    recoveryActions: [],
  }
  snapshot.recoveryActions = deriveRecoveryActions(snapshot)

  await writeAgentCache(SYSTEM_HEALTH_CACHE, snapshot)

  if (args?.notifyAdmins !== false) {
    if (providers.clearsports?.status !== 'up') {
      await alertAdmins(
        'ClearSports degraded',
        'ClearSports is unavailable or degraded. The app is serving cached sports data where possible.',
        'high'
      ).catch(() => {})
    }
    if (providers.primaryDb?.status === 'degraded') {
      await alertAdmins(
        'Primary database latency elevated',
        'Primary database latency is above the 100ms threshold. Cache-first fallback should stay active until latency normalizes.',
        'medium'
      ).catch(() => {})
    }
  }

  return snapshot
}

export async function runDataFreshnessSweep() {
  const dataFreshness = await buildDataFreshness()
  const snapshot = (await getLatestSystemHealth()) ?? {
    timestamp: new Date().toISOString(),
    overall: 'up' as OverallStatus,
    providers: {},
    dataFreshness: {},
    importCompleteness: { leagues: { synced: 0, stale: 0, total: 0 } },
    alertHistory: [],
    recoveryActions: [],
  }

  const nextSnapshot: SystemHealthSnapshot = {
    ...snapshot,
    timestamp: new Date().toISOString(),
    dataFreshness,
  }

  await writeAgentCache(SYSTEM_HEALTH_CACHE, nextSnapshot)
  return nextSnapshot
}

export async function preloadStaticAgentData() {
  const jobs = await Promise.all(
    (['NFL', 'NBA', 'MLB', 'NHL', 'NCAAB', 'NCAAF', 'SOCCER'] as SupportedSport[]).map(async (sport) => {
      const [teams, schedule] = await Promise.all([
        getSportsData({ sport, dataType: 'teams' }).catch(() => null),
        getSportsData({ sport, dataType: 'schedule' }).catch(() => null),
      ])

      return { sport, teamsSource: teams?.source ?? null, scheduleSource: schedule?.source ?? null }
    })
  )

  await writeAgentCache(
    {
      tier: '24h',
      sport: 'GLOBAL',
      dataType: 'static_preload',
      identifier: 'daily',
    },
    {
      refreshedAt: new Date().toISOString(),
      jobs,
    },
    { ttlMs: 24 * 60 * 60 * 1000 }
  )

  return jobs
}

export async function preloadGameDayAgentData() {
  const jobs = await Promise.all([
    getSportsData({ sport: 'NFL', dataType: 'games' }).catch(() => null),
    getSportsData({ sport: 'NFL', dataType: 'schedule' }).catch(() => null),
  ])

  await writeAgentCache(
    {
      tier: '1h',
      sport: 'NFL',
      dataType: 'gameday_preload',
      identifier: 'sunday',
    },
    {
      refreshedAt: new Date().toISOString(),
      jobs: jobs.map((job) => ({ source: job?.source ?? null, cached: job?.cached ?? false })),
    },
    { ttlMs: 60 * 60 * 1000 }
  )

  return jobs
}

export async function preloadWaiverRecommendations() {
  const leagues = await prisma.league.findMany({
    where: {
      lastSyncedAt: { not: null },
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 50,
    select: {
      id: true,
      sport: true,
      scoring: true,
      isDynasty: true,
      settings: true,
    },
  })

  await writeAgentCache(
    {
      tier: '1h',
      sport: 'GLOBAL',
      dataType: 'waiver_precompute',
      identifier: 'wednesday',
    },
    {
      refreshedAt: new Date().toISOString(),
      leagues: leagues.map((league) => ({
        id: league.id,
        sport: league.sport,
        format: league.isDynasty ? 'dynasty' : 'redraft',
        scoring: league.scoring ?? null,
      })),
    },
    { ttlMs: 60 * 60 * 1000 }
  )

  return { leaguesProcessed: leagues.length }
}

function readDraftDate(settings: unknown): Date | null {
  const record = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? (settings as Record<string, unknown>)
    : {}
  const raw = record.draftDate
  if (typeof raw !== 'string' || !raw.trim()) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export async function preloadUpcomingDrafts() {
  const sessions = await prisma.draftSession.findMany({
    where: {
      status: 'pre_draft',
    },
    take: 50,
    orderBy: [{ updatedAt: 'asc' }],
    select: {
      id: true,
      leagueId: true,
      league: {
        select: {
          name: true,
          sport: true,
          settings: true,
        },
      },
    },
  })

  const now = Date.now()
  const upcoming = sessions.filter((session) => {
    const draftDate = readDraftDate(session.league.settings)
    if (!draftDate) return false
    const diffMs = draftDate.getTime() - now
    return diffMs >= 0 && diffMs <= 30 * 60 * 1000
  })

  const jobs = await Promise.all(
    upcoming.map(async (session) => {
      const sport = String(session.league.sport) as SupportedSport
      const [players, teams] = await Promise.all([
        getSportsData({ sport, dataType: 'players' }).catch(() => null),
        getSportsData({ sport, dataType: 'teams' }).catch(() => null),
      ])

      return {
        leagueId: session.leagueId,
        leagueName: session.league.name ?? 'Draft league',
        sport,
        playersSource: players?.source ?? null,
        teamsSource: teams?.source ?? null,
      }
    })
  )

  await writeAgentCache(
    {
      tier: '1h',
      sport: 'GLOBAL',
      dataType: 'draft_preload',
      identifier: 'upcoming',
    },
    {
      refreshedAt: new Date().toISOString(),
      jobs,
    },
    { ttlMs: 60 * 60 * 1000 }
  )

  return { draftsPreloaded: jobs.length, jobs }
}
