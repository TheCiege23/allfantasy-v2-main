'use client'

import { useCallback, useEffect, useState } from 'react'
import { Input, Select, SettingsRow, SettingsSection, Toggle } from '../../../tabs/settings/components'
import { useMessages } from '@/components/i18n/useMessages'
import {
  exileSlotLabel,
  normalizeExileSlotToken,
  readSurvivorSideGameSettings,
  SURVIVOR_SIDE_GAME_DEFAULTS,
  type SideGamePrizeKind,
  type SurvivorSideGameKey,
  type SurvivorSideGameSettings,
} from '@/lib/survivor/survivorSideGameSettings'
import { SURVIVOR_GOVERNANCE_DAYS } from '@/lib/survivor/survivorGovernanceSettings'
import { formatWeekRulesText, parseWeekRulesText, survivorSideGameMessages } from '@/lib/survivor/survivorSideGameUiMessages'

type Loaded = { settings: SurvivorSideGameSettings; locked: SurvivorSideGameKey[]; sport?: string }

/**
 * League settings → Survivor → Exile: the side-game settings (lib/survivor/survivorSideGameSettings.ts)
 * — token → FAAB, the Exile lineup and team claims, secrecy, the Token Pool, the shop, the Survivor
 * Pool and Auction Week. Saved through the Commissioner Hub action `side_games_settings`, which
 * applies the same validation and season locks this screen shows.
 */
export function SurvivorSideGamesSettings({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const m = useMessages(survivorSideGameMessages)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [draft, setDraft] = useState<SurvivorSideGameSettings>(SURVIVOR_SIDE_GAME_DEFAULTS)
  const [slotsText, setSlotsText] = useState('')
  const [teamsText, setTeamsText] = useState('')
  const [weekRulesText, setWeekRulesText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const adopt = useCallback((settings: SurvivorSideGameSettings, sport?: string) => {
    setDraft(settings)
    setSlotsText(settings.exileLineupSlots.map((s) => exileSlotLabel(s, sport)).join(' '))
    setTeamsText(settings.survivorPoolAllowedTeams.join(', '))
    setWeekRulesText(formatWeekRulesText(settings.survivorPoolWeekRules))
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/survivor/commissioner?leagueId=${encodeURIComponent(leagueId)}&type=side_games`, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const raw = (await res.json()) as Partial<Loaded> | null
      if (!raw?.settings || typeof raw.settings !== 'object') throw new Error('shape')
      // Normalised through the same reader the server uses, so a partial payload can never break the panel.
      const data: Loaded = { settings: readSurvivorSideGameSettings({ survivorSideGames: raw.settings }), locked: Array.isArray(raw.locked) ? raw.locked : [], sport: raw.sport }
      setLoaded(data)
      adopt(data.settings, data.sport)
    } catch {
      setError(m.loadFailed)
    }
  }, [leagueId, m.loadFailed, adopt])

  useEffect(() => { void load() }, [load])

  const isLocked = (key: SurvivorSideGameKey) => Boolean(loaded?.locked.includes(key))
  const off = !canEdit || saving || !loaded
  const set = <K extends SurvivorSideGameKey>(key: K, value: SurvivorSideGameSettings[K]) => setDraft((d) => ({ ...d, [key]: value }))

  async function save() {
    if (!loaded || !canEdit) return
    const next: SurvivorSideGameSettings = {
      ...draft,
      exileLineupSlots: slotsText.split(/[\s,]+/).map(normalizeExileSlotToken).filter((s): s is string => Boolean(s) && s !== 'BENCH'),
      survivorPoolAllowedTeams: teamsText.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean),
      survivorPoolWeekRules: parseWeekRulesText(weekRulesText) as SurvivorSideGameSettings['survivorPoolWeekRules'],
    }
    if (!next.exileLineupSlots.length) next.exileBenchSlots = 0
    const patch: Partial<SurvivorSideGameSettings> = {}
    for (const key of Object.keys(next) as SurvivorSideGameKey[]) {
      if (JSON.stringify(next[key]) !== JSON.stringify(loaded.settings[key])) (patch as Record<string, unknown>)[key] = next[key]
    }
    if (!Object.keys(patch).length) { setStatus(m.saved); return }
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch('/api/survivor/commissioner', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, action: 'side_games_settings', settings: patch }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; settings?: SurvivorSideGameSettings; locked?: SurvivorSideGameKey[] }
      if (!res.ok || !body.settings) throw new Error(body.error || m.saveFailed)
      const saved = readSurvivorSideGameSettings({ survivorSideGames: body.settings })
      setLoaded({ ...loaded, settings: saved, locked: Array.isArray(body.locked) ? body.locked : loaded.locked })
      adopt(saved, loaded.sport)
      setStatus(m.saved)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : m.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const days = SURVIVOR_GOVERNANCE_DAYS.map((d) => <option key={d} value={d}>{m.day(d)}</option>)
  const prizeKinds: Array<[SideGamePrizeKind, string]> = [
    ['none', m.prizeNone], ['faab', m.prizeFaab], ['score_bonus', m.prizeScore], ['advantage', m.prizeAdvantage],
    ['free_trade_token', m.prizeFreeTrade], ['steal_blocker', m.prizeBlocker], ['auction_cash', m.prizeCash], ['tokens', m.prizeTokens],
  ]
  const lbl = (text: string, key: SurvivorSideGameKey) => (isLocked(key) ? `${text} (${m.locked})` : text)

  return (
    <div className="space-y-5" data-testid="survivor-side-games-settings">
      <p className="text-[11px] text-amber-200/80">{m.intro}</p>
      {!loaded && !error && <p className="text-sm text-white/50">{m.loading}</p>}
      {error && <p className="text-sm text-rose-300" role="alert">{error}</p>}

      <SettingsSection id="sv-side-return" title={m.returnTitle}>
        <SettingsRow label={lbl(m.returnRate, 'exileTokenFaabRate')} control={<Input type="number" min={0} max={200} value={draft.exileTokenFaabRate} disabled={off || isLocked('exileTokenFaabRate')} onChange={(e) => set('exileTokenFaabRate', Number(e.target.value))} className="w-24" aria-label={m.returnRate} />} />
        <SettingsRow label={m.returnBasis} control={<Select value={draft.exileTokenFaabBasis} disabled={off || isLocked('exileTokenFaabBasis')} onChange={(v) => set('exileTokenFaabBasis', v as SurvivorSideGameSettings['exileTokenFaabBasis'])}><option value="all">{m.basisAll}</option><option value="leftover">{m.basisLeftover}</option></Select>} />
      </SettingsSection>

      <SettingsSection id="sv-side-lineup" title={m.lineupTitle} description={m.lineupSlotsHelp}>
        <SettingsRow label={m.lineupSlots} control={<Input value={slotsText} disabled={off} onChange={(e) => setSlotsText(e.target.value)} placeholder="QB RB WR TE W/R/T" className="w-56" aria-label={m.lineupSlots} />} />
        <SettingsRow label={m.lineupBench} control={<Input type="number" min={0} max={5} value={draft.exileBenchSlots} disabled={off || !slotsText.trim()} onChange={(e) => set('exileBenchSlots', Number(e.target.value))} className="w-20" aria-label={m.lineupBench} />} />
      </SettingsSection>

      <SettingsSection id="sv-side-claims" title={m.claimsTitle}>
        <SettingsRow label={m.claimMode} control={<Select value={draft.exileClaimMode} disabled={off} onChange={(v) => set('exileClaimMode', v as SurvivorSideGameSettings['exileClaimMode'])}><option value="first_come">{m.claimFirstCome}</option><option value="faab_bid">{m.claimBid}</option></Select>} />
        {draft.exileClaimMode === 'faab_bid' && <>
          <SettingsRow label={m.bidBudget} control={<Input type="number" min={1} max={1000} value={draft.exileBidBudget} disabled={off} onChange={(e) => set('exileBidBudget', Number(e.target.value))} className="w-24" aria-label={m.bidBudget} />} />
          <SettingsRow label={m.bidClose} control={<div className="flex gap-2"><Select value={draft.exileBidCloseDay} disabled={off} onChange={(v) => set('exileBidCloseDay', v as SurvivorSideGameSettings['exileBidCloseDay'])}>{days}</Select><Input type="time" value={draft.exileBidCloseTime} disabled={off} onChange={(e) => set('exileBidCloseTime', e.target.value)} className="w-28" aria-label={m.bidClose} /></div>} />
        </>}
      </SettingsSection>

      <SettingsSection id="sv-side-secrecy" title={m.secrecyTitle}>
        <SettingsRow label={m.hideExile} control={<Toggle checked={draft.hideExileMembership} disabled={off} onChange={(v) => set('hideExileMembership', v)} />} />
      </SettingsSection>

      <SettingsSection id="sv-side-token-pool" title={m.tokenPoolTitle}>
        <SettingsRow label={m.tokenPoolEnabled} control={<Toggle checked={draft.tokenPoolEnabled} disabled={off} onChange={(v) => set('tokenPoolEnabled', v)} />} />
        {draft.tokenPoolEnabled && <>
          <SettingsRow label={m.tokenPoolOpen} control={<Toggle checked={draft.tokenPoolOpen} disabled={off} onChange={(v) => set('tokenPoolOpen', v)} />} />
          <SettingsRow label={lbl(m.tokenPoolMode, 'tokenPoolMode')} control={<Select value={draft.tokenPoolMode} disabled={off || isLocked('tokenPoolMode')} onChange={(v) => set('tokenPoolMode', v as SurvivorSideGameSettings['tokenPoolMode'])}><option value="per_pick">{m.modePerPick}</option><option value="streak">{m.modeStreak}</option></Select>} />
          <SettingsRow label={m.wrongPick} control={<Select value={draft.tokenPoolWrongPick} disabled={off} onChange={(v) => set('tokenPoolWrongPick', v as SurvivorSideGameSettings['tokenPoolWrongPick'])}><option value="keep">{m.wrongKeep}</option><option value="minus_one">{m.wrongMinusOne}</option><option value="lose_all">{m.wrongLoseAll}</option></Select>} />
          <SettingsRow label={m.picksPerWeek} control={<Input type="number" min={1} max={5} value={draft.tokenPoolPicksPerWeek} disabled={off} onChange={(e) => set('tokenPoolPicksPerWeek', Number(e.target.value))} className="w-20" aria-label={m.picksPerWeek} />} />
          <SettingsRow label={m.autoSettle} control={<Toggle checked={draft.tokenPoolAutoSettle} disabled={off} onChange={(v) => set('tokenPoolAutoSettle', v)} />} />
        </>}
      </SettingsSection>

      <SettingsSection id="sv-side-shop" title={m.shopTitle}>
        <SettingsRow label={m.shopEnabled} control={<Toggle checked={draft.tokenShopEnabled} disabled={off} onChange={(v) => set('tokenShopEnabled', v)} />} />
        {draft.tokenShopEnabled && draft.tokenShopItems.map((item, i) => (
          <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.06] p-2" data-testid={`survivor-shop-item-${item.id}`}>
            <span className="w-32 capitalize">{m.shopItem(item.id)}</span>
            <label className="flex items-center gap-1 text-[11px] text-white/60">{m.shopForSale}<Toggle checked={item.enabled} disabled={off} onChange={(v) => set('tokenShopItems', draft.tokenShopItems.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} /></label>
            <label className="flex items-center gap-1 text-[11px] text-white/60">{m.shopCost}<Input type="number" min={1} max={50} value={item.cost} disabled={off} onChange={(e) => set('tokenShopItems', draft.tokenShopItems.map((x, j) => (j === i ? { ...x, cost: Number(e.target.value) } : x)))} className="w-16" aria-label={`${m.shopCost} ${item.id}`} /></label>
          </div>
        ))}
      </SettingsSection>

      <SettingsSection id="sv-side-pool" title={m.poolTitle}>
        <SettingsRow label={m.poolEnabled} control={<Toggle checked={draft.survivorPoolEnabled} disabled={off} onChange={(v) => set('survivorPoolEnabled', v)} />} />
        {draft.survivorPoolEnabled && <>
          <SettingsRow label={lbl(m.poolStart, 'survivorPoolStartWeek')} control={<Input type="number" min={1} max={30} value={draft.survivorPoolStartWeek} disabled={off || isLocked('survivorPoolStartWeek')} onChange={(e) => set('survivorPoolStartWeek', Number(e.target.value))} className="w-20" aria-label={m.poolStart} />} />
          <SettingsRow label={m.poolRule} control={<Select value={draft.survivorPoolRule} disabled={off} onChange={(v) => set('survivorPoolRule', v as SurvivorSideGameSettings['survivorPoolRule'])}><option value="any">{m.ruleAny}</option><option value="conference">{m.ruleConference}</option><option value="away_only">{m.ruleAway}</option><option value="allowed_list">{m.ruleList}</option></Select>} />
          {draft.survivorPoolRule === 'conference' && <SettingsRow label={m.poolConference} control={<Select value={draft.survivorPoolConference} disabled={off} onChange={(v) => set('survivorPoolConference', v as 'AFC' | 'NFC')}><option value="AFC">AFC</option><option value="NFC">NFC</option></Select>} />}
          {draft.survivorPoolRule === 'allowed_list' && <SettingsRow label={m.poolAllowed} control={<Input value={teamsText} disabled={off} onChange={(e) => setTeamsText(e.target.value)} placeholder="KC, TB, ARI, ATL" className="w-56" aria-label={m.poolAllowed} />} />}
          <SettingsRow label={m.poolWeekRules} control={<Input value={weekRulesText} disabled={off} onChange={(e) => setWeekRulesText(e.target.value)} className="w-64" aria-label={m.poolWeekRules} />} />
          <SettingsRow label={m.poolPrize} control={<Select value={draft.survivorPoolPrize.kind} disabled={off} onChange={(v) => set('survivorPoolPrize', { ...draft.survivorPoolPrize, kind: v as SideGamePrizeKind })}>{prizeKinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</Select>} />
          {['faab', 'score_bonus', 'auction_cash', 'tokens'].includes(draft.survivorPoolPrize.kind) && <SettingsRow label={m.poolPrizeAmount} control={<Input type="number" min={1} max={1000} value={draft.survivorPoolPrize.amount} disabled={off} onChange={(e) => set('survivorPoolPrize', { ...draft.survivorPoolPrize, amount: Number(e.target.value) })} className="w-24" aria-label={m.poolPrizeAmount} />} />}
          {draft.survivorPoolPrize.kind === 'advantage' && <SettingsRow label={m.prizeAdvantage} control={<Select value={draft.survivorPoolPrize.powerType} disabled={off} onChange={(v) => set('survivorPoolPrize', { ...draft.survivorPoolPrize, powerType: v as SurvivorSideGameSettings['survivorPoolPrize']['powerType'] })}><option value="extra_vote">extra vote</option><option value="vote_shield">vote shield</option><option value="vote_steal">vote steal</option></Select>} />}
          <SettingsRow label={lbl(m.poolRevives, 'survivorPoolRevives')} control={<Input type="number" min={0} max={5} value={draft.survivorPoolRevives} disabled={off || isLocked('survivorPoolRevives')} onChange={(e) => set('survivorPoolRevives', Number(e.target.value))} className="w-20" aria-label={m.poolRevives} />} />
        </>}
      </SettingsSection>

      <SettingsSection id="sv-side-auction" title={m.auctionTitle}>
        <SettingsRow label={m.auctionCurrency} control={<Select value={draft.auctionCurrency} disabled={off} onChange={(v) => set('auctionCurrency', v as SurvivorSideGameSettings['auctionCurrency'])}><option value="faab">{m.currencyFaab}</option><option value="auction_cash">{m.currencyCash}</option></Select>} />
        {draft.auctionCurrency === 'auction_cash' && <SettingsRow label={m.auctionCash} control={<Input type="number" min={0} max={1000} value={draft.auctionCashPerAuction} disabled={off} onChange={(e) => set('auctionCashPerAuction', Number(e.target.value))} className="w-24" aria-label={m.auctionCash} />} />}
      </SettingsSection>

      {loaded && <div className="flex justify-end"><button type="button" onClick={() => void save()} disabled={off} className="rounded-xl border border-[#ff3d81]/40 bg-cyan-950/40 px-5 py-2 text-sm text-[#ffd7e5] disabled:opacity-40" data-testid="survivor-side-games-save">{saving ? m.saving : m.save}</button></div>}
      {status && <p role="status" className="text-sm text-amber-200">{status}</p>}
    </div>
  )
}
