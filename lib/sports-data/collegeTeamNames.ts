/**
 * College team names across feeds, collapsed to one comparable key.
 *
 * Rolling Insights names a school formally ("Vanderbilt University", "University of Mississippi");
 * CFBD, TheSportsDB and the logo sources use the short name ("Vanderbilt", "Ole Miss"). The aliases
 * cover names no suffix rule can reach, and are checked on the EXACT name before the loose rule —
 * which is what keeps "Miami University" (Ohio) apart from "University of Miami" (Florida).
 *
 * Pure (no I/O) on purpose: the draft-pool logo resolver and the lineup lock both key on it, and the
 * lock module must stay importable without Prisma. One crosswalk, so the two can never disagree.
 */
export function exactKey(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Rolling Insights' formal college names that no suffix rule can reach, mapped to the name the
 * logo sources use. Checked on the EXACT name, before the loose rule — which is what makes
 * "Miami University" (Ohio) safe: loosely it is "miami", which is the Florida school.
 */
export const COLLEGE_NAME_ALIASES: Record<string, string> = {
  'miami university': 'Miami (OH)',
  'united states naval academy': 'Navy',
  'united states military academy': 'Army',
  'united states air force academy': 'Air Force',
  'university of colorado boulder': 'Colorado',
  'university of north carolina at charlotte': 'Charlotte',
  'university of north carolina at chapel hill': 'North Carolina',
  'university of nebraska-lincoln': 'Nebraska',
  'university of southern mississippi': 'Southern Miss',
  'university of louisiana at monroe': 'Louisiana-Monroe',
  'university of louisiana at lafayette': 'Louisiana',
  'louisiana state university': 'LSU',
  'texas christian university': 'TCU',
  'university of central florida': 'UCF',
  'georgia institute of technology': 'Georgia Tech',
  'university of alabama at birmingham': 'UAB',
  'north carolina state university': 'NC State',
  'university of southern california': 'USC',
  'university of california, los angeles': 'UCLA',
  'university of california, berkeley': 'California',
  'university of california, davis': 'UC Davis',
  'the state university of new york at buffalo': 'Buffalo',
  'university at albany': 'UAlbany',
  'university of texas at el paso': 'UTEP',
  'university of texas at san antonio': 'UTSA',
  'university of texas at austin': 'Texas',
  'pennsylvania state university': 'Penn State',
  'university of nevada, las vegas': 'UNLV',
  'university of nevada, reno': 'Nevada',
  'university of illinois': 'Illinois',
  'university of wisconsin-madison': 'Wisconsin',
  'university of hawaii at manoa': "Hawai'i",
  'bowling green state university': 'Bowling Green',
  'middle tennessee state university': 'Middle Tennessee',
  'california state university, fresno': 'Fresno State',
  'california state university, sacramento': 'Sacramento State',
  'california polytechnic state university': 'Cal Poly',
  'brigham young university': 'BYU',
  'university of massachusetts': 'UMass',
  'university of connecticut': 'UConn',
  'university of mississippi': 'Ole Miss',
  'north carolina agricultural and technical state university': 'North Carolina A&T',
  'alabama agricultural and mechanical university': 'Alabama A&M',
  'virginia commonwealth university': 'VCU',
}

/**
 * Further spellings the LOGO resolver may try once the name above (or the raw name) has missed.
 * TheSportsDB's college-basketball rows spell schools their own way ("UNC Greensboro",
 * "Cal State-Fullerton"), so one name per school cannot serve both sports. Tried only after a miss,
 * so no team that already has a crest can be moved by an entry here. Each value is a row name read
 * off the test DB on 2026-10-01 and checked against that row's city — never a guess.
 */
export const COLLEGE_LOGO_NAME_ALIASES: Record<string, readonly string[]> = {
  'university of north carolina at greensboro': ['UNC Greensboro'],
  'university of north carolina at asheville': ['UNC Asheville'],
  'university of north carolina at wilmington': ['UNC Wilmington'],
  'university of south carolina upstate': ['USC Upstate'],
  'texas a&m university-corpus christi': ['Texas A and M-Corpus Christi'],
  'university of texas at arlington': ['Texas-Arlington'],
  'university of texas rio grande valley': ['UT Rio Grande Valley'],
  'california state university, long beach': ['Long Beach State'],
  'california state university, fullerton': ['Cal State-Fullerton'],
  'california state university, northridge': ['Cal State-Northridge'],
  'california state university, bakersfield': ['Cal State-Bakersfield'],
  'university of california, santa barbara': ['UC Santa Barbara'],
  'university of california, riverside': ['UC Riverside'],
  'university of california, irvine': ['UC Irvine'],
  // Rolling Insights' own typo, and the spelling it will have once someone fixes it.
  'university of california, san deigo': ['UC San Diego'],
  'university of california, san diego': ['UC San Diego'],
  'university of the pacific': ['Pacific'],
  'university of louisiana at lafayette': ['Louisiana-Lafayette'],
  'university of southern mississippi': ['Southern Mississippi'],
  'university of central florida': ['UCF Knights'],
  'miami university': ['Miami (Ohio)'],
  'university of tennessee at martin': ['Tennessee-Martin'],
  // Saint Francis University is the Loretto, PA school; St. Francis Brooklyn is "St. Francis College".
  'saint francis university': ['St Francis-Pennsylvania'],
  // The Division I Gaels (Moraga, CA), the only Saint Mary's College in Rolling Insights' feed.
  "saint mary's college": ['Saint Marys-California'],
  'university of detroit mercy': ['Detroit'],
  'indiana university – purdue university indianapolis': ['IUPUI'],
  'purdue university fort wayne': ['Purdue Fort Wayne'],
  'university of maryland, baltimore county': ['UMBC'],
  'university of illinois at chicago': ['UIC'],
  'university of arkansas at little rock': ['Arkansas-Little Rock'],
  'southern illinois university edwardsville': ['Southern Illinois-Edwardsville'],
  'university of missouri–kansas city': ['UMKC'],
  'loyola university chicago': ['Loyola-Chicago'],
  'loyola university maryland': ['Loyola-Maryland'],
  'new jersey institute of technology': ['NJIT'],
  // One program since the 2019 merger; TheSportsDB still files it under Brooklyn, as "LIU Sharks".
  'long island university': ['LIU Sharks'],
  'queens university of charlotte': ['Queens Royals'],
  'university of st. thomas': ['St. Thomas (Minnesota)'],
}

/**
 * Every name the logo resolver may try for a team, in order: the primary alias (or the raw name),
 * then CFBD's spelling, then the logo-only spellings. The first is what was always tried; the rest
 * are reached only on a miss, so adding to them can fill a blank badge but never change a crest.
 */
export function collegeLogoNameCandidates(team: string | null | undefined): string[] {
  const raw = String(team ?? '').trim()
  if (!raw) return []
  const k = exactKey(raw)
  const names = [COLLEGE_NAME_ALIASES[k] ?? raw, CFBD_SCHOOL_ALIASES[k], ...(COLLEGE_LOGO_NAME_ALIASES[k] ?? [])]
  return [...new Set(names.filter((n): n is string => Boolean(n)))]
}

export function looseTeamKey(value: string | null | undefined): string {
  return exactKey(value)
    .replace(/&/g, ' and ')
    .replace(/[.'’]/g, '')
    .replace(/[(),–-]/g, ' ')
    .replace(/^the /, '')
    .replace(/^university of /, '')
    .replace(/ university$/, '')
    .replace(/ college$/, '')
    .replace(/^(afc|fc|cf|ac) /, '')
    .replace(/ (afc|fc|cf|sc)$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Rolling Insights' formal names that CFBD's SCHEDULE spells differently from the logo sources.
 * Consulted before `COLLEGE_NAME_ALIASES` by `cfbdScheduleTeamKeys` — moving these into the logo
 * table would move logos. The logo resolver reaches them only AFTER its own name has missed
 * (`collegeLogoNameCandidates`), where they match CFBD's crest rows of the same spelling. Every
 * value is CFBD's own spelling, read off its 2026 schedule rows.
 */
export const CFBD_SCHOOL_ALIASES: Record<string, string> = {
  'southern methodist university': 'SMU',
  'sam houston state university': 'Sam Houston',
  'appalachian state university': 'App State',
  'university of massachusetts': 'Massachusetts',
  'university of louisiana at monroe': 'UL Monroe',
  'grambling state university': 'Grambling',
  'university of tennessee at martin': 'UT Martin',
  'southern university and a&m college': 'Southern',
  'university of the incarnate word': 'Incarnate Word',
  'mcneese state university': 'McNeese',
  'nicholls state university': 'Nicholls',
  'central connecticut state university': 'Central Connecticut',
  'austin peay state university': 'Austin Peay',
  'college of william & mary': 'William & Mary',
  'college of the holy cross': 'Holy Cross',
  'university of arkansas at pine bluff': 'Arkansas-Pine Bluff',
  'houston baptist university': 'Houston Christian',
  'tennessee technological university': 'Tennessee Tech',
  'southeastern louisiana university': 'SE Louisiana',
  'university of tennessee at chattanooga': 'Chattanooga',
  'stephen f. austin state university': 'Stephen F. Austin',
  'virginia military institute': 'VMI',
}

/** "San José State" and "San Jose State" are one school; the loose rule keeps accents. */
function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Two keys for matching a college team against CFBD's schedule: `exact` (after aliases) always
 * identifies one school; `loose` also reaches suffix variants ("Vanderbilt University" ->
 * "vanderbilt") but can collide ("Illinois" and "Illinois College" are both "illinois"). A caller
 * must try `exact` first and use `loose` only where no two schools share it.
 */
export function cfbdScheduleTeamKeys(team: string | null | undefined): { exact: string; loose: string } {
  const raw = String(team ?? '').trim()
  if (!raw) return { exact: '', loose: '' }
  const k = exactKey(raw)
  const named = CFBD_SCHOOL_ALIASES[k] ?? COLLEGE_NAME_ALIASES[k] ?? raw
  return { exact: foldAccents(exactKey(named)), loose: foldAccents(looseTeamKey(named)) }
}
