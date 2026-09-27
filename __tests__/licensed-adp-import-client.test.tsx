import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AdpImportClient from '@/app/admin/adp-import/AdpImportClient'

const fetchMock = vi.fn()
beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); fetchMock.mockReset() })
const board = () => ({
  evidenceType: 'observed_drafts', licensedForUse: true, sport: 'NFL', source: 'licensed-export',
  season: new Date().getFullYear(), format: 'redraft', scoring: 'PPR', asOf: new Date().toISOString(),
  players: [{ canonicalPlayerId: 'canonical-1', providerPlayerId: 'vendor-1', playerName: 'Player One', position: 'WR', team: 'KC', adp: 12.5, draftSampleSize: 40 }],
})
const success = (dryRun: boolean) => ({ ok: true, json: async () => ({ dryRun, accepted: 1 }) })
function fillExport() { fireEvent.change(screen.getByLabelText('Export JSON'), { target: { value: JSON.stringify(board()) } }) }

it('validates without writing and imports only the reviewed board on an explicit second action', async () => {
  fetchMock.mockResolvedValueOnce(success(true)).mockResolvedValueOnce(success(false))
  render(<AdpImportClient />)
  expect(screen.queryByRole('button', { name: 'Import validated export' })).toBeNull()
  fillExport()
  fireEvent.click(screen.getByRole('button', { name: 'Validate export' }))
  const importButton = await screen.findByRole('button', { name: 'Import validated export' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const validationBody = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(validationBody.dryRun).toBe(true)
  expect(screen.getByRole('status').textContent).toContain('No data has been written')
  fireEvent.click(importButton)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ ...validationBody, dryRun: false })
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Imported 1'))
  expect(screen.queryByRole('button', { name: 'Import validated export' })).toBeNull()
})

it.each(['Sport', 'Season', 'Draft format', 'Scoring context', 'Export JSON'])('invalidates a preview when %s changes', async label => {
  fetchMock.mockResolvedValue(success(true))
  render(<AdpImportClient />)
  fillExport()
  fireEvent.click(screen.getByRole('button', { name: 'Validate export' }))
  await screen.findByRole('button', { name: 'Import validated export' })
  const values: Record<string, string> = { Sport: 'NBA', Season: '2027', 'Draft format': 'dynasty', 'Scoring context': 'points', 'Export JSON': '{}' }
  fireEvent.change(screen.getByLabelText(label), { target: { value: values[label] } })
  expect(screen.queryByRole('button', { name: 'Import validated export' })).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('rejects invalid evidence before calling the endpoint', async () => {
  render(<AdpImportClient />)
  fireEvent.change(screen.getByLabelText('Export JSON'), { target: { value: JSON.stringify({ ...board(), evidenceType: 'rankings' }) } })
  fireEvent.click(screen.getByRole('button', { name: 'Validate export' }))
  await screen.findByRole('alert')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('shows server identity or permission refusal without enabling import', async () => {
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Export rejected by server' }) })
  render(<AdpImportClient />)
  fillExport()
  fireEvent.click(screen.getByRole('button', { name: 'Validate export' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Export rejected by server')
  expect(screen.queryByRole('button', { name: 'Import validated export' })).toBeNull()
})

it('loads a JSON file and requires validation again after replacing it', async () => {
  fetchMock.mockResolvedValue(success(true))
  render(<AdpImportClient />)
  fillExport()
  fireEvent.click(screen.getByRole('button', { name: 'Validate export' }))
  await screen.findByRole('button', { name: 'Import validated export' })
  const replacement = new File(['{}'], 'licensed-export.json', { type: 'application/json' })
  Object.defineProperty(replacement, 'text', { value: async () => JSON.stringify({ ...board(), source: 'replacement-export' }) })
  fireEvent.change(screen.getByLabelText('JSON export file'), { target: { files: [replacement] } })
  await waitFor(() => expect((screen.getByLabelText('Export JSON') as HTMLTextAreaElement).value).toContain('replacement-export'))
  expect(screen.queryByRole('button', { name: 'Import validated export' })).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
