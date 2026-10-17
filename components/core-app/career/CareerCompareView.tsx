'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { compareHref, type CareerCompare, type CompareOption } from '@/lib/core-app/careerCompare'
import { askChimmyAboutCareer } from './CareerAskChimmy'

/**
 * `?view=compare` — two slices of one career side by side (live-career plan, phase 5).
 *
 * Built for the desktop frame first — two named columns with the stronger side marked per row —
 * and it holds at every width: three narrow columns fit a phone, and the pickers stack. Each pick
 * is a navigation, so a comparison is a link someone can send.
 */

const GROUPS: CompareOption['group'][] = ['Career', 'Platforms', 'Leagues', 'Seasons', 'Sports']

function SidePicker({
  id,
  label,
  value,
  options,
  onPick,
}: {
  id: string
  label: string
  value: string
  options: CompareOption[]
  onPick: (spec: string) => void
}) {
  return (
    <label className="af-crc-pick" htmlFor={id}>
      <span className="af-crc-picklabel">{label}</span>
      <select id={id} value={value} onChange={(e) => onPick(e.target.value)}>
        {GROUPS.map((g) => {
          const opts = options.filter((o) => o.group === g)
          if (opts.length === 0) return null
          return (
            <optgroup key={g} label={g}>
              {opts.map((o) => (
                <option key={o.spec} value={o.spec}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )
        })}
      </select>
    </label>
  )
}

export function CareerCompareView({ compare }: { compare: CareerCompare | null }) {
  const router = useRouter()
  if (!compare) {
    return (
      <div className="af-cr-empty">
        <p className="af-cr-empty-t">We could not build this comparison just now.</p>
        <p className="af-cr-empty-b">This is a read failure on our side, not a career with nothing to compare.</p>
      </div>
    )
  }
  const { a, b, rows, options } = compare
  const same = a.spec === b.spec
  const ask = `Compare my ${a.label} results with my ${b.label} results. What explains the difference, and what should I carry over?`

  return (
    <div className="af-crx-stack af-crc">
      <p className="af-crx-lede">
        Pick any two slices of your career: a platform, a league, a season or a sport. Every number comes from finished
        seasons only, the same figures the overview shows for that filter.
      </p>

      <div className="af-crc-pickers">
        <SidePicker id="af-crc-a" label="Compare" value={a.spec} options={options} onPick={(s) => router.push(compareHref(s, b.spec))} />
        <Link className="af-crc-swap" href={compareHref(b.spec, a.spec)} aria-label="Swap sides">
          ⇄
        </Link>
        <SidePicker id="af-crc-b" label="with" value={b.spec} options={options} onPick={(s) => router.push(compareHref(a.spec, s))} />
      </div>

      {same ? <p className="af-crl-foot">Both sides are the same — pick something different to compare.</p> : null}

      <div className="af-crx-tablewrap">
        <table className="af-crx-table af-crc-table">
          <caption className="af-crc-cap">
            {a.label} compared with {b.label}
          </caption>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">{a.label}</th>
              <th scope="col">{b.label}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td data-better={r.better === 'a' ? '' : undefined}>{r.a}</td>
                <td data-better={r.better === 'b' ? '' : undefined}>{r.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="af-crc-foot">
        <p className="af-crl-foot">
          Highlighted cells lead on that measure. Points per game is only ranked when both sides are the same sport.
        </p>
        <button type="button" className="af-crl-chip" onClick={() => askChimmyAboutCareer(ask)}>
          ✦ Ask Chimmy what explains the gap
        </button>
      </div>
    </div>
  )
}
