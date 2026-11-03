/** Explicit media-only bridges reviewed against stored provider IDs, names, DOB and current club.
 * These never join statistics, confer roster eligibility, or replace a position/team.
 * A birthday match alone is NOT an identity match: many unrelated athletes share one.
 */
export const VERIFIED_MEDIA_ALIASES = [
  {
    "sport": "MLB",
    "rollingId": "377",
    "secondaryId": "tsdb_34185308",
    "dob": "1991-08-24",
    "rollingName": "Enrique Hernandez",
    "secondaryName": "Kiké Hernández"
  },
  {
    "sport": "MLB",
    "rollingId": "4740",
    "secondaryId": "tsdb_34215785",
    "dob": "2000-03-03",
    "rollingName": "Jose A. Ferrer",
    "secondaryName": "José Ferrer"
  },
  {
    "sport": "MLB",
    "rollingId": "4522",
    "secondaryId": "tsdb_34202226",
    "dob": "1997-08-07",
    "rollingName": "Josh H. Smith",
    "secondaryName": "Josh Smith"
  },
  {
    "sport": "MLB",
    "rollingId": "6161",
    "secondaryId": "tsdb_34440056",
    "dob": "2004-02-13",
    "rollingName": "Leonardo Bernal",
    "secondaryName": "Leo Bernal"
  },
  {
    "sport": "MLB",
    "rollingId": "2564",
    "secondaryId": "tsdb_34185729",
    "dob": "1994-12-07",
    "rollingName": "Peter Alonso",
    "secondaryName": "Pete Alonso"
  },
  {
    "sport": "MLB",
    "rollingId": "7801",
    "secondaryId": "tsdb_34337747",
    "dob": "1991-01-09",
    "rollingName": "Tyron Guerrero",
    "secondaryName": "Tayron Guerrero"
  },
  {
    "sport": "NBA",
    "rollingId": "1214",
    "secondaryId": "tsdb_34194075",
    "dob": "2000-12-11",
    "rollingName": "Onyeka Okongwu",
    "secondaryName": "Onyeka Okungwu"
  },
  {
    "sport": "NBA",
    "rollingId": "858",
    "secondaryId": "tsdb_34165545",
    "dob": "1997-06-10",
    "rollingName": "Sviatoslav Mykhailiuk",
    "secondaryName": "Svi Mykhailiuk"
  },
  {
    "sport": "NBA",
    "rollingId": "1651",
    "secondaryId": "tsdb_34251403",
    "dob": "2005-08-10",
    "rollingName": "Tidjane Salauen",
    "secondaryName": "Tidjane Salaün"
  },
  {
    "sport": "NHL",
    "rollingId": "2940",
    "secondaryId": "tsdb_34381700",
    "dob": "1999-05-05",
    "rollingName": "Cam Crotty",
    "secondaryName": "Cameron Crotty"
  },
  {
    "sport": "NHL",
    "rollingId": "760",
    "secondaryId": "tsdb_34186193",
    "dob": "1991-07-23",
    "rollingName": "Dmitry Orlov",
    "secondaryName": "Dmitri Orlov"
  },
  {
    "sport": "NHL",
    "rollingId": "3515",
    "secondaryId": "tsdb_34391019",
    "dob": "2001-02-02",
    "rollingName": "Emil Martinsen Lilleberg",
    "secondaryName": "Emil Lilleberg"
  },
  {
    "sport": "NHL",
    "rollingId": "3898",
    "secondaryId": "tsdb_34381598",
    "dob": "2003-04-05",
    "rollingName": "Fedor Svechkov",
    "secondaryName": "Fyodor Svechkov"
  },
  {
    "sport": "NHL",
    "rollingId": "2649",
    "secondaryId": "tsdb_34194413",
    "dob": "2000-06-06",
    "rollingName": "J.J Moser",
    "secondaryName": "Janis Moser"
  },
  {
    "sport": "NHL",
    "rollingId": "3403",
    "secondaryId": "tsdb_34434768",
    "dob": "2002-11-14",
    "rollingName": "Matthew Coronato",
    "secondaryName": "Matt Coronato"
  },
  {
    "sport": "NHL",
    "rollingId": "1038",
    "secondaryId": "tsdb_34231793",
    "dob": "1998-06-25",
    "rollingName": "Mikhail Sergachev",
    "secondaryName": "Mikhail Sergachyov"
  },
  {
    "sport": "NHL",
    "rollingId": "2969",
    "secondaryId": "tsdb_34252222",
    "dob": "2003-02-24",
    "rollingName": "Zack Bolduc",
    "secondaryName": "Zachary Bolduc"
  },
  {
    "sport": "MLB",
    "rollingId": "4142",
    "secondaryId": "tsdb_34185546",
    "dob": "1996-11-17",
    "rollingName": "Daniel Lynch",
    "secondaryName": "Daniel Lynch IV"
  },
  {
    "sport": "NHL",
    "rollingId": "2186",
    "secondaryId": "tsdb_34186151",
    "dob": "1997-01-28",
    "rollingName": "Jeffrey Viel",
    "secondaryName": "Jeffrey Truchon-Viel"
  },
  {
    "sport": "NHL",
    "rollingId": "2408",
    "secondaryId": "tsdb_34383708",
    "dob": "1999-03-31",
    "rollingName": "Jonas Rondbjerg",
    "secondaryName": "Jonas Røndbjerg"
  }
] as const

type MediaIdentity = { source: string; externalId?: string; name: string; dob?: string | null }
export function verifiedMediaAliasPeerId(sport: string, row: MediaIdentity): string | null {
  if (row.source !== 'rolling_insights' || !row.externalId || !row.dob) return null
  const entry = VERIFIED_MEDIA_ALIASES.find(a => a.sport === sport && a.rollingId === row.externalId)
  return entry && row.name === entry.rollingName && row.dob.slice(0,10) === entry.dob ? entry.secondaryId : null
}
export function verifiedMediaAliasMatches(sport: string, primary: MediaIdentity, secondary: MediaIdentity): boolean {
  const peer = verifiedMediaAliasPeerId(sport, primary)
  if (!peer || secondary.source !== 'thesportsdb' || secondary.externalId !== peer || !secondary.dob) return false
  const entry = VERIFIED_MEDIA_ALIASES.find(a => a.sport === sport && a.rollingId === primary.externalId)!
  return secondary.name === entry.secondaryName && secondary.dob.slice(0,10) === entry.dob
}
