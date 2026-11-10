'use client'

/**
 * 11c — the anti-collusion / anti-tanking settings rail.
 *
 * ⚠ THIS RAIL WAS THE REASON `lib/integrity/sensitivity.ts` HAD TO EXIST. Every
 * control below writes a column that has been in `LeagueIntegritySettings` and
 * saved by `PUT /api/leagues/[leagueId]/integrity` since the table shipped — and
 * until this change the detection engines read exactly one of them
 * (`tankingMonitorEnabled`). Rendering the rest as live controls without wiring
 * the engines would have shipped a settings panel that persists your choice,
 * reloads it correctly, and changes nothing.
 *
 * ⚠ EVERY THRESHOLD SENTENCE IS GENERATED, NOT WRITTEN. `describeCollusionSensitivity`
 * and `describeTankingSensitivity` build their copy from the same constants the
 * scan compares against. Do not replace them with a hardcoded string: build rule
 * 5 requires the plain-language threshold to be true, and a literal here would
 * be true only until someone tuned the engine.
 */

import { useEffect, useState } from 'react'
import {
  HOLD_FLAGGED_TRADES_LABELS,
  HOLD_FLAGGED_TRADES_MODES,
  holdModeFromResponse,
  type HoldFlaggedTradesMode,
} from '@/lib/integrity/holdFlaggedTradesMode'
import {
  describeCollusionSensitivity,
  describeTankingSensitivity,
  INTEGRITY_SENSITIVITIES,
  normalizeSensitivity,
  type IntegritySensitivity,
} from '@/lib/integrity/sensitivity'

export type IntegritySettingsValue = {
  collusionSensitivity: string
  tankingMonitorEnabled: boolean
  tankingSensitivity: string
  tankingStartWeek: number | null
  tankingIllegalLineupCheck: boolean
  tankingBenchPatternCheck: boolean
  tankingWaiverPatternCheck: boolean
  /** Suspicious-trade alerts (League.settings, lib/integrity/tradeAlerts.ts). Absent = on. */
  tradeAlertsEnabled?: boolean
  /** Hold flagged trades for commissioner review (League.settings, lib/integrity/holdFlaggedTrades.ts). Default: serious flags only. */
  holdFlaggedTrades?: boolean
  holdFlaggedTradesMode?: HoldFlaggedTradesMode
  /** False in an imported league: its trades go through on the host, so there is nothing to hold. */
  holdFlaggedTradesSupported?: boolean
  /**
   * Anti-tanking penalties (League.settings, lib/integrity/tankingPenalties.ts). Present only for a
   * league run on AllFantasy: an imported league's picks and FAAB live on its host.
   */
  tankingPenalties?: TankingPenaltiesValue
  /**
   * True when the league has future picks to take (a dynasty-family league run here). Losing a draft pick
   * and worse rookie-lottery odds need them; a redraft league is offered the FAAB penalty only.
   */
  tankingPickPenaltiesSupported?: boolean
}

export type TankingPenaltiesValue = {
  enabled: boolean
  penalty?: 'forfeit_pick' | 'lottery_odds' | 'faab'
  pickAtStrike: number
  pickRound: number
  lotteryOddsCutPct?: number
  faabPercent?: number
}

type Draft = {
  tankingPenalties?: TankingPenaltiesValue
  collusionSensitivity: IntegritySensitivity
  tankingMonitorEnabled: boolean
  tankingSensitivity: IntegritySensitivity
  tankingStartWeek: number | null
  tankingIllegalLineupCheck: boolean
  tankingBenchPatternCheck: boolean
  tankingWaiverPatternCheck: boolean
  tradeAlertsEnabled: boolean
  holdFlaggedTradesMode: HoldFlaggedTradesMode
}

function toDraft(v: IntegritySettingsValue): Draft {
  return {
    collusionSensitivity: normalizeSensitivity(v.collusionSensitivity),
    tankingMonitorEnabled: Boolean(v.tankingMonitorEnabled),
    tankingSensitivity: normalizeSensitivity(v.tankingSensitivity),
    tankingStartWeek: typeof v.tankingStartWeek === 'number' ? v.tankingStartWeek : null,
    tankingIllegalLineupCheck: v.tankingIllegalLineupCheck !== false,
    tankingBenchPatternCheck: v.tankingBenchPatternCheck !== false,
    tankingWaiverPatternCheck: Boolean(v.tankingWaiverPatternCheck),
    tradeAlertsEnabled: v.tradeAlertsEnabled !== false,
    holdFlaggedTradesMode: holdModeFromResponse(v),
    ...(v.tankingPenalties ? { tankingPenalties: { ...v.tankingPenalties } } : {}),
  }
}

/**
 * What a strike costs, chosen by the commissioner. These controls used to live only in League Settings,
 * a different page from the monitor they govern; they now sit beside it (owner decision 2026-11-06).
 */
function TankingPenaltyFields({
  value,
  onChange: change,
  disabled,
  pickPenalties,
}: {
  value: TankingPenaltiesValue
  onChange: (patch: Partial<TankingPenaltiesValue>) => void
  disabled: boolean
  /** False in a league with no future picks: only the FAAB penalty can apply there. */
  pickPenalties: boolean
}) {
  const kind = pickPenalties ? value.penalty ?? 'forfeit_pick' : 'faab'
  // Every edit in such a league saves the FAAB penalty, whatever was stored before.
  const onChange = (patch: Partial<TankingPenaltiesValue>) => change(pickPenalties ? patch : { ...patch, penalty: 'faab' })
  const off = disabled || !value.enabled
  return (
    <div className="af-cm-penalties" data-testid="tanking-penalties">
      <div className="af-cm-setrow">
        <span className="af-cm-setrow-label">Penalties for confirmed tanking</span>
        <button
          type="button"
          className="af-cm-toggle af-num"
          aria-pressed={value.enabled}
          aria-label="Penalties for confirmed tanking"
          disabled={disabled}
          onClick={() => onChange({ enabled: !value.enabled })}
        >
          {value.enabled ? 'On' : 'Off'}
        </button>
      </div>
      <p className="af-cm-threshold">
        A flag only warns the manager privately. Confirming one (Escalate) is a strike; at the strike below, the team pays the penalty.
      </p>
      <label className="af-cm-numrow">
        <span className="af-cm-setrow-label">Penalty</span>
        <select
          className="af-cm-select"
          data-testid="tanking-penalty-kind"
          value={kind}
          disabled={off}
          onChange={(e) => onChange({ penalty: e.target.value as TankingPenaltiesValue['penalty'] })}
        >
          {pickPenalties ? (
            <>
              <option value="forfeit_pick">Lose a draft pick</option>
              <option value="lottery_odds">Worse rookie-lottery odds</option>
            </>
          ) : null}
          <option value="faab">Lose FAAB</option>
        </select>
      </label>
      {pickPenalties ? null : (
        <p className="af-cm-threshold" data-testid="tanking-penalty-faab-only">
          This league has no future draft picks, so losing a pick or lottery odds can't apply. A strike costs FAAB.
        </p>
      )}
      <label className="af-cm-numrow">
        <span className="af-cm-setrow-label">At strike</span>
        <select className="af-cm-select" value={value.pickAtStrike} disabled={off} onChange={(e) => onChange({ pickAtStrike: Number(e.target.value) })}>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n === 1 ? '1 (no warning)' : n}
            </option>
          ))}
        </select>
      </label>
      {kind === 'forfeit_pick' ? (
        <label className="af-cm-numrow">
          <span className="af-cm-setrow-label">Round of the pick</span>
          <select className="af-cm-select" value={value.pickRound} disabled={off} onChange={(e) => onChange({ pickRound: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {kind === 'lottery_odds' ? (
        <label className="af-cm-numrow">
          <span className="af-cm-setrow-label">Odds cut</span>
          <select
            className="af-cm-select"
            data-testid="tanking-lottery-cut"
            value={value.lotteryOddsCutPct ?? 50}
            disabled={off}
            onChange={(e) => onChange({ lotteryOddsCutPct: Number(e.target.value) })}
          >
            {[25, 50, 75, 100].map((n) => (
              <option key={n} value={n}>
                {n === 100 ? 'All (left out of the lottery)' : `${n}%`}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {kind === 'faab' ? (
        <label className="af-cm-numrow">
          <span className="af-cm-setrow-label">FAAB taken</span>
          <select
            className="af-cm-select"
            data-testid="tanking-faab-percent"
            value={value.faabPercent ?? 25}
            disabled={off}
            onChange={(e) => onChange({ faabPercent: Number(e.target.value) })}
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}% of the budget
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p className="af-cm-threshold">
        {kind === 'lottery_odds'
          ? 'Applies to the next rookie-draft lottery not yet drawn. Only matters if your rookie draft order is a lottery.'
          : kind === 'faab'
            ? 'Taken from what the team has left, never below $0. Only matters if your league uses FAAB waivers.'
            : 'The team loses its own pick in that round, from the nearest draft it still holds one.'}
      </p>
    </div>
  )
}

function Segmented({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string
  value: IntegritySensitivity
  onChange: (next: IntegritySensitivity) => void
  disabled?: boolean
}) {
  return (
    <div className="af-cm-seg" role="group" aria-label={`${name} sensitivity`}>
      {INTEGRITY_SENSITIVITIES.map((level) => (
        <button
          key={level}
          type="button"
          className="af-cm-seg-btn"
          aria-pressed={value === level}
          disabled={disabled}
          onClick={() => onChange(level)}
        >
          {level === 'low' ? 'Low' : level === 'high' ? 'High' : 'Medium'}
        </button>
      ))}
    </div>
  )
}

export function IntegritySettings({
  value,
  onSave,
  saving = false,
  readOnly = false,
  leagueId,
}: {
  value: IntegritySettingsValue
  onSave: (next: Draft) => void | Promise<void>
  saving?: boolean
  readOnly?: boolean
  /** When given, the rail links to the league options that take away the reason to tank. */
  leagueId?: string
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(value))

  /*
   * Re-sync when the server's copy changes underneath us (a save round-trip, or
   * a reload triggered by acting on a flag). Keyed on the serialised value so a
   * new object identity with identical contents does not stomp an in-progress
   * edit.
   */
  const serialized = JSON.stringify(value)
  useEffect(() => {
    setDraft(toDraft(JSON.parse(serialized) as IntegritySettingsValue))
  }, [serialized])

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(value))
  const set = <K extends keyof Draft>(key: K, next: Draft[K]) => setDraft((d) => ({ ...d, [key]: next }))

  return (
    <>
      <div>
        <div className="af-label" style={{ marginBottom: 8 }}>
          Anti-collusion
        </div>
        <div className="af-cm-setgroup">
          {/*
            Always on, and said so plainly. The `collusionMonitoringEnabled`
            column exists but no engine gates on it and the product does not
            offer switching collusion detection off — surfacing a toggle that
            does nothing would be worse than surfacing no toggle.
          */}
          <p className="af-cm-setgroup-note">
            Always on. Runs the trade review on every settled trade &mdash; value, partners, activity, standings; no chat access.
          </p>
          <div className="af-cm-setrow">
            <span className="af-cm-setrow-label">Alert me when a trade is flagged</span>
            <button
              type="button"
              className="af-cm-toggle af-num"
              aria-pressed={draft.tradeAlertsEnabled}
              aria-label="Suspicious trade alerts"
              disabled={saving || readOnly}
              onClick={() => set('tradeAlertsEnabled', !draft.tradeAlertsEnabled)}
            >
              {draft.tradeAlertsEnabled ? 'On' : 'Off'}
            </button>
          </div>
          {value.holdFlaggedTradesSupported === false ? (
            <p className="af-cm-setgroup-note" data-testid="integrity-hold-unsupported">
              Holding flagged trades is not available in an imported league: its trades go through on the league&apos;s
              own platform. Completed trades are still checked, and a flagged one alerts you.
            </p>
          ) : (
            <>
            <div className="af-cm-setrow">
              <span className="af-cm-setrow-label">Hold flagged trades for my review</span>
              <select
                className="af-cm-toggle af-num"
                aria-label="Hold flagged trades"
                disabled={saving || readOnly}
                value={draft.holdFlaggedTradesMode}
                onChange={(e) => set('holdFlaggedTradesMode', e.target.value as HoldFlaggedTradesMode)}
              >
                {HOLD_FLAGGED_TRADES_MODES.map((m) => (
                  <option key={m} value={m}>
                    {HOLD_FLAGGED_TRADES_LABELS[m].label}
                  </option>
                ))}
              </select>
            </div>
            <p className="af-cm-setgroup-note">
              An accepted trade is checked before it goes through. {HOLD_FLAGGED_TRADES_LABELS[draft.holdFlaggedTradesMode].detail}
            </p>
            </>
          )}
          <div className="af-label">Sensitivity</div>
          <Segmented
            name="Collusion"
            value={draft.collusionSensitivity}
            onChange={(v) => set('collusionSensitivity', v)}
            disabled={saving || readOnly}
          />
          <p className="af-cm-threshold">{describeCollusionSensitivity(draft.collusionSensitivity)}</p>
        </div>
      </div>

      <div>
        <div className="af-label" style={{ marginBottom: 8 }}>
          Anti-tanking
        </div>
        <div className="af-cm-setgroup">
          <div className="af-cm-setrow">
            <span className="af-cm-setrow-label">Monitor weekly lineups</span>
            <button
              type="button"
              className="af-cm-toggle af-num"
              aria-pressed={draft.tankingMonitorEnabled}
              disabled={saving || readOnly}
              onClick={() => set('tankingMonitorEnabled', !draft.tankingMonitorEnabled)}
            >
              {draft.tankingMonitorEnabled ? 'On' : 'Off'}
            </button>
          </div>

          <div className="af-cm-checks">
            <label className="af-cm-check">
              <input
                type="checkbox"
                checked={draft.tankingIllegalLineupCheck}
                disabled={saving || readOnly || !draft.tankingMonitorEnabled}
                onChange={(e) => set('tankingIllegalLineupCheck', e.target.checked)}
              />
              <span>Starting OUT / IR / doubtful when alternatives exist</span>
            </label>
            <label className="af-cm-check">
              <input
                type="checkbox"
                checked={draft.tankingBenchPatternCheck}
                disabled={saving || readOnly || !draft.tankingMonitorEnabled}
                onChange={(e) => set('tankingBenchPatternCheck', e.target.checked)}
              />
              <span>Benching significantly better projections</span>
            </label>
            {/*
              ⚠ DISABLED BECAUSE NOTHING DETECTS IT YET. The column is real and the
              PUT handler saves it, but `TankingDetectionEngine` has no
              waiver-drop detector — it reads lineup snapshots only. An enabled
              checkbox here would let a commissioner switch on a protection that
              does not exist, which is the one failure mode an integrity screen
              cannot have. The `title` says so on hover rather than leaving a
              dead control unexplained.
            */}
            <label className="af-cm-check" data-disabled="true" title="No waiver-drop detector ships yet — this rule is defined but not scanned.">
              <input type="checkbox" checked={false} disabled readOnly />
              <span>
                Suspicious waiver drops <span className="af-cm-experimental">(not yet detecting)</span>
              </span>
            </label>
          </div>

          <div className="af-cm-numrow">
            <span className="af-cm-setrow-label">Start monitoring at week</span>
            <input
              className="af-cm-numinput"
              type="number"
              min={1}
              max={18}
              inputMode="numeric"
              disabled={saving || readOnly || !draft.tankingMonitorEnabled}
              value={draft.tankingStartWeek ?? ''}
              placeholder="—"
              aria-label="Start monitoring at week"
              onChange={(e) => {
                const raw = e.target.value.trim()
                if (raw === '') return set('tankingStartWeek', null)
                const n = Number.parseInt(raw, 10)
                set('tankingStartWeek', Number.isFinite(n) ? Math.min(18, Math.max(1, n)) : null)
              }}
            />
          </div>
          <p className="af-cm-threshold">
            {draft.tankingStartWeek == null
              ? 'Blank monitors every week. Early-season lineup mistakes are usually inexperience, not tanking.'
              : `Weeks 1–${draft.tankingStartWeek - 1} are not scanned.`}
          </p>

          <div className="af-label" style={{ marginTop: 16 }}>
            Sensitivity
          </div>
          <Segmented
            name="Tanking"
            value={draft.tankingSensitivity}
            onChange={(v) => set('tankingSensitivity', v)}
            disabled={saving || readOnly || !draft.tankingMonitorEnabled}
          />
          <p className="af-cm-threshold">{describeTankingSensitivity(draft.tankingSensitivity)}</p>

          {draft.tankingPenalties ? (
            <TankingPenaltyFields
              value={draft.tankingPenalties}
              disabled={saving || readOnly}
              pickPenalties={value.tankingPickPenaltiesSupported !== false}
              onChange={(patch) =>
                setDraft((d) => (d.tankingPenalties ? { ...d, tankingPenalties: { ...d.tankingPenalties, ...patch } } : d))
              }
            />
          ) : null}
        </div>
      </div>

      {/*
        Detection catches tanking after it happens; these two options make it pointless before it does.
        Both already exist elsewhere and are linked, not duplicated: a second editor for the same rule is
        how this page ended up with two copies of every setting.
      */}
      {leagueId ? (
        <div data-testid="integrity-remove-motive">
          <div className="af-label" style={{ marginBottom: 8 }}>
            Take away the reason to tank
          </div>
          <div className="af-cm-setgroup">
            <p className="af-cm-setgroup-note">
              A manager tanks to win a better draft pick, so make losing on purpose earn nothing.
            </p>
            <a className="af-cm-motive-link" href={`/core/commissioner?league=${encodeURIComponent(leagueId)}#ch-eliminated-lineups`}>
              <strong>Set best lineups for eliminated teams</strong>
              <span>AllFantasy starts their best lineup before kickoff, so they cannot field a weak one on purpose.</span>
            </a>
            <a className="af-cm-motive-link" href={`/league/${encodeURIComponent(leagueId)}?tab=Settings`}>
              <strong>Rookie draft order by Max PF</strong>
              <span>Dynasty leagues: order non-playoff teams by the most points they could have scored, not by losses.</span>
            </a>
          </div>
        </div>
      ) : null}

      {!readOnly && <button
        type="button"
        className="af-cm-save"
        disabled={saving || !dirty}
        onClick={() => void onSave(draft)}
      >
        {saving ? 'Saving…' : dirty ? 'Save integrity settings' : 'Saved'}
      </button>}

      <p className="af-cm-rail-foot">
        Flags are private to commissioners until you act on one. Dismissals are logged. Every settled trade is checked
        with the same review you see on a pending trade; nothing is ever vetoed automatically.
      </p>
    </>
  )
}

export default IntegritySettings
