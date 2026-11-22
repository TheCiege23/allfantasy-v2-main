/**
 * Sport-aware tab + row layout for commissioner scoring settings (visual grouping only).
 * Template stat keys come from `templateStatKeyFromUiKey`; values resolve from `LeagueScoringConfig.rules`.
 */
import { NFL_SCORING_CATEGORIES, NFL_PREMIUM_SCORING } from '@/lib/nfl-scoring/NflScoringCategories'
import { NCAAF_SCORING_CATEGORIES, NCAAF_PREMIUM_SCORING } from '@/lib/ncaaf-scoring/NcaafScoringCategories'
import { NBA_SCORING_CATEGORIES, NBA_PREMIUM_SCORING } from '@/lib/nba-scoring/NbaScoringCategories'
import { NCAAB_SCORING_CATEGORIES, NCAAB_PREMIUM_SCORING } from '@/lib/ncaab-scoring/NcaabScoringCategories'
import { MLB_ALL_SCORING_CATEGORIES } from '@/lib/mlb-scoring/MlbScoringCategories'
import { NHL_ALL_SCORING_CATEGORIES } from '@/lib/nhl-scoring/NhlScoringCategories'
import { SOCCER_SCORING_CATEGORIES } from '@/lib/soccer-scoring/SoccerScoringCategories'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export type ScoringLayoutRow = {
  uiKey: string
  label: string
  helper?: string
}

type ScoringLayoutTab = {
  id: string
  label: string
  rows: ScoringLayoutRow[]
}

type ScoringLayoutSpec = {
  primaryTabs: ScoringLayoutTab[]
  moreTabs?: ScoringLayoutTab[]
}

function rowsFromCategory(cat: { rows: Array<{ key: string; label: string; helper?: string }> }): ScoringLayoutRow[] {
  return cat.rows.map((r) => ({
    uiKey: r.key,
    label: r.label,
    helper: r.helper,
  }))
}

/** Split NFL/NCAAF special teams into team vs player buckets for "More" subtabs. */
function splitSpecialTeams(cat: { id: string; label: string; rows: typeof NFL_SCORING_CATEGORIES[0]['rows'] }): {
  teamDefense: ScoringLayoutTab
  teamPlayer: ScoringLayoutTab
} {
  const team: ScoringLayoutRow[] = []
  const player: ScoringLayoutRow[] = []
  for (const r of cat.rows) {
    const row = { uiKey: r.key, label: r.label, helper: r.helper }
    if (r.key.startsWith('st_player')) player.push(row)
    else team.push(row)
  }
  return {
    teamDefense: { id: 'st_defense', label: 'Special Teams Defense', rows: team },
    teamPlayer: { id: 'st_player', label: 'Special Teams Player', rows: player },
  }
}

function buildFootballLikeLayout(
  categories: typeof NFL_SCORING_CATEGORIES,
  premium: typeof NFL_PREMIUM_SCORING,
): ScoringLayoutSpec {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const passing = byId.get('passing')
  const rushing = byId.get('rushing')
  const receiving = byId.get('receiving')
  const kicking = byId.get('kicking')
  const teamDefense = byId.get('team_defense')
  const special = byId.get('special_teams')
  const misc = byId.get('misc')
  const bonus = byId.get('bonus')
  const idp = byId.get('idp')

  const primaryTabs: ScoringLayoutTab[] = []
  if (passing) primaryTabs.push({ id: 'passing', label: 'Passing', rows: rowsFromCategory(passing) })
  if (rushing) primaryTabs.push({ id: 'rushing', label: 'Rushing', rows: rowsFromCategory(rushing) })
  if (receiving) primaryTabs.push({ id: 'receiving', label: 'Receiving', rows: rowsFromCategory(receiving) })
  if (kicking) primaryTabs.push({ id: 'kicking', label: 'Kicking', rows: rowsFromCategory(kicking) })
  if (teamDefense) primaryTabs.push({ id: 'team_defense', label: 'Team Defense', rows: rowsFromCategory(teamDefense) })

  const moreTabs: ScoringLayoutTab[] = []
  if (special) {
    const { teamDefense: stDef, teamPlayer: stPl } = splitSpecialTeams(special)
    moreTabs.push(stDef, stPl)
  }
  if (misc) moreTabs.push({ id: 'misc', label: 'Misc', rows: rowsFromCategory(misc) })
  if (bonus) moreTabs.push({ id: 'bonus', label: 'Bonus', rows: rowsFromCategory(bonus) })
  if (idp) moreTabs.push({ id: 'idp', label: 'IDP', rows: rowsFromCategory(idp) })

  moreTabs.push({
    id: 'advanced',
    label: 'Advanced',
    rows: rowsFromCategory(premium),
  })

  return { primaryTabs, moreTabs }
}

function buildNbaLikeLayout(): ScoringLayoutSpec {
  const tabs: ScoringLayoutTab[] = []
  for (const c of NBA_SCORING_CATEGORIES) {
    tabs.push({ id: c.id, label: c.label, rows: rowsFromCategory(c) })
  }
  tabs.push({
    id: NBA_PREMIUM_SCORING.id,
    label: NBA_PREMIUM_SCORING.label,
    rows: rowsFromCategory(NBA_PREMIUM_SCORING),
  })
  return { primaryTabs: tabs }
}

function buildNcaabLikeLayout(): ScoringLayoutSpec {
  const tabs: ScoringLayoutTab[] = []
  for (const c of NCAAB_SCORING_CATEGORIES) {
    tabs.push({ id: c.id, label: c.label, rows: rowsFromCategory(c) })
  }
  tabs.push({
    id: NCAAB_PREMIUM_SCORING.id,
    label: NCAAB_PREMIUM_SCORING.label,
    rows: rowsFromCategory(NCAAB_PREMIUM_SCORING),
  })
  return { primaryTabs: tabs }
}

/** Group MLB categories by `group` field into primary column groups as tabs. */
function buildMlbLayout(): ScoringLayoutSpec {
  const groups = new Map<string, ScoringLayoutTab[]>()
  for (const c of MLB_ALL_SCORING_CATEGORIES) {
    const g = c.group ?? 'global'
    const tab: ScoringLayoutTab = { id: `${g}_${c.id}`, label: c.label, rows: rowsFromCategory(c) }
    const list = groups.get(g) ?? []
    list.push(tab)
    groups.set(g, list)
  }
  const order = ['hitting', 'pitching', 'global', 'premium']
  const primaryTabs: ScoringLayoutTab[] = []
  for (const g of order) {
    const list = groups.get(g)
    if (list) primaryTabs.push(...list)
  }
  for (const [g, list] of groups) {
    if (!order.includes(g)) primaryTabs.push(...list)
  }
  return { primaryTabs }
}

function buildNhlLayout(): ScoringLayoutSpec {
  const tabs: ScoringLayoutTab[] = NHL_ALL_SCORING_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    rows: rowsFromCategory(c),
  }))
  return { primaryTabs: tabs }
}

function buildSoccerLayout(): ScoringLayoutSpec {
  const tabs: ScoringLayoutTab[] = SOCCER_SCORING_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    rows: rowsFromCategory(c),
  }))
  return { primaryTabs: tabs }
}

function buildGenericSingleTab(): ScoringLayoutSpec {
  return {
    primaryTabs: [
      {
        id: 'scoring',
        label: 'Scoring',
        rows: [],
      },
    ],
  }
}

export function getScoringSettingsLayout(sportRaw: string): ScoringLayoutSpec {
  const sport = normalizeToSupportedSport(sportRaw)
  switch (sport) {
    case 'NFL':
      return buildFootballLikeLayout(NFL_SCORING_CATEGORIES, NFL_PREMIUM_SCORING)
    case 'NCAAF':
      return buildFootballLikeLayout(
        NCAAF_SCORING_CATEGORIES as unknown as typeof NFL_SCORING_CATEGORIES,
        NCAAF_PREMIUM_SCORING as unknown as typeof NFL_PREMIUM_SCORING,
      )
    case 'NBA':
      return buildNbaLikeLayout()
    case 'NCAAB':
      return buildNcaabLikeLayout()
    case 'MLB':
      return buildMlbLayout()
    case 'NHL':
      return buildNhlLayout()
    case 'SOCCER':
      return buildSoccerLayout()
    default:
      return buildGenericSingleTab()
  }
}
