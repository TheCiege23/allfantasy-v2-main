import type { DemoTeam } from '@/lib/demo-league/types'
import type { FormatPanel, PanelItem, Tone } from '@/lib/demo-league/formats/types'
import { TeamBadge } from '../TeamBadge'

const TONE_COLOR: Record<Tone, string> = {
  danger: 'var(--color-danger)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  info: 'var(--color-info)',
  muted: 'var(--text-tertiary)',
}
const TONE_SOFT: Record<Tone, string> = {
  danger: 'var(--color-danger-soft)',
  success: 'var(--color-success-soft)',
  warning: 'var(--color-warning-soft)',
  info: 'var(--color-info-soft)',
  muted: 'var(--surface-inset)',
}

function Badge({ text, tone = 'muted' }: { text: string; tone?: Tone }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
      style={{ background: TONE_SOFT[tone], color: TONE_COLOR[tone] }}
    >
      {text}
    </span>
  )
}

function Item({ item, teams }: { item: PanelItem; teams: DemoTeam[] }) {
  const team = item.slot != null ? teams.find((t) => t.slot === item.slot) : undefined
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        {team ? <TeamBadge team={team} size={26} link={false} /> : null}
        <p className={`${team ? 'mt-1 pl-[34px]' : ''} text-sm`} style={item.tone && !team ? { color: TONE_COLOR[item.tone] } : undefined}>
          <span className={team ? 'af-muted' : 'font-semibold'}>{item.label}</span>
          {item.detail ? <span className="af-muted"> · {item.detail}</span> : null}
        </p>
      </div>
      {item.badge ? <Badge text={item.badge} tone={item.tone} /> : null}
    </div>
  )
}

function Panel({ panel, teams }: { panel: FormatPanel; teams: DemoTeam[] }) {
  return (
    <section className="af-card min-w-0 p-4" aria-label={panel.title}>
      <h2 className="text-lg font-black">{panel.title}</h2>
      {'subtitle' in panel && panel.subtitle ? <p className="text-xs af-tertiary">{panel.subtitle}</p> : null}

      {panel.kind === 'list' ? (
        <ul className="mt-3 space-y-3">{panel.items.map((it, i) => <li key={i}><Item item={it} teams={teams} /></li>)}</ul>
      ) : null}

      {panel.kind === 'groups' ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {panel.groups.map((g) => (
            <div key={g.name} className="af-card-soft min-w-0 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-bold">{g.name}</h3>
                <Badge text={`${g.members.length}`} tone={g.tone} />
              </div>
              <ul className="space-y-2">{g.members.map((m, i) => <li key={i}><Item item={m} teams={teams} /></li>)}</ul>
            </div>
          ))}
        </div>
      ) : null}

      {panel.kind === 'timeline' ? (
        <ol className="mt-3 space-y-3 border-l pl-4" style={{ borderColor: 'var(--border-subtle)' }}>
          {panel.entries.map((e, i) => (
            <li key={i} className="relative">
              <span aria-hidden="true" className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full" style={{ background: e.item.tone ? TONE_COLOR[e.item.tone] : 'var(--border-strong)' }} />
              <p className="text-xs font-semibold uppercase af-tertiary">{e.when}</p>
              <Item item={e.item} teams={teams} />
            </li>
          ))}
        </ol>
      ) : null}

      {panel.kind === 'table' ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[360px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase af-tertiary">
                {panel.columns.map((c) => <th key={c} className="py-2 pr-3">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {panel.rows.map((r, i) => {
                const team = r.slot != null ? teams.find((t) => t.slot === r.slot) : undefined
                return (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    {r.cells.map((c, j) => (
                      <td key={j} className="py-2 pr-3 align-middle">
                        {j === 0 && team ? <TeamBadge team={team} size={24} link={false} /> : c}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {panel.kind === 'callout' ? (
        <p className="mt-2 rounded-xl p-3 text-sm" style={{ background: TONE_SOFT[panel.tone ?? 'info'] }}>{panel.body}</p>
      ) : null}
    </section>
  )
}

export function FormatPanels({ panels, teams }: { panels: FormatPanel[]; teams: DemoTeam[] }) {
  if (panels.length === 0) return null
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {panels.map((p, i) => <Panel key={i} panel={p} teams={teams} />)}
    </div>
  )
}
