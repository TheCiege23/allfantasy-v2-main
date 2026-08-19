'use client'

import { trackLandingCtaClick } from '@/lib/landing-analytics'

const DEMO_MAILTO = 'mailto:enterprise@allfantasy.ai?subject=Schedule%20a%20demo&body=Tell%20us%20about%20your%20platform%2C%20league%20site%2C%20or%20media%20brand%3A'

/**
 * B2B band from the landing mock. No booking backend exists yet, so
 * "Schedule a demo" opens a real mailto: to the enterprise inbox rather
 * than linking to a page that doesn't do anything — an honest action,
 * not a dead click.
 */
export function B2BDemoBand() {
  return (
    <div
      className="relative z-10 mt-6 flex w-full max-w-2xl flex-col items-center gap-3 rounded-2xl border p-5 text-center sm:flex-row sm:text-left"
      style={{
        borderColor: 'color-mix(in srgb, var(--border) 100%, transparent)',
        background: 'color-mix(in srgb, var(--panel2) 45%, transparent)',
      }}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg"
        style={{ background: 'color-mix(in srgb, var(--accent-purple) 16%, transparent)' }}
        aria-hidden
      >
        🏢
      </div>
      <div className="flex-1">
        <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          Run a fantasy platform, league site, or media brand?
        </div>
        <div className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
          AllFantasy is the intelligence layer that lifts retention, engagement, and league health — without building it yourself.
        </div>
      </div>
      <a
        href={DEMO_MAILTO}
        className="inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition hover:opacity-90"
        style={{
          backgroundImage: 'linear-gradient(90deg, var(--accent-purple), var(--accent-cyan))',
          color: 'var(--on-accent-bg)',
        }}
        data-testid="landing-b2b-demo-cta"
        onClick={() => trackLandingCtaClick({ cta_label: 'Schedule a demo', cta_destination: DEMO_MAILTO, cta_type: 'secondary', source: 'b2b-band' })}
      >
        Schedule a demo →
      </a>
    </div>
  )
}
