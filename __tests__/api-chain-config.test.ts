import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

describe('sports api chain config', () => {
  afterEach(() => {
    delete process.env.RI_NFL_ENABLED
    delete process.env.RI_NBA_ENABLED
    delete process.env.RI_MLB_ENABLED
    delete process.env.RI_NHL_ENABLED
    delete process.env.RI_NCAAF_ENABLED
    delete process.env.RI_NCAAB_ENABLED
    delete process.env.RI_SOCCER_ENABLED
    vi.resetModules()
  })

  it('defaults Rolling Insights to NFL only', async () => {
    const { ROLLING_INSIGHTS_SPORTS } = await import('@/lib/workers/api-config')

    expect(ROLLING_INSIGHTS_SPORTS.NFL).toBe(true)
    expect(ROLLING_INSIGHTS_SPORTS.NBA).toBe(false)
    expect(ROLLING_INSIGHTS_SPORTS.MLB).toBe(false)
    expect(ROLLING_INSIGHTS_SPORTS.NHL).toBe(false)
    expect(ROLLING_INSIGHTS_SPORTS.NCAAF).toBe(false)
    expect(ROLLING_INSIGHTS_SPORTS.NCAAB).toBe(false)
    expect(ROLLING_INSIGHTS_SPORTS.SOCCER).toBe(false)
    expect(ROLLING_INSIGHTS_SPORTS.Soccer).toBe(false)
  })

  it('enables all ClearSports tools when the provider is available', async () => {
    const { getClearSportsToolStates } = await import('@/lib/clear-sports/tool-support')

    const states = getClearSportsToolStates(true)

    expect(Object.values(states).every((tool) => tool.enabled)).toBe(true)
  })
})
