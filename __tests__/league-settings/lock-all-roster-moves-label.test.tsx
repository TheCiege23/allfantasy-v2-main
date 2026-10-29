/**
 * The commissioner's move lock is labelled "Lock all roster moves" wherever it is shown, because it now
 * blocks every member move (lineups, IR, claims, add/drop, trades), not only free agent and waiver
 * moves. Label only: the stored key is still `lockAllMoves`.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/components/subscription/SubscriptionGateModal', () => ({ SubscriptionGateModal: () => null }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ hasCommissioner: true }) }))
vi.mock('@/hooks/useSubscriptionGate', () => ({ useSubscriptionGateOptional: () => null }))

import { LeagueSettingsPanel } from '@/app/league/[leagueId]/components/settings/LeagueSettingsPanel'
import { translations } from '@/lib/i18n/translations'
import { translationsEsParity } from '@/lib/i18n/translations-es-parity'
import { buildCommissionerHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'

afterEach(cleanup)

const SNAPSHOT = {}

describe('"Lock all roster moves"', () => {
  it('the settings toggle carries the new label and still saves lockAllMoves', () => {
    const save = vi.fn(async () => undefined)
    render(
      <LeagueSettingsPanel
        leagueId="L"
        initialData={{ leagueType: 'redraft', lockAllMoves: false } as never}
        settingsSnapshot={SNAPSHOT}
        hasAfCommissionerSub
        canEdit
        save={save}
        debouncedSave={vi.fn()}
      />,
    )
    expect(screen.queryByText(/Lock all free agent and waiver moves/i)).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: /^Lock all roster moves/ }))
    expect(save).toHaveBeenCalledWith({ lockAllMoves: true })
  })

  it('has EN and ES copy, and the Spanish never says «waiver»', () => {
    expect(translations.en['leagueSettings.lockAllRosterMoves']).toBe('Lock all roster moves')
    expect(translationsEsParity['leagueSettings.lockAllRosterMoves']).toBe('Bloquear todos los movimientos de plantilla')
    expect(translations.es['leagueSettings.lockAllRosterMoves']).toBe('Bloquear todos los movimientos de plantilla')
    const hintEs = translationsEsParity['leagueSettings.lockAllRosterMovesHint']
    expect(hintEs).toMatch(/reclamos/)
    expect(`${hintEs} ${translationsEsParity['leagueSettings.lockAllRosterMoves']}`).not.toMatch(/waiver/i)
  })

  it('the commissioner hub action says the same thing', () => {
    const labelFor = (lockAllMoves: boolean) =>
      buildCommissionerHealthSnapshot({
        now: new Date('2026-10-25T12:00:00Z'),
        league: { id: 'L', name: 'L', sport: 'NBA', lockAllMoves },
        counts: { pendingWaiverClaims: 0, pendingTrades: 0 },
      } as never).actions.find((a) => a.key === (lockAllMoves ? 'unlock_rosters' : 'lock_rosters'))?.label
    expect(labelFor(false)).toBe('Lock all roster moves')
    expect(labelFor(true)).toBe('Unlock all roster moves')
  })
})
