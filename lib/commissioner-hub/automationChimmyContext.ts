/**
 * Chimmy and the league's automations (phase 12, 2026-10-29). The plan said the automations would be
 * connected to Chimmy; until now Chimmy could only guess at "what does AllFantasy do in my league?" or
 * "why did my lineup change?". This is the text block it reads, built from the same views the
 * Commissioner Hub and the lineup screen show, so its answer and the screens never disagree:
 *
 *   - what may act on the asker's own team (lib/lineup-automation/myTeamAutomations.ts);
 *   - for a commissioner, every automation's state (./automationOverview.ts);
 *   - the automatic changes recorded on the asker's team recently, from the logs, newest first — what
 *     happened, when, and why.
 *
 * Read-only knowledge: Chimmy explains, it does not act here. Pure.
 */
import type { AutomationRow } from './automationOverview'
import type { MyTeamAutomation } from '@/lib/lineup-automation/myTeamAutomations'

export type RecentAutomaticChange = { at: Date; message: string }

export function automationContextForChimmy(args: {
  myTeam: { items: readonly MyTeamAutomation[]; takeBack: MyTeamAutomation } | null
  commissionerRows: readonly AutomationRow[] | null
  recent: readonly RecentAutomaticChange[]
}): string {
  const lines: string[] = ['[LEAGUE AUTOMATIONS — what AllFantasy does by itself in this league. Explain from this; never claim something runs that is not listed, and never act on it here.]']
  if (args.myTeam) {
    if (args.myTeam.items.length) {
      lines.push('For the asker’s own team:')
      for (const i of args.myTeam.items) lines.push(`- ${i.en}`)
    } else {
      lines.push('Nothing automatic acts on the asker’s own team in this league.')
    }
    lines.push(`How to take control: ${args.myTeam.takeBack.en}`)
  }
  if (args.commissionerRows?.length) {
    lines.push('Every automation in the league (the asker is a commissioner; switches are on the Commissioner Hub, "What runs itself"):')
    for (const r of args.commissionerRows) {
      const state = r.state === 'on' ? 'on' : r.state === 'needs_plan' ? 'needs AF Commissioner' : 'off'
      lines.push(`- ${r.label}: ${state}${r.detail ? ` (${r.detail})` : ''}`)
    }
  }
  if (args.recent.length) {
    lines.push('Automatic changes recorded on the asker’s team (use these to answer "why did my lineup change?"):')
    for (const c of args.recent) lines.push(`- ${c.at.toISOString().slice(0, 10)}: ${c.message}`)
  } else if (args.myTeam) {
    lines.push('No automatic change has been recorded on the asker’s team in the last 14 days; a change they see was made by a person.')
  }
  return lines.join('\n')
}
