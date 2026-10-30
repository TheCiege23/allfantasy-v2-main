// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PirateRulesEditor } from '@/components/league-settings/home/PirateRulesEditor'
import { CommissionerCenter } from '@/components/league-settings/home/CommissionerCenter'
import { readPirateRules } from '@/lib/pirate/rules'
import type { SettingsHomeSection } from '@/lib/league-settings-home/buildLeagueSettingsHome'

const sections: SettingsHomeSection[] = [{ id: 'general', title: 'League', rows: [
  { id: 'general', label: 'League settings', value: 'Test', target: 'general' },
  { id: 'pirate', label: 'Pirate rules', value: '3 protected', target: 'pirate-rules' },
] }]
let persisted = readPirateRules({})
let failSave = false
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  if (init?.method === 'PATCH') {
    if (failSave) return { ok: false, json: async () => ({ error: 'Settings are locked.' }) }
    persisted = JSON.parse(String(init.body))
  }
  return { ok: true, json: async () => ({ rules: { ...persisted } }) }
})

function center() {
  return render(<CommissionerCenter sections={sections} initialSubPage="pirate-rules" inSeason={false}
    managers={{ joined: 1, total: 4, inviteUrl: null }}
    renderSubPage={id => ({ title: id === 'pirate-rules' ? 'Pirate rules' : 'League settings', content: id === 'pirate-rules' ? <PirateRulesEditor leagueId="test-league" /> : <p>General editor</p> })} />)
}

beforeEach(() => {
  persisted = readPirateRules({})
  failSave = false
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

describe('Pirate rules in commissioner settings', () => {
  it('saves through the shared bar and reloads server-confirmed values', async () => {
    const first = center()
    const input = await screen.findByLabelText('Protected players')
    expect((input as HTMLInputElement).value).toBe('3')
    expect(screen.queryByTestId('lsh-savebar')).toBeNull()
    fireEvent.change(input, { target: { value: '2' } })
    expect(persisted.protectionLimit).toBe(3)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Pirate rules saved.')
    expect(persisted.protectionLimit).toBe(2)
    expect(screen.queryByTestId('pirate-rules-save')).toBeNull()
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[0]).toBe('/api/leagues/test-league/pirate')
    first.unmount()
    center()
    expect((await screen.findByLabelText('Protected players') as HTMLInputElement).value).toBe('2')
  })

  it('keeps unsaved edits when a category switch is cancelled and discards only on confirmation', async () => {
    center()
    fireEvent.change(await screen.findByLabelText('Protected players'), { target: { value: '2' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.change(screen.getByLabelText('Settings category'), { target: { value: 'general' } })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText('Protected players') as HTMLInputElement).value).toBe('2')
    confirm.mockReturnValue(true)
    fireEvent.change(screen.getByLabelText('Settings category'), { target: { value: 'general' } })
    expect(screen.getByText('General editor')).toBeTruthy()
    fireEvent.click(screen.getByTestId('cc-nav-pirate-rules'))
    expect((await screen.findByLabelText('Protected players') as HTMLInputElement).value).toBe('3')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  })

  it('retains edits and shows the server error when save is rejected', async () => {
    failSave = true
    center()
    fireEvent.change(await screen.findByLabelText('Protected players'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Settings are locked.')
    expect(screen.queryByText('Pirate rules saved.')).toBeNull()
    expect((screen.getByLabelText('Protected players') as HTMLInputElement).value).toBe('2')
    expect(persisted.protectionLimit).toBe(3)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false))
  })
})
