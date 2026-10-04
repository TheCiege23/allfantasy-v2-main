// @vitest-environment jsdom
import React from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TradeComparisonSnapshots } from '@/components/core-app/screens/TradeComparisonSnapshots'

vi.mock('@/components/core-app/screens/useTradeVisualCopy', () => ({
  useTradeVisualCopy: () => ({ copy: (text: string) => text, locale: 'en-US', language: 'en' }),
}))
const fetchMock = vi.fn()
const snapshot = {
  id: 'device-1', scope: 'generic:user-1', sport: 'NFL', title: 'Team A ↔ Team B',
  at: '2026-10-03T10:00:00.000Z', basis: 'General market values', uncertainty: 'Market estimate',
  sides: ['Team A', 'Team B'] as [string, string],
  assets: [['Player One'], ['Player Two']] as [string[], string[]],
  grades: ['B', 'D'] as [string, string], verdict: 'Favors Team A',
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  window.localStorage.clear()
})
afterEach(() => vi.unstubAllGlobals())

describe('generic comparison account sync', () => {
  it('imports an existing device save once and clears it only after the account accepts it', async () => {
    window.localStorage.setItem('af-trade-comparisons:v1', JSON.stringify([snapshot]))
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ snapshots: [] }) })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ snapshots: [snapshot] }) })
    render(<TradeComparisonSnapshots scope="generic:user-1" snapshot={null} />)
    expect(await screen.findByText('Saved comparisons (1)')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).snapshots[0]).toMatchObject({ id: 'device-1', sport: 'NFL' })
    await waitFor(() => expect(window.localStorage.getItem('af-trade-comparisons:v1')).toBe('[]'))
  })

  it('keeps the device save available when account sync fails', async () => {
    window.localStorage.setItem('af-trade-comparisons:v1', JSON.stringify([snapshot]))
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ snapshots: [] }) })
    fetchMock.mockResolvedValueOnce({ ok: false })
    render(<TradeComparisonSnapshots scope="generic:user-1" snapshot={null} />)
    expect(await screen.findByText(/device saves could not sync/)).toBeTruthy()
    expect(screen.getByText('Saved comparisons (1)')).toBeTruthy()
    expect(window.localStorage.getItem('af-trade-comparisons:v1')).toContain('device-1')
    expect(screen.getByRole('button', { name: 'Save this comparison' })).toHaveProperty('disabled', true)
  })
})

describe('comparison evidence and variant recovery', () => {
  it('ignores a corrupt device save instead of rendering or importing it', async () => {
    window.localStorage.setItem('af-trade-comparisons:v1', JSON.stringify([{ id:'bad', scope:'generic:device', at:snapshot.at, sides:['A','B'], assets:[null,null] }]))
    render(<TradeComparisonSnapshots scope="generic:device" snapshot={null} />)
    expect(screen.queryByText(/Saved comparisons/)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('keeps device evidence when a successful import response omits it', async () => {
    window.localStorage.setItem('af-trade-comparisons:v1', JSON.stringify([snapshot]))
    fetchMock.mockResolvedValueOnce({ ok:true, json:async()=>({snapshots:[]}) })
    fetchMock.mockResolvedValueOnce({ ok:true, json:async()=>({snapshots:[]}) })
    render(<TradeComparisonSnapshots scope="generic:user-1" snapshot={null} />)
    expect(await screen.findByText(/device saves could not sync/)).toBeTruthy()
    expect(window.localStorage.getItem('af-trade-comparisons:v1')).toContain('device-1')
  })
  it('reports malformed account history without treating it as an empty successful read', async () => {
    fetchMock.mockResolvedValueOnce({ ok:true, json:async()=>({snapshots:[{id:'bad'}]}) })
    render(<TradeComparisonSnapshots scope="generic:user-1" snapshot={snapshot} />)
    expect(await screen.findByText(/history could not be verified/)).toBeTruthy()
    expect(screen.getByRole('button',{name:'Save this comparison'})).toHaveProperty('disabled',true)
  })
  it('compares selected saved and current variants and returns to the current analysis', async () => {
    const saved = {...snapshot, scope:'generic:device'}
    const current = {...saved, id:'current', assets:[['New Player'],['Player Two']] as [string[],string[]]}
    window.localStorage.setItem('af-trade-comparisons:v1',JSON.stringify([saved]))
    render(<TradeComparisonSnapshots scope="generic:device" snapshot={current} />)
    fireEvent.click(screen.getByText('Saved comparisons (1)'))
    fireEvent.click(screen.getByRole('button',{name:/^Team A.*Team B/}))
    expect(screen.getByText('Compare saved and current variants')).toBeTruthy()
    expect(screen.getByRole('region',{name:'Saved variant'}).textContent).toContain('Player One')
    expect(screen.getByRole('region',{name:'Current variant'}).textContent).toContain('New Player')
    fireEvent.click(screen.getByRole('button',{name:'Show current analysis'}))
    expect(screen.queryByText('Compare saved and current variants')).toBeNull()
    expect(screen.getByText('Current analysis')).toBeTruthy()
  })
  it('does not compare grades across different sports', () => {
    const saved={...snapshot,scope:'generic:device'}
    window.localStorage.setItem('af-trade-comparisons:v1',JSON.stringify([saved]))
    render(<TradeComparisonSnapshots scope="generic:device" snapshot={{...saved,id:'current',sport:'NBA'}} />)
    fireEvent.click(screen.getByText('Saved comparisons (1)'))
    fireEvent.click(screen.getByRole('button',{name:/^Team A.*Team B/}))
    expect(screen.getByText('Choose a saved comparison for the current sport before comparing variants.')).toBeTruthy()
    expect(screen.queryByText('Compare saved and current variants')).toBeNull()
  })
  it('handles an unavailable canvas export without breaking the panel', () => {
    render(<TradeComparisonSnapshots scope="generic:device" snapshot={{...snapshot,scope:'generic:device'}} />)
    const getContext=vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(()=>{throw new Error('Canvas unavailable')})
    fireEvent.click(screen.getByRole('button',{name:'Download share card'}))
    expect(screen.getByText('The share card could not be created in this browser.')).toBeTruthy()
    getContext.mockRestore()
  })
})
