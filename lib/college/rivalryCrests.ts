/**
 * College football rivalry games that wear an AllFantasy crest on their matchup card.
 *
 * The crests are our own artwork (components/brackets/playoffs/CfpBowlCrest.tsx),
 * never a school's logo or a rivalry trophy's likeness.
 *
 * ⚠ MATCHED ON EXACT TEAM NAMES, BOTH SIDES, ORDER-FREE. A substring test would
 * read "Michigan State Spartans" as Michigan, "Washington State" as Washington
 * and "Utah State" as Utah, and hang The Game's crest on the wrong game. ESPN's
 * college display names ("Ole Miss Rebels") are what the live slate carries; the
 * bare school name is accepted too for feeds that send only that.
 */
export type RivalryCrestKey =
  | "iron" | "game" | "river" | "egg" | "service" | "apple" | "holy" | "brawl"
  | "flga" | "hate" | "palmetto" | "sunshine" | "lonestar" | "territorial" | "biggame" | "coast"

export const RIVALRY_NAMES: Record<RivalryCrestKey, string> = {
  iron: "Iron Bowl",
  game: "The Game",
  river: "Red River Rivalry",
  egg: "Egg Bowl",
  service: "Army–Navy Game",
  apple: "Apple Cup",
  holy: "Holy War",
  brawl: "Backyard Brawl",
  flga: "Florida–Georgia",
  hate: "Clean, Old-Fashioned Hate",
  palmetto: "Palmetto Bowl",
  sunshine: "Sunshine Showdown",
  lonestar: "Lone Star Showdown",
  territorial: "Territorial Cup",
  biggame: "Big Game",
  coast: "Notre Dame–USC",
}

const SCHOOLS: Record<string, string[]> = {
  alabama: ["Alabama Crimson Tide", "Alabama"],
  auburn: ["Auburn Tigers", "Auburn"],
  ohioState: ["Ohio State Buckeyes", "Ohio State"],
  michigan: ["Michigan Wolverines", "Michigan"],
  texas: ["Texas Longhorns", "Texas"],
  oklahoma: ["Oklahoma Sooners", "Oklahoma"],
  oleMiss: ["Ole Miss Rebels", "Ole Miss", "Mississippi Rebels"],
  missState: ["Mississippi State Bulldogs", "Mississippi State"],
  army: ["Army Black Knights", "Army"],
  navy: ["Navy Midshipmen", "Navy"],
  washington: ["Washington Huskies", "Washington"],
  washState: ["Washington State Cougars", "Washington State"],
  byu: ["BYU Cougars", "BYU", "Brigham Young Cougars"],
  utah: ["Utah Utes", "Utah"],
  pitt: ["Pittsburgh Panthers", "Pittsburgh", "Pitt Panthers", "Pitt"],
  westVirginia: ["West Virginia Mountaineers", "West Virginia"],
  florida: ["Florida Gators", "Florida"],
  georgia: ["Georgia Bulldogs", "Georgia"],
  georgiaTech: ["Georgia Tech Yellow Jackets", "Georgia Tech"],
  clemson: ["Clemson Tigers", "Clemson"],
  southCarolina: ["South Carolina Gamecocks", "South Carolina"],
  floridaState: ["Florida State Seminoles", "Florida State"],
  texasAm: ["Texas A&M Aggies", "Texas A&M"],
  arizona: ["Arizona Wildcats", "Arizona"],
  arizonaState: ["Arizona State Sun Devils", "Arizona State"],
  cal: ["California Golden Bears", "California", "Cal Golden Bears", "Cal"],
  stanford: ["Stanford Cardinal", "Stanford"],
  notreDame: ["Notre Dame Fighting Irish", "Notre Dame"],
  usc: ["USC Trojans", "USC"],
}

const RIVALRIES: Array<[RivalryCrestKey, string, string]> = [
  ["iron", "alabama", "auburn"],
  ["game", "ohioState", "michigan"],
  ["river", "texas", "oklahoma"],
  ["egg", "oleMiss", "missState"],
  ["service", "army", "navy"],
  ["apple", "washington", "washState"],
  ["holy", "byu", "utah"],
  ["brawl", "pitt", "westVirginia"],
  ["flga", "florida", "georgia"],
  ["hate", "georgia", "georgiaTech"],
  ["palmetto", "clemson", "southCarolina"],
  ["sunshine", "florida", "floridaState"],
  ["lonestar", "texas", "texasAm"],
  ["territorial", "arizona", "arizonaState"],
  ["biggame", "cal", "stanford"],
  ["coast", "notreDame", "usc"],
]

const norm = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase()

const SCHOOL_BY_NAME = new Map<string, string>()
for (const [school, names] of Object.entries(SCHOOLS)) for (const name of names) SCHOOL_BY_NAME.set(norm(name), school)

/** The rivalry this college football game is, or null. Only NCAAF: the same schools meet in other sports. */
export function collegeRivalry(sport: string | null | undefined, teamA: string | null | undefined, teamB: string | null | undefined): RivalryCrestKey | null {
  if (sport?.toUpperCase() !== "NCAAF" || !teamA || !teamB) return null
  const a = SCHOOL_BY_NAME.get(norm(teamA))
  const b = SCHOOL_BY_NAME.get(norm(teamB))
  if (!a || !b) return null
  for (const [key, x, y] of RIVALRIES) if ((a === x && b === y) || (a === y && b === x)) return key
  return null
}
