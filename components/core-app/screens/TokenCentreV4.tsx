'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useTokenBalance } from '@/hooks/useTokenBalance'
import { usePostPurchaseSync } from '@/hooks/usePostPurchaseSync'
import { resolveCheckoutUrl } from '@/lib/monetization/checkout-client'
import { CheckoutOutcomePanel } from '@/components/monetization/CheckoutOutcomePanel'
import { getTokenPurchasableRule, type TokenBuyer } from '@/lib/tokens/tokenPurchasable'
import '@/components/core-app/af-tokens.css'

/**
 * Screen 20a — the token centre.
 *
 * ⚠ THE DESIGN'S CENTRAL TABLE FEATURE NO LONGER APPLIES, AND RENDERING IT ANYWAY
 * WOULD BE THEATRE. The handoff specifies five columns including "list price
 * struck through" beside "your price in --accent" — a subscriber discount made
 * visible. That discount was dropped this morning along with the token grants:
 * subscribers get features unlocked outright, so a discount on token spend served
 * nobody. `discountedTokenSpendPct` is now 0 for every plan, so those two columns
 * would show the same number twice, one of them crossed out. There is one price
 * and everybody pays it.
 *
 * ⚠ COPY GOES THROUGH t(). The existing page is translated and a reskin that
 * hardcodes English silently un-translates it — easy to do, hard to notice, and
 * invisible to anyone testing in English. New keys are added to `en` only; the
 * provider falls back `dict[key] ?? en[key] ?? key`, so other locales render
 * English until translated rather than showing a raw key.
 */

type SpendRule = {
  code: string
  label: string
  who: TokenBuyer
  tokenCost: number
}

type SpendEntry = {
  id: string
  label: string
  delta: number
  createdAt: string | null
}

export type TokenCentreV4Props = {
  packs: Array<{ sku: string; amountUsd: number; tokenAmount: number | null }>
}

/** Who can buy it, when that is narrower than "any member". */
const WHO_KEY: Partial<Record<TokenBuyer, string>> = {
  commissioner: 'tokens.v4.whoCommissioner',
  pool_manager: 'tokens.v4.whoPoolManager',
}

const CHIMMY_RULE = 'ai_chimmy_chat_message'

export function TokenCentreV4({ packs }: TokenCentreV4Props) {
  const { t } = useLanguage()
  const { balance, loading: balanceLoading } = useTokenBalance()
  const postPurchase = usePostPurchaseSync({})

  const [rules, setRules] = useState<SpendRule[]>([])
  const [history, setHistory] = useState<SpendEntry[]>([])
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
       * and this page used to list them all under "What things cost", so it advertised 51
       * actions no screen could buy (lib/tokens/tokenPurchasable.ts). The cost still comes from
       * the live rule; the list and the plain-words label come from the allowlist.
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
      const entries = (histRes?.entries ?? histRes?.data ?? []) as Array<Record<string, unknown>>
      /*
       * ⚠ THE HISTORY API'S FIELDS ARE `spendFeatureLabel`, `description` AND `tokenDelta`
       * (TokenSpendService `toLedgerView`). This read `label` / `reason` / `delta`, which it
       * never sends, so every row rendered a blank name and "0".
       */
      setHistory(
        entries.map((e, i) => ({
          id: String(e.id ?? i),
          label: String(
            e.spendFeatureLabel ?? e.description ?? e.tokenPackageSku ?? e.entryType ?? e.label ?? '',
          ),
          delta: Number(e.tokenDelta ?? e.delta ?? 0),
          createdAt: e.createdAt ? String(e.createdAt) : null,
        }))
      )
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** What one Chimmy question costs, so a pack can say what it buys in plain terms. */
  const chimmyCost = useMemo(() => rules.find((r) => r.code === CHIMMY_RULE)?.tokenCost ?? null, [rules])

  async function buy(sku: string) {
    setError(null)
    setPendingSku(sku)
    const res = await resolveCheckoutUrl({ sku, productType: 'token_pack', returnPath: '/tokens' })
    if (!res.ok) {
      setError(res.error)
      setPendingSku(null)
      return
    }
    window.location.assign(res.url)
  }

  return (
    <div className="af-tk">
      <div className="af-tk-alerts">
        <CheckoutOutcomePanel phase={postPurchase.state.phase} onRetry={postPurchase.retrySync} />
      </div>

      <header className="af-tk-head">
        <h1 className="af-tk-title">{t('tokens.v4.title')}</h1>
        <p className="af-tk-sub">{t('tokens.v4.subtitle')}</p>
      </header>

      {/* ── Balance ──────────────────────────────────────────── */}
      <section className="af-tk-balance">
        <span className="af-tk-label">{t('tokens.v4.balanceLabel')}</span>
        {balanceLoading ? (
          <span className="af-tk-balance-num af-tk-balance-num--muted">{t('tokens.v4.loading')}…</span>
        ) : balance == null ? (
          /*
            ⚠ NO NUMBER WHEN WE DO NOT HAVE ONE. A signed-out visitor gets a
            sentence, never a zero — "0 tokens" reads as an empty wallet rather
            than as not being signed in, and those prompt different actions.
          */
          <span className="af-tk-balance-none">{t('tokens.v4.balanceUnavailable')}</span>
        ) : (
          <span className="af-tk-balance-num" data-testid="tokens-balance-display">
            {balance.toLocaleString()}
          </span>
        )}
      </section>

      {error ? <p className="af-tk-error">{error}</p> : null}

      {/* ── Costs ────────────────────────────────────────────── */}
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
                {/*
                  One price column, not two. There is no subscriber discount
                  any more, so a struck-through "list price" beside an
                  identical "your price" would be invented drama.
                */}
                <span className="af-tk-rule-cost af-num">{r.tokenCost}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── What tokens don't buy ────────────────────────────── */}
      <section className="af-tk-free" data-testid="tokens-not-included">
        <h2 className="af-tk-h2">{t('tokens.v4.notTitle')}</h2>
        <ul className="af-tk-not">
          <li>{t('tokens.v4.notPlan')}</li>
          <li>{t('tokens.v4.notUnlisted')}</li>
        </ul>
      </section>

      {/* ── What's free ──────────────────────────────────────── */}
      <section className="af-tk-free">
        <h2 className="af-tk-h2">{t('tokens.v4.freeTitle')}</h2>
        <p className="af-tk-sub af-tk-sub--tight">{t('tokens.v4.freeBody')}</p>
      </section>

      {/* ── Packs ────────────────────────────────────────────── */}
      <section className="af-tk-packs-wrap">
        <h2 className="af-tk-h2">{t('tokens.v4.packsTitle')}</h2>
        <div className="af-tk-packs">
          {packs.map((p) => (
            <div key={p.sku} className="af-tk-pack">
              <span className="af-tk-pack-num af-num">
                {p.tokenAmount != null ? p.tokenAmount.toLocaleString() : '—'}
              </span>
              <span className="af-tk-pack-label">{t('tokens.v4.packTokens')}</span>
              <span className="af-tk-pack-price af-num">${p.amountUsd.toFixed(2)}</span>
              {p.tokenAmount != null && chimmyCost ? (
                <span className="af-tk-pack-about" data-testid={`tokens-pack-about-${p.sku}`}>
                  {t('tokens.v4.packAbout').replace('{{n}}', Math.floor(p.tokenAmount / chimmyCost).toLocaleString())}
                </span>
              ) : null}
              {/*
                The token suite drives every purchase through
                `tokens-buy-cta-{sku}` and reads the balance from
                `tokens-balance-display` — the ids the previous /tokens surface
                emitted. This screen replaced it and kept both behaviours but
                neither id, so the buy path lost its e2e hook. Restored here; the
                rest of that suite needs UI this screen does not have, which the
                spec now says out loud rather than failing on.
              */}
              <button
                type="button"
                className="af-tk-btn"
                data-testid={`tokens-buy-cta-${p.sku}`}
                disabled={pendingSku === p.sku}
                onClick={() => buy(p.sku)}
              >
                {pendingSku === p.sku ? `${t('tokens.v4.loading')}…` : t('tokens.v4.packBuy')}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Recent ───────────────────────────────────────────── */}
      <section className="af-tk-recent">
        <h2 className="af-tk-h2">{t('tokens.v4.recentTitle')}</h2>
        {history.length === 0 ? (
          <p className="af-tk-empty">{t('tokens.v4.recentEmpty')}</p>
        ) : (
          <ul className="af-tk-history">
            {history.map((h) => (
              <li key={h.id}>
                <span className="af-tk-hist-label">{h.label}</span>
                <span className="af-tk-hist-delta af-num" data-up={h.delta > 0}>
                  {h.delta > 0 ? '+' : ''}
                  {h.delta}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default TokenCentreV4
