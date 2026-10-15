import type { ZombieLeague, ZombieRulesDocument, ZombieRulesTemplate } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getLeagueMode } from '@/lib/zombie/zombieLeagueMode'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getZombieSportConfig } from '@/lib/zombie/sportRulesConfig'
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
    '- Infection is permanent unless a Serum Antidote is used.',
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
    'Mauling result: Double loot transfer where enabled; mauling animation triggers.',
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
    '@Chimmy can help with: status check, item use, ambush targets, serum timing, and rules lookups.',
  ].join('\n')

  const sectionWeeklyTiming = [
    `WEEKLY SCHEDULE — ${cfg.label}`,
    cfg.weeklySchedule,
    `Scoring window: ${scoring}`,
    `Whisperer ambushes must respect lock rules: ${lock}`,
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
    'The Whisperer commands the Horde and can deploy ambushes to remap matchups.',
    'If the Whisperer is voted out or eliminated, a new Whisperer rises from the Horde.',
    `Ambush count per week: ${z.whispererAmbushCount ?? 1}`,
    `Selection mode: ${z.whispererSelectionMode ?? 'random'}`,
  ].join('\n')

  const sectionSurvivor = [
    'SURVIVORS',
    'Survivors begin the season as the majority. Their goal: survive.',
    'Winning matchups keeps you alive. Losing to a Zombie or Whisperer turns you.',
    'Serums can reverse infection. Weapons provide score advantages.',
    'The last Survivor(s) standing earn the Ultimate Survivor bonus (if enabled).',
  ].join('\n')

  const sectionZombie = [
    'THE HORDE (ZOMBIES)',
    'Once turned, you join the Horde permanently (unless a Serum is used).',
    'Zombies can infect Survivors by beating them in matchups.',
    'The Horde grows each week as more Survivors fall.',
    'Zombies earn rewards for successful infections and may earn winnings based on commissioner settings.',
  ].join('\n')

  const sectionAmbush = [
    'AMBUSHES',
    'The Whisperer can deploy ambushes to remap matchups strategically.',
    `Ambush count per week: ${z.whispererAmbushCount ?? 1}`,
    'Ambush types: remap (swap matchup pairings), boost (bonus to Horde team), sabotage (debuff to Survivor).',
    'Ambushes must be set before lineup lock for the affected players.',
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
    sectionSerums:
      tpl?.serumAwardDesc ??
      `Serum awards: ${
        cfg.serumAwards.length > 0
          ? cfg.serumAwards.map((a) => a.label).join(', ')
          : 'no default awards configured'
      }. Commissioner can configure additional award triggers.`,
    sectionWeapons: 'Weapons follow score thresholds and commissioner toggles. Top 2 scorers each week may earn weapons.',
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

  const sections = buildSections(z, tpl, freeCurrency)
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

export function getRulesDocAsHtml(doc: ZombieRulesDocument): string {
  const sec = (title: string, body: string) =>
    `<section class="zombie-rules-section mb-6"><h2 class="zombie-rules-heading text-[14px] font-bold text-[var(--zombie-text-full)] mb-2">${esc(title)}</h2><pre class="whitespace-pre-wrap text-[12px] leading-relaxed opacity-90">${esc(body)}</pre></section>`

  return `<article class="zombie-rules-doc max-w-3xl">
  ${doc.isPaid ? '<p class="zombie-rules-paid-badge mb-4 inline-block rounded-lg bg-amber-500/15 px-3 py-1 text-[12px] font-bold text-amber-200/90">PAID LEAGUE</p>' : '<p class="zombie-rules-threshold-badge mb-4 inline-block rounded-lg bg-sky-500/15 px-3 py-1 text-[12px] font-bold text-sky-200/80">FREE LEAGUE</p>'}
  ${sec('Overview', doc.sectionOverview)}
  ${sec('Infection', doc.sectionInfection)}
  ${sec('The Whisperer', doc.sectionWhisperer)}
  ${sec('Survivors', doc.sectionSurvivor)}
  ${sec('The Horde', doc.sectionZombie)}
  ${sec('Scoring', doc.sectionScoring)}
  ${sec('Roster', doc.sectionRoster)}
  ${sec('Ambushes', doc.sectionAmbush)}
  ${sec('Bashing', doc.sectionBashing)}
  ${sec('Mauling', doc.sectionMauling)}
  ${sec('Serums', doc.sectionSerums)}
  ${sec('Weapons', doc.sectionWeapons)}
  ${sec('Winnings / Rewards', doc.sectionWinnings)}
  ${sec('Universe', doc.sectionUniverseMovement)}
  ${sec('Weekly Schedule', doc.sectionWeeklyTiming)}
  ${sec('@Chimmy', doc.sectionChimmy)}
  ${sec('Paid vs Free', doc.sectionPaidVsFree)}
</article>`
}

export function getRulesDocAsText(doc: ZombieRulesDocument): string {
  const parts = [
    doc.sectionOverview,
    doc.sectionInfection,
    doc.sectionWhisperer,
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
  if (latest) return getRulesDocAsHtml(latest)

  const doc = await generateRulesDocument(z.id)
  return getRulesDocAsHtml(doc)
}
