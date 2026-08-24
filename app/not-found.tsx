import Link from 'next/link'

/**
 * Branded 404. Without this file Next served its unbranded default — no logo,
 * no nav, no way home — which is what paid-social traffic hit on any bad link.
 * Token-authored (var(--…)) so it renders correctly in every mode.
 */
export default function NotFound() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
      style={{ background: 'var(--bg, #0b0e14)', color: 'var(--text, #eef0fa)' }}
    >
      <p
        className="text-xs font-bold uppercase tracking-[0.3em]"
        style={{ color: 'var(--muted, #93a2b2)' }}
      >
        AllFantasy
      </p>
      <h1 className="mt-4 text-6xl font-extrabold tabular-nums">404</h1>
      <p className="mt-3 max-w-md text-sm" style={{ color: 'var(--muted, #93a2b2)' }}>
        That page doesn&apos;t exist — or it hasn&apos;t launched yet. Your leagues are still where
        you left them.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-xl px-5 py-3 text-sm font-semibold"
          style={{ background: 'var(--accent-cyan, #06b6d4)', color: '#04121a' }}
        >
          Back to home
        </Link>
        <Link
          href="/dashboard"
          className="rounded-xl border px-5 py-3 text-sm font-semibold"
          style={{ borderColor: 'var(--border, #2a3441)', color: 'var(--text, #eef0fa)' }}
        >
          Open my leagues
        </Link>
      </div>
    </div>
  )
}
