'use client'

/**
 * [NEW] Ceremony Center: nomination, veto draw, veto ceremony, replacement, eviction, host recap. PROMPT 4.
 */

import { useState } from 'react'
import type { BigBrotherSummary } from './types'

interface BigBrotherCeremonyCenterProps {
  leagueId: string
  summary: BigBrotherSummary
}

const CEREMONY_TABS = ['Nomination', 'Veto Draw', 'Veto Ceremony', 'Replacement', 'Eviction'] as const

function PersonPill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'hoh' | 'danger' | 'safe' | 'veto' }) {
  const toneClass =
    tone === 'hoh'
      ? 'border-[var(--line2)] bg-[var(--warn-soft)] text-[var(--warn)]'
      : tone === 'danger'
        ? 'border-[var(--bad)] bg-[var(--bad-soft)] text-[var(--bad)]'
        : tone === 'safe'
          ? 'border-[var(--good)] bg-[var(--good-soft)] text-[var(--good)]'
          : tone === 'veto'
            ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]'
            : 'border-[var(--line)] bg-white/[0.06] text-[var(--text)]'

  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${toneClass}`}>{label}</span>
}

export function BigBrotherCeremonyCenter({ leagueId, summary }: BigBrotherCeremonyCenterProps) {
  const [tab, setTab] = useState<(typeof CEREMONY_TABS)[number]>('Nomination')
  const names = summary.rosterDisplayNames ?? {}
  const cycle = summary.cycle

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {CEREMONY_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-sm ${tab === t ? 'bg-[var(--warn-soft)] text-[var(--warn)]' : 'bg-[var(--chip)] text-[var(--text2)] hover:bg-[var(--chip)]'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--line)] bg-white/[0.03] p-4">
        {tab === 'Nomination' && (
          <>
            <h3 className="text-sm font-medium text-[var(--text)]">Nomination Ceremony</h3>
            {cycle?.hohRosterId ? (
              <div className="mt-2">
                <PersonPill
                  tone="hoh"
                  label={`HOH: ${names[cycle.hohRosterId] ?? cycle.hohRosterId}`}
                />
              </div>
            ) : null}
            {cycle?.nominee1RosterId && cycle?.nominee2RosterId ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm text-[var(--text2)]">HOH nominations for the block:</p>
                <div className="flex flex-wrap gap-2">
                  <PersonPill tone="danger" label={names[cycle.nominee1RosterId] ?? cycle.nominee1RosterId} />
                  <PersonPill tone="danger" label={names[cycle.nominee2RosterId] ?? cycle.nominee2RosterId} />
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-[var(--muted)]">Nominations not yet set for this week.</p>
            )}
          </>
        )}
        {tab === 'Veto Draw' && (
          <>
            <h3 className="text-sm font-medium text-[var(--text)]">Veto Players</h3>
            {cycle?.vetoParticipantRosterIds?.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {cycle.vetoParticipantRosterIds.map((id) => (
                  <PersonPill key={id} tone="veto" label={names[id] ?? id} />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-[var(--muted)]">Veto draw not yet run.</p>
            )}
          </>
        )}
        {tab === 'Veto Ceremony' && (
          <>
            <h3 className="text-sm font-medium text-[var(--text)]">Veto Result</h3>
            {cycle?.vetoWinnerRosterId ? (
              <div className="mt-2 space-y-2">
                <PersonPill tone="veto" label={`Veto Winner: ${names[cycle.vetoWinnerRosterId] ?? cycle.vetoWinnerRosterId}`} />
                {cycle.vetoUsed ? (
                  <div className="flex flex-wrap gap-2">
                    {cycle.vetoSavedRosterId ? (
                      <PersonPill
                        tone="safe"
                        label={`Saved: ${names[cycle.vetoSavedRosterId] ?? cycle.vetoSavedRosterId}`}
                      />
                    ) : null}
                    {cycle.replacementNomineeRosterId ? (
                      <PersonPill
                        tone="danger"
                        label={`Replacement: ${names[cycle.replacementNomineeRosterId] ?? cycle.replacementNomineeRosterId}`}
                      />
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text2)]">Veto was not used. Nominations remain unchanged.</p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-[var(--muted)]">Veto not yet decided.</p>
            )}
          </>
        )}
        {tab === 'Replacement' && (
          <>
            <h3 className="text-sm font-medium text-[var(--text)]">Replacement Nominee</h3>
            {cycle?.vetoUsed && cycle?.replacementNomineeRosterId ? (
              <p className="mt-2 text-sm text-[var(--text2)]">
                HOH named {names[cycle.replacementNomineeRosterId] ?? cycle.replacementNomineeRosterId} as the replacement nominee.
              </p>
            ) : (
              <p className="mt-2 text-sm text-[var(--muted)]">{cycle?.vetoUsed ? 'Replacement not yet set.' : 'No replacement (veto not used).'}</p>
            )}
          </>
        )}
        {tab === 'Eviction' && (
          <>
            <h3 className="text-sm font-medium text-[var(--text)]">Eviction</h3>
            {cycle?.evictedRosterId ? (
              <div className="mt-2 space-y-2">
                <PersonPill tone="danger" label={`Evicted: ${names[cycle.evictedRosterId] ?? cycle.evictedRosterId}`} />
                <p className="text-sm text-[var(--text2)]">The house vote has concluded and the roster is removed from active competition.</p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-[var(--muted)]">Eviction not yet held.</p>
            )}
          </>
        )}
      </div>

      <p className="text-xs text-[var(--muted)]">Host recap and ceremony copy appear in league chat and from Chimmy.</p>
    </div>
  )
}
