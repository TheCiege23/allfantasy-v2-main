'use client'

import { useState } from 'react'
import { Settings as SettingsIcon, Lock } from 'lucide-react'
import { InfoCard } from '@/components/commissioner-os/cards'
import { PreviewDataBanner } from '@/components/commissioner-os/PreviewDataBanner'
import { ErrorState } from '@/components/commissioner-os/states'
import type { CommissionerDataMode } from '@/lib/commissioner-ui/demo-mode/constants'
import type { LeagueSettingsSnapshot } from '@/lib/commissioner-ui/settings/decision-os-client'

export interface LeagueSettingsViewProps {
  snapshot: LeagueSettingsSnapshot | null
  dataMode: CommissionerDataMode
  errorMessage?: string | null
}

/** How many scoring rules are visible before the reader asks for the rest. */
const SCORING_PREVIEW_COUNT = 12

/**
 * What "we did not capture this" looks like.
 *
 * ⚠ AN EM DASH AND A LABEL, NEVER A BLANK CELL AND NEVER A ZERO. A blank reads as a rendering bug and
 * a zero reads as a rule ("this league has no FAAB budget"), and both are claims this page has no
 * basis for. The contract carries `value: string | null` the whole way here precisely so this
 * component is the only place that decides how absence looks.
 */
function SettingValue({ value, note }: { value: string | null; note?: string }) {
  if (value === null) {
    return (
      <span className="text-xs" style={{ color: 'var(--muted2, var(--muted))' }} title="Not captured from this league's platform">
        — not captured
      </span>
    )
  }
  return (
    <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
      {note ? `${note} ${value}` : value}
    </span>
  )
}

export function LeagueSettingsView({ snapshot, dataMode, errorMessage }: LeagueSettingsViewProps) {
  const [showAllRules, setShowAllRules] = useState(false)

  if (!snapshot) {
    return (
      <div>
        <PreviewDataBanner mode={dataMode} />
        <ErrorState message={errorMessage ?? "Couldn't load this league's settings right now."} />
      </div>
    )
  }

  const { scoring, provenance } = snapshot
  const visibleRules = showAllRules ? scoring.rules : scoring.rules.slice(0, SCORING_PREVIEW_COUNT)
  const hiddenCount = scoring.rules.length - visibleRules.length

  return (
    <div>
      <PreviewDataBanner mode={dataMode} />

      {/* Header: what this page is looking at, and where the values came from. */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
            {snapshot.leagueName ?? 'This league'}
          </h1>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {provenance.source
              ? `Rules as imported from ${provenance.source}${provenance.externalLeagueId ? ` · ${provenance.externalLeagueId}` : ''}`
              : 'Rules as stored for this league'}
            {snapshot.seasonLabel ? ` · ${snapshot.seasonLabel} season` : ''}
          </p>
        </div>

        {/*
          * Says where to change things instead of offering a control that cannot work. An imported
          * league's rules live on the platform of origin — Sleeper has no write API at all — so a
          * save button here would be a button that lies.
          */}
        {!provenance.editableHere ? (
          <div
            className="flex items-center gap-2 rounded-[var(--radius-standard)] border px-3 py-1.5 text-xs"
            style={{ borderColor: 'var(--border)', background: 'var(--panel2)', color: 'var(--muted)' }}
          >
            <Lock size={13} aria-hidden />
            <span>
              Read-only here{provenance.source ? ` — change these on ${provenance.source}` : ''}
            </span>
          </div>
        ) : null}
      </div>

      {/* The five settings groups. */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {snapshot.groups.map((group) => (
          <InfoCard key={group.id} title={group.label}>
            <p className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>
              {group.description}
            </p>
            <dl className="space-y-2">
              {group.entries.map((entry) => (
                <div key={entry.label} className="flex flex-col gap-0.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-xs">{entry.label}</dt>
                    <dd className="text-right">
                      <SettingValue value={entry.value} note={entry.label === 'Playoffs start' || entry.label === 'Trade deadline' ? entry.note : undefined} />
                    </dd>
                  </div>
                  {/*
                    * The roster note is the position list, which is long and worth reading on its own
                    * line rather than crushed against the count. The week notes above are two
                    * characters and belong inline, which is why the note is rendered in one of two
                    * places rather than always the same one.
                    */}
                  {entry.note && entry.label !== 'Playoffs start' && entry.label !== 'Trade deadline' ? (
                    <span className="text-[11px] leading-snug" style={{ color: 'var(--muted)' }}>
                      {entry.note}
                    </span>
                  ) : null}
                </div>
              ))}
            </dl>
          </InfoCard>
        ))}
      </div>

      {/* Scoring, which is the one group too large for a definition list. */}
      <InfoCard title="Scoring">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Format <span style={{ color: 'var(--text)' }}>{scoring.format ?? '— not captured'}</span>
          </span>
          {scoring.templateId ? (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              Template <span className="font-mono" style={{ color: 'var(--text)' }}>{scoring.templateId}</span>
            </span>
          ) : null}
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            <span style={{ color: 'var(--text)' }}>{scoring.ruleCount}</span> rule
            {scoring.ruleCount === 1 ? '' : 's'} captured
          </span>
        </div>

        {scoring.rules.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            No scoring rules were captured for this league, so every projection and score on other
            pages is using league-default scoring rather than yours.
          </p>
        ) : (
          <>
            {/*
              * Ordered by absolute impact, so a 6-point touchdown sits above a 0.04 passing yard.
              * A commissioner opening this is usually checking one specific rule imported correctly,
              * and the ones that move a score are the ones worth seeing first.
              */}
            <div
              className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3"
              style={{ maxHeight: showAllRules ? undefined : '20rem', overflowY: showAllRules ? undefined : 'auto' }}
            >
              {visibleRules.map((rule) => (
                <div key={rule.stat} className="flex items-baseline justify-between gap-3 border-b py-1" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-xs" title={rule.stat}>
                    {rule.label}
                  </span>
                  <span
                    className="text-metric text-xs font-semibold"
                    style={{ color: rule.points < 0 ? 'var(--severity-elevated-text, var(--text))' : 'var(--text)' }}
                  >
                    {rule.points > 0 ? '+' : ''}
                    {rule.points}
                  </span>
                </div>
              ))}
            </div>

            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAllRules(true)}
                className="focus-ring mt-3 rounded-[var(--radius-standard)] px-2 py-1 text-xs font-semibold"
                style={{ color: 'var(--accent-cyan-strong, var(--text))' }}
              >
                Show all {scoring.ruleCount} rules
              </button>
            ) : null}
          </>
        )}
      </InfoCard>

      <p className="mt-4 flex items-start gap-2 text-xs" style={{ color: 'var(--muted)' }}>
        <SettingsIcon size={13} aria-hidden className="mt-0.5 shrink-0" />
        <span>
          Every value here was captured from this league rather than assumed. Anything marked “not
          captured” was absent from what the import returned — it is not a default, and no page in
          Commissioner OS is treating it as one.
        </span>
      </p>
    </div>
  )
}
