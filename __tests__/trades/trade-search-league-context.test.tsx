import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { TradeAssetPicker } from '@/components/core-app/screens/TradeAssetPicker'

afterEach(() => vi.unstubAllGlobals())

it('searches on the league chart and passes the selected defender identity to the proposal', async () => {
  const fetch = vi.fn().mockResolvedValue({ json: async () => [{
    kind: 'player', sport: 'NFL', playerId: 'd1', name: 'Test Defender', position: 'CB',
    team: 'BAL', value: 354, providerIdentity: { provider: 'sleeper', id: 'd1', position: 'CB' },
  }] })
  vi.stubGlobal('fetch', fetch)
  const onPick = vi.fn()
  const ui = render(<TradeAssetPicker leagueId="l1" sport="NFL" onClose={() => {}} onPick={onPick} />)
  fireEvent.change(ui.getByPlaceholderText('Search a player…'), { target: { value: 'Test' } })
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('&leagueId=l1')))
  fireEvent.click(await ui.findByRole('button', { name: /Test Defender/ }))
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({
    value: 354, providerIdentity: { provider: 'sleeper', id: 'd1', position: 'CB' },
  }))
})

it('does not display a response from the previous league after switching context', async () => {
  let resolveOld!: (value: unknown) => void
  const oldResponse = new Promise(resolve => { resolveOld = resolve })
  const fetch = vi.fn().mockReturnValueOnce(oldResponse).mockResolvedValue({ json: async () => [] })
  vi.stubGlobal('fetch', fetch)
  const props = { sport: 'NFL', onClose: () => {}, onPick: () => {} }
  const ui = render(<TradeAssetPicker {...props} leagueId="l1" />)
  fireEvent.change(ui.getByPlaceholderText('Search a player…'), { target: { value: 'Test' } })
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  ui.rerender(<TradeAssetPicker {...props} leagueId="l2" />)
  resolveOld({ json: async () => [{ kind: 'player', sport: 'NFL', playerId: 'p1', name: 'Stale Value', value: 1234 }] })
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('&leagueId=l2')))
  expect(ui.queryByText('Stale Value')).toBeNull()
})
