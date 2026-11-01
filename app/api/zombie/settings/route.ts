import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCommissionerOnly } from '@/lib/league/permissions'
import { generateRulesDocument } from '@/lib/zombie/rulesDocGenerator'
import { isZombieExperienceMode, zombieExperienceDefaults } from '@/lib/zombie/zombieExperience'

export const dynamic = 'force-dynamic'

const ZOMBIE_ALLOWED_TEAM_COUNTS = [8, 10, 12, 14, 16] as const
const ZOMBIE_ALLOWED_WHISPERER_SELECTION_MODES = ['random', 'veteran_priority'] as const

export async function PATCH(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : null
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  try {
    await requireCommissionerOnly(leagueId, userId)
  } catch (denied) {
    if (denied instanceof Response) return denied
    throw denied
  }

  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) return NextResponse.json({ error: 'Zombie league not found' }, { status: 404 })

  if (['status', 'currentWeek', 'universeId'].some((key) => body[key] !== undefined)) {
    return NextResponse.json({ error: 'League lifecycle and universe membership use dedicated commissioner actions.' }, { status: 400 })
  }

  const moneyAmounts = ['buyInAmount', 'commissionerFeeCap', 'totalPot', 'weeklyPayoutPool']
  const moneyRates = ['commissionerFeeRate', 'weeklyPayoutRate', 'seasonPayoutRate', 'survivorBonusRate']
  for (const key of moneyAmounts) {
    const value = body[key]
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      return NextResponse.json({ error: `${key} must be a nonnegative amount.` }, { status: 400 })
    }
  }
  for (const key of moneyRates) {
    const value = body[key]
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) {
      return NextResponse.json({ error: `${key} must be between 0 and 1.` }, { status: 400 })
    }
  }
  const nextPaid = typeof body.isPaid === 'boolean' ? body.isPaid : z.isPaid
  const nextBuyIn = typeof body.buyInAmount === 'number' ? body.buyInAmount : z.buyInAmount
  if ((body.isPaid === true || body.buyInAmount !== undefined) && nextPaid && (!nextBuyIn || nextBuyIn <= 0)) {
    return NextResponse.json({ error: 'Paid Zombie leagues require a buy-in greater than zero.' }, { status: 400 })
  }
  if (body.commissionerUiPrefs !== undefined) {
    const prefs = body.commissionerUiPrefs
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
      return NextResponse.json({ error: 'Invalid commissioner preferences.' }, { status: 400 })
    }
    for (const key of ['leaguesafeUrl', 'fancredUrl']) {
      const value = (prefs as Record<string, unknown>)[key]
      if (value === undefined || value === '') continue
      if (typeof value !== 'string' || value.length > 500) {
        return NextResponse.json({ error: `${key} must be a valid HTTPS URL.` }, { status: 400 })
      }
      try {
        if (new URL(value).protocol !== 'https:') throw new Error('Insecure URL')
      } catch {
        return NextResponse.json({ error: `${key} must be a valid HTTPS URL.` }, { status: 400 })
      }
    }
  }

  if (String(z.sport ?? '').toUpperCase() === 'NFL' && (
    (body.serumReviveCount !== undefined && body.serumReviveCount !== 2) || body.autoSerumRevive === false ||
    body.serumAwardHighScore === false || body.serumAwardOnBashMaul === false ||
    body.serumUseBeforeLastStarter === false || body.weaponTopTwoActive === false || body.bombOneTimeOverride === false ||
    body.weaponScoreThresholds !== undefined
  )) return NextResponse.json({ error: 'The 2025 NFL rules require automatic two-serum revival, last-starter timing and fixed weapon bonuses.' }, { status: 400 })

  if (body.zombieTradeBlocked === false) {
    return NextResponse.json({ error: 'The 2025 Zombie rules prohibit Zombie trades.' }, { status: 400 })
  }

  const competitiveKeys = [
    'experienceMode', 'whispererCount', 'whispererSelectionMode', 'whispererSelection',
    'whispererAmbushCount', 'ambushCountPerWeek', 'ambushRemapMatchup',
    'infectionLossToWhisperer', 'infectionLossToZombie', 'serumReviveCount',
    'autoSerumRevive', 'serumAwardHighScore', 'serumAwardOnBashMaul',
    'serumUseBeforeLastStarter', 'weaponScoreThresholds', 'weaponTopTwoActive',
    'bombOneTimeOverride', 'zombieTradeBlocked', 'noWaiverFreeAgency',
  ]
  if (!['setup', 'registering'].includes(z.status) && competitiveKeys.some((key) => body[key] !== undefined)) {
    return NextResponse.json({ error: 'Competitive Zombie rules are locked for this season.' }, { status: 409 })
  }

  const num = (k: string) => (typeof body[k] === 'number' ? (body[k] as number) : undefined)
  const bool = (k: string) => (typeof body[k] === 'boolean' ? (body[k] as boolean) : undefined)
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : undefined)

  const experienceModePatch = str('experienceMode')
  if (experienceModePatch !== undefined && !isZombieExperienceMode(experienceModePatch)) {
    return NextResponse.json({ error: 'experienceMode must be simple or enhanced.' }, { status: 400 })
  }
  if (experienceModePatch !== undefined && !['setup', 'registering'].includes(z.status)) {
    return NextResponse.json({ error: 'Experience mode is locked once the season starts.' }, { status: 409 })
  }

  const whispererCountPatch = num('whispererCount')
  if (whispererCountPatch !== undefined &&
      (whispererCountPatch !== 1 && whispererCountPatch !== 2 ||
       whispererCountPatch === 2 && (!['NBA', 'NHL', 'MLB'].includes(String(z.sport ?? '').toUpperCase()) || (experienceModePatch ?? z.experienceMode) === 'simple'))) {
    return NextResponse.json({ error: 'Two Whisperers require Enhanced NBA, NHL, or MLB.' }, { status: 400 })
  }
  if (experienceModePatch === 'simple' && z.whispererCount === 2 && whispererCountPatch !== 1) {
    return NextResponse.json({ error: 'Set Whisperer count to one before choosing Simple Zombie.' }, { status: 400 })
  }

  const teamCountPatch = num('teamCount')
  if (
    teamCountPatch !== undefined &&
    !(ZOMBIE_ALLOWED_TEAM_COUNTS as readonly number[]).includes(teamCountPatch)
  ) {
    return NextResponse.json(
      { error: `teamCount must be one of ${ZOMBIE_ALLOWED_TEAM_COUNTS.join(', ')}` },
      { status: 400 },
    )
  }

  const weeklyUpdateDayPatch = num('weeklyUpdateDay')
  if (
    weeklyUpdateDayPatch !== undefined &&
    (!Number.isInteger(weeklyUpdateDayPatch) || weeklyUpdateDayPatch < 0 || weeklyUpdateDayPatch > 6)
  ) {
    return NextResponse.json({ error: 'weeklyUpdateDay must be an integer between 0 and 6.' }, { status: 400 })
  }

  const weeklyUpdateHourPatch = num('weeklyUpdateHour')
  if (
    weeklyUpdateHourPatch !== undefined &&
    (!Number.isInteger(weeklyUpdateHourPatch) || weeklyUpdateHourPatch < 0 || weeklyUpdateHourPatch > 23)
  ) {
    return NextResponse.json({ error: 'weeklyUpdateHour must be an integer between 0 and 23.' }, { status: 400 })
  }

  const whispererSelectionModePatch = str('whispererSelectionMode')
  if (
    whispererSelectionModePatch !== undefined &&
    !(ZOMBIE_ALLOWED_WHISPERER_SELECTION_MODES as readonly string[]).includes(whispererSelectionModePatch)
  ) {
    return NextResponse.json(
      {
        error: `whispererSelectionMode must be one of ${ZOMBIE_ALLOWED_WHISPERER_SELECTION_MODES.join(', ')}`,
      },
      { status: 400 },
    )
  }

  const configSelectionPatch = str('whispererSelection')
  if (
    configSelectionPatch !== undefined &&
    !(ZOMBIE_ALLOWED_WHISPERER_SELECTION_MODES as readonly string[]).includes(configSelectionPatch)
  ) {
    return NextResponse.json({ error: 'Unsupported Whisperer selection mode.' }, { status: 400 })
  }
  if (
    configSelectionPatch !== undefined &&
    whispererSelectionModePatch !== undefined &&
    configSelectionPatch !== whispererSelectionModePatch
  ) {
    return NextResponse.json({ error: 'Whisperer selection fields must match.' }, { status: 400 })
  }

  const seasonAmbushPatch = num('whispererAmbushCount')
  const weeklyAmbushPatch = num('ambushCountPerWeek')
  if (seasonAmbushPatch !== undefined && (!Number.isInteger(seasonAmbushPatch) || seasonAmbushPatch < 0 || seasonAmbushPatch > 20)) {
    return NextResponse.json({ error: 'whispererAmbushCount must be an integer between 0 and 20.' }, { status: 400 })
  }
  if (weeklyAmbushPatch !== undefined && (!Number.isInteger(weeklyAmbushPatch) || weeklyAmbushPatch < 0 || weeklyAmbushPatch > 5)) {
    return NextResponse.json({ error: 'ambushCountPerWeek must be an integer between 0 and 5.' }, { status: 400 })
  }
  const currentAmbushConfig = await prisma.zombieLeagueConfig.findUnique({
    where: { leagueId }, select: { ambushCountPerWeek: true },
  })
  if ((seasonAmbushPatch !== undefined || weeklyAmbushPatch !== undefined) &&
      (seasonAmbushPatch ?? z.whispererAmbushCount) < (weeklyAmbushPatch ?? currentAmbushConfig?.ambushCountPerWeek ?? 1)) {
    return NextResponse.json({ error: 'Weekly ambush cap cannot exceed season ambushes.' }, { status: 400 })
  }

  const requestedSelection = whispererSelectionModePatch ?? configSelectionPatch
  if (requestedSelection !== undefined || seasonAmbushPatch !== undefined || weeklyAmbushPatch !== undefined || experienceModePatch !== undefined || whispererCountPatch !== undefined) {
    const selected = await prisma.whispererRecord.findUnique({
      where: { zombieLeagueId: z.id },
      select: { id: true },
    })
    if (selected || !['setup', 'registering'].includes(z.status)) {
      return NextResponse.json(
        { error: 'Whisperer and ambush settings are locked once the draft assigns the role.' },
        { status: 409 },
      )
    }
  }

  const serumReviveCountPatch = num('serumReviveCount')
  if (serumReviveCountPatch !== undefined && (!Number.isInteger(serumReviveCountPatch) || serumReviveCountPatch < 1 || serumReviveCountPatch > 5)) {
    return NextResponse.json({ error: 'serumReviveCount must be an integer between 1 and 5.' }, { status: 400 })
  }

  const leaguePatch = {
    ...(str('name') !== undefined ? { name: str('name') } : {}),
    ...(teamCountPatch !== undefined ? { teamCount: teamCountPatch } : {}),
    ...(experienceModePatch !== undefined ? { experienceMode: experienceModePatch } : {}),
    ...(whispererCountPatch !== undefined ? { whispererCount: whispererCountPatch } : {}),
    ...(num('buyInAmount') !== undefined ? { buyInAmount: num('buyInAmount') } : {}),
    ...(bool('isPaid') !== undefined ? { isPaid: bool('isPaid') } : {}),
    ...(str('namingMode') !== undefined ? { namingMode: str('namingMode') } : {}),
    ...(requestedSelection !== undefined
      ? { whispererSelectionMode: requestedSelection }
      : {}),
    ...(bool('whispererIsPublic') !== undefined ? { whispererIsPublic: bool('whispererIsPublic') } : {}),
    ...(seasonAmbushPatch !== undefined ? { whispererAmbushCount: seasonAmbushPatch } : {}),
    ...(experienceModePatch === 'simple' ? { whispererAmbushCount: 0 } : {}),
    ...(experienceModePatch === 'enhanced' && z.experienceMode === 'simple' && seasonAmbushPatch === undefined
      ? { whispererAmbushCount: 3 } : {}),
    ...(bool('weeklyPayoutEnabled') !== undefined ? { weeklyPayoutEnabled: bool('weeklyPayoutEnabled') } : {}),
    ...(bool('ultimateSurvivorPot') !== undefined ? { ultimateSurvivorPot: bool('ultimateSurvivorPot') } : {}),
    ...(weeklyUpdateDayPatch !== undefined ? { weeklyUpdateDay: weeklyUpdateDayPatch } : {}),
    ...(weeklyUpdateHourPatch !== undefined ? { weeklyUpdateHour: weeklyUpdateHourPatch } : {}),
    ...(bool('weeklyUpdateAutoPost') !== undefined ? { weeklyUpdateAutoPost: bool('weeklyUpdateAutoPost') } : {}),
    ...(bool('weeklyUpdateApproval') !== undefined ? { weeklyUpdateApproval: bool('weeklyUpdateApproval') } : {}),
    ...(bool('updateIncludeProjections') !== undefined
      ? { updateIncludeProjections: bool('updateIncludeProjections') }
      : {}),
    ...(bool('updateIncludeMoney') !== undefined ? { updateIncludeMoney: bool('updateIncludeMoney') } : {}),
    ...(bool('updateIncludeInventory') !== undefined ? { updateIncludeInventory: bool('updateIncludeInventory') } : {}),
    ...(bool('updateIncludeUniverse') !== undefined ? { updateIncludeUniverse: bool('updateIncludeUniverse') } : {}),
    ...(bool('updateIncludeDanger') !== undefined ? { updateIncludeDanger: bool('updateIncludeDanger') } : {}),
  }

  let row = await prisma.zombieLeague.update({
    where: { id: z.id },
    data: leaguePatch,
  })

  if (body.commissionerUiPrefs && typeof body.commissionerUiPrefs === 'object' && !Array.isArray(body.commissionerUiPrefs)) {
    const cur =
      z.commissionerUiPrefs && typeof z.commissionerUiPrefs === 'object' && !Array.isArray(z.commissionerUiPrefs)
        ? (z.commissionerUiPrefs as Record<string, unknown>)
        : {}
    const next = { ...cur, ...(body.commissionerUiPrefs as Record<string, unknown>) }
    row = await prisma.zombieLeague.update({
      where: { id: z.id },
      data: { commissionerUiPrefs: next as object },
    })
  }

  const configPatch = {
    ...(requestedSelection !== undefined ? { whispererSelection: requestedSelection } : {}),
    ...(bool('infectionLossToWhisperer') !== undefined
      ? { infectionLossToWhisperer: bool('infectionLossToWhisperer') }
      : {}),
    ...(bool('infectionLossToZombie') !== undefined ? { infectionLossToZombie: bool('infectionLossToZombie') } : {}),
    ...(serumReviveCountPatch !== undefined ? { serumReviveCount: serumReviveCountPatch } : {}),
    ...(bool('autoSerumRevive') !== undefined ? { autoSerumRevive: bool('autoSerumRevive') } : {}),
    ...(bool('serumAwardHighScore') !== undefined ? { serumAwardHighScore: bool('serumAwardHighScore') } : {}),
    ...(bool('serumAwardOnBashMaul') !== undefined ? { serumAwardOnBashMaul: bool('serumAwardOnBashMaul') } : {}),
    ...(bool('serumUseBeforeLastStarter') !== undefined
      ? { serumUseBeforeLastStarter: bool('serumUseBeforeLastStarter') }
      : {}),
    ...(body.weaponScoreThresholds && typeof body.weaponScoreThresholds === 'object'
      ? { weaponScoreThresholds: body.weaponScoreThresholds }
      : {}),
    ...(bool('weaponTopTwoActive') !== undefined ? { weaponTopTwoActive: bool('weaponTopTwoActive') } : {}),
    ...(bool('bombOneTimeOverride') !== undefined ? { bombOneTimeOverride: bool('bombOneTimeOverride') } : {}),
    ...(weeklyAmbushPatch !== undefined ? { ambushCountPerWeek: weeklyAmbushPatch } : {}),
    ...(bool('ambushRemapMatchup') !== undefined ? { ambushRemapMatchup: bool('ambushRemapMatchup') } : {}),
    ...(bool('noWaiverFreeAgency') !== undefined ? { noWaiverFreeAgency: bool('noWaiverFreeAgency') } : {}),
    ...(bool('statCorrectionReversal') !== undefined ? { statCorrectionReversal: bool('statCorrectionReversal') } : {}),
    ...(body.zombieTradeBlocked !== undefined ? { zombieTradeBlocked: true } : {}),
    ...(num('dangerousDropThreshold') !== undefined ? { dangerousDropThreshold: num('dangerousDropThreshold') } : {}),
    ...(experienceModePatch !== undefined ? zombieExperienceDefaults(experienceModePatch) : {}),
  }

  let config = null
  if (Object.keys(configPatch).length > 0) {
    config = await prisma.zombieLeagueConfig.upsert({
      where: { leagueId },
      create: { leagueId, ...configPatch },
      update: configPatch,
    })
  } else {
    config = await prisma.zombieLeagueConfig.findUnique({ where: { leagueId } })
  }

  const paidPatch = {
    ...(num('buyInAmount') !== undefined ? { buyInAmount: num('buyInAmount') } : {}),
    ...(num('commissionerFeeRate') !== undefined ? { commissionerFeeRate: num('commissionerFeeRate') } : {}),
    ...(num('commissionerFeeCap') !== undefined ? { commissionerFeeCap: num('commissionerFeeCap') } : {}),
    ...(num('totalPot') !== undefined ? { totalPot: num('totalPot') } : {}),
    ...(num('weeklyPayoutPool') !== undefined ? { weeklyPayoutPool: num('weeklyPayoutPool') } : {}),
    ...(num('weeklyPayoutRate') !== undefined ? { weeklyPayoutRate: num('weeklyPayoutRate') } : {}),
    ...(num('seasonPayoutRate') !== undefined ? { seasonPayoutRate: num('seasonPayoutRate') } : {}),
    ...(num('survivorBonusRate') !== undefined ? { survivorBonusRate: num('survivorBonusRate') } : {}),
    ...(bool('ultimateSurvivorEnabled') !== undefined
      ? { ultimateSurvivorEnabled: bool('ultimateSurvivorEnabled') }
      : {}),
    ...(bool('potIsLocked') !== undefined ? { potIsLocked: bool('potIsLocked') } : {}),
  }

  let paidConfig = null
  if (Object.keys(paidPatch).length > 0) {
    paidConfig = await prisma.zombiePaidConfig.upsert({
      where: { zombieLeagueId: z.id },
      create: {
        zombieLeagueId: z.id,
        buyInAmount: num('buyInAmount') ?? z.buyInAmount ?? 0,
        paidUserIds: [],
        ...paidPatch,
      },
      update: paidPatch,
    })
  } else {
    paidConfig = await prisma.zombiePaidConfig.findUnique({ where: { zombieLeagueId: z.id } })
  }

  const freePatch = {
    ...(str('currencyLabel') !== undefined ? { currencyLabel: str('currencyLabel') } : {}),
    ...(str('weeklyWinLabel') !== undefined ? { weeklyWinLabel: str('weeklyWinLabel') } : {}),
    ...(str('seasonWinLabel') !== undefined ? { seasonWinLabel: str('seasonWinLabel') } : {}),
    ...(str('ultimatePotLabel') !== undefined ? { ultimatePotLabel: str('ultimatePotLabel') } : {}),
    ...(bool('badgesEnabled') !== undefined ? { badgesEnabled: bool('badgesEnabled') } : {}),
    ...(bool('achievementsEnabled') !== undefined ? { achievementsEnabled: bool('achievementsEnabled') } : {}),
  }

  let freeRewardConfig = null
  if (Object.keys(freePatch).length > 0) {
    freeRewardConfig = await prisma.zombieFreeRewardConfig.upsert({
      where: { zombieLeagueId: z.id },
      create: { zombieLeagueId: z.id, ...freePatch },
      update: freePatch,
    })
  } else {
    freeRewardConfig = await prisma.zombieFreeRewardConfig.findUnique({ where: { zombieLeagueId: z.id } })
  }

  if (serumReviveCountPatch !== undefined || bool('autoSerumRevive') !== undefined ||
      bool('serumAwardHighScore') !== undefined || bool('serumAwardOnBashMaul') !== undefined ||
      seasonAmbushPatch !== undefined || weeklyAmbushPatch !== undefined || experienceModePatch !== undefined) {
    await generateRulesDocument(z.id)
  }

  return NextResponse.json({ zombieLeague: row, config, paidConfig, freeRewardConfig })
}
