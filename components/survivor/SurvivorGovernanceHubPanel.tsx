'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import { survivorGovernanceMessages } from '@/lib/survivor/survivorGovernanceUiMessages'
import type { SurvivorGovernanceSettings, SurvivorSwapMode } from '@/lib/survivor/survivorGovernanceSettings'
import { survivorTradeWindowText, type TradeWindowJson } from '@/lib/survivor/survivorTradeWindowText'

type Castaway = {
  userId: string
  displayName: string
  playerState: string
  strikes: { id: string; reason: string; issuedAt: string }[]
  experience: { experience: 'rookie' | 'veteran'; source: 'manual' | 'history' | 'platform' | 'default' }
}
type View = {
  settings: SurvivorGovernanceSettings
  castaways: Castaway[]
  tradeWindow?: TradeWindowJson | null
  context?: { merged?: boolean }
}

function when(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(getAppIntlLocale(), { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
}

/**
 * Commissioner Hub → Rules & conduct. Live actions for the governance rules: issue or withdraw a
 * conduct strike, mark a castaway rookie or veteran (Rooks vs Vets), and seal a swap of any type now.
 * Settings themselves are in league settings → Rules & Conduct.
 */
export function SurvivorGovernanceHubPanel({ leagueId }: { leagueId: string }) {
  const m = useMessages(survivorGovernanceMessages)
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [swapMode, setSwapMode] = useState<SurvivorSwapMode>('resize')
  const [swapTribes, setSwapTribes] = useState(3)
  const [swapPattern, setSwapPattern] = useState('ABC')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/survivor/commissioner?leagueId=${encodeURIComponent(leagueId)}&type=governance`, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as View
      if (!Array.isArray(data?.castaways)) throw new Error('shape')
      setView(data)
      setError(null)
    } catch {
      setError(m.loadFailed)
    }
  }, [leagueId, m.loadFailed])

  useEffect(() => { void load() }, [load])

  async function act(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true)
    setStatus(null)
    try {
      const res = await fetch('/api/survivor/commissioner', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, ...payload }),
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) { setStatus(typeof body.error === 'string' ? body.error : m.saveFailed); return null }
      await load()
      return body
    } finally {
      setBusy(false)
    }
  }

  async function issue(userId: string) {
    const body = await act({ action: 'issue_strike', userId, reason: reasons[userId] ?? '' })
    if (!body) return
    setReasons((r) => ({ ...r, [userId]: '' }))
    const n = Number(body.activeStrikes ?? 0)
    const limit = Number(body.limit ?? view?.settings.strikeLimit ?? 2)
    setStatus(body.removed ? m.strikeRemovedNow : body.limitReached ? `${m.strikeIssued(n, limit)} ${m.strikeLimitReached}` : m.strikeIssued(n, limit))
  }

  async function swapNow() {
    const swap = swapMode === 'resize' ? { mode: swapMode, tribeCount: swapTribes } : swapMode === 'custom_pattern' ? { mode: swapMode, pattern: swapPattern, order: 'season_points' } : { mode: swapMode }
    const body = await act({ action: 'swap_now', swap })
    if (body) setStatus(m.swapSealedAt(when(typeof body.revealAt === 'string' ? body.revealAt : null)))
  }

  if (error) return <p className="text-sm text-rose-300" role="alert">{error}</p>
  if (!view) return <p className="text-sm text-white/50">{m.loading}</p>
  const limit = view.settings.strikeLimit
  const tw = view.tradeWindow

  return (
    <div className="space-y-5" data-testid="survivor-governance-hub">
      <p className="text-xs text-white/55">{m.hubSubtitle}</p>
      {view.settings.tradeRulesEnabled && tw && (
        <p className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white/80" data-testid="survivor-governance-trade-window">
          {survivorTradeWindowText(m, tw, when)}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-white/50">
            <tr><th className="py-2 pr-3">{m.castaway}</th><th className="py-2 pr-3">{m.strikes}</th><th className="py-2 pr-3">{m.experience}</th><th className="py-2" /></tr>
          </thead>
          <tbody>
            {view.castaways.map((c) => (
              <tr key={c.userId} className="border-t border-white/10 align-top" data-testid={`survivor-governance-row-${c.userId}`}>
                <td className="py-2 pr-3 text-white">{c.displayName}{c.playerState !== 'active' ? <span className="ml-2 text-xs text-white/40">({c.playerState})</span> : null}</td>
                <td className="py-2 pr-3 text-white/80">
                  {c.strikes.length}/{limit}
                  {c.strikes.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-white/50">{c.strikes.map((s) => <li key={s.id}>{s.reason}</li>)}</ul>}
                </td>
                <td className="py-2 pr-3">
                  <select
                    aria-label={`${m.experience}: ${c.displayName}`}
                    className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-xs text-white"
                    disabled={busy}
                    value={c.experience.source === 'manual' ? c.experience.experience : ''}
                    onChange={(e) => void act({ action: 'set_experience', userId: c.userId, experience: e.target.value || null })}
                  >
                    {/* A platform veteran shows only that: never which other leagues. */}
                    <option value="">{c.experience.source === 'platform' ? m.expPlatform : m.expAuto(c.experience.source === 'manual' ? 'rookie' : c.experience.experience)}</option>
                    <option value="rookie">{m.expRookie}</option>
                    <option value="veteran">{m.expVeteran}</option>
                  </select>
                </td>
                <td className="py-2">
                  {c.playerState !== 'eliminated' && (
                    <div className="flex flex-wrap gap-2">
                      <input
                        aria-label={`${m.strikeReason}: ${c.displayName}`}
                        placeholder={m.strikeReason}
                        maxLength={280}
                        value={reasons[c.userId] ?? ''}
                        onChange={(e) => setReasons((r) => ({ ...r, [c.userId]: e.target.value }))}
                        className="min-w-[12rem] flex-1 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-xs text-white placeholder:text-white/35"
                      />
                      <button type="button" disabled={busy || (reasons[c.userId] ?? '').trim().length < 3} onClick={() => void issue(c.userId)} className="rounded-lg bg-amber-500/80 px-3 py-1 text-xs font-semibold text-black disabled:opacity-40" data-testid={`survivor-governance-strike-${c.userId}`}>{m.issueStrike}</button>
                      {c.strikes.length > 0 && <button type="button" disabled={busy} onClick={() => void act({ action: 'revoke_strike', userId: c.userId, reason: '' })} className="rounded-lg border border-white/20 px-3 py-1 text-xs text-white/80 disabled:opacity-40">{m.withdrawStrike}</button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!view.context?.merged && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <p className="text-sm font-semibold text-white">{m.swapNowTitle}</p>
          <p className="mb-2 text-xs text-white/50">{m.swapNowDesc}</p>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label={m.swapMode} value={swapMode} onChange={(e) => setSwapMode(e.target.value as SurvivorSwapMode)} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-xs text-white">
              <option value="random_shuffle">{m.swapModeRandom}</option>
              <option value="resize">{m.swapModeResize}</option>
              <option value="return_to_original">{m.swapModeReturn}</option>
              <option value="custom_pattern">{m.swapModePattern}</option>
            </select>
            {swapMode === 'resize' && (
              <select aria-label={m.swapTribes} value={swapTribes} onChange={(e) => setSwapTribes(Number(e.target.value))} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-xs text-white">
                {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
            {swapMode === 'custom_pattern' && (
              <input aria-label={m.swapPattern} value={swapPattern} maxLength={40} onChange={(e) => setSwapPattern(e.target.value.toUpperCase().replace(/[^A-E]/g, ''))} className="w-32 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-xs text-white" />
            )}
            <button type="button" disabled={busy} onClick={() => void swapNow()} className="rounded-lg bg-emerald-500 px-3 py-1 text-xs font-semibold text-black disabled:opacity-40" data-testid="survivor-governance-swap-now">{m.swapNow}</button>
          </div>
        </div>
      )}
      {status && <p role="status" className="text-sm text-amber-200">{status}</p>}
    </div>
  )
}
