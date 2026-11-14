/**
 * The Commissioner Hub guide (2026-11-13). The owner's ask: users should know what the page is for and
 * exactly what to do. The page is a commissioner's to-do list across every league they run, so the
 * headline is the count of things waiting, and the chips say what kind each is.
 *
 * Pure, so the rules are testable and the screen stays a renderer.
 */
import type { CommissionerOverviewData } from '@/lib/core-app/commissionerOverview'

export type CommissionerGuideChip = {
  key: 'trades' | 'quiet' | 'resync' | 'clear'
  label: string
  href: string
  tone: 'bad' | 'warn' | 'good'
}

export type CommissionerGuide = {
  eyebrow: string
  headline: string
  intro: string
  teach: string
  chips: CommissionerGuideChip[]
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function commissionerGuide(
  data: Pick<CommissionerOverviewData, 'runCount' | 'queue' | 'leagues' | 'ladder'> & {
    summary?: CommissionerOverviewData['summary']
  },
): CommissionerGuide {
  const n = data.runCount
  const s = data.summary ?? {
    todo: data.queue.length,
    trades: 0,
    quiet: (data.ladder ?? []).length,
    resync: 0,
    leaguesWithNothing: data.leagues.filter((l) => l.needsYou === 0).length,
  }
  const teach =
    'A manager who stops playing mid-season hands free wins to everyone they face, so catching it early keeps the league fair. Before the draft and after the final, quiet is normal — those leagues are not flagged.'
  if (n === 0) {
    return {
      eyebrow: 'Commissioner',
      headline: 'Commissioner Hub',
      intro: 'Every league you run shows up here, with what needs you in each one.',
      teach,
      chips: [],
    }
  }
  const where = n === 1 ? 'your league' : `${n} leagues`
  const headline =
    s.todo === 0
      ? `Nothing needs you in the ${n === 1 ? 'league' : `${n} leagues`} you run`
      : `${plural(s.todo, 'thing needs', 'things need')} you across ${where}`
  const chips: CommissionerGuideChip[] = []
  if (s.trades > 0) chips.push({ key: 'trades', label: `${plural(s.trades, 'trade', 'trades')} to review`, href: '#afh-queue', tone: 'warn' })
  if (s.quiet > 0) chips.push({ key: 'quiet', label: `${plural(s.quiet, 'quiet manager', 'quiet managers')} mid-season`, href: '#af-ladder', tone: 'bad' })
  if (s.resync > 0) chips.push({ key: 'resync', label: `${plural(s.resync, 'league', 'leagues')} to re-sync`, href: '/core/sync', tone: 'bad' })
  if (s.leaguesWithNothing > 0)
    chips.push({ key: 'clear', label: `${plural(s.leaguesWithNothing, 'league', 'leagues')} with nothing waiting`, href: '#afh-leagues', tone: 'good' })
  return {
    eyebrow: `Commissioner · ${plural(n, 'league', 'leagues')} you run`,
    headline,
    intro:
      'Your commissioner to-do list: trades to review, managers gone quiet mid-season and leagues to re-sync — each with the button that fixes it. Rulings are still made on each league’s own platform.',
    teach,
    chips,
  }
}
