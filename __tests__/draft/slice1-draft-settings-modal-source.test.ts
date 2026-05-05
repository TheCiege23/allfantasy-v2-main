import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

describe('Slice 1 — Draft Settings modal + canonical entry point', () => {
  it('DraftSettingsModal exposes all 5 expected controls by testid', () => {
    const src = read('components/app/draft-room/DraftSettingsModal.tsx')
    expect(src).toMatch(/data-testid="draft-settings-trr"/)
    expect(src).toMatch(/data-testid="draft-settings-soft-timer"/)
    expect(src).toMatch(/data-testid="draft-settings-onclock-inherit"/)
    expect(src).toMatch(/data-testid="draft-settings-onclock-reset"/)
    expect(src).toMatch(/data-testid="draft-settings-player-trades"/)
    expect(src).toMatch(/data-testid="draft-settings-custom-rankings"/)
    expect(src).toMatch(/data-testid="draft-settings-modal-save"/)
  })

  it('DraftSettingsModal locks Third Round Reversal when sessionStatus !== pre_draft', () => {
    const src = read('components/app/draft-room/DraftSettingsModal.tsx')
    // Lock derived from sessionStatus comparison.
    expect(src).toMatch(/sessionStatus !== null && sessionStatus !== 'pre_draft'/)
    // Lock state actually disables the input.
    expect(src).toMatch(/disabled=\{trrLocked \|\| saving\}/)
  })

  it('DraftSettingsModal handles 409 THIRD_ROUND_REVERSAL_LOCKED response', () => {
    const src = read('components/app/draft-room/DraftSettingsModal.tsx')
    expect(src).toMatch(/THIRD_ROUND_REVERSAL_LOCKED/)
  })

  it('CommissionerControlCenterModal opens DraftSettingsModal via dedicated button', () => {
    const src = read('components/app/draft-room/CommissionerControlCenterModal.tsx')
    expect(src).toMatch(/import \{ DraftSettingsModal \} from '\.\/DraftSettingsModal'/)
    expect(src).toMatch(/data-testid="draft-commissioner-open-draft-settings"/)
    expect(src).toMatch(/<DraftSettingsModal leagueId=\{leagueId\}/)
  })
})

describe('Slice 1 — Hub typed flags + 3RR lock contract', () => {
  it('DraftVariantSettingsHub exports DraftSessionFlags + updateDraftSessionFlags', () => {
    const src = read('lib/draft-defaults/DraftVariantSettingsHub.ts')
    expect(src).toMatch(/export interface DraftSessionFlags/)
    expect(src).toMatch(/export async function updateDraftSessionFlags/)
    expect(src).toMatch(/code: 'THIRD_ROUND_REVERSAL_LOCKED'/)
  })

  it('updateDraftVariantSettings rejects 3RR config patch when status !== pre_draft', () => {
    const src = read('lib/draft-defaults/DraftVariantSettingsHub.ts')
    // Both code paths (sessionFlags and config.third_round_reversal) must check the lock.
    expect(src).toMatch(/Object\.prototype\.hasOwnProperty\.call\(patch\.config, 'third_round_reversal'\)/)
    expect(src).toMatch(/session\.status !== 'pre_draft'/)
  })

  it('PATCH route returns 409 with THIRD_ROUND_REVERSAL_LOCKED code', () => {
    const src = read('app/api/leagues/[leagueId]/draft/settings/route.ts')
    expect(src).toMatch(/code === 'THIRD_ROUND_REVERSAL_LOCKED'/)
    expect(src).toMatch(/status: 409/)
    // Accepts the new typed body fields.
    expect(src).toMatch(/sessionFlagsPatch\.onClockTradeTimerBehavior/)
    expect(src).toMatch(/sessionFlagsPatch\.inDraftPlayerTradesEnabled/)
    expect(src).toMatch(/sessionFlagsPatch\.customRankingsEnabled/)
  })
})

describe('Slice 1 — Schema + migration', () => {
  it('Prisma schema has the 3 new typed columns on DraftSession', () => {
    const src = read('prisma/schema.prisma')
    expect(src).toMatch(/onClockTradeTimerBehavior\s+String\s+@default\("inherit_remaining"\)/)
    expect(src).toMatch(/inDraftPlayerTradesEnabled\s+Boolean\s+@default\(true\)/)
    expect(src).toMatch(/customRankingsEnabled\s+Boolean\s+@default\(true\)/)
  })

  it('Migration SQL adds the 3 columns idempotently', () => {
    const sql = read('prisma/migrations/20260504200000_draft_settings_slice1/migration.sql')
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "onClockTradeTimerBehavior"/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "inDraftPlayerTradesEnabled"/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "customRankingsEnabled"/)
  })
})
