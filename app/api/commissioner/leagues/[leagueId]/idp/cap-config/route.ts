/**
 * GET / PUT the IDP salary-cap configuration for a league. Commissioner only.
 *
 * 🛑 THIS IS THE WRITER THE CAP SYSTEM NEVER HAD.
 *
 * `IDPCapConfig` had FIFTEEN read sites across capEngine, idpCapChimmy and three cap routes,
 * and ZERO creates or upserts anywhere in the repo. Every one of those readers starts with
 * `findUnique` and either throws "No IDP cap configuration for this league" or returns an empty
 * shape. So the entire cap and contract stack — salaries, dead money, franchise tags,
 * extensions, cap projections, the /idp/cap and /idp/contracts pages — was unreachable by
 * construction: not broken, just impossible to turn on. Measured 2026-08-30, all fourteen
 * cap/contract tables held 0 rows in production.
 *
 * ⚠ IT LIVES UNDER /commissioner BECAUSE A CAP IS A LEAGUE RULE. The sibling IDP settings
 * routes (scoring-overrides, apply-scoring-preset, audit) are commissioner-gated for the same
 * reason, and `assertCommissioner` is the gate they all use. A league member must not be able
 * to move the cap.
 *
 * ⚠ SEASON IS DELIBERATELY NOT SETTABLE HERE. `expireContractsForNewSeason` rolls it, and a
 * commissioner editing it by hand mid-season would silently re-date every active contract's
 * eligibility window. It is returned so the UI can display it, and ignored on write.
 *
 * 🛑 BUT IT IS SET ON CREATE, FROM THE LEAGUE, BECAUSE THE SCHEMA DEFAULT IS STALE AND WRONG.
 * `IDPCapConfig.season` defaults to 2025. Both KBFL leagues are season 2026, so a config
 * created today started a year behind — and that is not cosmetic:
 *
 *   app/api/idp/cap/route.ts   `const defaultSeason = cfg?.season ?? new Date().getFullYear()`
 *
 * The `?? currentYear` fallback only fires when there is NO config, so the moment one exists the
 * whole cap API adopts its season. `isSalaryActiveInSeason` then gates on
 * `contractStartYear <= season <= contractEndYear`, so EVERY 2026 CONTRACT WOULD BE INVISIBLE
 * and a team carrying a full roster of salaries would report zero cap used. Taking the season
 * from the league at create time is the difference between a cap that works and one that
 * silently reports nothing.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { isIdpLeague } from '@/lib/idp'
import { writeIdpSettingsAudit } from '@/lib/idp/IdpSettingsAudit'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const DRAFT_METHODS = ['auction', 'snake_scale', 'hybrid'] as const
const CURVES = ['linear', 'logarithmic', 'stepped'] as const

type Body = Partial<{
  totalCap: number
  isHardCap: boolean
  capFloorEnabled: boolean
  capFloor: number | null
  capRolloverEnabled: boolean
  inSeasonHoldbackEnabled: boolean
  inSeasonHoldbackPct: number
  franchiseTagEnabled: boolean
  franchiseTagValue: number
  draftSalaryMethod: string
  snakeScaleHighSalary: number
  snakeScaleLowSalary: number
  snakeScaleCurve: string
  auctionDefaultContractYears: number
  snakeTopPickContractYears: number
  snakeMidPickContractYears: number
  snakeLatePickContractYears: number
  isDynastyMode: boolean
  contractsCarryOver: boolean
}>

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

/**
 * Rejects rather than clamps. A commissioner who types 250% for a cap floor has made a mistake
 * worth telling them about; silently storing 1.0 would apply a rule they never chose to every
 * team in the league.
 */
function validate(b: Body): string[] {
  const errs: string[] = []
  const pos = (k: keyof Body, label: string) => {
    const v = b[k]
    if (v !== undefined && (!isNum(v) || v <= 0)) errs.push(`${label} must be a number greater than 0`)
  }
  const pct = (k: keyof Body, label: string) => {
    const v = b[k]
    if (v !== undefined && v !== null && (!isNum(v) || v < 0 || v > 1)) {
      errs.push(`${label} must be between 0 and 1 (a fraction, not a percentage)`)
    }
  }
  const years = (k: keyof Body, label: string) => {
    const v = b[k]
    if (v !== undefined && (!isNum(v) || !Number.isInteger(v) || v < 1 || v > 10)) {
      errs.push(`${label} must be a whole number of years between 1 and 10`)
    }
  }
  for (const [k, label] of [
    ['totalCap', 'Total cap'],
    ['franchiseTagValue', 'Franchise tag value'],
    ['snakeScaleHighSalary', 'Snake scale high salary'],
    ['snakeScaleLowSalary', 'Snake scale low salary'],
  ] as const) pos(k, label)
  pct('capFloor', 'Cap floor')
  pct('inSeasonHoldbackPct', 'In-season holdback')
  for (const [k, label] of [
    ['auctionDefaultContractYears', 'Auction contract years'],
    ['snakeTopPickContractYears', 'Snake top-pick contract years'],
    ['snakeMidPickContractYears', 'Snake mid-pick contract years'],
    ['snakeLatePickContractYears', 'Snake late-pick contract years'],
  ] as const) years(k, label)

  if (b.draftSalaryMethod !== undefined && !DRAFT_METHODS.includes(b.draftSalaryMethod as never)) {
    errs.push(`Draft salary method must be one of: ${DRAFT_METHODS.join(', ')}`)
  }
  if (b.snakeScaleCurve !== undefined && !CURVES.includes(b.snakeScaleCurve as never)) {
    errs.push(`Snake scale curve must be one of: ${CURVES.join(', ')}`)
  }
  for (const k of [
    'isHardCap', 'capFloorEnabled', 'capRolloverEnabled', 'inSeasonHoldbackEnabled',
    'franchiseTagEnabled', 'isDynastyMode', 'contractsCarryOver',
  ] as const) {
    if (b[k] !== undefined && !isBool(b[k])) errs.push(`${k} must be true or false`)
  }

  /*
   * ⚠ CROSS-FIELD, AND THE ONE THAT ACTUALLY BITES. calculateSnakeScaleSalary interpolates
   * between high and low across the pick range; inverted, it hands the first overall pick the
   * cheapest contract in the draft and nothing downstream would flag it.
   */
  if (isNum(b.snakeScaleHighSalary) && isNum(b.snakeScaleLowSalary) && b.snakeScaleHighSalary < b.snakeScaleLowSalary) {
    errs.push('Snake scale high salary must be greater than or equal to the low salary')
  }
  if (b.capFloorEnabled === true && b.capFloor == null) {
    errs.push('Cap floor is enabled but no floor was supplied')
  }
  if (isNum(b.franchiseTagValue) && isNum(b.totalCap) && b.franchiseTagValue > b.totalCap) {
    errs.push('Franchise tag value cannot exceed the total cap')
  }
  return errs
}

async function gate(leagueId: string) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  if (!(await isIdpLeague(leagueId))) {
    return { error: NextResponse.json({ error: 'Not an IDP league' }, { status: 404 }) }
  }
  return { userId }
}

export async function GET(_req: Request, { params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  const g = await gate(leagueId)
  if ('error' in g) return g.error

  const config = await prisma.iDPCapConfig.findUnique({ where: { leagueId } })
  /*
   * `configured: false` rather than a 404. The distinction the UI needs is "this league has no
   * cap yet" versus "something went wrong", and the cap stack's own readers already treat a
   * missing row as the former.
   */
  return NextResponse.json({ leagueId, configured: Boolean(config), config: config ?? null })
}

export async function PUT(req: Request, { params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  const g = await gate(leagueId)
  if ('error' in g) return g.error

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const errors = validate(body)
  if (errors.length) return NextResponse.json({ error: 'Invalid cap settings', errors }, { status: 400 })

  const before = await prisma.iDPCapConfig.findUnique({ where: { leagueId } })

  // Only fields the caller actually sent; everything else keeps its stored or schema default.
  const data: Record<string, unknown> = {}
  for (const k of [
    'totalCap', 'isHardCap', 'capFloorEnabled', 'capFloor', 'capRolloverEnabled',
    'inSeasonHoldbackEnabled', 'inSeasonHoldbackPct', 'franchiseTagEnabled', 'franchiseTagValue',
    'draftSalaryMethod', 'snakeScaleHighSalary', 'snakeScaleLowSalary', 'snakeScaleCurve',
    'auctionDefaultContractYears', 'snakeTopPickContractYears', 'snakeMidPickContractYears',
    'snakeLatePickContractYears', 'isDynastyMode', 'contractsCarryOver',
  ] as const) {
    if (body[k] !== undefined) data[k] = body[k]
  }
  // Disabling the floor clears the value, so a re-enable cannot silently reuse an old number.
  if (body.capFloorEnabled === false) data.capFloor = null

  /*
   * Season comes from the league on CREATE only — never on update, per the rule above. A league
   * with no season falls back to the current year rather than the schema's 2025.
   */
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } })
  const seasonOnCreate = Number(league?.season) || new Date().getUTCFullYear()

  const config = await prisma.iDPCapConfig.upsert({
    where: { leagueId },
    create: { leagueId, season: seasonOnCreate, ...data },
    update: data,
  })

  await writeIdpSettingsAudit({
    leagueId,
    configId: config.id,
    actorId: g.userId,
    action: 'cap_config_change',
    before: before ?? null,
    after: config,
    metadata: { created: !before },
  }).catch(() => {
    /* An audit failure must not lose the commissioner's setting. */
  })

  return NextResponse.json({ ok: true, created: !before, config })
}
