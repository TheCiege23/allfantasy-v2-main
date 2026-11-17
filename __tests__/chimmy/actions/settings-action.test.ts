import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

/**
 * League settings through Chimmy — stage 5 (2026-11-16). Owner's rules: AllFantasy-hosted leagues only;
 * any commissioner (a co-commissioner within their areas, which the settings pipeline enforces); once
 * the season has started the card warns and needs a second tap. Nothing is saved without the tap, and
 * the save is the settings page's own pipeline.
 */

const h = vi.hoisted(() => ({
  elevated: vi.fn(async () => true),
  league: vi.fn(),
  patch: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.league } } }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: h.elevated }))
vi.mock('@/server/services/leagueLifecycleService', () => ({
  getLeagueLifecycleState: (row: { lifecycleState?: string | null }) => row.lifecycleState ?? 'in_season',
}))
vi.mock('@/lib/league/settingsLifecycleGate', () => ({
  SETTINGS_EDIT_POLICY: {
    setup: 'allowed', pre_draft: 'allowed', drafting: 'refused', post_draft: 'confirm', in_season: 'confirm',
    playoffs: 'confirm', completed: 'allowed', offseason: 'allowed', renewal_pending: 'allowed', archived: 'refused',
  },
}))
vi.mock('@/lib/league/execute-league-settings-patch', () => ({ executeLeagueSettingsPatch: h.patch }))

import { executeSettingsAction, proposeSettingsChange } from '@/lib/chimmy/actions/settingsAction'
import { verifyChimmyActionToken } from '@/lib/chimmy/actions/actionToken'

const NOW = new Date('2026-08-01T15:00:00Z')
const prevSecret = process.env.NEXTAUTH_SECRET

const LEAGUE = {
  name: 'Dynasty Ten',
  sport: 'NFL',
  season: 2026,
  platform: 'manual',
  lifecycleState: 'pre_draft',
  leagueSize: 10,
  waiverType: 'faab',
  waiverBudget: 100,
  waiverMinBid: 0,
  tradeReviewHours: 48,
  tradeDeadlineWeek: 11,
  playoffTeams: 4,
  playoffStartWeek: 15,
  irSlots: 1,
  _count: { teams: 10 },
}
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 })

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret'
  vi.clearAllMocks()
  h.elevated.mockResolvedValue(true)
  h.league.mockResolvedValue({ ...LEAGUE })
  h.patch.mockResolvedValue(ok())
})
afterEach(() => {
  if (prevSecret === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = prevSecret
})

const payloadOf = (token: string) => {
  const v = verifyChimmyActionToken(token, NOW)
  if (!v.ok) throw new Error(v.reason)
  return v.payload
}
async function card(changes: Record<string, unknown>) {
  const r = await proposeSettingsChange({ leagueId: 'L1', userId: 'u1', changes, now: NOW })
  if (!r.ok) throw new Error(r.text)
  return r
}

describe('proposeSettingsChange', () => {
  it('builds a card showing each setting before → after, and saves nothing', async () => {
    const r = await card({ waiverBudget: 200, waiverMinBid: '1' })
    expect(r.card.kind).toBe('settings')
    expect(r.card.settings).toEqual({
      changes: [
        { label: 'FAAB budget', from: '$100', to: '$200' },
        { label: 'Minimum FAAB bid', from: '$0', to: '$1' },
      ],
      midSeason: false,
    })
    expect(r.text).toMatch(/NOTHING has changed yet/)
    // Found live: with nothing said, the model invented a mid-season second tap and a budget side effect.
    expect(r.text).toMatch(/season has NOT started, so ONE tap saves it — do not mention a second tap/)
    expect(r.text).toMatch(/do NOT claim effects on remaining budgets/)
    expect(h.patch).not.toHaveBeenCalled()
    expect(payloadOf(r.card.token).spec).toEqual({
      kind: 'settings',
      section: 'waivers',
      changes: [
        { key: 'waiverBudget', from: 100, to: 200 },
        { key: 'waiverMinBid', from: 0, to: 1 },
      ],
      midSeason: false,
    })
  })

  it('refuses anyone who is not the commissioner', async () => {
    h.elevated.mockResolvedValue(false)
    const r = await proposeSettingsChange({ leagueId: 'L1', userId: 'u2', changes: { waiverBudget: 200 }, now: NOW })
    expect(r).toMatchObject({ ok: false })
    expect(r.text).toMatch(/commissioner/)
  })

  it('refuses an imported league and points at its platform', async () => {
    h.league.mockResolvedValue({ ...LEAGUE, platform: 'sleeper' })
    const r = await proposeSettingsChange({ leagueId: 'L1', userId: 'u1', changes: { waiverBudget: 200 }, now: NOW })
    expect(r.ok).toBe(false)
    expect(r.text).toMatch(/imported from sleeper.*changed there/)
  })

  it('refuses settings it does not cover, bad values, and two areas in one card', async () => {
    const scoring = await proposeSettingsChange({ leagueId: 'L1', userId: 'u1', changes: { scoring: 'ppr' }, now: NOW })
    expect(scoring.text).toMatch(/can't change scoring.*Settings page/)
    const tooMany = await proposeSettingsChange({ leagueId: 'L1', userId: 'u1', changes: { playoffTeams: 12 }, now: NOW })
    expect(tooMany.text).toMatch(/playoff teams must be between 2 and 10/)
    const split = await proposeSettingsChange({ leagueId: 'L1', userId: 'u1', changes: { waiverBudget: 200, tradeReviewHours: 24 }, now: NOW })
    expect(split.text).toMatch(/one card covers one part/)
  })

  it('says when a setting is already what was asked', async () => {
    const r = await proposeSettingsChange({ leagueId: 'L1', userId: 'u1', changes: { waiverType: 'FAAB' }, now: NOW })
    expect(r.ok).toBe(false)
    expect(r.text).toMatch(/Waiver type is already FAAB bidding/)
  })

  it('reads "no deadline" and a week number for the trade deadline', async () => {
    expect((await card({ tradeDeadlineWeek: 0 })).card.settings!.changes[0]).toEqual({ label: 'Trade deadline', from: 'Week 11', to: 'no deadline' })
    expect((await card({ tradeDeadlineWeek: 12 })).card.settings!.changes[0]!.to).toBe('Week 12')
  })

  it('mid-season: the card warns and is marked for a second tap', async () => {
    h.league.mockResolvedValue({ ...LEAGUE, lifecycleState: 'in_season' })
    const r = await card({ tradeReviewHours: 24 })
    expect(r.card.title).toBe('Change the trade review period')
    expect(r.card.settings!.midSeason).toBe(true)
    expect(r.text).toMatch(/needs a SECOND tap/)
    expect(r.text).not.toMatch(/ONE tap saves it/)
    expect(r.card.warnings.join(' ')).toMatch(/season has started/)
    expect(payloadOf(r.card.token).spec).toMatchObject({ midSeason: true, section: 'trades' })
  })

  it('roster settings cannot be proposed while the draft is running', async () => {
    h.league.mockResolvedValue({ ...LEAGUE, lifecycleState: 'drafting' })
    const r = await proposeSettingsChange({ leagueId: 'L1', userId: 'u1', changes: { irSlots: 2 }, now: NOW })
    expect(r.ok).toBe(false)
    expect(r.text).toMatch(/while the league is drafting/)
  })
})

describe('executeSettingsAction (only after the tap)', () => {
  it("saves through the settings page's pipeline, for this section", async () => {
    const r = await card({ waiverBudget: 200 })
    const res = await executeSettingsAction(payloadOf(r.card.token), 'u1')
    expect(res).toMatchObject({ ok: true, message: 'Saved — FAAB budget is now $200.', before: { waiverBudget: 100 }, after: { waiverBudget: 200 } })
    expect(r.card.title).toBe('Change the FAAB budget')
    expect(h.patch).toHaveBeenCalledWith('u1', { leagueId: 'L1', waiverBudget: 200 }, { section: 'waivers' })
  })

  it('refuses when the setting moved after the card was made', async () => {
    const r = await card({ waiverBudget: 200 })
    h.league.mockResolvedValue({ ...LEAGUE, waiverBudget: 150 })
    const res = await executeSettingsAction(payloadOf(r.card.token), 'u1')
    expect(res).toEqual({ ok: false, message: expect.stringMatching(/changed since this card was made/) })
    expect(h.patch).not.toHaveBeenCalled()
  })

  it('refuses a card made before the season started — it never asked for the second tap', async () => {
    const r = await card({ waiverBudget: 200 })
    h.league.mockResolvedValue({ ...LEAGUE, lifecycleState: 'in_season' })
    const res = await executeSettingsAction(payloadOf(r.card.token), 'u1')
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/season has started since this card was made/)
    expect(h.patch).not.toHaveBeenCalled()
  })

  it('a mid-season card sends the mid-season confirmation the pipeline requires', async () => {
    h.league.mockResolvedValue({ ...LEAGUE, lifecycleState: 'in_season' })
    const r = await card({ irSlots: 2 })
    await executeSettingsAction(payloadOf(r.card.token), 'u1')
    expect(h.patch).toHaveBeenCalledWith('u1', { leagueId: 'L1', irSlots: 2, confirmMidSeasonChange: true }, { section: 'roster' })
  })

  it("relays the pipeline's own refusal (a lock, a co-commissioner without that area)", async () => {
    const r = await card({ waiverBudget: 200 })
    h.patch.mockResolvedValue(new Response(JSON.stringify({ error: 'The head commissioner hasn’t given you waivers permission in this league.' }), { status: 403 }))
    const res = await executeSettingsAction(payloadOf(r.card.token), 'u1')
    expect(res).toEqual({ ok: false, message: 'Nothing was saved: The head commissioner hasn’t given you waivers permission in this league..' })
  })

  it('refuses a non-commissioner at confirm time too', async () => {
    const r = await card({ waiverBudget: 200 })
    h.elevated.mockResolvedValue(false)
    expect((await executeSettingsAction(payloadOf(r.card.token), 'u1')).ok).toBe(false)
    expect(h.patch).not.toHaveBeenCalled()
  })
})

describe('wiring', () => {
  const read = (p: string) => readFileSync(path.resolve(__dirname, '..', '..', '..', p), 'utf8')
  it('the confirm route runs the settings branch before the trade fallthrough and writes a Chimmy audit row', () => {
    const src = read('lib/chimmy/actions/confirmAction.ts')
    expect(src.indexOf("payload.spec.kind === 'settings'")).toBeGreaterThan(0)
    expect(src.indexOf("payload.spec.kind === 'settings'")).toBeLessThan(src.indexOf('executeTradeAction(payload'))
    expect(src).toMatch(/actionType: 'chimmy_settings_changed'/)
  })
  it('the tool maps its arguments onto the catalog and the commissioner prompt no longer says AllFantasy changes nothing', () => {
    const tools = read('lib/chimmy/tools/chimmyTools.ts')
    expect(tools).toMatch(/case 'propose_league_rule_change':/)
    expect(tools).toMatch(/waiver_budget: 'waiverBudget'/)
    expect(read('lib/chimmy/commissionerGrounding.ts')).toMatch(/In an imported league AllFantasy changes nothing on the platform/)
  })
})
