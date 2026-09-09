import type { LeagueSettingsSnapshot, SettingsClient } from './types'

/**
 * A realistic 12-team dynasty superflex league — the kind of league this product is sold to.
 *
 * ⚠ ONE ENTRY IS DELIBERATELY NULL (`Devy / college`). A demo where every field is populated teaches
 * a viewer that this page is always complete, and then the first real league with a gap reads as
 * broken. Demo Mode is what sales and QA look at, so the "not captured" state has to be visible in
 * it — it is the state a large share of real leagues are in for at least one field.
 */
const SNAPSHOT: LeagueSettingsSnapshot = {
  leagueName: 'Dynasty Warriors',
  seasonLabel: '2026',
  groups: [
    {
      id: 'identity',
      label: 'League',
      description: 'What kind of league this is, as captured from its platform.',
      entries: [
        { label: 'Teams', value: '12' },
        { label: 'Season', value: '2026' },
        { label: 'Format', value: 'Dynasty Superflex' },
        { label: 'Dynasty', value: 'Yes' },
        { label: 'Sport', value: 'Nfl' },
        { label: 'Matchups', value: 'Weekly' },
      ],
    },
    {
      id: 'roster',
      label: 'Roster',
      description: 'Starting slots, bench depth and the developmental slots this league carries.',
      entries: [
        { label: 'Starting slots', value: '10', note: 'QB · RB · RB · WR · WR · TE · FLEX · FLEX · SUPER_FLEX · K' },
        { label: 'Bench', value: '20' },
        { label: 'IR', value: '3' },
        { label: 'Taxi squad', value: '4' },
        { label: 'Devy / college', value: null },
        { label: 'Total roster spots', value: '37' },
      ],
    },
    {
      id: 'waivers',
      label: 'Waivers',
      description: 'How this league adds free agents.',
      entries: [
        { label: 'Waiver type', value: 'FAAB' },
        { label: 'FAAB budget', value: '$200' },
      ],
    },
    {
      id: 'playoffs',
      label: 'Playoffs',
      description: 'How the season ends.',
      entries: [
        { label: 'Playoff teams', value: '6' },
        { label: 'Playoffs start', value: '15', note: 'Week' },
        { label: 'Trade deadline', value: '12', note: 'Week' },
      ],
    },
    {
      id: 'draft',
      label: 'Draft',
      description: 'How this league drafts.',
      entries: [{ label: 'Draft type', value: 'Linear' }],
    },
  ],
  scoring: {
    format: 'Custom',
    templateId: 'fb_half_ppr',
    ruleCount: 8,
    rules: [
      { stat: 'pass_td', label: 'Passing TD', points: 6 },
      { stat: 'rush_td', label: 'Rushing TD', points: 6 },
      { stat: 'rec_td', label: 'Receiving TD', points: 6 },
      { stat: 'fum_lost', label: 'Fumble lost', points: -2 },
      { stat: 'pass_int', label: 'Interception thrown', points: -1 },
      { stat: 'rec', label: 'Reception', points: 0.5 },
      { stat: 'rush_yd', label: 'Rushing yards', points: 0.1 },
      { stat: 'pass_yd', label: 'Passing yards', points: 0.04 },
    ],
  },
  provenance: {
    source: 'Sleeper',
    externalLeagueId: '1048576000000000000',
    editableHere: false,
  },
}

export const demoSettingsClient: SettingsClient = {
  async getSnapshot() {
    return { data: SNAPSHOT, error: null, source: 'demo', timestamp: new Date().toISOString() }
  },
}
