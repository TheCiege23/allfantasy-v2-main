'use client'

import { AfInjuryTag } from '@/components/league/AfInjuryTag'

/**
 * Stat corrections + the League Legend, at the foot of the record book (components/decide/LegacyHome.tsx).
 *
 * ⚠ THE LEGEND EXPLAINS ONLY WHAT THIS PAGE ACTUALLY DRAWS. Sleeper's legend also covers
 * defense-matchup colours, projection trend colours and trending arrows; AF does not render those on
 * the league page, and a key for marks a reader never sees is worse than no key. Add an entry here in
 * the same change that starts drawing the mark.
 *
 * Stat corrections for an imported league are the host platform's: they are applied there and reach
 * AF on the next sync, so this says that rather than showing an empty corrections list that implies
 * none happened.
 */
const T = {
  text: 'var(--lsk-text, #fff)',
  text2: 'var(--lsk-text2, rgba(255,255,255,.8))',
  muted: 'var(--lsk-muted, rgba(255,255,255,.6))',
  line: 'var(--lsk-line, rgba(255,255,255,.1))',
  surface: 'var(--lsk-surface, #0e1119)',
}

const BLUE = 'var(--af-blue, #3b82f6)'

type Entry = { mark: React.ReactNode; name: string; desc: string }

const STATUS: Entry[] = [
  { mark: <AfInjuryTag status="Probable" />, name: 'Probable', desc: 'Very likely to play.' },
  { mark: <AfInjuryTag status="Questionable" />, name: 'Questionable', desc: 'About a 50/50 chance to play.' },
  { mark: <AfInjuryTag status="Doubtful" />, name: 'Doubtful', desc: 'Very unlikely to play.' },
  { mark: <AfInjuryTag status="Out" />, name: 'Out', desc: 'Will not play.' },
  { mark: <AfInjuryTag status="Suspended" />, name: 'Suspended', desc: 'Suspended and will not play.' },
  { mark: <AfInjuryTag status="Injured Reserve" />, name: 'Injured reserve', desc: 'On injured reserve and will not play.' },
]

const chip = (text: string, color: string) => (
  <span className="inline-block min-w-[44px] rounded-md border px-1.5 text-center text-[12px] font-extrabold" style={{ borderColor: color, color }}>
    {text}
  </span>
)

const PROJECTIONS: Entry[] = [
  { mark: chip('proj.', 'var(--lsk-muted, #9aa4b2)'), name: 'Host projection', desc: 'The projection from the platform your league is hosted on.' },
  { mark: chip('AF', BLUE), name: 'AF projection', desc: 'AllFantasy’s own projection, in your league’s scoring, shown in AF blue.' },
  { mark: chip('AF *', BLUE), name: 'Partial AF total', desc: 'AF has projections for only some of that team’s starters.' },
  { mark: chip('proj. —', 'var(--lsk-muted, #9aa4b2)'), name: 'No projection', desc: 'No real projection yet. AF shows a dash rather than a guess.' },
  { mark: <span className="inline-block h-2 w-11 rounded-full" style={{ background: '#ff2d55', boxShadow: '0 0 10px rgba(255,45,85,.6)' }} />, name: 'Red AF bar', desc: 'AF projects you to lose this matchup.' },
]

const SCHEDULE: Entry[] = [
  { mark: chip('BYE', BLUE), name: 'Bye week', desc: 'The NFL team has no game this week.' },
  { mark: chip('NG', BLUE), name: 'No game', desc: 'NBA, NHL or MLB: the team has no game today.' },
]

function Group({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border p-4" style={{ borderColor: T.line, background: T.surface }}>
      <h4 className="m-0 text-[15px] font-extrabold" style={{ color: T.text }}>{title}</h4>
      {entries.map((e) => (
        <div key={e.name} className="flex items-start gap-3">
          <span className="w-[56px] shrink-0 pt-0.5">{e.mark}</span>
          <span className="min-w-0">
            <span className="block text-[14px] font-bold" style={{ color: T.text }}>{e.name}</span>
            <span className="block text-[13px] leading-snug" style={{ color: T.muted }}>{e.desc}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

export function LeagueLegend({ hostLabel }: { hostLabel: string | null }) {
  return (
    <section className="mt-6 flex flex-col gap-5" aria-label="Stat corrections and league legend" data-testid="league-legend">
      <div className="flex flex-wrap gap-4">
        <div className="flex min-w-0 flex-[999_1_420px] flex-col gap-2 rounded-2xl border p-4" style={{ borderColor: T.line, background: T.surface }}>
          <h3 className="m-0 text-[20px] font-extrabold" style={{ color: T.text }}>Stat corrections</h3>
          <p className="m-0 text-[14px] leading-relaxed" style={{ color: T.text2 }}>
            {hostLabel
              ? `This league’s scores and stat corrections come from ${hostLabel}. A correction is applied there first and reaches AllFantasy on the next sync, so a total here can change after the week ends.`
              : 'Stat corrections are applied to each player’s total after the games, so a weekly total can change after the week ends.'}
          </p>
        </div>
        <aside className="flex flex-[1_1_280px] flex-col gap-2 rounded-2xl border p-4" style={{ borderColor: 'var(--lsk-accent-line, rgba(59,130,246,.38))', background: 'var(--lsk-soft, rgba(59,130,246,.1))' }}>
          <h3 className="m-0 text-[16px] font-extrabold" style={{ color: T.text }}>When corrections happen</h3>
          <p className="m-0 text-[14px] leading-relaxed" style={{ color: T.text2 }}>
            Stat providers correct numbers during games and for a few days after, usually by Tuesday and sometimes as late as Thursday. A final-looking matchup can still move.
          </p>
        </aside>
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="m-0 text-[22px] font-extrabold" style={{ color: T.text }}>League legend</h3>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <Group title="Player status" entries={STATUS} />
          <Group title="Projections" entries={PROJECTIONS} />
          <Group title="Schedule" entries={SCHEDULE} />
        </div>
      </div>
    </section>
  )
}
