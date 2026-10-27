import type { ZombieLeague, ZombieRulesDocument, ZombieRulesTemplate } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getLeagueMode } from '@/lib/zombie/zombieLeagueMode'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { DEFAULT_ENGINE_WEAPONS, getZombieSportConfig } from '@/lib/zombie/sportRulesConfig'
import { BASH_TRANSFER_SHARE, MAUL_TRANSFER_SHARE } from '@/lib/zombie/winningsShares'

const pct = (share: number) => `${Math.round(share * 100)}%`

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function loadTemplate(sport: string): Promise<ZombieRulesTemplate | null> {
  const s = normalizeToSupportedSport(sport)
  return prisma.zombieRulesTemplate.findUnique({ where: { sport: s } })
}

function buildSections(
  z: ZombieLeague & { name: string | null },
  tpl: ZombieRulesTemplate | null,
  freeCurrency: string,
  reviveSerums: number,
  serumAwardHighScore: boolean,
  serumAwardOnBashMaul: boolean,
  autoSerumRevive: boolean,
  ambushCountPerWeek: number,
): Omit<
  ZombieRulesDocument,
  'id' | 'generatedAt' | 'lastUpdatedAt' | 'leagueId' | 'version' | 'sport' | 'isPaid'
> {
  const mode = getLeagueMode(z)
  const sport = normalizeToSupportedSport(z.sport)
  const cfg = getZombieSportConfig(sport)
  const leagueName = z.name ?? 'Zombie League'
  const year = z.season

  // Use DB template if available, else fallback to sport config
  const pos = (tpl?.positionList?.length ? tpl.positionList : cfg.positions).join(' | ')
  const scoring = tpl?.scoringWindowDesc ?? cfg.scoringWindow
  const lock = tpl?.lineupLockDesc ?? cfg.lockRule
  const edge = tpl?.edgeCaseNotes ?? cfg.edgeCases
  const bashThresh = tpl?.bashingThreshold ?? cfg.bashingThreshold
  const maulThresh = tpl?.maulingThreshold ?? cfg.maulingThreshold
  // The numbers getZombieRulesForSport hands the engine (weaponEngine, serumEngine), so the page and the
  // engine cannot disagree.
  const weapons = cfg.engineWeapons ?? DEFAULT_ENGINE_WEAPONS
  const knifeScore = tpl?.weaponShieldThreshold ?? weapons.knifeScore
  const bowScore = tpl?.weaponAmbushThreshold ?? weapons.bowScore
  const rosterSize = tpl?.rosterSize ?? cfg.rosterSize
  const starterCount = tpl?.starterCount ?? cfg.starterCount
  const benchCount = tpl?.benchCount ?? cfg.benchCount
  const irSlots = tpl?.irSlotsDefault ?? cfg.irSlots
  const lineupFreq = tpl?.lineupFrequency ?? cfg.lineupFrequency

  const sectionOverview = [
    `AllFantasy Zombie League — ${leagueName}`,
    `Sport: ${cfg.label} | Season: ${year} | Mode: ${mode === 'paid' ? 'PAID' : 'FREE'}`,
    `${leagueName} is an asymmetrical fantasy league where one team begins as the Whisperer and everyone else begins as a Survivor.`,
    'As the season progresses, infection spreads, the Horde grows, and Survivors fight to stay alive.',
    '',
    `This league plays ${cfg.label} fantasy with ${cfg.lineupFrequency} lineup management.`,
  ].join('\n')

  const sectionInfection = [
    'INFECTION RULES',
    '- A Survivor who loses their weekly matchup to the Whisperer becomes a Zombie.',
    '- A Survivor who loses their weekly matchup to any Zombie becomes a Zombie.',
    '- A Survivor who registers a serum before weekly scoring stays human if a Zombie or Whisperer beats them (the serum is spent only if it blocks infection).',
    `- A Zombie who collects ${reviveSerums} serums can ${autoSerumRevive ? 'automatically return' : 'use @Chimmy revive to return'} as a Survivor.`,
    `- ${cfg.infectionTiming}`,
    '',
    mode === 'paid'
      ? 'PAID: An infected Survivor\'s whole week of winnings goes to the team that infected them.'
      : `FREE: An infected Survivor's whole week of ${freeCurrency} goes to the team that infected them (symbolic).`,
  ].join('\n')

  const sectionScoring = [
    `SCORING — ${cfg.label}`,
    `Scoring window: ${scoring}`,
    `Roster size: ${rosterSize} players (${starterCount} starters, ${benchCount} bench).`,
    `Lineup lock: ${lock}`,
    `Lineup frequency: ${lineupFreq}`,
    `Positions: ${pos}`,
    '',
    `Sport notes: ${edge}`,
  ].join('\n')

  const sectionBashing = [
    'BASHINGS',
    `A Bashing occurs when the winning team wins by ${bashThresh}+ points.`,
    'Bashing result: The loser receives a public "Bashed" marker for the week.',
    '',
    mode === 'paid'
      ? `PAID: The loser hands ${pct(BASH_TRANSFER_SHARE)} of their week's winnings to the winner.`
      : `FREE: The loser hands ${pct(BASH_TRANSFER_SHARE)} of their week's ${freeCurrency} to the winner (symbolic).`,
  ].join('\n')

  const sectionMauling = [
    'MAULINGS',
    `A Mauling occurs when the winning team wins by ${maulThresh}+ points.`,
    'Mauling result: The loser receives a public "Mauled" marker for the week.',
    '',
    mode === 'paid'
      ? `PAID: The loser hands ${pct(MAUL_TRANSFER_SHARE)} of their week's winnings to the winner — double a Bashing.`
      : `FREE: The loser hands ${pct(MAUL_TRANSFER_SHARE)} of their week's ${freeCurrency} to the winner — double a Bashing (symbolic).`,
  ].join('\n')

  let sectionWinnings = ''
  if (mode === 'paid') {
    sectionWinnings = [
      'WINNINGS',
      z.buyInAmount != null ? `Buy-In: $${z.buyInAmount} per team (if configured).` : 'Buy-In: commissioner-configured.',
      `Tracked pot on league: $${z.potTotal.toFixed(2)} (display; actual pot may be in paid config).`,
      'Weekly and season payout rates are commissioner-configured in Zombie paid settings.',
      z.ultimateSurvivorPot ? 'Ultimate Survivor Bonus: enabled.' : 'Ultimate Survivor Bonus: optional.',
    ].join('\n')
  } else {
    sectionWinnings = [
      'REWARDS',
      `Currency: ${freeCurrency}`,
      'Weekly Win: symbolic weekly leader recognition.',
      'Season Award: symbolic season recognition.',
      'Ultimate Bonus: optional symbolic bonus.',
      'All rewards are symbolic — no real money is involved.',
    ].join('\n')
  }

  const sectionPaidVsFree =
    mode === 'paid'
      ? [
          'This is a PAID league. Real buy-ins may apply.',
          'Please ensure all participants have paid before the season begins.',
          'Winnings are distributed by the commissioner after verification.',
        ].join('\n')
      : [
          'This is a FREE league. No real money is involved.',
          `All winnings are tracked as ${freeCurrency} — symbolic rewards only.`,
          'Gameplay mirrors paid mode for infections, items, and drama.',
        ].join('\n')

  const sectionChimmy = [
    '@CHIMMY ACTIONS',
    'You can interact with @Chimmy for timed actions, status checks, inventory, and rules questions.',
    '@Chimmy will not reveal another player\'s private information.',
    '@Chimmy can help with: status check, inventory, serum revives, and rules lookups.',
  ].join('\n')

  const sectionWeeklyTiming = [
    `WEEKLY SCHEDULE — ${cfg.label}`,
    cfg.weeklySchedule,
    `Scoring window: ${scoring}`,
    `Lineup lock: ${lock}`,
    `Challenge frequency: ${cfg.challengeFrequency}`,
    '',
    'Status changes finalize after scores are official; stat corrections may re-open a window.',
  ].join('\n')

  const sectionRoster = [
    'ROSTER',
    `Starters: ${starterCount}, Bench: ${benchCount}, IR slots: ${irSlots}`,
    `Lineup frequency: ${lineupFreq}`,
    `Positions: ${pos}`,
  ].join('\n')

  const sectionWhisperer = [
    'THE WHISPERER',
    'One team is secretly (or publicly) designated as the Whisperer at the start of the season.',
    'The Whisperer infects every Survivor it beats, and leads the Horde.',
    'Whisperers cannot trade players at any time.',
    `Selection mode: ${z.whispererSelectionMode ?? 'random'}`,
  ].join('\n')

  const sectionSurvivor = [
    'SURVIVORS',
    'Survivors begin the season as the majority. Their goal: survive.',
    'Winning matchups keeps you alive. Losing to a Zombie or Whisperer turns you.',
    'Serums bring a Zombie back. Weapons are earned by big weeks.',
    'The last Survivor(s) standing earn the Ultimate Survivor bonus (if enabled).',
  ].join('\n')

  const sectionZombie = [
    'THE HORDE (ZOMBIES)',
    `Once turned, you stay in the Horde until you collect ${reviveSerums} serums and use them.`,
    'Zombies can infect Survivors by beating them in matchups.',
    'The Horde grows each week as more Survivors fall.',
    "An infection takes the victim's whole week to the team that turned them.",
  ].join('\n')

  const sectionAmbush = [
    'AMBUSHES',
    `The Whisperer starts with ${z.whispererAmbushCount ?? 1} ambushes, at most ${ambushCountPerWeek} per week.`,
    'Before weekly scoring begins, @Chimmy ambush swap <exact Survivor team name> swaps the Whisperer\'s opponent with that Survivor. Other ambush effects are inactive.',
  ].join('\n')

  return {
    sectionOverview,
    sectionInfection,
    sectionWhisperer,
    sectionSurvivor,
    sectionZombie,
    sectionScoring,
    sectionRoster,
    sectionAmbush,
    sectionBashing,
    sectionMauling,
    sectionSerums: `Serums to revive: ${reviveSerums}. Automatic revival: ${autoSerumRevive ? 'on' : 'off'}. Weekly serum awards: ${[
      serumAwardHighScore ? 'highest score' : null,
      serumAwardOnBashMaul ? 'Bashing or Mauling winner' : null,
    ].filter(Boolean).join(', ') || 'disabled'}.`,
    sectionWeapons: [
      `Weapons are earned automatically each week: a Knife for ${knifeScore}+ points, a Bow for ${bowScore}+,`,
      `an Axe for winning by ${weapons.axeWinMargin}+, a Gun after surviving 3 Zombie attacks, and a Bomb after 5 straight wins.`,
      'A Survivor can arm one Knife, Bow, Axe, or Gun before weekly scoring. It blocks a Zombie or Whisperer infection and is spent only when it does. Bomb effects remain inactive.',
    ].join(' '),
    sectionWinnings,
    sectionUniverseMovement: 'Universe promotion/relegation follows universe commissioner settings when enabled.',
    sectionWeeklyTiming,
    sectionChimmy,
    sectionPaidVsFree,
  }
}

/**
 * Build and persist the full rules document for a zombie league (uses DB template when present).
 */
export async function generateRulesDocument(zombieLeagueId: string): Promise<ZombieRulesDocument> {
  const z = await prisma.zombieLeague.findUnique({
    where: { id: zombieLeagueId },
  })
  if (!z) throw new Error('Zombie league not found')

  const tpl = await loadTemplate(z.sport)
  const free = await prisma.zombieFreeRewardConfig.findUnique({ where: { zombieLeagueId: z.id } })
  const freeCurrency = free?.currencyLabel ?? 'Outbreak Points'

  const config = await prisma.zombieLeagueConfig.findUnique({
    where: { leagueId: z.leagueId },
    select: { serumReviveCount: true, serumAwardHighScore: true, serumAwardOnBashMaul: true, autoSerumRevive: true, ambushCountPerWeek: true },
  })
  const sections = buildSections(z, tpl, freeCurrency, config?.serumReviveCount ?? 2,
    config?.serumAwardHighScore ?? true, config?.serumAwardOnBashMaul ?? true,
    config?.autoSerumRevive ?? false, config?.ambushCountPerWeek ?? 1)
  const prev = await prisma.zombieRulesDocument.findFirst({
    where: { leagueId: z.id },
    orderBy: { version: 'desc' },
  })
  const version = (prev?.version ?? 0) + 1

  const doc = await prisma.zombieRulesDocument.create({
    data: {
      leagueId: z.id,
      sport: normalizeToSupportedSport(z.sport),
      version,
      isPaid: z.isPaid,
      ...sections,
    },
  })

  await prisma.zombieAnnouncement.create({
    data: {
      zombieLeagueId: z.id,
      universeId: z.universeId,
      type: 'commissioner_note',
      title: 'Rules document updated',
      content: `Rules doc v${version} is available for ${z.name ?? 'this league'}.`,
      week: Math.max(1, z.currentWeek || 1),
    },
  })

  await prisma.zombieAuditEntry
    .create({
      data: {
        zombieLeagueId: z.id,
        universeId: z.universeId,
        category: 'rules_doc_generated',
        action: 'RULES_DOC_GENERATED',
        description: `Generated rules document version ${version}.`,
        isPublic: true,
      },
    })
    .catch(() => {})

  return doc
}

function whispererRulesWithTradeLock(section: string): string {
  const rule = 'Whisperers cannot trade players at any time.'
  return section.includes(rule) ? section : `${section}\n${rule}`
}

export function getRulesDocAsHtml(doc: ZombieRulesDocument): string {
  const sec = (icon: string, title: string, body: string) =>
    `<section class="zombie-rules-section mb-6"><h2 class="zombie-rules-heading text-[14px] font-bold text-[var(--zombie-text-full)] mb-2"><span aria-hidden="true">${esc(icon)}</span> ${esc(title)}</h2><pre class="whitespace-pre-wrap text-[12px] leading-relaxed opacity-90">${esc(body)}</pre></section>`

  return `<article class="zombie-rules-doc max-w-3xl">
  ${doc.isPaid ? '<p class="zombie-rules-paid-badge mb-4 inline-block rounded-lg bg-amber-500/15 px-3 py-1 text-[12px] font-bold text-amber-200/90">PAID LEAGUE</p>' : '<p class="zombie-rules-threshold-badge mb-4 inline-block rounded-lg bg-sky-500/15 px-3 py-1 text-[12px] font-bold text-sky-200/80">FREE LEAGUE</p>'}
  ${sec('🧟', 'Overview', doc.sectionOverview)}
  ${sec('🩸', 'Infection', doc.sectionInfection)}
  ${sec('🎭', 'The Whisperer', whispererRulesWithTradeLock(doc.sectionWhisperer))}
  ${sec('🧍', 'Survivors', doc.sectionSurvivor)}
  ${sec('🧟', 'The Horde', doc.sectionZombie)}
  ${sec('📊', 'Scoring', doc.sectionScoring)}
  ${sec('🧾', 'Roster', doc.sectionRoster)}
  ${sec('⚡', 'Ambushes', doc.sectionAmbush)}
  ${sec('🔥', 'Bashing', doc.sectionBashing)}
  ${sec('💀', 'Mauling', doc.sectionMauling)}
  ${sec('🧪', 'Serums', doc.sectionSerums)}
  ${sec('⚔️', 'Weapons', doc.sectionWeapons)}
  ${sec('💰', 'Winnings / Rewards', doc.sectionWinnings)}
  ${sec('🌍', 'Universe', doc.sectionUniverseMovement)}
  ${sec('📅', 'Weekly Schedule', doc.sectionWeeklyTiming)}
  ${sec('🤖', '@Chimmy', doc.sectionChimmy)}
  ${sec('🪙', 'Paid vs Free', doc.sectionPaidVsFree)}
</article>`
}

export function getRulesDocAsText(doc: ZombieRulesDocument): string {
  const parts = [
    doc.sectionOverview,
    doc.sectionInfection,
    whispererRulesWithTradeLock(doc.sectionWhisperer),
    doc.sectionSurvivor,
    doc.sectionZombie,
    doc.sectionScoring,
    doc.sectionRoster,
    doc.sectionAmbush,
    doc.sectionBashing,
    doc.sectionMauling,
    doc.sectionSerums,
    doc.sectionWeapons,
    doc.sectionWinnings,
    doc.sectionUniverseMovement,
    doc.sectionWeeklyTiming,
    doc.sectionChimmy,
    doc.sectionPaidVsFree,
  ]
  return parts.join('\n\n━━━━━━━━━━━━━━━━━━━━\n\n')
}

/**
 * Commissioner / rules page: HTML from latest stored doc, or generate-on-the-fly from templates.
 */
export async function generateZombieRulesDocumentHtml(fantasyLeagueId: string, sport: string): Promise<string> {
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId: fantasyLeagueId } })
  if (!z) return ''

  const latest = await prisma.zombieRulesDocument.findFirst({
    where: { leagueId: z.id },
    orderBy: { version: 'desc' },
  })
  if (latest && latest.sectionSerums.includes('Serums to revive:')) return getRulesDocAsHtml(latest)

  const doc = await generateRulesDocument(z.id)
  return getRulesDocAsHtml(doc)
}
