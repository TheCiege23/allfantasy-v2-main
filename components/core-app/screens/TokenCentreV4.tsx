'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { useTokenBalance } from '@/hooks/useTokenBalance'
import { usePostPurchaseSync } from '@/hooks/usePostPurchaseSync'
import { resolveCheckoutUrl } from '@/lib/monetization/checkout-client'
import { useNativeIapPrices } from '@/lib/monetization/native-iap-client'
import { CheckoutOutcomePanel } from '@/components/monetization/CheckoutOutcomePanel'
import { getTokenPurchasableRule, type TokenBuyer } from '@/lib/tokens/tokenPurchasable'
import { FREE_CHIMMY_QUESTIONS_PER_DAY } from '@/lib/tokens/freeChimmyQuestions'
import { activityRow, tokensHeadline, type ActivityRow } from '@/lib/core-app/tokensGuide'
import { tokensGuideMessages } from '@/lib/core-app/messages/tokensGuide'
// 2026-11-14: af-core.css carries the .af-core token layer (--surface, --line, --text2, --accent-ink …)
// that af-tokens.css reads. This screen renders standalone at /tokens, outside AfCoreShell, and never
// imported it — measured on the live page: --surface, --surface2, --line, --line2, --text2 and
// --accent-ink all computed to the EMPTY STRING, packs painted with no background and no border, and
// --accent fell through to an unrelated #7c3aed purple. Same failure, same fix, as PricingV4.tsx: the
// import must precede af-tokens.css AND the root must carry the `af-core` class.
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-tokens.css'
import '@/components/core-app/af-tokens-guide.css'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'

/**
 * Screen 20a — the token centre.
 *
 * 2026-11-14 guide pass: the balance is the headline, said in Chimmy questions; the packs come before
 * the price list; what tokens don't cover folds; the history is "Recent activity" in plain words. The
 * page also gained a header — it had none, and not one link, so there was no way back to the app.
 *
 * ⚠ ONE PRICE COLUMN. The handoff's struck-through "list price" beside "your price" described a
 * subscriber discount that was dropped with the token grants (`discountedTokenSpendPct` is 0 for every
 * plan), so two columns would show the same number twice, one crossed out.
 *
 * ⚠ EXISTING COPY STILL GOES THROUGH t(); the guide's new copy is a catalog
 * (lib/core-app/messages/tokensGuide.ts), so neither path silently un-translates the page.
 */

type SpendRule = {
  code: string
  label: string
  who: TokenBuyer
  tokenCost: number
}

type TokenCentreV4Props = {
  packs: Array<{ sku: string; amountUsd: number; tokenAmount: number | null }>
}

/** Who can buy it, when that is narrower than "any member". */
const WHO_KEY: Partial<Record<TokenBuyer, string>> = {
  commissioner: 'tokens.v4.whoCommissioner',
  pool_manager: 'tokens.v4.whoPoolManager',
}

const CHIMMY_RULE = 'ai_chimmy_chat_message'

/** Same mark as the pricing and landing navs. */
function Shield() {
  return (
    <svg width="24" height="26" viewBox="0 0 28 30" aria-hidden focusable="false">
      <path
        d="M14 1.5 26 6v10.5c0 6.4-5 10.6-12 12.5-7-1.9-12-6.1-12-12.5V6l12-4.5Z"
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <text x="14" y="19" textAnchor="middle" fill="var(--accent)" style={{ font: '900 10px Archivo, sans-serif', letterSpacing: '0.02em' }}>
        AF
      </text>
    </svg>
  )
}

export function TokenCentreV4({ packs }: TokenCentreV4Props) {
  const { nativeApp, prices: nativePrices, error: playError } = useNativeIapPrices()
  const { t } = useLanguage()
  const g = useMessages(tokensGuideMessages)
  const { balance, loading: balanceLoading } = useTokenBalance()
  const postPurchase = usePostPurchaseSync({})
  const locale = getAppIntlLocale()

  const [rules, setRules] = useState<SpendRule[]>([])
  const [history, setHistory] = useState<ActivityRow[]>([])
  const [pendingSku, setPendingSku] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [rulesRes, histRes] = await Promise.all([
        fetch('/api/tokens/spend-rules', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/tokens/history?limit=15', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ])
      if (cancelled) return
      const raw = (rulesRes?.rules ?? rulesRes?.data ?? []) as Array<Record<string, unknown>>
      /*
       * 🛑 ONLY WHAT A SCREEN CAN ACTUALLY SELL. The API returns every priced rule — 64 of them —
       * and this page used to list them all, advertising 51 actions no screen could buy
       * (lib/tokens/tokenPurchasable.ts). The cost comes from the live rule; the list and the
       * plain-words label come from the allowlist.
       */
      const buyable: SpendRule[] = []
      for (const r of raw) {
        const known = getTokenPurchasableRule(String(r.code ?? ''))
        const tokenCost = Number(r.tokenCost ?? 0)
        if (!known || !(tokenCost > 0)) continue
        buyable.push({ code: known.code, label: known.label, who: known.who, tokenCost })
      }
      buyable.sort((a, b) => a.tokenCost - b.tokenCost || a.label.localeCompare(b.label))
      setRules(buyable)
      /*
       * ⚠ THE HISTORY API'S FIELDS ARE `spendFeatureLabel`, `description`, `sourceType` AND
       * `tokenDelta` (TokenSpendService `toLedgerView`). `activityRow` phrases each one and drops a
       * row that changed nothing — the live page showed a red "0".
       */
      const entries = (histRes?.entries ?? histRes?.data ?? []) as Array<Record<string, unknown>>
      setHistory(entries.map(activityRow).filter((r): r is ActivityRow => r != null))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** What one Chimmy question costs, so the balance and each pack can say what they buy. */
  const chimmyCost = useMemo(() => rules.find((r) => r.code === CHIMMY_RULE)?.tokenCost ?? null, [rules])
  const head = tokensHeadline(balance, balanceLoading, chimmyCost)

  async function buy(sku: string) {
    setError(null)
    setPendingSku(sku)
    const res = await resolveCheckoutUrl({ sku, productType: 'token_pack', returnPath: '/tokens' })
    if (!res.ok) {
      setError(res.error)
      setPendingSku(null)
      return
    }
    if ('completed' in res) {
      window.location.reload()
      return
    }
    window.location.assign(res.url)
  }

  function activityText(h: ActivityRow): string {
    if (h.kind === 'dailyTopUp') return g.dailyTopUp
    if (h.kind === 'bought') return g.bought(Math.abs(h.delta).toLocaleString(locale))
    if (h.kind === 'refund') return g.refund(h.label)
    return h.label ?? ''
  }
  const day = (iso: string | null) =>
    iso && !Number.isNaN(Date.parse(iso)) ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(iso)) : null

  function headlineContent() {
    if (head.kind === 'unavailable') return g.headUnavailable
    if (head.kind === 'loading') return g.headLoading
    const n = head.balance.toLocaleString(locale)
    const q = head.questions != null ? head.questions.toLocaleString(locale) : null
    const text = g.headBalance(n, q)
    const at = text.indexOf(n)
    // The number keeps its e2e id (tokens-balance-display) and its own styling inside the sentence.
    return (
      <>
        {text.slice(0, at)}
        <span className="af-tkg-num af-num" data-testid="tokens-balance-display">
          {n}
        </span>
        {text.slice(at + n.length)}
      </>
    )
  }

  return (
    <div className="af-core af-tk" data-guide="tokens">
      {/*
        ⚠ THIS PAGE HAD NO NAVIGATION AT ALL — no header and not one link. /tokens is behind sign-in
        (app/tokens/layout.tsx), so the way out is always the app.
      */}
      <nav className="af-tkg-nav" aria-label="Main">
        <Link href="/core" className="af-tkg-brand">
          <Shield />
          <span>{g.eyebrow}</span>
        </Link>
        <span className="af-tkg-nav-right">
          <Link href="/pricing" className="af-tkg-nav-link">
            {g.seePlans}
          </Link>
          <Link href="/core" className="af-tkg-nav-cta" data-testid="tokens-back-to-app">
            {g.backToApp}
          </Link>
        </span>
      </nav>

      <div className="af-tk-alerts">
        <CheckoutOutcomePanel phase={postPurchase.state.phase} onRetry={postPurchase.retrySync} />
      </div>

      {/* ── The answer: your balance, in Chimmy questions ────────────────────────── */}
      <header className="af-tk-head af-tkg-head">
        <h1 className="af-tk-title af-tkg-title" data-testid="tokens-headline">
          {headlineContent()}
        </h1>
        {head.kind === 'unavailable' ? <p className="af-tk-sub">{g.unavailableHint}</p> : null}
        <p className="af-tk-sub" data-testid="tokens-intro">
          {g.intro}
        </p>
        <p className="af-tk-sub af-tkg-rule">{g.topUpRule(FREE_CHIMMY_QUESTIONS_PER_DAY)}</p>
      </header>

      {(error || playError) ? <p className="af-tk-error">{error || playError}</p> : null}

      {/* ── Packs: the one thing to do here ──────────────────────────────────────── */}
      <section className="af-tk-packs-wrap" aria-labelledby="af-tkg-packs-h">
        <h2 className="af-tk-h2" id="af-tkg-packs-h">
          {g.packsTitle}
        </h2>
        <div className="af-tk-packs">
          {packs.map((p) => (
            <div key={p.sku} className="af-tk-pack">
              <span className="af-tk-pack-num af-num">{p.tokenAmount != null ? p.tokenAmount.toLocaleString(locale) : '—'}</span>
              <span className="af-tk-pack-label">{t('tokens.v4.packTokens')}</span>
              <span className="af-tk-pack-price af-num">{nativeApp ? (nativePrices[p.sku] ?? 'Loading store price…') : `$${p.amountUsd.toFixed(2)}`}</span>
              {p.tokenAmount != null && chimmyCost ? (
                <span className="af-tk-pack-about" data-testid={`tokens-pack-about-${p.sku}`}>
                  {t('tokens.v4.packAbout').replace('{{n}}', Math.floor(p.tokenAmount / chimmyCost).toLocaleString(locale))}
                </span>
              ) : null}
              {/*
                The token suite drives every purchase through `tokens-buy-cta-{sku}` and reads the
                balance from `tokens-balance-display` — keep both ids.
              */}
              <button
                type="button"
                className="af-tk-btn"
                data-testid={`tokens-buy-cta-${p.sku}`}
                disabled={pendingSku === p.sku || (nativeApp && !nativePrices[p.sku])}
                onClick={() => buy(p.sku)}
              >
                {pendingSku === p.sku ? `${t('tokens.v4.loading')}…` : t('tokens.v4.packBuy')}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── What tokens buy ──────────────────────────────────────────────────────── */}
      <section className="af-tk-costs">
        <div className="af-tk-costs-head">
          <h2 className="af-tk-h2">{t('tokens.v4.costsTitle')}</h2>
          <p className="af-tk-sub af-tk-sub--tight">{t('tokens.v4.costsSubtitle')}</p>
        </div>

        {rules.length === 0 ? (
          <p className="af-tk-empty">{t('tokens.v4.loading')}…</p>
        ) : (
          <ul className="af-tk-rules" data-testid="tokens-buyable-list">
            {rules.map((r) => (
              <li key={r.code} className="af-tk-rule" data-testid={`tokens-rule-${r.code}`}>
                <span className="af-tk-rule-name">
                  {r.label}
                  {WHO_KEY[r.who] ? <span className="af-tk-rule-who"> · {t(WHO_KEY[r.who]!)}</span> : null}
                </span>
                <span className="af-tk-rule-cost af-num">{r.tokenCost}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── What tokens don't cover — one fold where there were two sections ─────── */}
      <details className="af-tkg-fold" data-testid="tokens-not-included">
        <summary>{g.dontCoverTitle}</summary>
        <ul className="af-tk-not">
          <li>{t('tokens.v4.notPlan')}</li>
          <li>{t('tokens.v4.notUnlisted')}</li>
          <li>{g.neverCosts}</li>
        </ul>
      </details>

      {/* ── Recent activity ──────────────────────────────────────────────────────── */}
      <section className="af-tk-recent">
        <h2 className="af-tk-h2">{g.activityTitle}</h2>
        {history.length === 0 ? (
          <p className="af-tk-empty">{g.activityEmpty}</p>
        ) : (
          <ul className="af-tk-history" data-testid="tokens-activity">
            {history.map((h) => (
              <li key={h.id}>
                <span className="af-tk-hist-label">
                  {activityText(h)}
                  {day(h.createdAt) ? <span className="af-tkg-date"> · {day(h.createdAt)}</span> : null}
                </span>
                <span className="af-tk-hist-delta af-num" data-up={h.delta > 0}>
                  {h.delta > 0 ? '+' : ''}
                  {h.delta.toLocaleString(locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
