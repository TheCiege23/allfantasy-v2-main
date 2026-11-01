/**
 * /import — a Fantrax member proven by their Secret ID can say they are the commissioner.
 *
 * 🛑 Fantrax reports no commissioner, and a proven member is never sent to the attestation step,
 * so nothing on the screen ever let the commissioner say so: the commit carried no attestation and
 * the league imported with no C and no hub. The preview now carries `commissionerConfirmable`, the
 * screen shows an unticked "I'm the commissioner" box, and ticking it sends the attestation.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const discoverProviderLeagues = vi.fn()
const submitImportCreation = vi.fn()
const fetchImportPreview = vi.fn()

vi.mock('@/lib/league-import/LeagueCreationImportSubmissionService', () => ({
  discoverProviderLeagues: (...a: unknown[]) => discoverProviderLeagues(...a),
  submitImportCreation: (...a: unknown[]) => submitImportCreation(...a),
  fetchImportPreview: (...a: unknown[]) => fetchImportPreview(...a),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/components/league/LeagueTypeConfirm', () => ({ default: () => null }))

import ImportV4 from '@/components/core-app/screens/ImportV4'

const SOURCE = 'fantrax-league:abc123|Maryland Terrapins'
const COMMITTED = { ok: true, data: { leagueId: 'lg-1', name: 'Big Fantrax League' } }

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ auths: [] }) })) as unknown as typeof fetch,
  )
  discoverProviderLeagues.mockReset()
  fetchImportPreview.mockReset()
  submitImportCreation.mockReset()
  discoverProviderLeagues.mockResolvedValue({ ok: false, error: 'no discovery' })
  submitImportCreation.mockResolvedValue(COMMITTED)
})

async function openPreview(commissionerConfirmable: boolean) {
  fetchImportPreview.mockResolvedValue({
    ok: true,
    data: { league: { name: 'Big Fantrax League' }, ...(commissionerConfirmable ? { commissionerConfirmable: true } : {}) },
  })
  render(<ImportV4 defaultProvider="fantrax" initialLeagueSourceId={SOURCE} />)
  return screen.findByTestId('import-commit')
}

describe('🛑 Fantrax: "I\'m the commissioner" on the preview', () => {
  it('is offered, unticked, when the server says commissioner status is unknown', async () => {
    await openPreview(true)
    const box = screen.getByTestId('import-preview-commissioner').querySelector('input') as HTMLInputElement
    expect(box.checked).toBe(false)
  })

  it('ticked, the commit carries the attestation', async () => {
    const importButton = await openPreview(true)
    fireEvent.click(screen.getByTestId('import-preview-commissioner').querySelector('input')!)
    fireEvent.click(importButton)

    await waitFor(() => expect(submitImportCreation).toHaveBeenCalled())
    const [provider, sourceId, , attestation] = submitImportCreation.mock.calls[0]!
    expect(provider).toBe('fantrax')
    expect(sourceId).toBe(SOURCE)
    expect(attestation).toEqual({ accepted: true })
  })

  it('left unticked, the commit claims nothing', async () => {
    const importButton = await openPreview(true)
    fireEvent.click(importButton)
    await waitFor(() => expect(submitImportCreation).toHaveBeenCalled())
    expect(submitImportCreation.mock.calls[0]![3]).toBeUndefined()
  })

  it('is not shown when the server did not offer it', async () => {
    await openPreview(false)
    expect(screen.queryByTestId('import-preview-commissioner')).toBeNull()
  })
})
