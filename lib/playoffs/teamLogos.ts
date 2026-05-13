/**
 * lib/playoffs/teamLogos.ts
 *
 * ESPN CDN logo URL builder for NBA and NHL teams.
 * Maps common team nicknames (as stored in PlayoffBracketSeries) to ESPN abbreviations.
 *
 * URL pattern: https://a.espncdn.com/i/teamlogos/{sport}/500/{abbr}.png
 * Domain is already whitelisted in next.config.js remotePatterns.
 */

export type PlayoffLogoSport = "nba" | "nhl"

/** NBA nickname → ESPN abbreviation (30 teams) */
const NBA_ABBR: Record<string, string> = {
  Hawks: "atl",
  Celtics: "bos",
  Nets: "bkn",
  Hornets: "cha",
  Bulls: "chi",
  Cavaliers: "cle",
  Mavericks: "dal",
  Nuggets: "den",
  Pistons: "det",
  Warriors: "gs",
  Rockets: "hou",
  Pacers: "ind",
  Clippers: "lac",
  Lakers: "lal",
  Grizzlies: "mem",
  Heat: "mia",
  Bucks: "mil",
  Timberwolves: "min",
  Pelicans: "no",
  Knicks: "ny",
  Thunder: "okc",
  Magic: "orl",
  "76ers": "phi",
  Suns: "phx",
  "Trail Blazers": "por",
  Kings: "sac",
  Spurs: "sa",
  Raptors: "tor",
  Jazz: "utah",
  Wizards: "wsh",
}

/** NHL nickname → ESPN abbreviation (32 teams, including Utah Mammoth) */
const NHL_ABBR: Record<string, string> = {
  Ducks: "ana",
  Coyotes: "ari",
  Bruins: "bos",
  Sabres: "buf",
  Flames: "cgy",
  Hurricanes: "car",
  Blackhawks: "chi",
  Avalanche: "col",
  "Blue Jackets": "cbj",
  Stars: "dal",
  "Red Wings": "det",
  Oilers: "edm",
  Panthers: "fla",
  Kings: "la",
  Wild: "min",
  Canadiens: "mtl",
  Predators: "nsh",
  Devils: "nj",
  Islanders: "nyi",
  Rangers: "nyr",
  Senators: "ott",
  Flyers: "phi",
  Penguins: "pit",
  Sharks: "sjs",
  Kraken: "sea",
  Blues: "stl",
  Lightning: "tb",
  "Maple Leafs": "tor",
  "Utah HC": "utah",
  Mammoth: "utah",
  Canucks: "van",
  "Golden Knights": "vgk",
  Jets: "wpg",
  Capitals: "wsh",
}

/**
 * Returns the ESPN CDN logo URL for a team, or null if the nickname is unknown.
 *
 * @param nickname  The team nickname as stored in PlayoffBracketSeries (e.g. "Celtics", "Oilers")
 * @param sport     "nba" or "nhl"
 */
export function getTeamLogoUrl(nickname: string, sport: PlayoffLogoSport): string | null {
  const map = sport === "nba" ? NBA_ABBR : NHL_ABBR

  // Direct match
  if (map[nickname]) {
    return `https://a.espncdn.com/i/teamlogos/${sport}/500/${map[nickname]}.png`
  }

  // Try extracting the last word (e.g. "Oklahoma City Thunder" → "Thunder")
  const lastWord = nickname.split(" ").pop() ?? ""
  if (lastWord && map[lastWord]) {
    return `https://a.espncdn.com/i/teamlogos/${sport}/500/${map[lastWord]}.png`
  }

  return null
}

/**
 * Returns the 1-2 letter initials to use in the logo fallback circle.
 * Uses the last 1-2 words of the team nickname.
 */
export function getTeamInitials(nickname: string): string {
  const words = nickname.trim().split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  // "Trail Blazers" → "TB", "76ers" → "76", "Maple Leafs" → "ML"
  return (words[words.length - 2][0] + words[words.length - 1][0]).toUpperCase()
}
