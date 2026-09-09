import type { LeagueSettingsSnapshot, SettingsClient } from './types'

/**
 * Developer fixtures — a small, obviously-synthetic league.
 *
 * Kept minimal on purpose: stub exists so a developer can render the view without a database, and a
 * second realistic dataset beside Demo Mode's would just be a second thing to keep in step. Two of
 * these entries are null so the "not captured" branch is exercised in the cheapest mode to run.
 */
const SNAPSHOT: LeagueSettingsSnapshot = {
  leagueName: 'Stub League',
  seasonLabel: '2026',
  groups: [
    {
      id: 'identity',
      label: 'League',
      description: 'What kind of league this is, as captured from its platform.',
      entries: [
        { label: 'Teams', value: '10' },
        { label: 'Season', value: '2026' },
        { label: 'Format', value: 'Redraft' },
        { label: 'Dynasty', value: 'No' },
        { label: 'Sport', value: 'Nfl' },
        { label: 'Matchups', value: 'Weekly' },
      ],
    },
    {
      id: 'roster',
      label: 'Roster',
      description: 'Starting slots, bench depth and the developmental slots this league carries.',
      entries: [
        { label: 'Starting slots', value: '9', note: 'QB · RB · RB · WR · WR · TE · FLEX · K · DEF' },
        { label: 'Bench', value: '6' },
        { label: 'IR', value: null },
        { label: 'Taxi squad', value: null },
        { label: 'Devy / college', value: null },
        { label: 'Total roster spots', value: '15' },
      ],
    },
    {
      id: 'waivers',
      label: 'Waivers',
      description: 'How this league adds free agents.',
      entries: [
        { label: 'Waiver type', value: 'Rolling' },
        { label: 'FAAB budget', value: null },
      ],
    },
    {
      id: 'playoffs',
      label: 'Playoffs',
      description: 'How the season ends.',
      entries: [
        { label: 'Playoff teams', value: '4' },
        { label: 'Playoffs start', value: '15', note: 'Week' },
        { label: 'Trade deadline', value: null, note: 'Week' },
      ],
    },
    {
      id: 'draft',
      label: 'Draft',
      description: 'How this league drafts.',
      entries: [{ label: 'Draft type', value: 'Snake' }],
    },
  ],
  scoring: {
    format: 'Ppr',
    templateId: null,
    ruleCount: 4,
    rules: [
      { stat: 'pass_td', label: 'Passing TD', points: 4 },
      { stat: 'rush_td', label: 'Rushing TD', points: 6 },
      { stat: 'rec', label: 'Reception', points: 1 },
      { stat: 'pass_yd', label: 'Passing yards', points: 0.04 },
    ],
  },
  provenance: { source: 'Stub', externalLeagueId: null, editableHere: false },
}

export const stubSettingsClient: SettingsClient = {
  async getSnapshot() {
    return { data: SNAPSHOT, error: null, source: 'stub', timestamp: new Date().toISOString() }
  },
}
