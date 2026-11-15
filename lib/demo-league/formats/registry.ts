/**
 * The 14 league-format demos. Each is a GENERATED example league (see ./sample.ts): real
 * NFL players, fake teams, invented results. Nothing is read from the database.
 *
 * ⚠ RULES TEXT FOLLOWS THE CODE, NOT THE DOCS, AND STATES NO DISPUTED NUMBER. Where the code
 * disagrees with itself or with its spec (Survivor tribe count, Zombie weapon thresholds,
 * Keeper same-round conflicts, Devy slot counts) the copy describes the mechanic without the
 * number. A sample that promises a rule the product does not enforce is worse than no sample.
 * Sources: lib/league/format-engine.ts, lib/<format>/ constants and configs.
 *
 * Titles, subtitles and posters come from the create-league catalog
 * (lib/league-creation/options-catalog-seed-data.ts) so the demo and the wizard use one name.
 */
import { buildSampleBase, IDP_POOL, NFL_POOL, PROSPECT_POOL, teamNameOf, type SampleBase } from './sample'
import type { FormatDemo, FormatDemoMeta, FormatPanel, PanelItem } from './types'
import { demoRosterId, type FormatRealScreen } from './realScreens'
import { defaultSGConfig } from '@/lib/survivor-guillotine/config'

type Built = { base: SampleBase; panels: FormatPanel[]; standingsMode?: 'record' | 'points'; standingsTitle?: string; standingsNote?: string; elimination?: FormatDemo['elimination']; real?: FormatRealScreen }
type Entry = FormatDemoMeta & { build: () => Built }

const r1 = (n: number) => Math.round(n * 10) / 10

/** Chop the lowest weekly scorer among survivors, week by week. Returns chopped slots in order. */
function chopOrder(base: SampleBase, weeks: number, perWeek = 1): Array<{ week: number; slot: number; points: number; margin: number }> {
  const alive = new Set(base.teams.map((t) => t.slot))
  const out: Array<{ week: number; slot: number; points: number; margin: number }> = []
  for (let w = 1; w <= weeks; w++) {
    for (let k = 0; k < perWeek && alive.size > 1; k++) {
      const scores = base.teams.filter((t) => alive.has(t.slot)).map((t) => ({ slot: t.slot, pts: base.weekly.get(t.key)![w - 1]! })).sort((a, b) => a.pts - b.pts)
      const low = scores[0]!
      alive.delete(low.slot)
      out.push({ week: w, slot: low.slot, points: low.pts, margin: r1((scores[1]?.pts ?? low.pts) - low.pts) })
    }
  }
  return out
}

function seasonPoints(base: SampleBase, slot: number): number {
  const t = base.teams.find((x) => x.slot === slot)!
  return r1(base.weekly.get(t.key)!.reduce((a, b) => a + b, 0))
}

const ENTRIES: Entry[] = [
  {
    id: 'redraft', wizardType: 'redraft', title: 'Redraft', subtitle: 'Fresh draft every season', poster: '/images/league-types/redraft.png',
    pitch: 'The classic: draft a team, set lineups, work the waiver wire, and start over with a new draft next year.',
    rules: [
      'Head-to-head matchups every week; the top teams make the playoffs.',
      'Snake, linear or auction draft.',
      'FAAB waivers and trades all season.',
    ],
    build: () => {
      const base = buildSampleBase({ seed: 'redraft' })
      const fa = NFL_POOL.slice(-6)
      const claims: PanelItem[] = [3, 7, 1, 10].map((slot, i) => ({ slot, label: `Claimed ${fa[i]!.name} (${fa[i]!.position})`, badge: `$${[23, 11, 6, 2][i]}`, tone: 'success' }))
      return { base, panels: [{ kind: 'list', title: 'Waiver results', subtitle: 'Processed Wednesday, highest FAAB bid wins', items: claims }] }
    },
  },
  {
    id: 'keeper', wizardType: 'keeper', title: 'Keeper', subtitle: 'Hold a few, draft the rest', poster: '/league-type-keeper.png',
    pitch: 'A redraft league where every team carries a few players into next year — at the price of a draft pick.',
    rules: [
      'Each team keeps up to 3 players into next season (commissioner can change it).',
      'A keeper costs a draft pick one round earlier than where he was taken last year.',
      'Waiver pickups cost a last-round pick. Players can be kept for a limited number of years.',
    ],
    build: () => {
      const base = buildSampleBase({ seed: 'keeper' })
      const rows = base.teams.slice(0, 6).map((t, i) => {
        const p = t.roster[i % 3]!
        const drafted = [2, 5, 9, 1, 12, 7][i]!
        return { slot: t.slot, cells: ['', `${p.name} (${p.position})`, drafted === 12 ? 'Waivers' : `Round ${drafted}`, drafted === 12 ? 'Last round' : `Round ${Math.max(1, drafted - 1)}`] }
      })
      return {
        base,
        panels: [
          { kind: 'table', title: 'Keeper declarations — 2027', subtitle: 'Keepers lock before the draft order is set', columns: ['Team', 'Keeper', 'Acquired', 'Costs'], rows },
          { kind: 'callout', title: 'Keeper cost', body: 'Keeping a player gives up the pick one round earlier than he cost last year, so a 5th-rounder costs your 4th next season.', tone: 'info' },
        ],
      }
    },
  },
  {
    id: 'dynasty', wizardType: 'dynasty', title: 'Dynasty', subtitle: 'Keep your core forever', poster: '/league-type-dynasty.png',
    pitch: 'Your roster carries over every year. Draft rookies, trade future picks, and build a team that lasts.',
    rules: [
      'Rosters carry over year to year; a rookie draft runs each offseason in reverse standings order.',
      'Future draft picks can be traded up to three years out.',
      'A taxi squad stashes young players without using a roster spot.',
    ],
    build: () => {
      const base = buildSampleBase({ seed: 'dynasty', leagueType: 'dynasty', isDynasty: true })
      const owner = (s: number) => teamNameOf(base, s)
      const rows = base.teams.slice(0, 6).map((t, i) => ({
        slot: t.slot,
        cells: ['', i === 2 ? `via ${owner(9)}` : 'Own', i === 4 ? `Traded to ${owner(2)}` : 'Own', i === 1 ? '2 picks (own + via ' + owner(5) + ')' : 'Own'],
      }))
      const rookies = ['Ashton Jeanty', 'Omarion Hampton', 'Tetairoa McMillan', 'Colston Loveland', 'Tyler Warren']
      const taxi: PanelItem[] = rookies.slice(0, 4).map((n, i) => {
        const p = NFL_POOL.find((x) => x.name === n)!
        return { slot: [4, 8, 2, 11][i], label: `${p.name} (${p.position}, ${p.team})`, badge: 'Taxi', tone: 'info' }
      })
      return {
        base,
        panels: [
          { kind: 'table', title: 'Future pick board', subtitle: 'Who owns which picks', columns: ['Team', '2027 1st', '2027 2nd', '2028 1st'], rows },
          { kind: 'list', title: 'Taxi squads', subtitle: 'Rookies stashed for later', items: taxi },
        ],
      }
    },
  },
  {
    id: 'best-ball', wizardType: 'best_ball', title: 'Best Ball', subtitle: 'Set and forget', poster: '/league-type-best-ball.png',
    pitch: 'Draft and you are done. Every week your best possible lineup is set for you automatically.',
    rules: [
      'No lineup decisions: the highest-scoring legal lineup from your roster counts each week.',
      'Waivers and trades are off by default — your draft is your season.',
      'Bigger rosters, so depth matters more than in a normal league.',
    ],
    build: () => {
      const base = buildSampleBase({ seed: 'best-ball', leagueType: 'best_ball' })
      const t = base.teams[0]!
      const rng = base.rng
      const scored = t.roster.map((p) => ({ p, pts: r1(rng.int(2, 28) + rng.next()) })).sort((a, b) => b.pts - a.pts)
      const items: PanelItem[] = scored.map((x, i) => ({
        label: `${x.p.name} (${x.p.position})`,
        detail: `${x.pts} pts`,
        badge: i < 5 ? 'Counted' : 'Bench',
        tone: i < 5 ? 'success' : 'muted',
      }))
      return {
        base,
        panels: [
          { kind: 'list', title: `Week 9 auto-lineup — ${teamNameOf(base, t.slot)}`, subtitle: 'Your top scorers at each position count automatically', items },
          { kind: 'callout', title: 'Nothing to set', body: 'No start/sit decisions and no forgotten lineups: the optimizer picks your best lineup after the games are played.', tone: 'success' },
        ],
      }
    },
  },
  {
    id: 'idp', wizardType: 'idp', title: 'IDP', subtitle: 'Individual defensive players', poster: '/league-type-idp.png',
    pitch: 'Start real defenders — linemen, linebackers and defensive backs — instead of a team defense.',
    rules: [
      'Defensive lineup slots replace the team defense: DL, LB, DB and IDP flex.',
      'Tackles, sacks, interceptions and big plays all score.',
      'Works on redraft and dynasty leagues.',
    ],
    build: () => {
      const base = buildSampleBase({ seed: 'idp', extraPool: IDP_POOL, extraPerTeam: 2, rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DL', 'DL', 'LB', 'LB', 'DB', 'DB', 'IDP_FLEX'] })
      const rows = [['Sack', '4'], ['Interception', '3'], ['Forced fumble', '3'], ['Tackle for loss', '2'], ['Solo tackle', '1'], ['Assisted tackle', '0.5'], ['Defensive TD', '6']].map((c) => ({ cells: c }))
      const rng = base.rng
      const top: PanelItem[] = IDP_POOL.slice(0, 5).map((p) => ({ label: `${p.name} (${p.position}, ${p.team})`, detail: `${rng.int(2, 6)} tkl · ${rng.int(0, 2)} sack`, badge: `${r1(rng.int(9, 24) + rng.next())} pts`, tone: 'info' }))
      return {
        base,
        panels: [
          { kind: 'list', title: 'Top defenders this week', items: top },
          { kind: 'table', title: 'IDP scoring — Balanced', subtitle: 'On top of normal offensive scoring', columns: ['Stat', 'Points'], rows },
        ],
      }
    },
  },
  {
    id: 'salary-cap', wizardType: 'salary_cap', title: 'Salary Cap', subtitle: 'Budget-based rosters', poster: '/league-type-salary-cap.png',
    pitch: 'Every player has a salary and a contract. Build a winner under a hard cap — and live with your deals.',
    rules: [
      '$250 startup cap that grows 5% a year; build your team in a startup auction.',
      'Contracts run 1–4 years; rookies sign 3-year deals.',
      'Cutting a player leaves dead money on your cap. Extensions and franchise tags keep your stars.',
    ],
    build: () => {
      const base = buildSampleBase({ seed: 'salary-cap', leagueType: 'salary_cap', isDynasty: true })
      const t = base.teams[0]!
      const salaries = [62, 48, 35, 22, 14, 9, 3]
      const years = [3, 2, 4, 1, 2, 3, 1]
      const rows = t.roster.map((p, i) => ({ cells: [`${p.name} (${p.position})`, `$${salaries[i] ?? 1}`, `${years[i] ?? 1} yr`] }))
      const used = t.roster.reduce((sum, _p, i) => sum + (salaries[i] ?? 1), 0)
      const space = base.teams.slice(0, 6).map((x, i) => ({ slot: x.slot, cells: ['', `$${[used, 241, 228, 249, 212, 236][i]}`, `$${250 - [used, 241, 228, 249, 212, 236][i]!}`] }))
      // The app's cap dashboard and contracts table, for the same team and the same contracts.
      const contracts = t.roster.map((p, i) => {
        const yearsTotal = Math.max(years[i] ?? 1, 1) + (i % 2)
        return {
          id: `demo-contract-${i + 1}`, playerId: '', playerName: p.name, position: p.position,
          salary: salaries[i] ?? 1, yearsTotal, contractYear: yearsTotal - (years[i] ?? 1) + 1, yearsRemaining: years[i] ?? 1,
          status: 'active', source: i === 6 ? 'waiver' : i >= 4 ? 'rookie' : 'auction',
        }
      })
      const real: FormatRealScreen = {
        kind: 'salary-cap',
        summary: {
          config: {
            mode: 'dynasty', startupCap: 250, capGrowthPercent: 5, contractMinYears: 1, contractMaxYears: 4, rookieContractYears: 3,
            minimumSalary: 1, deadMoneyEnabled: true, deadMoneyPercentPerYear: 50, rolloverEnabled: true, rolloverMax: 10,
            capFloorEnabled: false, capFloorAmount: null, extensionsEnabled: true, franchiseTagEnabled: true,
            startupDraftType: 'auction', futureDraftType: 'snake', auctionHoldback: 0, weightedLotteryEnabled: false, offseasonPhase: null,
          },
          myRosterId: demoRosterId(t.slot),
          ledger: { rosterId: demoRosterId(t.slot), capYear: 2026, totalCapHit: used, deadMoneyHit: 0, rolloverUsed: 0, capSpace: 250 - used },
          futureProjection: [2027, 2028, 2029].map((capYear, k) => {
            const ceiling = Math.round(250 * 1.05 ** (k + 1))
            const hit = contracts.filter((c) => c.yearsRemaining > k + 1).reduce((s, c) => s + c.salary, 0)
            return { capYear, capCeiling: ceiling, totalCapHit: hit, deadMoney: 0, projectedSpace: ceiling - hit, contractCount: contracts.filter((c) => c.yearsRemaining > k + 1).length }
          }),
          contracts,
          expiringCount: contracts.filter((c) => c.yearsRemaining === 1).length,
          extensionCandidatesCount: contracts.filter((c) => c.yearsRemaining === 1).length,
          tagCandidatesCount: 1,
          deadMoneyTotal: 0,
          rookieContractCount: contracts.filter((c) => c.source === 'rookie').length,
          events: [],
          lottery: null,
          league: { name: 'Salary Cap example', sport: 'NFL', season: 2026, teamCount: base.teams.length, capYear: 2026 },
        },
      }
      return {
        base,
        real,
        panels: [
          // The contracts table is the app's own now (above); the league-wide cap space stays a panel.
          { kind: 'table', title: 'Cap space', subtitle: `${teamNameOf(base, t.slot)} has $${250 - used} of $250 left`, columns: ['Team', 'Committed', 'Space'], rows: space },
        ],
      }
    },
  },
  {
    id: 'devy', wizardType: 'devy', title: 'Devy', subtitle: 'Draft college prospects', poster: '/league-type-devy.png',
    pitch: 'A dynasty league where you also draft college players and promote them when they turn pro.',
    rules: [
      'Separate devy draft for college prospects, plus a rookie draft each year.',
      'Devy players do not score while in college; you promote them when they go pro.',
      'If a prospect returns to school, you keep his rights.',
    ],
    build: () => {
      const base = buildSampleBase({ seed: 'devy', leagueType: 'devy', isDynasty: true })
      const rows = PROSPECT_POOL.slice(0, 8).map((p, i) => ({ slot: base.teams[i % base.teams.length]!.slot, cells: ['', p.name, p.position, p.team] }))
      return {
        base,
        real: { kind: 'devy', leagueName: 'Devy example', season: 2026, dynastyYear: 3 },
        panels: [
          { kind: 'table', title: 'Devy board', subtitle: 'College prospects held by each team (sample names)', columns: ['Team', 'Prospect', 'Pos', 'School'], rows },
          { kind: 'callout', title: 'Promotion', body: 'When a prospect declares for the pros, his manager promotes him to the active roster before the rookie draft.', tone: 'info' },
        ],
      }
    },
  },
  {
    id: 'c2c', wizardType: 'c2c', title: 'C2C', subtitle: 'College to pros', poster: '/league-type-c2c.png',
    pitch: 'Campus to Canton: start a college lineup and a pro lineup every week, and both count toward your score.',
    rules: [
      'Two lineups each week: Campus (college) and Canton (NFL).',
      'By default both lineups add up to one combined score.',
      'Dynasty rules: prospects move from Campus to Canton when they turn pro.',
    ],
    build: () => {
      const base = buildSampleBase({ seed: 'c2c', leagueType: 'c2c', isDynasty: true })
      const t = base.teams[0]!
      const rng = base.rng
      const campus = PROSPECT_POOL.slice(0, 5).map((p) => ({ p, pts: r1(rng.int(4, 26) + rng.next()) }))
      const canton = t.roster.slice(0, 5).map((p) => ({ p, pts: r1(rng.int(4, 26) + rng.next()) }))
      const sum = (xs: Array<{ pts: number }>) => r1(xs.reduce((a, b) => a + b.pts, 0))
      return {
        base,
        panels: [
          {
            kind: 'groups', title: `Week 9 — ${teamNameOf(base, t.slot)}`, subtitle: `Combined score ${r1(sum(campus) + sum(canton))}`,
            groups: [
              { name: `Campus · ${sum(campus)} pts`, tone: 'warning', members: campus.map((x) => ({ label: `${x.p.name} (${x.p.position}, ${x.p.team})`, detail: `${x.pts} pts` })) },
              { name: `Canton · ${sum(canton)} pts`, tone: 'info', members: canton.map((x) => ({ label: `${x.p.name} (${x.p.position}, ${x.p.team})`, detail: `${x.pts} pts` })) },
            ],
          },
        ],
      }
    },
  },
  {
    id: 'guillotine', wizardType: 'guillotine', title: 'Guilly', subtitle: 'Lowest score is eliminated', poster: '/league-type-guillotine.png',
    pitch: 'No matchups. Every week the lowest score in the league gets chopped, and their roster hits waivers — until one team is left.',
    rules: [
      'One team is chopped each week: the lowest score league-wide.',
      'The chopped roster is released to waivers, so survivors get stronger every week.',
      'The chop waits for stat corrections before it is final.',
    ],
    build: () => {
      const base = buildSampleBase({ seed: 'guillotine', leagueType: 'guillotine', noMatchups: true })
      const chops = chopOrder(base, 9)
      const choppedSet = new Set(chops.map((c) => c.slot))
      const alive = base.teams.filter((t) => !choppedSet.has(t.slot))
      const projected = alive.map((t) => ({ slot: t.slot, pts: r1(seasonPoints(base, t.slot) / 9 + base.rng.int(-15, 15)) })).sort((a, b) => a.pts - b.pts)
      return {
        base,
        // The same facts the Chop Watch and history panels draw: chopped, and this week's bottom three.
        elimination: { eliminatedSlots: chops.map((c) => c.slot), bubbleSlots: projected.slice(0, 3).map((x) => x.slot) },
        standingsMode: 'points',
        standingsTitle: 'Season points',
        panels: [
          {
            kind: 'list', title: 'Chop Watch — week 10', subtitle: 'Projected scores; the lowest is chopped',
            items: projected.map((x, i) => ({ slot: x.slot, label: `${x.pts} projected`, badge: i === 0 ? 'Chop zone' : i < 3 ? 'Sweating' : 'Safe', tone: i === 0 ? 'danger' : i < 3 ? 'warning' : 'success' })),
          },
          {
            kind: 'timeline', title: 'Chopping Block history', subtitle: 'Roster released to waivers after each chop',
            entries: chops.map((c) => ({ when: `Week ${c.week}`, item: { slot: c.slot, label: `Chopped with ${c.points}`, detail: `${c.margin} below the blade`, tone: 'danger' } })),
          },
        ],
      }
    },
  },
  {
    id: 'survivor-guilly', wizardType: 'survivor_guillotine', title: 'Survivor Guilly', subtitle: 'Tribes, idols and weekly chops', poster: '/league-type-guillotine.png',
    pitch: 'Tribes battle for immunity. The lowest-scoring manager on a tribe without immunity is chopped — no voting — down to a Final Three.',
    rules: [
      'Tribes compete each week; the winning tribe is immune.',
      'The lowest scorer on a losing tribe is chopped automatically.',
      'Secret powers are hidden on drafted players: immunity, steals, tribe swaps and more.',
      'After the tribal phase comes a Gauntlet, then individual chops down to the Final Three.',
    ],
    build: () => {
      const base = buildSampleBase({ seed: 'survivor-guilly', teamCount: 16, leagueType: 'survivor_guillotine', noMatchups: true })
      const chops = chopOrder(base, 5)
      const out = new Set(chops.map((c) => c.slot))
      const tribes = [{ name: 'Tribe Kaimana', slots: base.teams.filter((t) => t.slot % 2 === 1) }, { name: 'Tribe Solano', slots: base.teams.filter((t) => t.slot % 2 === 0) }]
      // The app's Survivor Guilly boards (tribe race, chop line, idol vault): the same two tribes, the
      // same chops, Match Play pairs of one Kaimana member against one Solano member this period.
      const alive = (slots: typeof tribes[number]['slots']) => slots.filter((t) => !out.has(t.slot))
      const kai = alive(tribes[0]!.slots)
      const sol = alive(tribes[1]!.slots)
      const chopWeek = new Map(chops.map((c) => [c.slot, c.week]))
      const sg: FormatRealScreen = {
        kind: 'survivor-guilly',
        input: {
          season: {
            config: { ...defaultSGConfig('NFL'), teamCount: base.teams.length, tribeCount: 2 },
            tribes: base.teams.map((t) => ({ rosterId: demoRosterId(t.slot), tribeId: t.slot % 2 === 1 ? 'tribe-0' : 'tribe-1' })),
            periodState: {
              period: 6,
              matchups: kai.slice(0, Math.min(kai.length, sol.length)).map((t, i) => ({ team1: demoRosterId(t.slot), team2: demoRosterId(sol[i]!.slot) })),
              champions: [], sitOuts: [], priorSitOuts: [], ceremonyAt: null, ceremonyStarted: false,
            },
            currentPeriod: 6,
            status: 'active',
            periodHistory: {},
          },
          ownRosterId: null,
          teams: base.teams.map((t) => ({
            legacyRosterId: demoRosterId(t.slot), teamName: teamNameOf(base, t.slot), ownerName: teamNameOf(base, t.slot),
            eliminatedAt: chopWeek.has(t.slot) ? `2026-${String(9 + Math.floor(chopWeek.get(t.slot)! / 4)).padStart(2, '0')}-0${(chopWeek.get(t.slot)! % 4) + 1}T12:00:00Z` : null,
          })),
          scores: base.teams.filter((t) => !out.has(t.slot)).map((t) => ({ rosterId: demoRosterId(t.slot), totalPoints: r1((base.weekly.get(t.key)?.[5] ?? 100)), status: 'final' })),
          powers: [],
        },
      }
      return {
        base,
        real: sg,
        // Chopped so far; the at-risk tribe's survivors are this week's bubble (the Tribes panel's "At risk").
        elimination: { eliminatedSlots: [...out], bubbleSlots: tribes[0]!.slots.filter((t) => !out.has(t.slot)).map((t) => t.slot) },
        standingsMode: 'points',
        standingsTitle: 'Season points',
        // The tribes and the hidden powers are on the app's own boards above (`real`), under the
        // tribe names that screen draws; repeating them here under other names read as two leagues.
        // What the boards do not show — who was chopped with how many points — stays.
        panels: [
          { kind: 'timeline', title: 'Chop Night replay', entries: chops.map((c) => ({ when: `Week ${c.week}`, item: { slot: c.slot, label: `Chopped with ${c.points}`, tone: 'danger' } })) },
        ],
      }
    },
  },
  {
    id: 'zombie', wizardType: 'zombie', title: 'Zombie', subtitle: 'Infection-style survival', poster: '/league-type-zombie.png',
    pitch: 'One Whisperer, everyone else a Survivor. Lose to the Whisperer or a Zombie and you turn. Last Survivors standing win.',
    rules: [
      'One manager is secretly the Whisperer; everyone else starts as a Survivor.',
      'A Survivor who loses to the Whisperer or a Zombie becomes a Zombie.',
      'Big wins earn serums and weapons; two serums bring a Zombie back to life.',
      'Free agency is first come, first served — no waivers.',
    ],
    build: () => {
      const base = buildSampleBase({ seed: 'zombie', leagueType: 'zombie' })
      const whisperer = 7
      const zombies = [3, 11, 5, 9]
      const survivors = base.teams.map((t) => t.slot).filter((s) => s !== whisperer && !zombies.includes(s))
      return {
        base,
        // The app's command hero: the same counts the horde panel shows, the turned teams "chompin'".
        real: {
          kind: 'zombie', leagueName: 'Zombie example', week: 10,
          survivorCount: survivors.length, hordeCount: zombies.length, whispererCount: 1,
          chompinNames: zombies.map((slot) => teamNameOf(base, slot)),
        },
        panels: [
          {
            kind: 'groups', title: 'The horde — week 10', subtitle: `${survivors.length} Survivors left`,
            groups: [
              { name: 'Survivors', tone: 'success', members: survivors.map((slot) => ({ slot, label: 'Still human', tone: 'success' })) },
              { name: 'Zombies', tone: 'danger', members: [{ slot: whisperer, label: 'The Whisperer', badge: 'Whisperer', tone: 'danger' }, ...zombies.map((slot) => ({ slot, label: 'Turned', tone: 'danger' as const }))] },
            ],
          },
          {
            kind: 'timeline', title: 'The Outbreak Report',
            entries: zombies.map((slot, i) => ({ when: `Week ${[2, 4, 6, 8][i]}`, item: { slot, label: `Lost to ${i === 0 ? 'the Whisperer' : teamNameOf(base, zombies[i - 1]!)} and turned`, tone: 'danger' } })),
          },
          {
            kind: 'list', title: 'Your supplies',
            items: [
              { slot: survivors[0], label: 'Serum ×1', detail: 'Weekly high score', badge: 'Serum', tone: 'info' },
              { slot: survivors[1], label: 'Knife', detail: 'Earned for a big week', badge: 'Weapon', tone: 'warning' },
              { slot: survivors[2], label: 'Bow', detail: 'Earned for a bigger week', badge: 'Weapon', tone: 'warning' },
            ],
          },
        ],
      }
    },
  },
  {
    id: 'survivor', wizardType: 'survivor', title: 'Survivor', subtitle: 'Vote players off', poster: '/league-type-survivor.png',
    pitch: 'Managers are split into tribes. The lowest-scoring tribe goes to Tribal Council and votes someone out. After the merge it is every manager for themselves.',
    rules: [
      'Tribes compete; the lowest-scoring tribe attends Tribal Council and votes a member out.',
      'Hidden idols are tied to drafted players — they move with trades and claims.',
      'After the merge the top scorer each week wins immunity, and the jury forms.',
      'Voted-out managers go to Exile Island.',
    ],
    build: () => {
      const base = buildSampleBase({ seed: 'survivor', leagueType: 'survivor', noMatchups: true })
      const tribes = [
        { name: 'Tribe Ravu', slots: [1, 4, 7, 10] },
        { name: 'Tribe Moa', slots: [2, 5, 8, 11] },
        { name: 'Tribe Ika', slots: [3, 6, 9, 12] },
      ]
      const out = [{ week: 2, slot: 8, votes: '4–1' }, { week: 4, slot: 3, votes: '3–1' }, { week: 6, slot: 10, votes: '3–2' }]
      const outSet = new Set(out.map((o) => o.slot))
      return {
        base,
        // Voted out so far; Tribe Ika (heading to Tribal Council) is this week's bubble.
        elimination: { eliminatedSlots: [...outSet], bubbleSlots: tribes[2]!.slots.filter((s) => !outSet.has(s)) },
        standingsMode: 'points',
        standingsTitle: 'Season points',
        panels: [
          {
            kind: 'groups', title: 'Tribe Board — week 7', subtitle: 'Tribe Ika is heading to Tribal Council',
            groups: tribes.map((tr) => ({ name: tr.name, tone: tr.name === 'Tribe Ika' ? 'danger' : 'success', members: tr.slots.map((slot) => ({ slot, label: outSet.has(slot) ? 'On Exile Island' : 'In the game', tone: outSet.has(slot) ? 'muted' : undefined })) })),
          },
          { kind: 'timeline', title: 'Tribal Council', entries: out.map((o) => ({ when: `Week ${o.week}`, item: { slot: o.slot, label: `Voted out ${o.votes}`, tone: 'danger' } })) },
          { kind: 'callout', title: 'Idols', body: 'Two idols are hidden on drafted players. Whoever rosters that player holds the idol — and can play it at Tribal Council.', tone: 'info' },
        ],
      }
    },
  },
  {
    id: 'big-brother', wizardType: 'big_brother', title: 'Big Brother', subtitle: 'Weekly nominations', poster: '/league-type-big-brother.png',
    pitch: 'A redraft league with a Big Brother house on top: Head of Household, nominations, the Veto, eviction votes and a jury.',
    rules: [
      'Each week a Head of Household (HOH) is crowned and nominates two managers.',
      'Six managers play for the Power of Veto, which can pull a nominee off the block.',
      'The house votes to evict; the HOH only votes to break a tie.',
      'Evicted teams stop scoring; a jury of evictees picks the winner at the finale.',
    ],
    build: () => {
      // No weekly scoreboard: evicted teams stop scoring, so a full slate of week-10 matchups
      // would show evictees still playing.
      const base = buildSampleBase({ seed: 'big-brother', leagueType: 'big_brother', noMatchups: true })
      const evicted = [6, 12, 2]
      // The app's ceremony center for week 10: HOH 4 nominated 9 and 1, 7 won the Veto and saved 1,
      // 11 went up in their place — the same week the evictions panel below leads into.
      const id = demoRosterId
      const big: FormatRealScreen = {
        kind: 'big-brother',
        summary: {
          config: { sport: 'NFL', finaleFormat: 'jury_vote', juryStartMode: 'after_merge' },
          cycle: {
            id: 'demo-cycle-10', week: 10, phase: 'EVICTION_VOTE',
            hohRosterId: id(4), nominee1RosterId: id(9), nominee2RosterId: id(11),
            vetoWinnerRosterId: id(7), vetoParticipantRosterIds: [id(4), id(9), id(1), id(7), id(3), id(10)],
            vetoUsed: true, vetoSavedRosterId: id(1), replacementNomineeRosterId: id(11), evictedRosterId: null,
            voteDeadlineAt: null, voteOpenedAt: null, closedAt: null,
          },
          finalNomineeRosterIds: [id(9), id(11)],
          eligibility: null,
          jury: evicted.map((slot, i) => ({ rosterId: id(slot), evictedWeek: 7 + i })),
          finalists: [],
          ballot: null,
          myRosterId: null,
          myStatus: null,
          rosterDisplayNames: Object.fromEntries(base.teams.map((t) => [id(t.slot), teamNameOf(base, t.slot)])),
        },
      }
      return {
        base,
        real: big,
        standingsNote: 'Fantasy standings still decide the champion; evicted teams stop scoring from the week they leave the house.',
        panels: [
          { kind: 'timeline', title: 'Evictions', subtitle: 'Only the final vote totals are public', entries: evicted.map((slot, i) => ({ when: `Week ${[7, 8, 9][i]}`, item: { slot, label: `Evicted ${['6–2', '5–3', '7–0'][i]}`, tone: 'danger' } })) },
        ],
      }
    },
  },
  {
    id: 'pirate', wizardType: 'pirate', title: 'Pirate', subtitle: 'Win matchups and steal unprotected players', poster: '/images/league-types/pirate-hero.png',
    pitch: 'Win your matchup and steal one unprotected player from the team you beat.',
    rules: [
      'Before kickoff each week, protect up to 3 players.',
      'A win earns one claim: take an unprotected player from the team you beat.',
      'The winner may offer a player back; the loser can accept or counter.',
      'No claims on ties, and none in the playoffs unless the commissioner turns them on.',
    ],
    build: () => {
      const base = buildSampleBase({ seed: 'pirate', leagueType: 'pirate' })
      const t = base.teams[2]!
      const plunder: PanelItem[] = [[5, 8], [1, 12], [10, 3]].map(([w, l], i) => {
        const loser = base.teams.find((x) => x.slot === l)!
        const p = loser.roster[(4 + i) % loser.roster.length]!
        return { slot: w, label: `Plundered ${p.name} (${p.position}) from ${teamNameOf(base, l!)}`, badge: 'Claim', tone: 'warning' }
      })
      return {
        base,
        panels: [
          { kind: 'list', title: 'Recent plunder', subtitle: 'Week 9 claims', items: plunder },
          { kind: 'list', title: `Protection deck — ${teamNameOf(base, t.slot)}`, subtitle: 'Locks at first kickoff', items: t.roster.map((p, i) => ({ label: `${p.name} (${p.position})`, badge: i < 3 ? 'Protected' : 'Exposed', tone: i < 3 ? 'success' : 'danger' })) },
        ],
      }
    },
  },
]

export const FORMAT_DEMO_META: FormatDemoMeta[] = ENTRIES.map(({ build: _b, ...meta }) => meta)

const cache = new Map<string, FormatDemo>()

export function getFormatDemo(id: string): FormatDemo | null {
  const hit = cache.get(id)
  if (hit) return hit
  const entry = ENTRIES.find((e) => e.id === id)
  if (!entry) return null
  const { build, ...meta } = entry
  const built = build()
  const demo: FormatDemo = { ...meta, view: built.base.view, panels: built.panels, standingsNote: built.standingsNote, standingsMode: built.standingsMode, standingsTitle: built.standingsTitle, elimination: built.elimination, real: built.real }
  cache.set(id, demo)
  return demo
}
