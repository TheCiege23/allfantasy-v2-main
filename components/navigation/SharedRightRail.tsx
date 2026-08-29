'use client'

import Link from 'next/link'
import { useRightRailData } from '@/hooks/useRightRailData'
import { useAIAccessStatus } from '@/hooks/useAIAccessStatus'
import { getPrimaryChimmyEntry, getChimmyChatHrefWithPrompt, AI_HUB_HREF } from '@/lib/ai-product-layer'

export default function SharedRightRail() {
  const { data, loading, error } = useRightRailData()
  const aiAccess = useAIAccessStatus()
  const chimmyEntry = getPrimaryChimmyEntry({ source: 'right_rail' })

  return (
    <aside className="space-y-4">
      <section className="mode-panel rounded-2xl p-4">
        <h3 className="text-sm font-semibold mode-text">Notifications</h3>
        {loading ? (
          <p className="mt-2 text-xs mode-muted">Loading...</p>
        ) : data.notifications.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {data.notifications.slice(0, 3).map((n) => (
              <li key={n.id} className="text-xs mode-muted">{n.title}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs mode-muted">No new notifications.</p>
        )}
        <Link
          href="/messages"
          className="mt-3 inline-flex rounded-lg border px-3 py-1.5 text-xs transition"
          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
        >
          Open Message Center
        </Link>
      </section>

      <section className="mode-panel-soft rounded-2xl p-4" style={{ borderColor: 'color-mix(in srgb, var(--accent-cyan) 40%, var(--border))' }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--accent-cyan-strong)' }}>AI Quick Ask</h3>
        {data.aiQuickActions.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {data.aiQuickActions.slice(0, 3).map((q) => (
              <li key={q}>
                <Link
                  href={getChimmyChatHrefWithPrompt(q, { source: 'right_rail' })}
                  className="text-xs mode-muted transition hover:text-white"
                >
                  {q}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs mode-muted">Ask Chimmy from any product context.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={chimmyEntry.href}
            className="inline-flex rounded-lg border px-3 py-1.5 text-xs transition"
            style={{ borderColor: 'color-mix(in srgb, var(--accent-cyan) 45%, var(--border))', color: 'var(--accent-cyan-strong)' }}
          >
            {chimmyEntry.label}
          </Link>
          <Link
            href={AI_HUB_HREF}
            className="inline-flex rounded-lg border px-3 py-1.5 text-xs transition"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            AI Hub
          </Link>
        </div>
      </section>

      <section className="mode-panel-soft rounded-2xl p-4" style={{ borderColor: 'color-mix(in srgb, var(--accent-emerald) 40%, var(--border))' }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--accent-emerald-strong)' }}>Wallet Summary</h3>
        <div className="mt-2 space-y-1 text-xs mode-muted">
          <div>Balance: ${data.wallet.balance.toFixed(2)}</div>
          <div>Pending: ${data.wallet.pendingBalance.toFixed(2)}</div>
        </div>
        <Link
          href="/wallet"
          className="mt-3 inline-flex rounded-lg border px-3 py-1.5 text-xs transition"
          style={{ borderColor: 'color-mix(in srgb, var(--accent-emerald) 45%, var(--border))', color: 'var(--accent-emerald-strong)' }}
        >
          Open Wallet
        </Link>
      </section>

      <section
        className="mode-panel-soft rounded-2xl p-4"
        style={{ borderColor: 'color-mix(in srgb, var(--accent-cyan) 40%, var(--border))' }}
      >
        <h3 className="text-sm font-semibold" style={{ color: 'var(--accent-cyan-strong)' }}>AI Status</h3>
        {aiAccess.loading ? (
          <p className="mt-2 text-xs mode-muted">Checking AI access…</p>
        ) : aiAccess.data ? (
          <div className="mt-2 space-y-1 text-xs mode-muted">
            <div>
              Tokens: <span className="mode-text">🪙 {aiAccess.data.tokenBalance}</span>
            </div>
            {/*
              * The "Trial: Nd left" row is removed, not hidden behind a flag: the trial
              * grants nothing. Its token floor was deleted from lib/tokens/dailyFreeTokens.ts
              * on 2026-08-28 and the Chimmy route never consulted AIAccessResolver, so a
              * trialling account has the same two free questions as a free one. Counting
              * down days against an allowance that does not exist is the bug 129441a13
              * fixed once already. Restore this only after the trial floor is back.
              */}
            {aiAccess.data.hasSubscription && (
              <div>
                Plan: <span className="mode-text">Premium</span>
              </div>
            )}
            <div>{aiAccess.data.message}</div>
          </div>
        ) : (
          <p className="mt-2 text-xs mode-muted">Sign in to see your AI access.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/ai-chat"
            className="inline-flex rounded-lg border px-3 py-1.5 text-xs transition"
            style={{ borderColor: 'color-mix(in srgb, var(--accent-cyan) 45%, var(--border))', color: 'var(--accent-cyan-strong)' }}
          >
            Open Chimmy
          </Link>
          {aiAccess.data && !aiAccess.data.hasSubscription && (
            <Link
              href="/pricing"
              className="inline-flex rounded-lg border px-3 py-1.5 text-xs transition"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              Upgrade
            </Link>
          )}
        </div>
      </section>

      {error && (
        <section className="rounded-2xl border p-3 text-xs" style={{ borderColor: 'color-mix(in srgb, var(--accent-red) 45%, var(--border))', background: 'color-mix(in srgb, var(--accent-red) 12%, transparent)', color: 'var(--accent-red-strong)' }}>
          {error}
        </section>
      )}
    </aside>
  )
}
