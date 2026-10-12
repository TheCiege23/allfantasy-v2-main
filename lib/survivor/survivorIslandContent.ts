/**
 * Survivor + Exile “island guide” copy (Welcome to the Island, Exile Island, Token Pool,
 * optional theme examples, chat ops notes, Replit-style AI guardrails).
 * Commissioners may override prizes in league settings; example $ amounts reflect KB season docs.
 */

/** Short hero line for headers and first-entry */
export const SURVIVOR_ISLAND_TAGLINE =
  'Outwit, Outplay, Outlast — with fantasy lineups, tribes, Elimination Council, and a jury that decides who wins.'

/** Opening pitch: fantasy + Survivor hybrid */
export const SURVIVOR_WELCOME_BLURB = [
  'Yes, this is Survivor — but the beach is your fantasy league.',
  'Tribes compete each week on fantasy scoring. Challenges, rewards, Elimination Council, idols, and exile twists land all season.',
  'A jury of eliminated players helps crown Sole Survivor. How you treat people matters.',
  'Twists, advantages, and disadvantages can appear anytime. The host runs elimination formats at Tribal — stay sharp.',
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
  'You can DM the host with questions — they won’t leak secrets, but they’ll answer.',
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
  'Token Pool (pick’em): choose winners to earn tokens.',
  'A wrong pick can wipe your token stack — high risk, high reward. You can opt in or out when the format allows.',
].join(' ')

/** Exile Island — full rules summary from host docs */
export const EXILE_ISLAND_RULES = {
  headline: 'Exile Island',
  intro:
    'Voted out isn’t always the end. On Exile, you can fight to return while the main island keeps playing.',
  lineup:
    'Set a lineup aligned with your league’s sport and roster rules (positions follow your scoring settings). Each week may start from an empty roster — use FAAB or waivers to build that week’s lineup.',
  tokens:
    'Top scorer in the exile competition earns tokens. At the end of the exile arc, the token leader may return or convert tokens (e.g. into FAAB on the main island) — exact conversion is set by your commissioner.',
  bossReset:
    'If the commissioner (“Boss”) wins the exile scoring week, token totals can reset — everyone starts climbing again.',
  conduct:
    'Same conduct rules as the main island: no harassment. Secrecy matters in some formats: if the main island discovers you’re on Exile when you’re supposed to be hidden, the host may remove you — follow your league’s secrecy rule.',
} as const

/** Example prize copy — commissioner may change */
export const SURVIVOR_PRIZE_EXAMPLES =
  'Example KB season prizes: top prize and runner-up rebates were posted by the host — your AllFantasy league may use different stakes.'

/**
 * Appended to Survivor AI system prompts so Chimmy/host voice matches the product spec:
 * social deception in-game OK; no harassment; no real-money wagering in AI text.
 */
export const SURVIVOR_AI_ISLAND_VOICE = `Island voice: This is fantasy sports + Survivor social play. Encourage strategic deception, bluffing, and blindsides only as in-game social strategy — never harassment, hate, or breaking platform rules. No real-money betting language; challenges are informational props only. Remind players that deadlines and official commands matter, that “information is currency,” and that the jury/host decide real outcomes — you only narrate and advise. Supported sports in AllFantasy include NFL, NHL, NBA, MLB, NCAA Football, NCAA Basketball, and Soccer unless the league is single-sport.`
