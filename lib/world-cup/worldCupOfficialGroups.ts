export type WorldCupOfficialGroupKey =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"

export type WorldCupOfficialGroupTeam = {
  group: WorldCupOfficialGroupKey
  name: string
  fifaCode: string
}

export const WORLD_CUP_2026_OFFICIAL_GROUPS: Record<WorldCupOfficialGroupKey, WorldCupOfficialGroupTeam[]> = {
  A: [
    { group: "A", name: "Mexico", fifaCode: "MEX" },
    { group: "A", name: "South Korea", fifaCode: "KOR" },
    { group: "A", name: "South Africa", fifaCode: "RSA" },
    { group: "A", name: "Czechia", fifaCode: "CZE" },
  ],
  B: [
    { group: "B", name: "Canada", fifaCode: "CAN" },
    { group: "B", name: "Switzerland", fifaCode: "SUI" },
    { group: "B", name: "Qatar", fifaCode: "QAT" },
    { group: "B", name: "Bosnia-Herzegovina", fifaCode: "BIH" },
  ],
  C: [
    { group: "C", name: "Brazil", fifaCode: "BRA" },
    { group: "C", name: "Morocco", fifaCode: "MAR" },
    { group: "C", name: "Scotland", fifaCode: "SCO" },
    { group: "C", name: "Haiti", fifaCode: "HAI" },
  ],
  D: [
    { group: "D", name: "USA", fifaCode: "USA" },
    { group: "D", name: "Paraguay", fifaCode: "PAR" },
    { group: "D", name: "Australia", fifaCode: "AUS" },
    { group: "D", name: "Turkiye", fifaCode: "TUR" },
  ],
  E: [
    { group: "E", name: "Germany", fifaCode: "GER" },
    { group: "E", name: "Ecuador", fifaCode: "ECU" },
    { group: "E", name: "Ivory Coast", fifaCode: "CIV" },
    { group: "E", name: "Curacao", fifaCode: "CUW" },
  ],
  F: [
    { group: "F", name: "Netherlands", fifaCode: "NED" },
    { group: "F", name: "Japan", fifaCode: "JPN" },
    { group: "F", name: "Tunisia", fifaCode: "TUN" },
    { group: "F", name: "Sweden", fifaCode: "SWE" },
  ],
  G: [
    { group: "G", name: "Belgium", fifaCode: "BEL" },
    { group: "G", name: "Iran", fifaCode: "IRN" },
    { group: "G", name: "Egypt", fifaCode: "EGY" },
    { group: "G", name: "New Zealand", fifaCode: "NZL" },
  ],
  H: [
    { group: "H", name: "Spain", fifaCode: "ESP" },
    { group: "H", name: "Uruguay", fifaCode: "URU" },
    { group: "H", name: "Saudi Arabia", fifaCode: "KSA" },
    { group: "H", name: "Cape Verde", fifaCode: "CPV" },
  ],
  I: [
    { group: "I", name: "France", fifaCode: "FRA" },
    { group: "I", name: "Senegal", fifaCode: "SEN" },
    { group: "I", name: "Norway", fifaCode: "NOR" },
    { group: "I", name: "Iraq", fifaCode: "IRQ" },
  ],
  J: [
    { group: "J", name: "Argentina", fifaCode: "ARG" },
    { group: "J", name: "Austria", fifaCode: "AUT" },
    { group: "J", name: "Algeria", fifaCode: "ALG" },
    { group: "J", name: "Jordan", fifaCode: "JOR" },
  ],
  K: [
    { group: "K", name: "Portugal", fifaCode: "POR" },
    { group: "K", name: "Colombia", fifaCode: "COL" },
    { group: "K", name: "Uzbekistan", fifaCode: "UZB" },
    { group: "K", name: "DR Congo", fifaCode: "COD" },
  ],
  L: [
    { group: "L", name: "England", fifaCode: "ENG" },
    { group: "L", name: "Croatia", fifaCode: "CRO" },
    { group: "L", name: "Panama", fifaCode: "PAN" },
    { group: "L", name: "Ghana", fifaCode: "GHA" },
  ],
}

const NAME_ALIASES: Record<string, string> = {
  "bosnia and herzegovina": "bosnia-herzegovina",
  "bosnia-herzegovina": "bosnia-herzegovina",
  "côte d'ivoire": "ivory coast",
  "cote d'ivoire": "ivory coast",
  "ivory coast": "ivory coast",
  "curaçao": "curacao",
  "curacao": "curacao",
  "cape verde": "cape verde",
  "dr congo": "dr congo",
  "democratic republic of congo": "dr congo",
  "congo dr": "dr congo",
  "korea republic": "south korea",
  "south korea": "south korea",
  "turkey": "turkiye",
  "türkiye": "turkiye",
  "turkiye": "turkiye",
  "united states": "usa",
  "united states of america": "usa",
}

function normalizeName(value?: string | null) {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  return NAME_ALIASES[normalized] ?? normalized
}

const GROUP_BY_FIFA_CODE = new Map<string, WorldCupOfficialGroupKey>()
const GROUP_BY_NAME = new Map<string, WorldCupOfficialGroupKey>()

for (const [group, teams] of Object.entries(WORLD_CUP_2026_OFFICIAL_GROUPS) as Array<[WorldCupOfficialGroupKey, WorldCupOfficialGroupTeam[]]>) {
  for (const team of teams) {
    GROUP_BY_FIFA_CODE.set(team.fifaCode, group)
    GROUP_BY_NAME.set(normalizeName(team.name), group)
  }
}

export function resolveWorldCup2026OfficialGroup(input: {
  fifaCode?: string | null
  name?: string | null
  country?: string | null
}): WorldCupOfficialGroupKey | null {
  const code = input.fifaCode?.trim().toUpperCase()
  if (code && GROUP_BY_FIFA_CODE.has(code)) return GROUP_BY_FIFA_CODE.get(code) ?? null

  const names = [input.name, input.country]
  for (const name of names) {
    const group = GROUP_BY_NAME.get(normalizeName(name))
    if (group) return group
  }

  return null
}

