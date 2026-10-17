import { defaultSeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import { defaultSeasonRules } from '@/lib/tournament/seasonRules'

export function completeConfig() {
  const config = { ...defaultSeasonBlueprint(), name: 'NBA Pilot', rules: defaultSeasonRules('NBA', 'nba_points') }
  const rules = config.rules
  const epoch = Date.parse('2026-10-20T00:00:00Z')
  const hour = 3600000
  const iso = (hours: number) => new Date(epoch + hours * hour).toISOString()
  // Artificial fixture: spaced windows deliberately leave correction and redraft time.
  rules.calendar = {
    timezone: 'America/New_York', seasonLabel: 'Test season', sourceUrl: 'https://www.nba.com/schedule', scheduleReviewed: true,
    regularSeasonStartsAt: iso(0), regularSeasonEndsAt: iso(24 * 192),
    periods: Array.from({ length: 24 }, (_, i) => ({ number: i + 1, startsAt: iso(i * 192), endsAt: iso(i * 192 + 144), finalizesAt: iso(i * 192 + 168) })),
    drafts: [
      { stage: 1, startsAt: iso(-48), completeBy: iso(-24) },
      { stage: 2, startsAt: iso(9 * 192 + 168), completeBy: iso(10 * 192 - 24) },
      { stage: 3, startsAt: iso(19 * 192 + 168), completeBy: iso(20 * 192 - 24) },
    ],
  }
  // Exactly 24h between correction closure and next period: a two-hour draft needs a smaller buffer.
  config.redraftBufferHours = 12
  rules.calendar.drafts[1]!.completeBy = iso(10 * 192 - 12)
  rules.calendar.drafts[2]!.completeBy = iso(20 * 192 - 12)
  return config
}
