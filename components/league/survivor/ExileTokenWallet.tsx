'use client'
import { useEffect, useState } from 'react'
import { ExileTokenIcon, ExileTokenProgress, ExileTokenRuleChips, ExileTokenToast, type ExileWeekResult } from './ExileTokens'

type Data = {
  island?: { bossWinsEnabled?: boolean; bossTokenResetOnWin?: boolean } | null
  user?: { tokenBalance?: number; playerState?: string }
  returnRules?: { enabled: boolean; week: number; tokensRequired: number; resolved: boolean; slots: number }
  /** The viewer's own latest scored Exile week, when it earned or wiped tokens. */
  latestResult?: ExileWeekResult | null
  tokenCap?: number | null
  error?: string
}

const dismissKey = (id: string) => `af:survivor:exile-toast:${id}`
function wasDismissed(id: string): boolean {
  try { return window.localStorage.getItem(dismissKey(id)) === '1' } catch { return false }
}
function rememberDismissed(id: string) {
  try { window.localStorage.setItem(dismissKey(id), '1') } catch { /* private mode: the toast simply returns next visit */ }
}

export function ExileTokenWallet({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [toastOpen, setToastOpen] = useState(false)
  useEffect(() => { let active = true; setData(null)
    fetch(`/api/survivor/exile?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' }).then(async r => { const json = await r.json(); if (!r.ok) throw new Error(json.error ?? 'Could not load tokens'); if (active) setData(json) }).catch(e => { if (active) setData({ error: e.message }) })
    return () => { active = false }
  }, [leagueId])
  const result = data?.latestResult ?? null
  useEffect(() => { setToastOpen(Boolean(result && !wasDismissed(result.id))) }, [result])

  const rules = data?.returnRules
  const balance = data?.user?.tokenBalance ?? 0
  const minimum = rules?.tokensRequired ?? 0
  const cap = data?.tokenCap ?? null
  const needed = Math.max(0, minimum - balance)
  const inExile = data?.user?.playerState === 'exile'
  return <section className="rounded-2xl border border-amber-300/20 bg-[#0b0d14] p-5 text-white">
    {inExile && result && toastOpen && <div className="mb-5">
      <ExileTokenToast result={result} balance={balance} required={minimum} onDismiss={() => { rememberDismissed(result.id); setToastOpen(false) }} />
    </div>}
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
      <img src="/survivor/exile/token-coin.svg" alt="Exile Island token: a gold coin with a carved E" width={160} height={160} className="h-36 w-36 shrink-0 object-contain" />
      <div className="w-full min-w-0"><p className="text-xs uppercase tracking-widest text-amber-200">The Exile token</p><h2 className="mt-2 font-serif text-2xl font-bold text-amber-100" style={{ fontFamily: "'Cinzel', serif" }}>Earn your way back</h2>
        {!data && <p role="status" className="mt-3 text-sm text-white/60">Loading your token balance…</p>}
        {data?.error && <p role="alert" className="mt-3 text-sm text-rose-300">{data.error}</p>}
        {rules && <><p className="mt-3 text-sm text-white/70">{rules.enabled ? `One manager returns after Week ${rules.week}: the highest token balance meeting the ${minimum}-token minimum.` : 'Exile return is disabled for this league.'}</p>
          {rules.enabled && <div className="mt-3"><ExileTokenRuleChips required={minimum} cap={cap} /></div>}
          {rules.enabled && <ul className="mt-3 space-y-2 text-sm text-white/85">
            <li className="flex items-center gap-2"><ExileTokenIcon size={20} />Win your week on Exile Island and you earn a token.</li>
            {minimum > 0 && <li className="flex items-center gap-2"><ExileTokenIcon size={20} /><span>Collect <b className="text-amber-300">{minimum} tokens</b> to return to the game.{cap != null && cap > 0 ? ` You can hold up to ${cap}.` : ''}</span></li>}
            {data?.island?.bossWinsEnabled && data.island.bossTokenResetOnWin && <li className="flex items-center gap-2"><ExileTokenIcon size={20} wiped />If the Exile boss outscores you, your tokens are wiped.</li>}
          </ul>}
          {inExile ? <div className="mt-4">
            <ExileTokenProgress balance={balance} required={minimum} cap={cap} popLast={Boolean(toastOpen && result && result.tokenEarned > 0)} />
            <p className="mt-2 text-sm text-white/65">{rules.resolved ? 'The return deadline has passed.' : !rules.enabled ? 'These tokens do not qualify for a return.' : needed > 0 ? 'The return spot is decided at the deadline.' : 'Minimum reached. You must still lead the qualifying balances at the deadline.'}</p>
          </div> : <p className="mt-3 text-sm text-white/50">Your token wallet becomes available when you enter Exile.</p>}
        </>}
      </div>
    </div>
  </section>
}
