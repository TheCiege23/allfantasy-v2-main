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
  COLLUSION_VALUE_GAP_PCT,
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
}

type Draft = {
  collusionSensitivity: IntegritySensitivity
  tankingMonitorEnabled: boolean
  tankingSensitivity: IntegritySensitivity
  tankingStartWeek: number | null
  tankingIllegalLineupCheck: boolean
  tankingBenchPatternCheck: boolean
  tankingWaiverPatternCheck: boolean
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
  }
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
}: {
  value: IntegritySettingsValue
  onSave: (next: Draft) => void | Promise<void>
  saving?: boolean
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
            Always on. Analyzes trade values and partner frequency &mdash; no chat access.
          </p>
          <div className="af-label">Sensitivity</div>
          <Segmented
            name="Collusion"
            value={draft.collusionSensitivity}
            onChange={(v) => set('collusionSensitivity', v)}
            disabled={saving}
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
              disabled={saving}
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
                disabled={saving || !draft.tankingMonitorEnabled}
                onChange={(e) => set('tankingIllegalLineupCheck', e.target.checked)}
              />
              <span>Starting OUT / IR / doubtful when alternatives exist</span>
            </label>
            <label className="af-cm-check">
              <input
                type="checkbox"
                checked={draft.tankingBenchPatternCheck}
                disabled={saving || !draft.tankingMonitorEnabled}
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
              disabled={saving || !draft.tankingMonitorEnabled}
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
            disabled={saving || !draft.tankingMonitorEnabled}
          />
          <p className="af-cm-threshold">{describeTankingSensitivity(draft.tankingSensitivity)}</p>
        </div>
      </div>

      <button
        type="button"
        className="af-cm-save"
        disabled={saving || !dirty}
        onClick={() => void onSave(draft)}
      >
        {saving ? 'Saving…' : dirty ? 'Save integrity settings' : 'Saved'}
      </button>

      <p className="af-cm-rail-foot">
        Flags are private to commissioners until you act on one. Dismissals are logged. A trade is reviewed once the two
        sides differ by about {COLLUSION_VALUE_GAP_PCT[draft.collusionSensitivity]}%.
      </p>
    </>
  )
}

export default IntegritySettings
