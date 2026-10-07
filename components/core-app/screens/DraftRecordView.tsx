'use client'

import { formatRecordValue, recordLabel, slotName, slotRank } from '@/lib/draft-archive/recordLabels'

/**
 * One archived Draft HQ record, readable (2026-10-07). Replaces `<pre>{JSON.stringify(…)}</pre>`:
 * an object is a list of labelled rows, a list of objects is a stack of small cards, a list of
 * values is a comma list, and an empty list says so. Every field is still shown — nothing is
 * dropped, it only stops being JSON. Labels and formats live in `lib/draft-archive/recordLabels.ts`.
 *
 * Lineup-slot settings (`slots_qb`, `slots_rb`, …) collapse into one "Lineup slots" row, because
 * fourteen one-number rows of the same kind read as noise.
 */

type Props = { value: unknown; language: string }

/** Deep enough for every record the loader builds; anything deeper is shown as one line of text. */
const MAX_DEPTH = 5

export function DraftRecordView({ value, language }: Props) {
  return (
    <div className="af-record">
      <Value value={value} fieldKey="" language={language} depth={0} />
    </div>
  )
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function Value({ value, fieldKey, language, depth }: { value: unknown; fieldKey: string; language: string; depth: number }) {
  const es = language === 'es'
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="af-record-empty">{es ? 'No hay registros' : 'None recorded'}</span>
    if (value.every((v) => !isPlainObject(v) && !Array.isArray(v))) {
      return <span>{value.map((v) => formatRecordValue(fieldKey, v, language)).join(', ')}</span>
    }
    if (depth >= MAX_DEPTH) return <span>{value.length}</span>
    return (
      <ol className="af-record-list">
        {value.map((item, i) => (
          <li key={i} className="af-record-card">
            <Value value={item} fieldKey={fieldKey} language={language} depth={depth + 1} />
          </li>
        ))}
      </ol>
    )
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return <span className="af-record-empty">{es ? 'No hay registros' : 'None recorded'}</span>
    if (depth >= MAX_DEPTH) return <span>{entries.map(([k, v]) => `${recordLabel(k, language)}: ${formatRecordValue(k, v, language)}`).join(' · ')}</span>
    const slots = entries.filter(([k, v]) => /^slots_/.test(k) && typeof v === 'number')
    const rest = entries.filter(([k, v]) => !(/^slots_/.test(k) && typeof v === 'number'))
    return (
      <dl className="af-record-dl">
        {slots.length > 0 ? (
          <div>
            <dt>{es ? 'Puestos de la alineación' : 'Lineup slots'}</dt>
            <dd>
              {slots
                .filter(([, v]) => (v as number) > 0)
                .sort(([a], [b]) => slotRank(a) - slotRank(b))
                .map(([k, v]) => `${slotName(k)} ${v}`)
                .join(' · ')}
            </dd>
          </div>
        ) : null}
        {rest.map(([k, v]) => (
          <div key={k}>
            <dt>{recordLabel(k, language)}</dt>
            <dd>
              <Value value={v} fieldKey={k} language={language} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    )
  }
  return <span>{formatRecordValue(fieldKey, value, language)}</span>
}

export default DraftRecordView
