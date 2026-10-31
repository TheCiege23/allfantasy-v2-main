'use client'

import { useEffect, useState } from 'react'
import type { ImportedKeeperGridView } from '@/lib/import-assist/keeperGridService'

/**
 * Imported-league assist: the keeper cost grid for a keeper league that lives on another platform,
 * and how to set the keepers there. Renders nothing for a native league or a non-keeper league —
 * the server decides (/api/commissioner/leagues/[leagueId]/imported-keepers).
 */
export function ImportedKeeperGrid({ leagueId }: { leagueId: string }) {
  const [view, setView] = useState<ImportedKeeperGridView | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [manual, setManual] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    // Never rejects: a failed read leaves the card hidden.
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/imported-keepers`, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as ImportedKeeperGridView | null
        if (live && res.ok && body && typeof body === 'object' && 'applies' in body) setView(body)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [leagueId])

  if (!view || !view.applies) return null

  if (view.locked) {
    return (
      <div className="rounded-xl border border-violet-400/25 bg-violet-950/20 p-3" data-testid="imported-keeper-grid-locked">
        <p className="text-[13px] font-semibold text-white">Keeper costs for every team</p>
        <p className="mt-1 text-[11px] text-white/50">
          AF Commissioner works out what keeping each player costs from this league’s own drafts and your keeper rules, and tells you how to set the keepers on your league’s platform.
        </p>
        <a href="/upgrade?plan=commissioner" className="mt-2 inline-block text-[11px] font-semibold text-violet-300 underline">
          Get AF Commissioner
        </a>
      </div>
    )
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(view.shareText)
      setCopied(true)
      setManual(null)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // No clipboard (insecure context or refused permission): show the text to select by hand.
      setManual(view.shareText)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-cyan-400/25 bg-cyan-950/15 p-3" data-testid="imported-keeper-grid">
      <div>
        <p className="text-[13px] font-semibold text-white">Keeper costs{view.grid ? ` for the ${view.grid.draftSeason} draft` : ''}</p>
        <p className="mt-0.5 text-[11px] text-white/50">
          From this league’s {view.grid ? `${view.grid.basedOnSeason} ` : ''}draft and the keeper rules above. A player not in that draft was picked up after it.
        </p>
      </div>
      {view.note && <p className="text-[12px] text-white/70">{view.note}</p>}
      {view.grid?.warnings.map((w) => (
        <p key={w} className="text-[11px] text-amber-300/80">{w}</p>
      ))}
      {view.grid && (
        <ul className="space-y-1">
          {view.grid.teams.map((t) => (
            <li key={t.teamId} className="rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setOpen(open === t.teamId ? null : t.teamId)}
                aria-expanded={open === t.teamId}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] font-semibold text-white/90"
              >
                <span className="min-w-0 truncate">{t.name}</span>
                <span className="shrink-0 text-[11px] text-white/40">{t.players.filter((p) => p.costRound != null).length} keepable</span>
              </button>
              {open === t.teamId && (
                <ul className="space-y-0.5 border-t border-white/10 px-3 py-2">
                  {t.players.map((p) => (
                    <li key={p.playerId} className="flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="min-w-0 truncate text-white/85">
                        {p.name}
                        {p.yearsKept ? <span className="text-white/40"> · kept {p.yearsKept}x</span> : null}
                      </span>
                      <span className={`shrink-0 ${p.blocked ? 'text-white/35' : 'font-semibold text-white'}`} title={p.blocked ?? undefined}>
                        {p.blocked ? 'Not keepable' : `${p.label}${p.basis === 'waiver' ? ' · pickup' : ''}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {view.steps.length > 0 && (
        <>
          <p className="text-[12px] font-semibold text-white/80">Set the keepers on your league’s platform</p>
          <ol className="list-decimal space-y-1 pl-5 text-[12px] text-white/75">
            {view.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <button type="button" onClick={() => void copy()} className="w-full rounded-lg bg-cyan-600/80 px-3 py-2 text-[12px] font-semibold text-white hover:bg-cyan-600">
            {copied ? 'Copied' : 'Copy the cost list for league chat'}
          </button>
          {manual && (
            <textarea readOnly value={manual} rows={6} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-lg border border-white/15 bg-[#0d1526] p-2 text-[12px] text-white" aria-label="Text to copy" />
          )}
        </>
      )}
    </div>
  )
}
