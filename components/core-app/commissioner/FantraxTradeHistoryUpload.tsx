'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { hubCopy } from '@/lib/core-app/commissionerHubCopy'

/**
 * The commissioner's upload for a Fantrax league's completed trades (Commissioner Hub → Trades and draft archive).
 *
 * Fantrax gives AllFantasy no completed-trade feed, so the trade history is whatever the commissioner exports from
 * Fantrax and uploads here (`POST /api/legacy/fantrax/trade-history`). The route re-checks the commissioner and does
 * the matching; this only sends the file and shows what was added and what was not, with each reason. Uploading the
 * same file again rewrites the same trades.
 */
type UploadResult = {
  imported: number
  refused: Array<{ dateText: string; teams: string[]; reasons: string[] }>
  skippedLines: Array<{ line: number; reason: string }>
}

export function FantraxTradeHistoryUpload({ leagueId }: { leagueId: string }) {
  const router = useRouter()
  const { language } = useOptionalLanguage()
  const t = (english: string | null | undefined) => hubCopy(english, language)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<UploadResult | null>(null)

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const form = new FormData()
      form.append('leagueId', leagueId)
      form.append('file', file)
      const res = await fetch('/api/legacy/fantrax/trade-history', { method: 'POST', body: form, credentials: 'same-origin' })
      const body = (await res.json().catch(() => null)) as (UploadResult & { error?: string }) | null
      if (!res.ok || !body) {
        setError(body?.error ?? 'The upload did not go through. Nothing was changed.')
        return
      }
      setResult(body)
      if (body.imported > 0) router.refresh()
    } catch {
      setError('Could not reach the server. Nothing was changed.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="af-ch-fantrax-trades">
      <h3>{t('Fantrax trade history')}</h3>
      <p className="af-ch-muted">
        {t('Fantrax does not send completed trades to AllFantasy. Download the trade history from Fantrax (Transaction History, Trade) as a CSV and upload it here. Uploading the same file again does not add anything twice.')}
      </p>
      <p className="af-ch-muted">{t('A trade that moved budget is graded only once this league’s waiver budget is set above.')}</p>
      <label className="af-btn af-ch-publish-btn">
        {busy ? t('Uploading…') : t('Upload trade history CSV')}
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          hidden
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void upload(file)
          }}
        />
      </label>
      {error ? <p className="af-ch-publish-error" role="alert">{t(error)}</p> : null}
      {result ? (
        <div role="status">
          <p>{t(result.imported === 1 ? '1 trade added.' : `${result.imported} trades added.`)}</p>
          {result.refused.length ? (
            <>
              <p>{t(result.refused.length === 1 ? '1 trade was not added:' : `${result.refused.length} trades were not added:`)}</p>
              <ul className="af-ch-areas">
                {result.refused.map((r) => (
                  <li key={`${r.dateText}-${r.teams.join('|')}`}>
                    <strong>{r.teams.join(' ↔ ')}</strong> · {r.dateText}
                    <ul>
                      {r.reasons.map((why) => (
                        <li key={why}>{t(why)}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {result.skippedLines.length ? (
            <p className="af-ch-muted">{t(result.skippedLines.length === 1 ? '1 line of the file could not be read.' : `${result.skippedLines.length} lines of the file could not be read.`)}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
