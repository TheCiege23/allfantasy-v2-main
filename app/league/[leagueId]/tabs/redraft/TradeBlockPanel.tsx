'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  fetchLeagueTradeBlock,
  fetchMyInterests,
  fetchRedraftRoster,
  addTradeBlockItem,
  removeTradeBlockItem,
  addTradeInterest,
  removeTradeInterest,
  type TradeBlockItem,
  type TradeInterestItem,
  type RedraftRosterPlayerClient,
} from '@/lib/redraft/client'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { tOr } from '@/lib/i18n/tInterpolate'
import { localizeTradeReason, serverErrorText } from '@/lib/i18n/trade-center-server-text'

/** The one grade's five labels (`tradeGradeLabel`), arriving from the server in English. */
const GRADE_LABEL_KEY: Record<string, string> = {
  'Major win (you)': 'tradeCenter.block.gradeLabel.majorWin',
  'Slightly favors you': 'tradeCenter.block.gradeLabel.slightlyYou',
  Even: 'tradeCenter.block.gradeLabel.even',
  'Slightly favors opponent': 'tradeCenter.block.gradeLabel.slightlyOpponent',
  'Major overpay': 'tradeCenter.block.gradeLabel.majorOverpay',
}

/**
 * THE grade on a league block card (2026-09-28): the suggested offer from your roster for that player
 * and its one grade, yours first. A withheld grade says why; an ungraded offer shows only the offer.
 * See lib/trade-block/tradeBlockOffers.ts.
 */
export function BlockOfferLine({ offer }: { offer: TradeBlockItem['suggestedOffer'] }) {
  const { t, tInterpolate, language } = useOptionalLanguage()
  if (!offer) return null
  const g = offer.grade
  return (
    <div className="mt-1 text-[11px] leading-snug text-white/65" data-testid="block-offer">
      <span>
        {tInterpolate('tradeCenter.block.offer', { gives: offer.gives.join(' + '), receives: offer.receives.join(' + ') })}
      </span>
      {g?.graded ? (
        <span className="block font-semibold text-white/85" data-testid="block-offer-grade">
          {tInterpolate('tradeCenter.block.grade', { letter: g.letter, partnerLetter: g.partnerLetter })}
          {g.label ? <span className="font-normal text-white/55"> — {tOr(t, GRADE_LABEL_KEY[g.label], g.label)}</span> : null}
        </span>
      ) : g ? (
        <span className="block text-amber-200/80" data-testid="block-offer-grade-withheld">
          {tInterpolate('tradeCenter.block.notGraded', { reason: localizeTradeReason(g.reason, language) })}
        </span>
      ) : null}
    </div>
  )
}

/**
 * T8 native Trade Block UI: My Trade Block (publish/unpublish owned players), League Trade Block
 * (league-visible cards with Mark interest / Build proposal), My Interests. No auto-submit; "Build
 * proposal" only opens the existing modal preselected.
 */
export function TradeBlockPanel({
  leagueId,
  myRosterId,
  currentWeek,
  onBuildProposal,
}: {
  leagueId: string
  myRosterId: string
  currentWeek: number
  onBuildProposal: (partnerRosterId: string) => void
}) {
  const { t, language } = useOptionalLanguage()
  /** An interest with no player or position shows its type: the catalog's label (English is the raw code, as before). */
  const interestLabel = (it: TradeInterestItem) =>
    it.playerName ?? it.position ?? tOr(t, `tradeCenter.block.interestType.${it.interestType}`, it.interestType)
  const [open, setOpen] = useState(false)
  const [leagueBlock, setLeagueBlock] = useState<TradeBlockItem[]>([])
  const [myInterests, setMyInterests] = useState<TradeInterestItem[]>([])
  const [myPlayers, setMyPlayers] = useState<RedraftRosterPlayerClient[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [block, interests, roster] = await Promise.all([
        fetchLeagueTradeBlock(leagueId),
        fetchMyInterests(leagueId),
        fetchRedraftRoster(myRosterId, currentWeek).catch(() => null),
      ])
      setLeagueBlock(block.items)
      setMyInterests(interests.interests)
      setMyPlayers(roster?.players ?? [])
    } catch (e) {
      setError(e instanceof Error ? serverErrorText(e as Error & { code?: string | null }, e.message, t, language) : t('tradeCenter.block.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [leagueId, myRosterId, currentWeek, t, language])

  useEffect(() => {
    if (open && !loading && leagueBlock.length === 0 && myInterests.length === 0 && myPlayers.length === 0) void load()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const myBlockPlayerIds = new Set(leagueBlock.filter((i) => i.rosterId === myRosterId).map((i) => i.playerId))

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof Error ? serverErrorText(e as Error & { code?: string | null }, e.message, t, language) : t('tradeCenter.block.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-violet-300/15 bg-violet-400/[0.05]" data-testid="trade-block-panel">
      <button
        type="button"
        data-testid="trade-block-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold text-violet-100"
      >
        <span>{t('tradeCenter.block.toggle')}</span>
        <span className="text-violet-200/70">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-violet-300/15 px-3 py-2 text-[11px]">
          {loading ? <p className="text-white/50">{t('tradeCenter.block.loading')}</p> : null}
          {error ? <p className="text-rose-300">{error}</p> : null}

          <section>
            <p className="text-[11px] font-semibold text-white">{t('tradeCenter.block.mine')}</p>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {myPlayers.map((p) => {
                const on = myBlockPlayerIds.has(p.playerId)
                return (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded border border-white/10 bg-black/20 px-2 py-1">
                    <span className="truncate text-white/80">
                      {p.playerName} <span className="text-white/40">{p.position}</span>
                    </span>
                    <button
                      type="button"
                      data-testid={`block-toggle-${p.playerId}`}
                      disabled={busy}
                      onClick={() =>
                        act(() =>
                          on
                            ? removeTradeBlockItem(leagueBlock.find((i) => i.rosterId === myRosterId && i.playerId === p.playerId)!.id)
                            : addTradeBlockItem({ leagueId, playerId: p.playerId, playerName: p.playerName, position: p.position, team: p.team }),
                        )
                      }
                      className={`rounded px-1.5 py-0.5 text-[11px] ${on ? 'border border-rose-400/40 text-rose-200' : 'bg-violet-500/80 text-black'}`}
                    >
                      {on ? t('tradeCenter.block.remove') : t('tradeCenter.block.add')}
                    </button>
                  </div>
                )
              })}
            </div>
          </section>

          <section>
            <p className="text-[11px] font-semibold text-white">{t('tradeCenter.block.league')}</p>
            {leagueBlock.filter((i) => i.rosterId !== myRosterId).length === 0 ? (
              <p className="mt-0.5 text-white/45">{t('tradeCenter.block.leagueEmpty')}</p>
            ) : (
              <div className="mt-1 space-y-1">
                {leagueBlock.filter((i) => i.rosterId !== myRosterId).map((i) => (
                  <div key={i.id} className="rounded border border-white/10 bg-black/20 p-2" data-testid="league-block-card">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">
                        {i.playerName} <span className="text-white/40">{i.position}</span>
                      </span>
                      <div className="flex gap-1">
                        <button type="button" disabled={busy} data-testid={`mark-interest-${i.playerId}`}
                          onClick={() => act(() => addTradeInterest({ leagueId, interestType: 'player_interest', targetRosterId: i.rosterId, playerId: i.playerId, playerName: i.playerName, position: i.position }))}
                          className="rounded border border-white/20 px-1.5 py-0.5 text-[11px] text-white/80">{t('tradeCenter.block.markInterest')}</button>
                        <button type="button" data-testid={`block-build-${i.rosterId}`}
                          onClick={() => onBuildProposal(i.rosterId)}
                          className="rounded bg-[#ff3d81]/85 px-1.5 py-0.5 text-[11px] font-semibold text-black">{t('tradeCenter.block.buildProposal')}</button>
                      </div>
                    </div>
                    <BlockOfferLine offer={i.suggestedOffer} />
                    {i.note ? <p className="mt-0.5 text-[11px] text-white/55">“{i.note}”</p> : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <p className="text-[11px] font-semibold text-white">{t('tradeCenter.block.interests')}</p>
            {myInterests.length === 0 ? (
              <p className="mt-0.5 text-white/45">{t('tradeCenter.block.interestsEmpty')}</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {myInterests.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-2 text-[11px] text-white/70">
                    <span>{interestLabel(it)} <span className="text-white/40">({tOr(t, `tradeCenter.block.visibility.${it.visibility}`, it.visibility)})</span></span>
                    <button type="button" disabled={busy} onClick={() => act(() => removeTradeInterest(it.id))} className="text-rose-300/80">{t('tradeCenter.block.removeInterest')}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}
