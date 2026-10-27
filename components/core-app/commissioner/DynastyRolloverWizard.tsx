'use client'

import { useState } from 'react'
import BroadcastModal from '@/components/commish/BroadcastModal'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { leagueSettingsHomeHref } from '@/lib/league-settings-home/settingsEntryRouting'
import type { RolloverStepState } from '@/lib/season-rollover/rolloverWizard'
import type { DynastyStepKey } from '@/lib/season-rollover/dynastyRolloverWizard'
import type { DynastyRolloverView } from '@/lib/season-rollover/dynastyRolloverService'

/**
 * The dynasty rollover wizard (lib/season-rollover/dynastyRolloverWizard.ts) on the Commissioner
 * Hub, in the spec's order: rookie draft order → taxi → contracts → dues → schedule → start. The
 * actions are the existing ones: `create_next_draft` on the draft controls, the dues on the
 * rollover route, and POST /api/leagues/[id]/season/start-new. Rendered by RolloverWizard when the
 * league is dynasty; strings are in lib/i18n (commishHub.rollover.dyn.*), a server message as is.
 */
const MARK: Record<RolloverStepState, string> = { done: '✓', todo: '•', blocked: '🔒', optional: '○' }
const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`
const K = 'commishHub.rollover.dyn.'

export function DynastyRolloverWizard({ leagueId, view, reload }: { leagueId: string; view: DynastyRolloverView; reload: () => Promise<void> }) {
  const { language, t, tInterpolate } = useOptionalLanguage()
  const tx = (key: string, vars?: Record<string, string | number>) => (vars ? tInterpolate(K + key, vars) : t(K + key))
  const plural = (key: string, n: number, vars: Record<string, string | number> = {}) => tx(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...vars })
  const { input, plan } = view
  const [dues, setDues] = useState(input.dues.amountDollars != null ? String(input.dues.amountDollars) : '')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [announcing, setAnnouncing] = useState(false)
  const id = encodeURIComponent(leagueId)
  const vars = { season: input.season, next: input.nextSeason }
  const between = input.seasonOver && !input.started

  const run = async (url: string, body: Record<string, unknown>, success: string) => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!r.ok) {
        setMessage({ ok: false, text: data.error || data.message || tx('failed') })
        return
      }
      setMessage({ ok: true, text: success })
      setConfirmed(false)
      await reload()
    } catch {
      setMessage({ ok: false, text: tx('offline') })
    } finally {
      setBusy(false)
    }
  }

  const saveDues = () => {
    const amount = dues.trim() === '' ? null : Number(dues)
    void run(`/api/leagues/${id}/rollover`, { action: 'set_dues', amount }, amount ? tx('dues.saved', { next: input.nextSeason, amount }) : tx('dues.cleared', vars))
  }

  const detail = (key: DynastyStepKey) => {
    switch (key) {
      case 'season':
        if (!input.seasonOver) return tx('season.blocked', vars)
        return input.champion ? tx('season.champion', { team: input.champion, season: input.season }) : tx('season.over')
      case 'draft_order':
        return (
          <>
            {tx(`order.${input.draftOrder.source}`)}
            {input.draftOrder.source === 'live_order' && input.draftOrder.finalOrderSaved ? ` ${tx('order.saved')}` : ''}{' '}
            <a href={leagueSettingsHomeHref(leagueId, 'draft')}>{tx('order.settings')}</a>
            <div>
              {input.rookieDraft === 'complete' || input.started ? (
                tx('draft.complete', vars)
              ) : input.rookieDraft === 'open' ? (
                <>
                  {tx('draft.open', vars)} <a href={`/core/draft-hq?league=${id}`}>{tx('draft.room')}</a>
                </>
              ) : (
                <>
                  {tx('draft.none', vars)}{' '}
                  <button
                    type="button"
                    className="af-btn"
                    disabled={busy || !input.seasonOver}
                    onClick={() => void run(`/api/leagues/${id}/draft/controls`, { action: 'create_next_draft' }, tx('draft.created', vars))}
                    data-testid="dyn-rollover-create-draft"
                  >
                    {tx('draft.create')}
                  </button>
                </>
              )}
            </div>
          </>
        )
      case 'taxi': {
        const rule =
          input.taxi.slots > 0
            ? tx(input.taxi.allowNonRookies ? 'taxi.rule.any' : 'taxi.rule.rookies', { slots: input.taxi.slots }) +
              (input.taxi.yearsLimit ? ` ${plural('taxi.rule.years', input.taxi.yearsLimit)}` : '')
            : tx('taxi.none')
        const effect = input.started
          ? plural('taxi.moved', input.taxi.toBench)
          : input.taxi.toBench > 0
            ? plural('taxi.willMove', input.taxi.toBench)
            : input.taxi.slots > 0
              ? tx('taxi.allQualify')
              : ''
        return (
          <>
            {rule} {effect}
            {input.taxi.unverified > 0 ? ` ${plural('taxi.unverified', input.taxi.unverified)}` : ''}{' '}
            <a href={leagueSettingsHomeHref(leagueId, 'roster')}>{tx('taxi.settings')}</a>
          </>
        )
      }
      case 'contracts':
        return input.contracts && input.contracts.expiring > 0
          ? plural('contracts.expiring', input.contracts.expiring, { active: input.contracts.active, season: input.season })
          : tx('contracts.none', vars)
      case 'dues':
        return (
          <>
            {input.dues.setForNextSeason
              ? input.dues.amountDollars
                ? tx('dues.set', { next: input.nextSeason, amount: input.dues.amountDollars })
                : tx('dues.free', vars)
              : input.dues.unpaidTeams > 0
                ? plural('dues.unpaid', input.dues.unpaidTeams, vars)
                : tx('dues.fresh')}
            <label className="af-ch-rollover-field">
              <span>{tx('dues.label', vars)}</span>
              <input
                inputMode="decimal"
                className="w-24"
                value={dues}
                placeholder="0"
                disabled={!between || busy}
                aria-label={tx('dues.aria', vars)}
                onChange={(e) => setDues(e.target.value)}
                data-testid="dyn-rollover-dues"
              />
              <button type="button" className="af-btn" disabled={!between || busy} onClick={saveDues} data-testid="dyn-rollover-dues-save">
                {tx('dues.save')}
              </button>
            </label>
          </>
        )
      case 'schedule':
        return input.schedule.matchups > 0 ? (
          <>
            {plural('schedule.ready', input.schedule.weeks, vars)} <a href={`/core/schedule?league=${id}`}>{tx('schedule.open')}</a>
          </>
        ) : (
          tx('schedule.later')
        )
      case 'start':
        if (input.started) {
          return (
            <>
              {tx('start.done', vars)}
              {input.overLimitTeams > 0 ? ` ${plural('start.overLimit', input.overLimitTeams)}` : ''}
            </>
          )
        }
        if (!input.seasonOver) return tx('start.blocked')
        if (input.rookieDraft === 'open') return tx('start.draftOpen')
        return (
          <>
            <p>
              {tx(plan.startSkipsRookieDraft ? 'start.noDraft' : 'start.withDraft', vars)} {tx('start.checks')}
              {input.overLimitTeams > 0 ? ` ${plural('start.overLimitPreview', input.overLimitTeams)}` : ''}
            </p>
            {plan.startSkipsRookieDraft ? (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="dyn-rollover-confirm" />
                <span>{tx('start.confirm')}</span>
              </label>
            ) : null}
            <button
              type="button"
              className="af-btn"
              data-primary="true"
              disabled={busy || (plan.startSkipsRookieDraft && !confirmed)}
              onClick={() =>
                void run(`/api/leagues/${id}/season/start-new`, { skipRookieDraft: plan.startSkipsRookieDraft }, tx('start.started', vars))
              }
              data-testid="dyn-rollover-start"
            >
              {busy ? tx('start.busy') : tx(plan.startSkipsRookieDraft ? 'start.buttonNoDraft' : 'start.button', vars)}
            </button>
          </>
        )
    }
  }

  const announcement = view.extras ? (language === 'es' ? view.extras.announcement.es : view.extras.announcement.en) : ''

  return (
    <section id="ch-rollover" className="af-card af-ch-section" aria-labelledby="ch-rollover-h" data-testid="dyn-rollover-wizard">
      <header className="af-ch-section-head">
        <h2 id="ch-rollover-h" className="af-label">{tx('title')}</h2>
        <span className="af-ch-section-note">{input.started ? tx('note.started', vars) : `${input.season} → ${input.nextSeason}`}</span>
      </header>
      <ol className="af-ch-week-list">
        {plan.steps.map((s) => (
          <li key={s.key} className="af-ch-week-item" data-status={s.state} data-testid={`dyn-rollover-step-${s.key}`}>
            <span className="af-ch-week-mark" aria-hidden>{MARK[s.state]}</span>
            <div>
              <strong>{tx(`step.${s.key}`)}</strong> <span className="af-ch-muted">· {tx(`state.${s.state}`)}</span>
              <div>{detail(s.key)}</div>
            </div>
          </li>
        ))}
      </ol>

      {view.extras ? (
        <div className="af-ch-rollover-extras" data-testid="dyn-rollover-extras">
          <p className="af-label">AF Commissioner</p>
          {view.extras.payoutCarry ? (
            <p>
              {tx('extras.carry', {
                from: view.extras.payoutCarry.fromCents != null ? money(view.extras.payoutCarry.fromCents) : tx('extras.entryFee'),
                to: money(view.extras.payoutCarry.toCents),
              })}{' '}
              <button
                type="button"
                className="af-btn"
                disabled={busy}
                onClick={() => void run(`/api/leagues/${id}/rollover`, { action: 'carry_payouts' }, tx('extras.carried'))}
                data-testid="dyn-rollover-carry"
              >
                {tx('extras.carryButton')}
              </button>
            </p>
          ) : null}
          <p className="af-ch-muted">{tx('extras.drafted')}</p>
          <blockquote data-testid="dyn-rollover-announcement">{announcement}</blockquote>
          <button type="button" className="af-btn" onClick={() => setAnnouncing(true)} data-testid="dyn-rollover-announce">
            {tx('extras.send')}
          </button>
          <BroadcastModal open={announcing} onClose={() => setAnnouncing(false)} defaultLeagueId={leagueId} defaultMessage={announcement} />
        </div>
      ) : (
        <p className="af-ch-muted" data-testid="dyn-rollover-upsell">
          {tx('extras.upsell')} <a href="/pricing">{tx('extras.plans')}</a>
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
