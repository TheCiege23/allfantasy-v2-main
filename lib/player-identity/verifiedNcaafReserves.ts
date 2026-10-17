/** Reviewed source-ID proofs, not a fuzzy name resolver.
 * Fantrax IDs/names/roles were supplied in the user's 12 roster CSVs (466 players).
 * Historical CFBD IDs were verified using provider search, season rosters and official biographies.
 * Identity persists across seasons; availability is explicitly limited to 2026.
 * See docs/readiness/ncaaf-reserve-identity-proofs-2026-10-06.md.
 */
export type NcaafReserveAvailability = 'college_inactive' | 'prospect' | 'needs_verification'
export type VerifiedNcaafReserve = {
 fantraxId: string; name: string; position: string; cfbdId: string | null; cfbdName: string | null;
 historicalSchool: string | null; season: number; availability: NcaafReserveAvailability;
 reason: string; evidenceUrl: string; verifiedAt: string
}
export const VERIFIED_NCAAF_RESERVES: readonly VerifiedNcaafReserve[] = [
  {
    "fantraxId": "05khp",
    "name": "E.J. Smith",
    "position": "RB",
    "cfbdId": "4430825",
    "cfbdName": "EJ Smith",
    "historicalSchool": "Texas A&M",
    "season": 2026,
    "availability": "college_inactive",
    "reason": "Signed as an NFL rookie in 2026.",
    "evidenceUrl": "https://www.chiefs.com/news/breaking-down-the-chiefs-2026-undrafted-free-agent-class-",
    "verifiedAt": "2026-10-06"
  },
  {
    "fantraxId": "05zra",
    "name": "Antonio Gates",
    "position": "WR",
    "cfbdId": "4685359",
    "cfbdName": "Antonio Gates Jr.",
    "historicalSchool": "Michigan State",
    "season": 2026,
    "availability": "needs_verification",
    "reason": "Historical Michigan State WR identity; no verified 2026 scoring roster.",
    "evidenceUrl": "https://msuspartans.com/sports/football/roster/antonio-gates-jr/13017",
    "verifiedAt": "2026-10-06"
  },
  {
    "fantraxId": "04zh9",
    "name": "Donavon Greene",
    "position": "WR",
    "cfbdId": "4567033",
    "cfbdName": "Donavon Greene",
    "historicalSchool": "Virginia Tech",
    "season": 2026,
    "availability": "needs_verification",
    "reason": "2025 Virginia Tech WR; absent from the 2026 CFBD FBS roster.",
    "evidenceUrl": "https://hokiesports.com/news/2025/08/23/virginia-tech-football-position-preview-wide-receivers-2025",
    "verifiedAt": "2026-10-06"
  },
  {
    "fantraxId": "05ny7",
    "name": "Bryson Barnes",
    "position": "QB",
    "cfbdId": "4695600",
    "cfbdName": "Bryson Barnes",
    "historicalSchool": "Utah State",
    "season": 2026,
    "availability": "college_inactive",
    "reason": "Official 2026 Pro Day identifies Barnes as a former Aggie; conflicts with the provider roster.",
    "evidenceUrl": "https://utahstateaggies.com/news/2026/3/18/utah-state-football-holds-annual-pro-day.aspx",
    "verifiedAt": "2026-10-06"
  },
  {
    "fantraxId": "04zjh",
    "name": "Jacob Clark",
    "position": "QB",
    "cfbdId": "4569535",
    "cfbdName": "Jacob Clark",
    "historicalSchool": "Missouri State",
    "season": 2026,
    "availability": "college_inactive",
    "reason": "Signed as an NFL rookie in 2026.",
    "evidenceUrl": "https://www.raiders.com/news/raiders-sign-17-undrafted-free-agents-2026-nfl-transactions",
    "verifiedAt": "2026-10-06"
  },
  {
    "fantraxId": "05mu0",
    "name": "Kentrel Bullock",
    "position": "RB",
    "cfbdId": "4430992",
    "cfbdName": "Kentrel Bullock",
    "historicalSchool": "South Alabama",
    "season": 2026,
    "availability": "college_inactive",
    "reason": "Signed as an NFL rookie in 2026.",
    "evidenceUrl": "https://www.bengals.com/news/five-draft-picks-college-free-agents-signed-2026-transactions",
    "verifiedAt": "2026-10-06"
  },
  {
    "fantraxId": "069b6",
    "name": "Jeffery Pittman",
    "position": "RB",
    "cfbdId": "5152209",
    "cfbdName": "Jeffery Pittman",
    "historicalSchool": "Southern Miss",
    "season": 2026,
    "availability": "needs_verification",
    "reason": "Historical Southern Miss RB; absent from the 2026 CFBD FBS roster.",
    "evidenceUrl": "https://southernmiss.com/sports/football/roster/jeffery-pittman/10172",
    "verifiedAt": "2026-10-06"
  },
  {
    "fantraxId": "05lol",
    "name": "Malik Sherrod",
    "position": "RB",
    "cfbdId": "4607267",
    "cfbdName": "Malik Sherrod",
    "historicalSchool": "Boise State",
    "season": 2026,
    "availability": "needs_verification",
    "reason": "2025 sixth-year RB listed for 2026 Pro Day; current scoring eligibility not independently verified.",
    "evidenceUrl": "https://broncosports.com/news/2026/2/19/football-boise-state-announces-pro-day-date",
    "verifiedAt": "2026-10-06"
  },
  {
    "fantraxId": "05w3m",
    "name": "Landon Sims",
    "position": "RB",
    "cfbdId": "4875791",
    "cfbdName": "Landon Sims",
    "historicalSchool": "Hawai'i",
    "season": 2026,
    "availability": "college_inactive",
    "reason": "Official 2026 Pro Day identifies Sims among former Hawaii players.",
    "evidenceUrl": "https://hawaiiathletics.com/story.aspx?file_date=3%2F19%2F2026&filename=football-pro-day-spotlight-rainbow-warriors-take-the-stage-in-sacramento",
    "verifiedAt": "2026-10-06"
  },
  {
    "fantraxId": "05jvj",
    "name": "Kenny Tracy",
    "position": "RB",
    "cfbdId": "4431432",
    "cfbdName": "Kenny Tracy",
    "historicalSchool": "Miami (OH)",
    "season": 2026,
    "availability": "needs_verification",
    "reason": "2025 sixth-year RB with a season-ending injury; absent from the 2026 CFBD FBS roster.",
    "evidenceUrl": "https://miamiredhawks.com/sports/football/roster/kenny-tracy/10405",
    "verifiedAt": "2026-10-06"
  },
  {
    "fantraxId": "05zuk",
    "name": "Camden Brown",
    "position": "WR",
    "cfbdId": "4808759",
    "cfbdName": "Camden Brown",
    "historicalSchool": "Georgia Southern",
    "season": 2026,
    "availability": "college_inactive",
    "reason": "Official 2026 release identifies Brown as a former Eagle signed by Dallas.",
    "evidenceUrl": "https://gseagles.com/news/2026/7/29/football-six-former-eagle-players-report-to-nfl-camps",
    "verifiedAt": "2026-10-06"
  },
  {
    "fantraxId": "05owb",
    "name": "Joey Hobert",
    "position": "WR",
    "cfbdId": "4432267",
    "cfbdName": "Joey Hobert",
    "historicalSchool": "Texas State",
    "season": 2026,
    "availability": "college_inactive",
    "reason": "Listed as a wide receivers assistant on the 2026 coaching staff.",
    "evidenceUrl": "https://txst.com/sports/football/coaches",
    "verifiedAt": "2026-10-06"
  },
  {
    "fantraxId": "05m2h",
    "name": "Trayvon Rudolph",
    "position": "WR",
    "cfbdId": "4433906",
    "cfbdName": "Trayvon Rudolph",
    "historicalSchool": "Toledo",
    "season": 2026,
    "availability": "college_inactive",
    "reason": "Signed as an NFL rookie in 2026.",
    "evidenceUrl": "https://www.vikings.com/news/michael-briscoe-trayvon-rudolph-wide-receivers-signed-roster-moves",
    "verifiedAt": "2026-10-06"
  },
  {
    "fantraxId": "077wg",
    "name": "Ryder Lyons",
    "position": "QB",
    "cfbdId": null,
    "cfbdName": null,
    "historicalSchool": null,
    "season": 2026,
    "availability": "prospect",
    "reason": "Verified BYU recruit; no CFBD athlete id or current scoring roster record.",
    "evidenceUrl": "https://byucougars.com/ryder-lyons-2026-byu-football-recruiting-class",
    "verifiedAt": "2026-10-06"
  }
]

/** Only used for imported Fantrax roster IDs. Historical identity does not authorize a zero. */
export function ncaafReserveAvailability(fantraxId: string, season: number): VerifiedNcaafReserve | undefined {
 return VERIFIED_NCAAF_RESERVES.find(p => p.fantraxId === fantraxId && p.season === season)
}
