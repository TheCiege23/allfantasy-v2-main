import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEMO_DECISIONS,
  DEMO_LEAGUES,
  DEMO_WEEKS,
  PARTNER_API_ENDPOINTS,
  activityTrendPct,
  decisionShares,
  findDemoLeague,
  freshnessLabel,
  leaguesByAttention,
  summarizeTenant,
  tierFor,
} from '@/lib/partner-portal/demoTenant'

describe('the demo tenant (partner front door, 2026-11-17)', () => {
  it('tiers follow the four health bands, edges included', () => {
    expect([100, 85, 84, 70, 69, 60, 59, 0].map(tierFor)).toEqual(['strong', 'strong', 'steady', 'steady', 'watch', 'watch', 'at_risk', 'at_risk'])
  })

  it('the tiles add up from the leagues, not from typed-in totals', () => {
    const s = summarizeTenant(DEMO_LEAGUES)
    expect(s.leagues).toBe(DEMO_LEAGUES.length)
    expect(s.managers).toBe(DEMO_LEAGUES.reduce((n, l) => n + l.managers, 0))
    expect(s.activeManagers).toBe(DEMO_LEAGUES.reduce((n, l) => n + l.activeManagers, 0))
    expect(s.activePct).toBe(Math.round((s.activeManagers / s.managers) * 100))
    expect(s.weeklyActions).toHaveLength(DEMO_WEEKS.length)
    expect(s.weeklyActions[0]).toBe(DEMO_LEAGUES.reduce((n, l) => n + l.weeklyActions[0]!, 0))
    expect(s.needsAttention).toBe(DEMO_LEAGUES.filter((l) => l.health < 70).length)
  })

  it('every league is internally consistent', () => {
    for (const l of DEMO_LEAGUES) {
      expect(l.activeManagers, l.id).toBeLessThanOrEqual(l.managers)
      expect(l.weeklyActions, l.id).toHaveLength(DEMO_WEEKS.length)
      expect(l.health, l.id).toBeGreaterThanOrEqual(0)
      expect(l.health, l.id).toBeLessThanOrEqual(100)
      expect(l.evidence.length, l.id).toBeGreaterThan(0)
    }
    expect(new Set(DEMO_LEAGUES.map((l) => l.id)).size).toBe(DEMO_LEAGUES.length)
  })

  it('the table puts the leagues that need attention first, worst first', () => {
    const ids = leaguesByAttention(DEMO_LEAGUES).map((l) => l.id)
    expect(ids[0]).toBe('blue-ridge-keepers') // 52, at risk
    expect(ids[1]).toBe('prairie-guillotine') // 69, watch
    expect(ids[ids.length - 1]).toBe('harbor-city') // 91, the healthiest
  })

  it('a decision bar always totals 100%, and its counts never exceed what was shown', () => {
    for (const r of DEMO_DECISIONS) {
      const s = decisionShares(r)
      expect(s.actedPct + s.dismissedPct + s.noResponsePct, r.kind).toBe(100)
      expect(r.actedOn + r.dismissed, r.kind).toBeLessThanOrEqual(r.shown)
      expect(r.measured, r.kind).toBeLessThanOrEqual(r.actedOn)
      expect(r.helped, r.kind).toBeLessThanOrEqual(r.measured)
    }
    expect(decisionShares({ ...DEMO_DECISIONS[0]!, measured: 0, helped: 0 }).helpedPct).toBeNull()
  })

  it('trend, freshness and lookup helpers', () => {
    expect(activityTrendPct([100, 50, 90])).toBe(-10)
    expect(activityTrendPct([])).toBe(0)
    expect(freshnessLabel(6)).toBe('6 min ago')
    expect(freshnessLabel(60)).toBe('1 h ago')
    expect(freshnessLabel(95)).toBe('1 h 35 min ago')
    expect(findDemoLeague('iron-horse')?.name).toBe('Iron Horse Dynasty')
    expect(findDemoLeague('../etc')).toBeNull()
    expect(findDemoLeague(undefined)).toBeNull()
  })

  it('🛑 every endpoint the page advertises exists as a route, with that method', async () => {
    const { readFileSync } = await import('node:fs')
    for (const e of PARTNER_API_ENDPOINTS) {
      const dir = e.path.replace(/^\//, '').replace(/\{(\w+)\}/g, '[$1]')
      const file = path.join(process.cwd(), 'app', ...dir.split('/'), 'route.ts')
      expect(existsSync(file), e.path).toBe(true)
      expect(readFileSync(file, 'utf8'), e.path).toMatch(new RegExp(`export (async function|const) ${e.method}\\b`))
    }
  })
})
