'use client'

import { useState } from 'react'

type Preview = {
  saved: boolean
  savedCount?: number
  replacedCount?: number
  matched: Array<{ line: number; teamName: string; playerName: string; position: string | null; salary: number; yearsTotal: number; contractYear: number }>
  problems: Array<{ line: number; text: string; reason: string }>
  totals: Array<{ rosterId: string; teamName: string; contracts: number; capHit: number }>
  startupCap: number
  error?: string
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * The commissioner's way to bring an imported cap league's contracts in: paste the sheet, check what
 * matched and what did not, then save. Nothing is saved from the check, and saving again replaces the
 * earlier upload.
 */
export function ImportedContractsUpload({ leagueId, onSaved }: { leagueId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const send = async (confirm: boolean) => {
    setBusy(confirm ? 'save' : 'preview')
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/salary-cap/contracts/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, confirm }),
      })
      const json = (await res.json().catch(() => ({}))) as Preview
      if (Array.isArray(json.matched)) setPreview(json)
      if (!res.ok) setError(json.error ?? 'Could not read that sheet.')
      else if (json.saved) onSaved()
    } catch {
      setError('Could not reach AllFantasy. Nothing was saved.')
    } finally {
      setBusy(null)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="salary-cap-import-open"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-[var(--line2)] bg-[var(--warn-soft)] px-3 py-2 text-sm font-semibold text-[var(--warn)] hover:bg-[var(--warn-soft)]"
      >
        Add your league&apos;s contracts
      </button>
    )
  }

  return (
    <section data-testid="salary-cap-import-panel" className="space-y-3 rounded-xl border border-[var(--line)] bg-white/[0.03] p-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text)]">Add your league&apos;s contracts</h3>
        <p className="mt-1 text-xs text-[var(--text2)]">
          Paste one contract per line from your spreadsheet: team, player, salary, years on the contract, and (optional) which year of it this
          season is. Team is the team name as it appears here. Saving again replaces what you uploaded before.
        </p>
      </div>
      <textarea
        data-testid="salary-cap-import-text"
        aria-label="Contract rows"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setPreview(null)
        }}
        rows={8}
        spellCheck={false}
        placeholder={'Team, Player, Salary, Years, Year\nGridiron Kings, Patrick Mahomes, 45, 4, 2'}
        className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 font-mono text-xs text-[var(--text)] placeholder:text-[var(--muted)]"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="salary-cap-import-preview"
          disabled={!text.trim() || busy != null}
          onClick={() => void send(false)}
          className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold text-[var(--text)] disabled:opacity-40"
        >
          {busy === 'preview' ? 'Checking…' : 'Check the sheet'}
        </button>
        <button
          type="button"
          data-testid="salary-cap-import-save"
          disabled={!preview || preview.matched.length === 0 || busy != null}
          onClick={() => void send(true)}
          className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          {busy === 'save' ? 'Saving…' : preview ? `Save ${plural(preview.matched.length, 'contract')}` : 'Save'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-[var(--bad)]">
          {error}
        </p>
      ) : null}
      {preview?.saved ? (
        <p role="status" data-testid="salary-cap-import-saved" className="text-sm text-[var(--good)]">
          Saved {plural(preview.savedCount ?? 0, 'contract')}
          {preview.replacedCount ? `, replacing ${preview.replacedCount} from your earlier upload` : ''}.
        </p>
      ) : null}
      {preview ? (
        <div className="space-y-3 text-xs text-[var(--text2)]">
          <p data-testid="salary-cap-import-summary">
            {plural(preview.matched.length, 'row')} matched a team and a player on it
            {preview.problems.length ? `; ${preview.problems.length} could not be read and will be skipped` : ''}.
          </p>
          {preview.totals.length ? (
            <ul className="space-y-1">
              {preview.totals.map((t) => (
                <li key={t.rosterId} className="flex justify-between gap-3">
                  <span className="truncate">
                    {t.teamName} · {plural(t.contracts, 'contract')}
                  </span>
                  <span className={t.capHit > preview.startupCap ? 'text-[var(--bad)]' : 'text-[var(--text)]'}>
                    {money(t.capHit)} of {money(preview.startupCap)}
                    {t.capHit > preview.startupCap ? ' · over the cap' : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {preview.problems.length ? (
            <ul data-testid="salary-cap-import-problems" className="space-y-1 text-[var(--bad)]">
              {preview.problems.slice(0, 50).map((p) => (
                <li key={`${p.line}-${p.reason}`}>
                  Line {p.line}: {p.reason}
                </li>
              ))}
              {preview.problems.length > 50 ? <li>…and {preview.problems.length - 50} more.</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
