/** Focused type diagnostics for the V2 implementation and its runtime seams.
 * Transitive dependencies are resolved, but this is NOT a repository-wide build gate.
 * Optional DECISION_OS_VALIDATION_PRISMA_CLIENT points to an isolated generated client.
 */
import ts from 'typescript'
import path from 'node:path'

const cwd = process.cwd()
const configFile = ts.readConfigFile(path.join(cwd, 'tsconfig.json'), ts.sys.readFile)
if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'))
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, cwd)
const seams = [
  'app/api/decision-os/manager-intelligence/route.ts',
  'server/api-route-modules/legacy/manager-dna/route.ts',
  'app/api/ai/manager-dna/route.ts',
  'app/api/mock-draft/manager-dna/route.ts',
  'app/api/v1/intelligence/manager/route.ts',
  'app/api/v1/intelligence/league/managers/route.ts',
  'app/api/v1/intelligence/league/manager-dna/route.ts',
  'app/api/user/trade-profile/route.ts',
  'lib/manager-dna.ts',
  'lib/opponent-tendencies.ts',
  'lib/trade-intel/tradeGradeEmail.ts',
  'server/api-route-modules/legacy/trade/proposal-generator/route.ts',
  'components/MockDraftSimulatorClient.tsx',
  'components/decision-os/ManagerDnaCard.tsx',
  'app/api/ai/chat/route.ts',
  'app/api/ai/trade-eval/route.ts',
  'app/api/ai/waiver/route.ts',
  '__tests__/decision-os/manager-intelligence-route-contract.test.ts',
  '__tests__/manager-dna-decision-os.test.tsx',
  '__tests__/trade-intel/tradeGradeEmail.test.ts',
  '__tests__/ai-chat-route-session-identity.test.ts',
  'app/api/decision-os/strategy/route.ts',
  'app/api/chat/chimmy/route.ts', 'components/chimmy/ChimmyStrategyCard.tsx', 'components/chimmy/ChimmyChatShell.tsx',
  'lib/shared-services/league-hub/generators/strategyRecommendations.ts',
  'lib/league-context-engine/resolvePeriod.ts',
  '__tests__/chat-chimmy-route-contract.test.ts',
  'lib/psychological-profiles/ProfileAccess.ts', 'lib/psychological-profiles/retiredProfileRoute.ts',
  'app/api/rankings/manager-psychology/route.ts', 'components/ManagerPsychology.tsx', 'components/ManagerStyleBadge.tsx',
  'lib/relationship-insights/publicView.ts', 'lib/core-app/scout.ts', 'components/core-app/screens/Scout.tsx',
  'lib/drama-engine/publicNarrative.ts', 'lib/drama-engine/DramaQueryService.ts', 'lib/drama-engine/DramaTimelineBuilder.ts',
  'lib/drama-engine/DramaEventDetector.ts', 'lib/decision-os/grounding/serialize.ts',
  'lib/league-history/leagueWarehouseReads.ts', 'lib/trade-intel/tradePsychologyLoader.ts',
  'app/api/war-room/opponent-tendencies/route.ts', 'app/api/ai/opponent-tendencies/route.ts',
  'app/api/admin/decision-os/grounding-proof/route.ts',
  'server/api-route-modules/legacy/trade/league-managers/route.ts', 'server/api-route-modules/legacy/opponent-tendencies/route.ts',
  'app/api/leagues/[leagueId]/relationship-insights/handler.ts', 'app/api/leagues/[leagueId]/rivalries/explain/route.ts',
  'app/api/leagues/[leagueId]/psychological-profiles/handler.ts',
  'app/api/leagues/[leagueId]/psychological-profiles/[profileId]/route.ts',
  'app/api/leagues/[leagueId]/psychological-profiles/[profileId]/evidence/route.ts',
  'app/api/leagues/[leagueId]/psychological-profiles/explain/route.ts',
  'app/api/leagues/[leagueId]/psychological-profiles/run/route.ts',
  'app/api/leagues/[leagueId]/psychological-profiles/run-all/route.ts',
  'components/app/settings/BehaviorProfilesPanel.tsx', 'components/app/tabs/LeagueSettingsTab.tsx',
  'app/app/league/[leagueId]/psychological-profiles/page.tsx',
  'app/app/league/[leagueId]/psychological-profiles/compare/page.tsx',
  'app/app/league/[leagueId]/psychological-profiles/[profileId]/page.tsx',
  '__tests__/decision-os/psych-explain-route.test.ts', '__tests__/core-app/scout-gate.test.ts',
  '__tests__/opponent-tendencies-api.test.ts', '__tests__/psychological-profiles/behavior-profiles-panel-honesty.test.tsx',
  'lib/decision-os/trade/canonicalMemo.ts', 'lib/decision-os/trade/enrichmentPort.ts', 'lib/decision-os/trade/tradeWorld.ts',
  'lib/decision-os/world/assemble.ts', 'lib/decision-os/world/facts.ts', 'lib/decision-os/world/port.ts',
  'lib/fantasycalc-db.ts', 'lib/player-values/ingestPlayerValues.ts',
  'lib/trade-value-console/runTradeConsoleAnalysis.ts', 'lib/trade-value-console/types.ts',
  'lib/trade-value/snapshot.ts', 'lib/trade-value/types.ts',
].map(f => path.join(cwd, f))
const modules = ts.sys.readDirectory(path.join(cwd, 'lib/decision-os/value-v2'), ['.ts'])
const tests = ts.sys.readDirectory(path.join(cwd, '__tests__/decision-os'), ['.ts', '.tsx'])
  .filter(f => /value-v2.*\.test\.tsx?$/.test(f))
const targets = [...modules, ...seams, ...tests]
const ambient = config.fileNames.filter(f => f.endsWith('.d.ts') && !f.includes('.next'))
const options = { ...config.options, incremental: false, noEmit: true }
if (process.env.DECISION_OS_VALIDATION_PRISMA_CLIENT) {
  options.paths = { ...options.paths, '@prisma/client': [path.resolve(process.env.DECISION_OS_VALIDATION_PRISMA_CLIENT)] }
}
const program = ts.createProgram({ rootNames: [...targets, ...ambient], options })
const diagnostics = [...program.getOptionsDiagnostics()]
for (const file of targets) {
  const source = program.getSourceFile(file)
  if (!source) throw new Error(`Missing validation target: ${file}`)
  diagnostics.push(...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source))
}
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => cwd, getCanonicalFileName: f => f, getNewLine: () => '\n',
  }))
  process.exitCode = 1
} else console.log(`Focused V2 typecheck passed for ${targets.length} files. Full repository release gate is separate.`)
