/**
 * The old league header's IDP view switch and devy counts, brought back for imported leagues in the workspace
 * (2026-11-22, components/league/native/ImportedLeagueExtras.tsx). The workspace shows heading extras only for an
 * imported league; a native league never had them.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevyBucketCounts, IdpViewSwitch } from '@/components/league/native/ImportedLeagueExtras'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  HTMLDialogElement.prototype.showModal ??= function () {}
  HTMLDialogElement.prototype.close ??= function () {}
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('IdpViewSwitch', () => {
  it('shows Offense / Defense / Full team, marks the current one, and reports a pick', () => {
    const onChange = vi.fn()
    render(<IdpViewSwitch value="full" onChange={onChange} />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['offense', 'defense', 'Full team'])
    expect(screen.getByTestId('idp-view-full').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('idp-view-defense').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByTestId('idp-view-defense'))
    expect(onChange).toHaveBeenCalledWith('defense')
  })
})

describe('DevyBucketCounts', () => {
  it('reads "N NFL · N Taxi · N Devy"', () => {
    render(<DevyBucketCounts stats={{ active: 18, taxi: 3, devy: 6 }} />)
    expect(screen.getByTestId('devy-bucket-stats').textContent).toBe('18 NFL·3 Taxi·6 Devy')
  })
})

describe('workspace heading extras', () => {
  const tabs = ['native_home', 'roster'].map((id) => ({ id, label: id }))
  const league = (platform: string) => ({ id: 'L1', name: 'Devy Dynasty', platform, sport: 'NFL', season: 2026, teamCount: 12, format: 'dynasty', scoring: 'PPR', currentWeek: 5, lifecycleState: 'in_season' }) as never
  const renderWith = (platform: string, native: boolean) =>
    render(
      <NativeLeagueWorkspace native={native} league={league(platform)} leagues={[league(platform)]} tabs={tabs} activeTab="native_home" isCommissioner
        onSelectTab={() => {}} onOpenSettings={() => {}} headingExtras={<DevyBucketCounts stats={{ active: 1, taxi: 2, devy: 3 }} />} leftPanel={null} rightPanel={null}>
        <div>screen</div>
      </NativeLeagueWorkspace>,
    )

  it('an imported league shows them under its name', () => {
    renderWith('sleeper', false)
    expect(screen.getByTestId('devy-bucket-stats').closest('.nl-heading-name')).toBeTruthy()
  })

  it('a native league ignores them', () => {
    renderWith('allfantasy', true)
    expect(screen.queryByTestId('devy-bucket-stats')).toBeNull()
  })
})
