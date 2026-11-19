/**
 * Chimmy's leaguemate record (2026-11-16, re-score item 11): facts only, paid. A plan holder gets the
 * Competitive Edge record; a free user gets no history at all and the chat's own AF Pro line and button.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { buildManagerRecordContext, matchManagers } from '@/lib/chimmy/managerRecordGrounding'
import { buildManagerRecord, type ManagerRecord } from '@/lib/competitive-edge/managerRecord'
import { PRO_ONLY_TOOL_LABEL, proUpsellLine, readProUpsell } from '@/lib/chimmy/answerPolish'
import { PRO_ONLY_CHIMMY_TOOLS, isProOnlyChimmyTool } from '@/lib/chimmy/chimmyDepth'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'

const access = (unlocked: boolean): CoreDepthAccess => ({
  depth: 'competitive_edge',
  unlocked,
  hasPlan: unlocked,
  preLaunchFree: false,
  startsAt: '2026-10-15T04:00:00.000Z',
  planName: 'AF Pro',
  label: 'Competitive Edge',
  upgradePath: '/upgrade?plan=pro',
})

function record(name: string, teamExternalId: string, trades: number): ManagerRecord {
  const side = (ownerId: string) => ({ ownerId, playersIn: [{ position: 'WR' }], playersOut: [{ position: 'RB' }], picksIn: [], picksOut: [] })
  return buildManagerRecord({
    manager: { name, teamExternalId, ownerId: name.toLowerCase() },
    viewerOwnerId: 'viewer',
    trades: {
      available: true,
      data: {
        trades: Array.from({ length: trades }, (_, i) => ({
          id: `${name}-${i}`, season: '2026', week: 1, createdIso: `2026-09-0${i + 1}T00:00:00Z`,
          sides: [side(name.toLowerCase()), side('other')],
        })),
        seasonsScanned: ['2026'], historyGaps: [], asOf: '2026-11-15T00:00:00Z', stale: false,
      },
    },
    waivers: { available: false, reason: 'Competitive Edge reads Sleeper waiver history today. ESPN leagues aren’t connected yet.' },
    drafts: { available: true, data: { picks: [], unattributedSeasons: [] } },
  })
}

const RECORDS = [record('Mike Jones', '3', 4), record('Mikayla', '4', 1), record('Sam', '5', 0)]
const load = vi.fn(async () => ({
  available: true as const,
  data: { league: { id: 'L1', name: 'Dynasty', platform: 'sleeper' }, viewerTeamExternalId: '1', records: RECORDS },
}))

describe('buildManagerRecordContext', () => {
  it('🛑 without Competitive Edge: no history at all, and a refusal the upgrade button rests on', async () => {
    const load = vi.fn()
    const out = await buildManagerRecordContext({ leagueId: 'L1', userId: 'u1', manager: 'Mike' }, { access: async () => access(false), load })
    expect(load).not.toHaveBeenCalled()
    expect(out.locked).toBe(true)
    expect(out.text).toContain('part of Competitive Edge')
    expect(out.text).toContain('Do NOT mention the plan, upgrading or this tool')
    expect(out.text).toContain('Do NOT describe, estimate or characterise')
    expect(out.text).not.toMatch(/trades|waiver claims this season/)
  })

  it('a plan holder gets one full record, with the contract beside it', async () => {
    const out = await buildManagerRecordContext({ leagueId: 'L1', userId: 'u1', manager: 'mike jones' }, { access: async () => access(true), load })
    expect(out.locked).toBe(false)
    expect(out.text).toContain('FACTS ONLY')
    expect(out.text).toContain('Never label the manager')
    expect(out.text).toContain('Mike Jones — Trades: ')
    expect(out.text).toContain('Mike Jones took on a WR in 4 of their 4 trades and sent one away in none.')
    // A section that could not be read says why; it is never left out to read as "quiet".
    expect(out.text).toContain("Waivers: could not be read — Competitive Edge reads Sleeper waiver history today. ESPN leagues aren’t connected yet.")
  })

  it('no name: one line per manager', async () => {
    const out = await buildManagerRecordContext({ leagueId: 'L1', userId: 'u1' }, { access: async () => access(true), load })
    expect(out.text).toContain('Mike Jones: 4 trades, waivers unknown, 0 drafts on file')
    expect(out.text).toContain('Sam: 0 trades')
  })

  it('an ambiguous or unknown name is asked about, never guessed', async () => {
    const two = await buildManagerRecordContext({ leagueId: 'L1', userId: 'u1', manager: 'mik' }, { access: async () => access(true), load })
    expect(two.text).toContain('matches more than one manager (Mike Jones, Mikayla)')
    const none = await buildManagerRecordContext({ leagueId: 'L1', userId: 'u1', manager: 'Zed' }, { access: async () => access(true), load })
    expect(none.text).toContain('no manager in this league matches "Zed"')
  })

  it('a refused league (not a member) says so and describes nobody', async () => {
    const out = await buildManagerRecordContext(
      { leagueId: 'L9', userId: 'u1', manager: 'Mike' },
      { access: async () => access(true), load: async () => ({ available: false, reason: 'Manager records are read only for a league you are in.' }) },
    )
    expect(out.text).toContain('not available — Manager records are read only for a league you are in.')
  })
})

describe('matchManagers', () => {
  it('exact beats a word match, which beats a substring', () => {
    expect(matchManagers(RECORDS, new Map(), 'Mike').map((r) => r.manager.name)).toEqual(['Mike Jones'])
    expect(matchManagers(RECORDS, new Map(), 'Mikayla').map((r) => r.manager.name)).toEqual(['Mikayla'])
  })
})

describe('the upgrade line and button (the chat\u2019s own AF Pro path, lib/chimmy/answerPolish.ts)', () => {
  it('the refusal is a known upsell, with its own line', () => {
    expect(readProUpsell(['get_manager_record'])).toEqual(['get_manager_record'])
    expect(proUpsellLine(['get_manager_record'])).toBe("AF Pro adds a leaguemate's full record.")
    expect(PRO_ONLY_TOOL_LABEL.get_manager_record).toBeTruthy()
  })

  it('🛑 but it is NOT pre-gated on the Chimmy plan: Competitive Edge decides, so War Room members are not refused', () => {
    expect(isProOnlyChimmyTool('get_manager_record')).toBe(false)
    expect(PRO_ONLY_CHIMMY_TOOLS).not.toContain('get_manager_record')
    // Positive control: the real Chimmy-tier tools still are.
    expect(isProOnlyChimmyTool('get_playoff_outlook')).toBe(true)
  })
})
