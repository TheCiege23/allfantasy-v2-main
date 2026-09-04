import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  errorFromException,
  isValidConfidence,
  isValidEventSeverity,
  isValidSeverity,
  isWellFormedResponse,
  normalizeConfidence,
  normalizeErrorContract,
  normalizeEventSeverity,
  normalizeEvidenceMetadata,
  normalizeEvidencePoints,
  normalizeList,
  normalizeRecommendation,
  normalizeRecommendationList,
  normalizeSeverity,
  normalizeTimestamp,
  resetCommissionerAdapterLogger,
  setCommissionerAdapterLogger,
} from "@/lib/commissioner-ui/adapter/index"
import { buildDecisionOSAdapter } from "@/lib/commissioner-ui/adapter"
import type { CommissionerRecommendationContract } from "@/lib/commissioner-ui/contracts"

function makeRecommendation(overrides: Partial<CommissionerRecommendationContract> = {}): CommissionerRecommendationContract {
  return {
    id: 'rec-1',
    title: 'Test',
    rationale: 'Because.',
    severity: 'standard',
    confidence: 'moderate',
    expectedImpact: 'Some impact.',
    primaryActionLabel: 'Act',
    status: 'new',
    category: 'administrative',
    sourceModuleId: 'recommendations',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe("commissioner-os adapter — normalization primitives", () => {
  it("normalizeTimestamp accepts a valid ISO string and coerces anything else to now", () => {
    const valid = '2026-01-01T00:00:00.000Z'
    expect(normalizeTimestamp(valid)).toBe(valid)
    expect(Number.isNaN(Date.parse(normalizeTimestamp(undefined)))).toBe(false)
    expect(Number.isNaN(Date.parse(normalizeTimestamp('not a date')))).toBe(false)
    expect(Number.isNaN(Date.parse(normalizeTimestamp(null)))).toBe(false)
  })

  it("normalizeConfidence and normalizeSeverity pass through valid values and fall back on invalid ones", () => {
    expect(normalizeConfidence('high')).toBe('high')
    expect(normalizeConfidence('nonsense')).toBe('moderate')
    expect(normalizeConfidence(undefined)).toBe('moderate')
    expect(normalizeSeverity('critical')).toBe('critical')
    expect(normalizeSeverity('nonsense')).toBe('standard')
    expect(normalizeSeverity(null)).toBe('standard')
  })

  it("isValidConfidence / isValidSeverity are true only for exact enum members", () => {
    expect(isValidConfidence('very_high')).toBe(true)
    expect(isValidConfidence('VERY_HIGH')).toBe(false)
    expect(isValidSeverity('positive')).toBe(true)
    expect(isValidSeverity('good')).toBe(false)
  })

  it("normalizeEventSeverity passes through valid values and falls back on invalid ones; isValidEventSeverity is true only for exact enum members", () => {
    expect(normalizeEventSeverity('critical')).toBe('critical')
    expect(normalizeEventSeverity('warning')).toBe('warning')
    expect(normalizeEventSeverity('nonsense')).toBe('informational')
    expect(normalizeEventSeverity(undefined)).toBe('informational')
    expect(isValidEventSeverity('success')).toBe(true)
    expect(isValidEventSeverity('positive')).toBe(false)
  })

  it("normalizeErrorContract fills in missing fields and rejects an invalid category", () => {
    const result = normalizeErrorContract(
      { category: 'not-a-real-category' as never, message: '', retryable: undefined as never, timestamp: 'bad' },
      'league-health'
    )
    expect(result?.category).toBe('unknown')
    expect(result?.message).toBe('An unspecified error occurred.')
    expect(result?.moduleId).toBe('league-health')
    expect(result?.retryable).toBe(false)
    expect(Number.isNaN(Date.parse(result!.timestamp))).toBe(false)
  })

  it("normalizeErrorContract passes null through unchanged", () => {
    expect(normalizeErrorContract(null, 'recommendations')).toBeNull()
  })

  it("errorFromException always produces an honest upstream_unavailable, never a raw Error", () => {
    const fromError = errorFromException(new Error('boom'), 'managers')
    expect(fromError.category).toBe('upstream_unavailable')
    expect(fromError.message).toBe('boom')
    expect(fromError.retryable).toBe(false)

    const fromString = errorFromException('a raw thrown string', 'managers')
    expect(fromString.category).toBe('upstream_unavailable')
    expect(fromString.message).toBe('An unexpected error occurred while contacting Decision OS.')
  })

  it("normalizeList guarantees an array even when given null/undefined", () => {
    expect(normalizeList(null)).toEqual([])
    expect(normalizeList(undefined)).toEqual([])
    expect(normalizeList([1, 2])).toEqual([1, 2])
  })

  it("normalizeEvidencePoints trims whitespace and drops incomplete points", () => {
    const result = normalizeEvidencePoints([
      { label: '  Trade volume  ', detail: '  Up 20%  ' },
      { label: '', detail: 'orphaned detail' },
      { label: 'orphaned label', detail: '' },
    ])
    expect(result).toEqual([{ label: 'Trade volume', detail: 'Up 20%' }])
  })

  it("normalizeEvidenceMetadata fills confidence, asOf, and sourceModuleId when absent", () => {
    const result = normalizeEvidenceMetadata(undefined, 'league-health')
    expect(result.confidence).toBe('moderate')
    expect(result.sourceModuleId).toBe('league-health')
    expect(Number.isNaN(Date.parse(result.asOf))).toBe(false)
  })

  it("normalizeRecommendation coerces an invalid severity/confidence without touching other fields", () => {
    const rec = makeRecommendation({ severity: 'nonsense' as never, confidence: 'nonsense' as never, title: 'Keep me' })
    const result = normalizeRecommendation(rec)
    expect(result.severity).toBe('standard')
    expect(result.confidence).toBe('moderate')
    expect(result.title).toBe('Keep me')
  })

  it("normalizeRecommendationList maps over the whole array and guards null", () => {
    expect(normalizeRecommendationList(null)).toEqual([])
    const result = normalizeRecommendationList([makeRecommendation({ severity: 'critical' })])
    expect(result[0].severity).toBe('critical')
  })
})

describe("commissioner-os adapter — contract validation", () => {
  it("accepts a well-formed response envelope", () => {
    expect(isWellFormedResponse({ data: null, error: null, source: 'stub', timestamp: new Date().toISOString() })).toBe(true)
  })

  it("rejects a missing field, an invalid source, or a malformed timestamp", () => {
    expect(isWellFormedResponse({ data: null, error: null, source: 'stub' })).toBe(false)
    expect(isWellFormedResponse({ data: null, error: null, source: 'production', timestamp: new Date().toISOString() })).toBe(false)
    expect(isWellFormedResponse({ data: null, error: null, source: 'stub', timestamp: 'not a date' })).toBe(false)
    expect(isWellFormedResponse(null)).toBe(false)
    expect(isWellFormedResponse('a string')).toBe(false)
  })
})

describe("commissioner-os adapter — logging hooks", () => {
  afterEach(() => {
    resetCommissionerAdapterLogger()
  })

  it("is pluggable — a custom logger receives adapter events", async () => {
    const events: unknown[] = []
    setCommissionerAdapterLogger({ log: (event) => events.push(event) })

    const adapter = buildDecisionOSAdapter('demo')
    await adapter.missionControl.getLeagueHealthSummary()

    expect(events.length).toBeGreaterThan(0)
    expect(events[0]).toMatchObject({ type: 'success', moduleId: 'mission-control', method: 'getLeagueHealthSummary' })
  })
})

describe("commissioner-os adapter — buildDecisionOSAdapter composition", () => {
  it("exposes all twelve namespaces plus the mode it was built for", () => {
    const adapter = buildDecisionOSAdapter('demo')
    expect(adapter.mode).toBe('demo')
    expect(typeof adapter.missionControl.getLeagueHealthSummary).toBe('function')
    expect(typeof adapter.leagueHealth.getHealthDetail).toBe('function')
    expect(typeof adapter.managers.getManagerDirectory).toBe('function')
    expect(typeof adapter.recommendations.getQueue).toBe('function')
    expect(typeof adapter.workspace.getTasks).toBe('function')
    expect(typeof adapter.automations.getCatalog).toBe('function')
    expect(typeof adapter.automations.getExecutionHistory).toBe('function')
    expect(typeof adapter.automations.getSummary).toBe('function')
    expect(typeof adapter.analytics.getSnapshot).toBe('function')
    expect(typeof adapter.analytics.getSummary).toBe('function')
    expect(typeof adapter.reports.getTemplates).toBe('function')
    expect(typeof adapter.reports.getHistory).toBe('function')
    expect(typeof adapter.reports.getSummary).toBe('function')
    expect(typeof adapter.search.getIndex).toBe('function')
    expect(typeof adapter.notifications.getNotifications).toBe('function')
    expect(typeof adapter.notifications.getSummary).toBe('function')
    expect(typeof adapter.activity.getEvents).toBe('function')
    expect(typeof adapter.help.getArticles).toBe('function')
    expect(typeof adapter.help.getGlossary).toBe('function')
  })

  it("every response returned through the adapter is well-formed, in every mode", async () => {
    for (const mode of ['stub', 'demo', 'live'] as const) {
      const adapter = buildDecisionOSAdapter(mode)
      const responses = await Promise.all([
        adapter.missionControl.getLeagueHealthSummary(),
        adapter.missionControl.getManagerHighlights(),
        adapter.missionControl.getMissionControlKpis(),
        adapter.leagueHealth.getHealthDetail(),
        adapter.leagueHealth.getRisks(),
        adapter.leagueHealth.getEvidence(),
        adapter.leagueHealth.getRecommendations(),
        adapter.managers.getManagerDirectory(),
        adapter.recommendations.getQueue(),
        adapter.workspace.getTasks(),
        adapter.automations.getCatalog(),
        adapter.automations.getExecutionHistory('any-id'),
        adapter.automations.getSummary(),
        adapter.analytics.getSnapshot(),
        adapter.analytics.getSummary(),
        adapter.reports.getTemplates(),
        adapter.reports.getHistory(),
        adapter.reports.getSummary(),
        adapter.search.getIndex(),
        adapter.notifications.getNotifications(),
        adapter.notifications.getSummary(),
        adapter.activity.getEvents(),
        adapter.help.getArticles(),
        adapter.help.getGlossary(),
      ])
      for (const response of responses) {
        expect(isWellFormedResponse(response)).toBe(true)
        expect(response.source).toBe(mode)
      }
    }
  })

  it("stub and demo return real data; live remains an honest, typed placeholder error", async () => {
    const stub = buildDecisionOSAdapter('stub')
    const demo = buildDecisionOSAdapter('demo')
    const live = buildDecisionOSAdapter('live')

    const stubHealth = await stub.leagueHealth.getHealthDetail()
    const demoHealth = await demo.leagueHealth.getHealthDetail()
    const liveHealth = await live.leagueHealth.getHealthDetail()

    expect(stubHealth.error).toBeNull()
    expect(stubHealth.data).not.toBeNull()
    expect(demoHealth.error).toBeNull()
    expect(demoHealth.data).not.toBeNull()
    expect(liveHealth.data).toBeNull()
    expect(liveHealth.error?.category).toBe('upstream_unavailable')
    expect(liveHealth.error?.retryable).toBe(false)
  })

  it("normalizes severity/confidence on recommendation and health payloads flowing through the adapter", async () => {
    const adapter = buildDecisionOSAdapter('demo')
    const recs = await adapter.recommendations.getQueue()
    for (const rec of recs.data ?? []) {
      expect(['critical', 'elevated', 'standard', 'advisory', 'positive']).toContain(rec.severity)
      expect(['developing_signal', 'moderate', 'high', 'very_high']).toContain(rec.confidence)
    }
  })

  it("normalizes task priority against the real severity enum", async () => {
    const adapter = buildDecisionOSAdapter('demo')
    const tasks = await adapter.workspace.getTasks()
    for (const task of tasks.data ?? []) {
      expect(['critical', 'elevated', 'standard', 'advisory', 'positive']).toContain(task.priority)
    }
  })

  it("normalizes automation health against the real severity enum", async () => {
    const adapter = buildDecisionOSAdapter('demo')
    const catalog = await adapter.automations.getCatalog()
    for (const automation of catalog.data ?? []) {
      expect(['critical', 'elevated', 'standard', 'advisory', 'positive']).toContain(automation.health)
    }
  })

  it("normalizes notification and activity event severity against the real event-severity enum", async () => {
    const adapter = buildDecisionOSAdapter('demo')
    const notifications = await adapter.notifications.getNotifications()
    for (const notification of notifications.data ?? []) {
      expect(['informational', 'success', 'warning', 'critical']).toContain(notification.severity)
    }
    const events = await adapter.activity.getEvents()
    for (const event of events.data ?? []) {
      expect(['informational', 'success', 'warning', 'critical']).toContain(event.severity)
    }
  })
})

describe("commissioner-os adapter — no UI module imports Decision OS internals directly", () => {
  const FORBIDDEN_IMPORT = /from ['"]@\/lib\/commissioner-ui\/(?:decision-os-client|league-health\/decision-os-client|managers\/decision-os-client|recommendations\/decision-os-client|workspace\/decision-os-client|automations\/decision-os-client|analytics\/decision-os-client|reports\/decision-os-client|search\/decision-os-client|notifications\/decision-os-client|activity\/decision-os-client|help\/decision-os-client|demo-mode)['"]/

  const pageFiles = [
    'app/commissioner-os/page.tsx',
    'app/commissioner-os/league-health/page.tsx',
    'app/commissioner-os/managers/page.tsx',
    'app/commissioner-os/recommendations/page.tsx',
    'app/commissioner-os/automations/page.tsx',
    'app/commissioner-os/workspace/page.tsx',
    'app/commissioner-os/analytics/page.tsx',
    'app/commissioner-os/reports/page.tsx',
    'app/commissioner-os/activity/page.tsx',
    'app/commissioner-os/help/page.tsx',
    'app/commissioner-os/layout.tsx',
  ]

  it.each(pageFiles)("%s only imports from the adapter, not a per-module client or Demo Mode directly", (relativePath) => {
    const source = readFileSync(join(process.cwd(), relativePath), 'utf8')
    expect(source).toMatch(/from ['"]@\/lib\/commissioner-ui\/adapter['"]/)
    expect(source).not.toMatch(FORBIDDEN_IMPORT)
  })

  it("app/commissioner-os/search/page.tsx never imports a per-module client or Demo Mode directly (it triggers the palette the layout already fetched, it fetches nothing itself)", () => {
    const source = readFileSync(join(process.cwd(), 'app/commissioner-os/search/page.tsx'), 'utf8')
    expect(source).not.toMatch(FORBIDDEN_IMPORT)
  })

  it("app/commissioner-os/notifications/page.tsx never imports a per-module client or Demo Mode directly (it triggers the panel the layout already fetched, it fetches nothing itself)", () => {
    const source = readFileSync(join(process.cwd(), 'app/commissioner-os/notifications/page.tsx'), 'utf8')
    expect(source).not.toMatch(FORBIDDEN_IMPORT)
  })
})
