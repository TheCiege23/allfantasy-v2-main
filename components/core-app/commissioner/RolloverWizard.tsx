'use client'

import { useCallback, useEffect, useState } from 'react'
import BroadcastModal from '@/components/commish/BroadcastModal'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { commissionerScreensMessages } from '@/lib/core-app/messages/commissionerScreens'
import { leagueSettingsHomeHref } from '@/lib/league-settings-home/settingsEntryRouting'
import type { RolloverStepKey, RolloverStepState } from '@/lib/season-rollover/rolloverWizard'
import type { RolloverView } from '@/lib/season-rollover/rolloverService'
import type { DynastyRolloverView } from '@/lib/season-rollover/dynastyRolloverService'
import { DynastyRolloverWizard } from './DynastyRolloverWizard'

/**
 * The season rollover wizard (lib/season-rollover) on the Commissioner Hub: the steps from the
 * champion being crowned to next season's draft being set up, each measured, then the one renew
 * (POST /api/commissioner/leagues/[id]/renew — the same renew the league banner runs). Shown to the
 * head commissioner from the playoffs on. AF Commissioner adds a drafted announcement and carrying
 * the dues into next season's payout buy-in. English and Spanish; a server message is shown as is.
 * A dynasty league gets its own steps from the same route (./DynastyRolloverWizard.tsx).
 */
type Order = 'standings' | 'reverse_standings' | 'random'

type M = typeof commissionerScreensMessages.en
/** A catalog key whose message is a plain string. */
type TextKey = { [K in keyof M]: M[K] extends string ? K : never }[keyof M]

const STATE_WORD: Record<RolloverStepState, TextKey> = {
  done: 'rolloverStateDone',
  todo: 'rolloverStateTodo',
  blocked: 'rolloverStateBlocked',
  optional: 'rolloverStateOptional',
}
const STEP_TITLE: Record<RolloverStepKey, TextKey> = {
  season: 'rolloverStepSeason',
  payouts: 'rolloverStepPayouts',
  managers: 'rolloverStepManagers',
  dues: 'rolloverStepDues',
  rules: 'rolloverStepRules',
  draft_order: 'rolloverStepDraftOrder',
  renew: 'rolloverStepRenew',
}
const MARK: Record<RolloverStepState, string> = { done: '✓', todo: '•', blocked: '🔒', optional: '○' }

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`

export function RolloverWizard({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const m = useMessages(commissionerScreensMessages)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/rollover`
  const [view, setView] = useState<(RolloverView & { applies: true }) | null>(null)
  const [dynasty, setDynasty] = useState<DynastyRolloverView | null>(null)
  const [dues, setDues] = useState('')
  const [order, setOrder] = useState<Order>('standings')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [announcing, setAnnouncing] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) return
      const body = (await r.json()) as RolloverView | DynastyRolloverView | { applies: false }
      if (!body.applies) return
      if (body.kind === 'dynasty') {
        setDynasty(body)
        return
      }
      setView(body)
      setDues(body.input.dues.amountDollars != null ? String(body.input.dues.amountDollars) : '')
      setOrder(body.input.draftOrder === 'manual' ? 'standings' : body.input.draftOrder)
    } catch {
      // A hub card: the rest of the hub renders without it.
    }
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  if (dynasty) return dynasty.show ? <DynastyRolloverWizard leagueId={leagueId} view={dynasty} reload={load} /> : null
  if (!view || !view.show) return null
  const { input, plan } = view
  const stateOf = (key: RolloverStepKey) => plan.steps.find((s) => s.key === key)!.state

  const renew = async () => {
    setBusy(true)
    setMessage(null)
    const amount = Number(dues)
    try {
      const r = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedSeason: input.season,
          draftOrder: order,
          duesEnabled: Number.isFinite(amount) && amount > 0,
          duesAmount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
        }),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!r.ok) {
        setMessage({ ok: false, text: body.message || body.error || m.rolloverRenewFailed })
        return
      }
      setMessage({ ok: true, text: m.rolloverRenewed(input.nextSeason) })
      await load()
    } catch {
      setMessage({ ok: false, text: m.rolloverUnreachable })
    } finally {
      setBusy(false)
    }
  }

  const carry = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'carry_payouts' }) })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) {
        setMessage({ ok: false, text: body.error || m.rolloverCouldNotSave })
        return
      }
      setMessage({ ok: true, text: m.rolloverCarried })
      await load()
    } catch {
      setMessage({ ok: false, text: m.rolloverUnreachable })
    } finally {
      setBusy(false)
    }
  }

  const detail = (key: RolloverStepKey) => {
    switch (key) {
      case 'season':
        return input.seasonOver || input.renewed
          ? input.champion
            ? m.rolloverChampionWon(input.champion, input.renewed ? input.season - 1 : input.season)
            : m.rolloverSeasonOver
          : m.rolloverOpensOnceCrowned(input.season)
      case 'payouts':
        return input.payouts.configured ? (
          <>
            {input.payouts.places.map((p) => `${m.rolloverOrdinal(p.place)} ${p.team ?? '—'} ${money(p.cents)}`).join(' · ')}
            {!input.payouts.final ? m.rolloverNotFinal : ''}
            {input.dues.unpaidTeams > 0 ? m.rolloverStillOwe(input.dues.unpaidTeams) : ''}{' '}
            <a href={`/core/standings?league=${encodeURIComponent(leagueId)}`}>{m.rolloverPayoutsLink}</a>
          </>
        ) : (
          m.rolloverNoPayouts
        )
      case 'managers':
        return input.managers.orphanTeams.length ? (
          <>
            {m.rolloverOrphans(input.managers.orphanTeams)}{' '}
            <a href="#workflow-replace-manager">{m.rolloverReplaceManager}</a>
          </>
        ) : (
          m.rolloverAllManaged(input.managers.active)
        )
      case 'dues':
        return (
          <label className="af-ch-rollover-field">
            <span>{m.rolloverDuesFor(input.nextSeason)}</span>
            <input
              inputMode="decimal"
              className="w-24"
              value={dues}
              placeholder="0"
              disabled={!plan.canRenew}
              aria-label={m.rolloverDuesAria(input.nextSeason)}
              onChange={(e) => setDues(e.target.value)}
              data-testid="rollover-dues"
            />
          </label>
        )
      case 'rules':
        return (
          <>
            {m.rolloverRulesCarry}{' '}
            <a href={leagueSettingsHomeHref(leagueId)}>{m.rolloverLeagueSettings}</a>
          </>
        )
      case 'draft_order':
        return (
          <label className="af-ch-rollover-field">
            <select value={order} disabled={!plan.canRenew} onChange={(e) => setOrder(e.target.value as Order)} data-testid="rollover-order">
              <option value="standings">{m.rolloverOrderWorstFirst}</option>
              <option value="reverse_standings">{m.rolloverOrderChampionFirst}</option>
              <option value="random">{m.rolloverOrderRandom}</option>
            </select>
          </label>
        )
      case 'renew':
        if (input.renewed) return m.rolloverRenewedFor(input.season)
        if (!plan.canRenew) return m.rolloverOpensWhenOver
        return (
          <>
            <p>
              {m.rolloverResetWarning(plan.willCancel.trades, plan.willCancel.claims)}
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="rollover-confirm" />
              <span>{m.rolloverUnderstand}</span>
            </label>
            <button type="button" className="af-btn" data-primary="true" disabled={!confirmed || busy} onClick={() => void renew()} data-testid="rollover-renew">
              {busy ? m.rolloverRenewing : m.rolloverRenewFor(input.nextSeason)}
            </button>
          </>
        )
    }
  }

  const announcement = view.extras ? view.extras.announcement[language === 'es' ? 'es' : 'en'] : ''

  return (
    <section id="ch-rollover" className="af-card af-ch-section" aria-labelledby="ch-rollover-h" data-testid="rollover-wizard">
      <header className="af-ch-section-head">
        <h2 id="ch-rollover-h" className="af-label">{m.rolloverHeading}</h2>
        <span className="af-ch-section-note">
          {input.renewed ? m.rolloverReadyFor(input.season) : `${input.season} → ${input.nextSeason}`}
        </span>
      </header>
      <ol className="af-ch-week-list">
        {plan.steps.map((s) => (
          <li key={s.key} className="af-ch-week-item" data-status={s.state} data-testid={`rollover-step-${s.key}`}>
            <span className="af-ch-week-mark" aria-hidden>{MARK[s.state]}</span>
            <div>
              <strong>{m[STEP_TITLE[s.key]]}</strong> <span className="af-ch-muted">· {m[STATE_WORD[s.state]]}</span>
              <div>{detail(s.key)}</div>
            </div>
          </li>
        ))}
      </ol>

      {view.extras ? (
        <div className="af-ch-rollover-extras" data-testid="rollover-extras">
          <p className="af-label">{m.rolloverAfCommissioner}</p>
          {view.extras.payoutCarry ? (
            <p>
              {m.rolloverPayoutCarry(
                view.extras.payoutCarry.fromCents != null ? money(view.extras.payoutCarry.fromCents) : null,
                money(view.extras.payoutCarry.toCents),
              )}{' '}
              <button type="button" className="af-btn" disabled={busy} onClick={() => void carry()} data-testid="rollover-carry">
                {m.rolloverUseNewDues}
              </button>
            </p>
          ) : null}
          <p className="af-ch-muted">{m.rolloverAnnouncementDrafted}</p>
          <blockquote data-testid="rollover-announcement">{announcement}</blockquote>
          <button type="button" className="af-btn" onClick={() => setAnnouncing(true)} data-testid="rollover-announce">
            {m.rolloverSendToLeague}
          </button>
          <BroadcastModal open={announcing} onClose={() => setAnnouncing(false)} defaultLeagueId={leagueId} defaultMessage={announcement} />
        </div>
      ) : (
        <p className="af-ch-muted" data-testid="rollover-upsell">
          {m.rolloverUpsell}{' '}
          <a href="/pricing">{m.rolloverSeePlans}</a>
        </p>
      )}

      {message ? (
        <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'af-ch-muted' : undefined}>
          {message.text}
        </p>
      ) : null}
    </section>
  )
}
