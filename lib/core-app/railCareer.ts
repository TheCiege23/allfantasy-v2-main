import { isUnfiltered, recordLine, type CareerData, type CareerLeague } from './careerModel'

/**
 * Career stats in the league rail — "23-11 · 2 titles" under each league's name while you are on
 * the Career screen, so the rail you already scroll becomes the index of your career.
 *
 * ⚠ A CLIENT HAND-OFF, NOT A SERVER READ. The rail belongs to the shell, rendered by the OUTER
 * page; the career is read by the screen body, which streams separately. Rather than read the career
 * a second time on every /core/career render, the Career screen publishes its lines as a window event
 * (`RAIL_CAREER_EVENT`) and the shell renders them — the same pattern `askChimmyAboutCareer` uses to
 * open the Chimmy drawer. Leaving the Career screen publishes `null`, so the lines never outlive it.
 *
 * ⚠ MATCHED BY THE CAREER'S OWN IDENTITY: the league name, trimmed and lower-cased. That is the key
 * Career already merges a league's seasons by (Sleeper gives every season its own id), so the rail
 * line and the Career screen can never disagree about which league a record belongs to.
 *
 * ⚠ FINISHED SEASONS ONLY, and only for an unfiltered career — a platform or era filter on the
 * Career screen must not quietly turn the rail into "your record since 2023".
 */

export const RAIL_CAREER_EVENT = 'af:rail-career-lines'
export type RailCareerDetail = { lines: Record<string, string> | null }

export function railLeagueKey(name: string | null | undefined): string {
  return String(name ?? '').trim().toLowerCase()
}

/** "23-11 · 2 titles", "23-11", "1 title" — or null when there is nothing finished to say. */
export function railCareerLine(league: Pick<CareerLeague, 'record' | 'championships'>): string | null {
  const record = league.record ? recordLine(league.record.wins, league.record.losses, league.record.ties) : null
  const titles = league.championships > 0 ? `${league.championships} ${league.championships === 1 ? 'title' : 'titles'}` : null
  return [record, titles].filter(Boolean).join(' · ') || null
}

export function railCareerLines(data: CareerData): Record<string, string> | null {
  if (!isUnfiltered(data.filter)) return null
  const lines: Record<string, string> = {}
  for (const l of data.leagues) {
    const line = railCareerLine(l)
    if (line) lines[l.key] = line
  }
  return Object.keys(lines).length > 0 ? lines : null
}
