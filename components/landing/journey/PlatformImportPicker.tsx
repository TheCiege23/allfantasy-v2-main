'use client'

import { useState } from 'react'
import { GuestLegacyImportForm } from './GuestLegacyImportForm'
import { trackLandingCtaClick } from '@/lib/landing-analytics'

type PlatformId = 'sleeper' | 'espn' | 'yahoo' | 'mfl' | 'fantrax' | 'underdog' | 'tycoon'

type PlatformStep = { title: string; detail?: string }

type PlatformDef = {
  id: PlatformId
  label: string
  icon: string
  badge: string
  steps: PlatformStep[]
}

const PLATFORMS: PlatformDef[] = [
  { id: 'sleeper', label: 'Sleeper', icon: '🌙', badge: 'Public · no login', steps: [] },
  {
    id: 'espn',
    label: 'ESPN',
    icon: '🔴',
    badge: 'League ID + access',
    steps: [
      { title: 'Paste your ESPN League ID', detail: "It's in your league URL: fantasy.espn.com/…/league?leagueId=XXXXXXX" },
      { title: 'Private league? Connect ESPN', detail: 'Public leagues skip this — private leagues sign in with ESPN.' },
      { title: 'Import your teams & history', detail: 'We pull rosters, records, standings, and past seasons.' },
    ],
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    icon: '🟣',
    badge: 'Secure OAuth',
    steps: [
      { title: 'Connect your Yahoo account', detail: 'One-tap secure sign-in — we never see your password.' },
      { title: 'Choose the league to import', detail: "We'll list every league on your Yahoo account." },
      { title: 'Import your teams & history' },
    ],
  },
  {
    id: 'mfl',
    label: 'MFL',
    icon: '🏆',
    badge: 'League ID + API key',
    steps: [
      { title: 'Enter your MFL League ID + year' },
      { title: 'Paste your MFL API key', detail: 'Find it in MFL under Setup → API. Needed for private leagues.' },
      { title: 'Import your franchise & history' },
    ],
  },
  {
    id: 'fantrax',
    label: 'Fantrax',
    icon: '📊',
    badge: 'CSV export',
    steps: [
      { title: 'Export your league from Fantrax', detail: 'Standings / Rosters → "Download / Export to CSV".' },
      { title: 'Upload the exported file(s)' },
      { title: 'We parse & build your profile' },
    ],
  },
  {
    id: 'underdog',
    label: 'Underdog',
    icon: '🐶',
    badge: 'Connect or link',
    steps: [
      { title: 'Connect your Underdog account', detail: 'Or paste a Best Ball draft share link.' },
      { title: 'Select the drafts to import' },
      { title: 'Import your entries & results' },
    ],
  },
  {
    id: 'tycoon',
    label: 'League Tycoon',
    icon: '🎩',
    badge: 'Link or account',
    steps: [
      { title: 'Paste your League Tycoon league link or ID' },
      { title: 'Connect your account for full history', detail: 'Optional — lets us pull prior seasons and standings.' },
      { title: 'Import your league & history' },
    ],
  },
]

/**
 * The 7-platform picker from the landing mock. Only Sleeper imports for real
 * today (GuestLegacyImportForm, wired end-to-end to the guest-import API and
 * /dashboard/universal). The other 6 show the real step-by-step flow as
 * honest UX preview — Phase 4 wires the actual imports — but never route to
 * a login wall or silently no-op; clicking their CTA surfaces an inline
 * "coming soon, try Sleeper today" message so nothing is a dead click.
 */
export function PlatformImportPicker() {
  const [selected, setSelected] = useState<PlatformId>('sleeper')
  const [comingSoonNotice, setComingSoonNotice] = useState<PlatformId | null>(null)
  const active = PLATFORMS.find((p) => p.id === selected) ?? PLATFORMS[0]

  return (
    <div
      className="relative z-10 w-full max-w-lg rounded-2xl border p-4 sm:p-5"
      style={{
        borderColor: 'color-mix(in srgb, var(--border) 100%, transparent)',
        background: 'color-mix(in srgb, var(--panel) 55%, transparent)',
      }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-center gap-1.5" role="tablist" aria-label="Choose a fantasy platform to import from">
        {PLATFORMS.map((p) => {
          const isOn = p.id === selected
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={isOn}
              onClick={() => {
                setSelected(p.id)
                setComingSoonNotice(null)
                trackLandingCtaClick({ cta_label: `Platform: ${p.label}`, cta_destination: '#importer', cta_type: 'secondary', source: 'hero-platform-picker' })
              }}
              className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition"
              style={{
                borderColor: isOn ? 'var(--accent-cyan)' : 'color-mix(in srgb, var(--border) 100%, transparent)',
                background: isOn ? 'color-mix(in srgb, var(--accent-cyan) 16%, transparent)' : 'transparent',
                color: isOn ? 'var(--accent-cyan-strong)' : 'var(--muted)',
              }}
              data-testid={`platform-picker-${p.id}`}
            >
              <span aria-hidden>{p.icon}</span>
              {p.label}
            </button>
          )
        })}
      </div>

      {active.id === 'sleeper' ? (
        <GuestLegacyImportForm />
      ) : (
        <div className="flex flex-col items-center gap-3 text-left">
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              Import from {active.label}
            </span>
            <span
              className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ borderColor: 'color-mix(in srgb, var(--accent-amber) 40%, transparent)', color: 'var(--accent-amber-strong)' }}
            >
              {active.badge}
            </span>
          </div>
          <ol className="flex w-full flex-col gap-2.5">
            {active.steps.map((step, i) => (
              <li key={step.title} className="flex gap-2.5 text-xs">
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ background: 'color-mix(in srgb, var(--panel2) 80%, transparent)', color: 'var(--muted)' }}
                >
                  {i + 1}
                </span>
                <span>
                  <span style={{ color: 'var(--text)' }}>{step.title}</span>
                  {step.detail ? <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>{step.detail}</span> : null}
                </span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => setComingSoonNotice(active.id)}
            className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition hover:opacity-90"
            style={{
              backgroundImage: 'linear-gradient(90deg, var(--accent-cyan), color-mix(in srgb, var(--accent-cyan-strong) 72%, #3b82f6))',
              color: 'var(--on-accent-bg)',
            }}
            data-testid={`platform-picker-${active.id}-cta`}
          >
            Import & continue →
          </button>
          {comingSoonNotice === active.id && (
            <p className="text-[11px]" style={{ color: 'var(--accent-amber-strong)' }} role="status">
              Real {active.label} import is launching soon. Sleeper import works free today — try it above.
            </p>
          )}
          <p className="text-[11px]" style={{ color: 'var(--muted2)' }}>
            🔒 We only read your league data. Nothing is saved until you create a free account.
          </p>
        </div>
      )}

      <p className="mt-4 text-center text-[11px]" style={{ color: 'var(--muted2)' }}>
        Works with <b style={{ color: 'var(--muted)' }}>Sleeper · ESPN · Yahoo · MFL · Fantrax · Underdog · League Tycoon</b>
      </p>
    </div>
  )
}
