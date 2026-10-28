'use client'

import Link from 'next/link'
import { paidToolFetch, approvePaidToolQuote } from '@/lib/tokens/paidToolClient'
import { useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { hubCopy } from '@/lib/core-app/commissionerHubCopy'

type ChatResult = {
  answer?: string
  source?: 'ai' | 'template'
  /** Screens for the tasks the answer is about (lib/ai-commissioner/commissionerDesk.ts) — never from the model. */
  actions?: Array<{ label: string; href: string }>
  error?: string
  code?: string
  preview?: { tokenCost?: number; currentBalance?: number }
}

/** Questions a commissioner asks most, one tap each. */
const STARTERS = [
  'What needs my attention this week?',
  'Is anything waiting on me in trades?',
  'Which teams look inactive?',
  'Are dues and payouts settled?',
] as const

/**
 * Ask Chimmy as commissioner. Chimmy answers from the commissioner's desk — open tasks, this week's
 * checklist, the league office — and the screens to act on come from that desk, not from the model.
 * Read-only: nothing here changes the league. The chat route checks league role and token consent.
 */
export function CommissionerChimmy({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const t = (english: string | null | undefined) => hubCopy(english, language)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<ChatResult | null>(null)
  const [busy, setBusy] = useState(false)
  const ask = async (confirmed: boolean): Promise<ChatResult> => {
    const response = await paidToolFetch(`/api/leagues/${encodeURIComponent(leagueId)}/ai-commissioner/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question.trim(), confirmTokenSpend: confirmed }),
    })
    const result = await response.json() as ChatResult
    if (!response.ok && result.code !== 'token_confirmation_required') throw new Error(result.error ?? 'Chimmy could not answer')
    return result
  }
  const submit = async () => {
    if (!question.trim()) return
    setBusy(true); setAnswer(null)
    try {
      let result = await ask(false)
      if (result.code === 'token_confirmation_required') {
        const cost = result.preview?.tokenCost
        const balance = result.preview?.currentBalance ?? t('unknown')
        const accepted = window.confirm(
          t(
            cost == null
              ? `Use the stated number of tokens for this commissioner question? Current balance: ${balance}.`
              : cost === 1
                ? `Use 1 token for this commissioner question? Current balance: ${balance}.`
                : `Use ${cost} tokens for this commissioner question? Current balance: ${balance}.`,
          ),
        )
        if (!accepted || !approvePaidToolQuote(result)) return
        result = await ask(true)
      }
      setAnswer(result)
    } catch (cause) { setAnswer({ error: cause instanceof Error ? cause.message : 'Chimmy could not answer' }) }
    finally { setBusy(false) }
  }
  // Styled on the Core theme tokens via af-ch-chimmy* (af-commish-hub.css). Tailwind
  // white/colour utilities are forbidden in .af-core: light mode clamps them unreadable.
  return <div className="af-ch-chimmy" data-testid="commissioner-chimmy">
    <h3 className="af-ch-chimmy-title">{t('Ask Chimmy about this league')}</h3>
    <p className="af-ch-muted">{t('Chimmy answers as your assistant commissioner: it sees what is waiting on you — open tasks, trades in your review, stat corrections, inactive teams, dues and payouts — and links you to the screen to act on. It cannot make rulings or change settings itself.')}</p>
    <div className="af-ch-chimmy-starters" role="group" aria-label={t('Suggested questions')}>
      {STARTERS.map((q) => (
        <button key={q} type="button" className="af-btn af-ch-chimmy-starter" onClick={() => setQuestion(t(q))}>{t(q)}</button>
      ))}
    </div>
    <label className="af-ch-chimmy-field">{t('Question')}<textarea className="af-ch-os-draft" rows={3} maxLength={1000} value={question} onChange={(event) => setQuestion(event.target.value)} /></label>
    <button type="button" className="af-btn af-ch-chimmy-ask" disabled={busy || !question.trim()} onClick={() => void submit()}>{busy ? t('Asking…') : t('Ask Chimmy')}</button>
    {answer?.answer && <div className="af-ch-chimmy-answer" aria-live="polite">{answer.answer}
      {answer.actions?.length ? (
        <nav className="af-ch-chimmy-actions" aria-label={t('Act on it')} data-testid="commissioner-chimmy-actions">
          {answer.actions.map((a) => <Link key={a.href} className="af-btn af-ch-step-link" href={a.href}>{t(a.label)}</Link>)}
        </nav>
      ) : null}
      <p className="af-ch-os-stamp">{answer.source === 'template' ? t('Template guidance') : t('AI guidance')} · {t('review evidence before acting.')}</p></div>}
    {answer?.error && <p className="af-ch-os-note" data-tone="bad" role="alert">{t(answer.error)}</p>}
  </div>
}
