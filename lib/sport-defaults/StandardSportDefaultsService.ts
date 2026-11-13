/**
 * Standard default sport configuration layer.
 * Resolves for each league/sport: default_scoring_profile, default_roster_template,
 * default_schedule_template, default_season_calendar. Used by league creation and settings resolution.
 */
import type { LeagueSport } from '@prisma/client'

export interface StandardSportDefaults {
  sport: LeagueSport
  default_scoring_profile: {
    templateId: string
    name: string
    formatType: string
  }
  default_roster_template: {
    templateId: string
    name: string
    formatType: string
  }
  default_schedule_template: {
    templateId: string
    name: string
    formatType: string
  }
  default_season_calendar: {
    calendarId: string
    name: string
    formatType: string
  }
}

