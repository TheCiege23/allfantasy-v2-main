import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { WorkBook } from 'xlsx'
const writeFile = vi.hoisted(() => vi.fn())
vi.mock('xlsx', async (original) => ({ ...await original<typeof import('xlsx')>(), writeFile }))
import { WeeklyReportPanel } from '@/app/tournament-hub/[tournamentId]/WeeklyReportPanel'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('copies and downloads the same report with numeric points and literal manager names', async () => {
  const report = { season: 2026, week: 2, sheets: [
    { name: 'Manager status', rows: [['Manager', 'Points'], ['=not-a-formula', 123.45]] },
    { name: 'Weekly top scorers', rows: [['Rank', 'Manager', 'Points'], [1, '=not-a-formula', 123.45]] },
    { name: 'Coverage', rows: [['Conference', 'League', 'Managers', 'Available', 'Missing'], ['Black', 'A', 1, 1, 0]] },
  ] }
  const copy = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => report }))
  render(<WeeklyReportPanel tournamentId="cup" />)
  fireEvent.click(screen.getByRole('button', { name: 'Build weekly report' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Copy report for Excel' }))
  expect(copy).toHaveBeenCalledWith(expect.stringContaining("'=not-a-formula\t123.45"))
  fireEvent.click(screen.getByRole('button', { name: 'Download Excel (.xlsx)' }))
  await waitFor(() => expect(writeFile).toHaveBeenCalled())
  const book = writeFile.mock.calls[0][0] as WorkBook
  expect(book.SheetNames).toEqual(['Manager status', 'Weekly top scorers', 'Coverage'])
  expect(book.Sheets['Manager status'].A2).toMatchObject({ t: 's', v: '=not-a-formula' })
  expect(book.Sheets['Manager status'].A2.f).toBeUndefined()
  expect(book.Sheets['Manager status'].B2).toMatchObject({ t: 'n', v: 123.45 })
  expect(writeFile.mock.calls[0][1]).toBe('tournament-2026-week-2.xlsx')
})
