/**
 * Draft settings as Sleeper-style pickers (owner request, 2026-11-28): type, time per pick, rounds and
 * player pool before the draft starts. Once the draft has started they stand down: the settings PATCH
 * does not freeze them, so the hub must not offer a one-tap format change mid-draft.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeagueSettingsHubView, type HubCallbacks, type HubViewData } from '@/components/league-settings/hub/LeagueSettingsHubView'
import { buildDraftGroups } from '@/lib/league-settings-hub/hubModel'

afterEach(cleanup)

const payload = { settings: { draftType: 'snake', pickTimerPreset: '90s', rounds: 15, playerPool: 'all', autostart: true } }
const rows = (draftStarted?: boolean) => buildDraftGroups(payload, { draftStarted }).flatMap((g) => g.rows)

describe('draft pickers', () => {
  it('before the draft: type, timer, rounds and pool each offer their choices', () => {
    const r = rows(false)
    expect(r.find((x) => x.key === 'type')?.edit?.choices.map((c) => c.value)).toEqual(['snake', 'linear', '3rd_reversal', 'auction'])
    expect(r.find((x) => x.key === 'type')?.value).toBe('Snake')
    expect(r.find((x) => x.key === 'timer')?.edit?.current).toBe('90s')
    expect(r.find((x) => x.key === 'timer')?.edit?.choices.find((c) => c.value === '3h')?.label).toBe('3 hours')
    expect(r.find((x) => x.key === 'rounds')?.edit?.choices).toHaveLength(30)
    expect(r.find((x) => x.key === 'pool')?.edit?.choices.map((c) => c.value)).toEqual(['all', 'rookies_only', 'veterans_only'])
  })

  it('once the draft has started, none of them is offered', () => {
    for (const key of ['type', 'timer', 'rounds', 'pool']) expect(rows(true).find((x) => x.key === key)?.edit).toBeUndefined()
  })

  it('a custom timer stays listed as the current value', () => {
    const r = buildDraftGroups({ settings: { pickTimerPreset: 'custom', pickTimerCustomValue: 45 } }).flatMap((g) => g.rows)
    const timer = r.find((x) => x.key === 'timer')!
    expect(timer.edit?.current).toBe('custom')
    expect(timer.edit?.choices.some((c) => c.value === 'custom')).toBe(true)
  })

  it('a commissioner picks a draft type and it saves that field', async () => {
    const onSetSetting = vi.fn(async () => null)
    const data = { leagueId: 'L', leagueName: 'T', kind: 'redraft', sport: 'NFL', season: 2026, teamCount: 12, canEdit: true, isHeadCommissioner: true, importedFrom: null, draft: buildDraftGroups(payload) } as unknown as HubViewData
    const cb = new Proxy({ onSetSetting } as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : vi.fn()) }) as unknown as HubCallbacks
    render(<LeagueSettingsHubView data={data} cb={cb} />)
    const fold = document.querySelector('[data-testid="league-settings-fold-draft"]') as HTMLDetailsElement | null
    if (fold) fold.open = true
    fireEvent.click(screen.getByTestId('setting-row-draftType'))
    fireEvent.click(screen.getByTestId('setting-choice-linear'))
    await waitFor(() => expect(onSetSetting).toHaveBeenCalledWith('draftType', 'linear'))
  })
})
