/**
 * Survivor + Exile “island guide” copy (Welcome to the Island, Exile Island, Token Pool,
 * optional theme examples, chat ops notes, Replit-style AI guardrails).
 * Commissioners may override prizes in league settings; example $ amounts reflect KB season docs.
 */

/** Short hero line for headers and first-entry */
export const SURVIVOR_ISLAND_TAGLINE =
  'Build your roster, win weekly challenges, survive the vote, and earn the jury’s support.'

/** Opening pitch: fantasy + Survivor hybrid */
export const SURVIVOR_WELCOME_BLURB = [
  'Yes, this is Survivor — but the beach is your fantasy league.',
  'Tribes compete each week on fantasy scoring. Challenges, rewards, Elimination Council, idols, and exile twists land all season.',
  'A jury of eliminated players helps crown the league champion. How you treat people matters.',
  'Twists and advantages can appear during the season. Chimmy runs the Elimination Council and publishes the Torch Ceremony.',
].join(' ')

/**
 * Default island copy is tribe-count first — the season headline (Heroes vs Villains, Rooks vs Vets, etc.)
 * is set by the commissioner, not assumed here.
 */
export const SURVIVOR_TRIBE_THEME_CONTEXT = [
  'This format uses 2–4 tribes (set in Survivor settings). Your commissioner names the season theme and tribes.',
  'Some leagues run “Rooks vs Vets” or “Heroes vs Villains” — those are flavor, not a required default.',
  'Tribes form after the draft (random or commissioner pattern). Then it’s tribe chat, side chats, and alliances until merge.',
].join(' ')

export const SURVIVOR_TIPS = [
  'This may be the most active league you’re in — tribe chat, side chats, and DMs all matter.',
  'Early votes often target the least active; don’t go quiet.',
  'The game is always on — guard your information.',
  'Jury remembers how you played; social skills can beat raw fantasy knowledge.',
  'Ask Chimmy about rules and deadlines. Private ballots and hidden idols remain sealed until their scheduled reveal.',
  'Information is currency. Spend it carefully.',
] as const

/** Conduct & comms (from Welcome + chat pins) */
export const SURVIVOR_CONDUCT_BULLETS = [
  'Compete hard: blindsides and backstabs are part of the game — personal attacks, hate speech, and harassment are not.',
  'Screenshots and creative strategy are allowed; sharing screenshots of private DMs with the host (including votes) is not, unless the host tells you to.',
  'Co-managers may be disallowed — follow your league’s rules.',
  'After you’re voted out, main public chat is for active players; eliminated players use private chats or jury rules as your host defines.',
  'Spectator / “ghost” viewers may be allowed by the host — they must not tip active players.',
] as const

/** Survivor “pool” (conference / pick-em style) — informational */
export const SURVIVOR_POOL_RULES = [
  'Some seasons run a Survivor-style pick pool (e.g. pick a winner from a chosen conference each week).',
  'Wrong picks may cost advantages; many formats allow a limited number of “revives” before you’re locked out — your commissioner sets the exact rules.',
].join(' ')

/** Token Pool (parallel path for eliminated players) */
export const SURVIVOR_TOKEN_POOL_BLURB = [
  'Exiled managers earn tokens from verified results for their separate weekly roster.',
  'At the configured return deadline, one manager with the highest qualifying token balance returns to the main island.',
].join(' ')

/** Exile Island — full rules summary from host docs */
export const EXILE_ISLAND_RULES = {
  headline: 'Exile Island',
  intro:
    'Voted out isn’t always the end. On Exile, you can fight to return while the main island keeps playing.',
  lineup:
    'Each week starts with an empty Exile roster. Claim an NFL quarterback, NBA point guard, NHL goalie, or MLB pitcher to reserve that real-world team, then claim only that team’s players. All players return to waivers after the week.',
  tokens:
    'Verified weekly Exile scoring awards tokens. At the configured deadline, the highest balance meeting the minimum takes the single return spot.',
  bossReset:
    'Chimmy tracks the contest and awards the return spot automatically. The commissioner can adjust public league rules without seeing private ballots or hidden idols when playing.',
  conduct:
    'Same conduct rules as the main island: no harassment. Exile rosters and token results follow the published league rules.',
} as const

/** Example prize copy — commissioner may change */
export const SURVIVOR_PRIZE_EXAMPLES =
  'Example KB season prizes: top prize and runner-up rebates were posted by the host — your AllFantasy league may use different stakes.'

/**
 * Appended to Survivor AI system prompts so Chimmy/host voice matches the product spec:
 * social deception in-game OK; no harassment; no real-money wagering in AI text.
 */
export const SURVIVOR_AI_ISLAND_VOICE = `Island voice: This is fantasy sports + Survivor social play. Encourage strategic deception, bluffing, and blindsides only as in-game social strategy — never harassment, hate, or breaking platform rules. No real-money betting language; challenges are informational props only. Remind players that deadlines and official commands matter, that “information is currency,” and that the jury/host decide real outcomes — you only narrate and advise. Supported sports in AllFantasy include NFL, NHL, NBA, MLB, NCAA Football, NCAA Basketball, and Soccer unless the league is single-sport.`
