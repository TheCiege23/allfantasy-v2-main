const fs = require('fs')
const path = require('path')

const repoRoot = process.cwd()
const appRoot = path.join(repoRoot, 'app')
const vercelConfigPath = path.join(repoRoot, 'vercel.json')
const cronSchedulePath = path.join(repoRoot, 'cron-schedule.json')
const buildScriptPath = path.join(repoRoot, 'scripts', 'vercel-next-build.cjs')

const GREEN_LIMIT = 1900
const YELLOW_LIMIT = 2020

const WORLD_CUP_CHAT_ROUTE = 'app/api/brackets/world-cup/[challengeId]/chat/route.ts'
const OLD_WORLD_CUP_CHAT_FEATURE_ROUTES = [
  'app/api/brackets/world-cup/[challengeId]/chat/gifs/route.ts',
  'app/api/brackets/world-cup/[challengeId]/chat/upload-image/route.ts',
  'app/api/brackets/world-cup/[challengeId]/notification-preferences/route.ts',
  'app/api/brackets/world-cup/[challengeId]/chat/[messageId]/poll-vote/route.ts',
]

function toPosix(value) {
  return value.replace(/\\/g, '/')
}

function pathExists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath))
}

function walkFiles(rootPath, shouldSkipDir = () => false) {
  if (!fs.existsSync(rootPath)) return []
  const files = []
  const stack = [rootPath]

  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!shouldSkipDir(absolute, entry.name)) stack.push(absolute)
        continue
      }
      files.push(absolute)
    }
  }

  return files
}

function isRouteFile(relativePath) {
  return /\/route\.(ts|tsx|js|jsx)$/.test(relativePath)
}

function isPageFile(relativePath) {
  return /\/page\.(ts|tsx|js|jsx)$/.test(relativePath)
}

function isLayoutFile(relativePath) {
  return /\/layout\.(ts|tsx|js|jsx)$/.test(relativePath)
}

function routeUrlFromFile(relativePath) {
  return `/${relativePath
    .replace(/^app\//, '')
    .replace(/\/(route|page)\.(ts|tsx|js|jsx)$/, '')
    .replace(/\/index$/, '')}`.replace(/\/$/, '') || '/'
}

function folderKey(relativePath, depth = 3) {
  const parts = relativePath.split('/')
  const fileName = parts.pop()
  if (fileName && ['route.ts', 'route.tsx', 'route.js', 'route.jsx', 'page.tsx', 'page.ts', 'page.js', 'page.jsx'].includes(fileName)) {
    return parts.slice(0, depth).join('/') || '.'
  }
  return parts.slice(0, depth).join('/') || '.'
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0
}

function detectGeneratedFolders() {
  return fs.readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name === '.next-build-disabled-routes' || /^\.next-build-fix/.test(name))
    .map((name) => {
      const absolute = path.join(repoRoot, name)
      const files = walkFiles(absolute)
      return { name, files: files.length }
    })
}

function buildScriptExclusions() {
  if (!fs.existsSync(buildScriptPath)) return []
  const source = fs.readFileSync(buildScriptPath, 'utf8')
  const matches = source.match(/path\.join\(([^)]+)\)/g) || []
  return matches
    .map((match) => match
      .replace(/^path\.join\(/, '')
      .replace(/\)$/, '')
      .split(',')
      .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
      .join('/'))
    .filter((value) => value.startsWith('app/'))
}

/** Count actual route files inside each excluded directory path. */
function countRoutesInExcludedDirs(exclusionPaths) {
  let total = 0
  for (const relPath of exclusionPaths) {
    const abs = path.join(repoRoot, relPath)
    if (!fs.existsSync(abs)) continue
    const stat = fs.statSync(abs)
    if (stat.isDirectory()) {
      total += walkFiles(abs).filter((f) => {
        const posix = toPosix(path.relative(repoRoot, f))
        return isRouteFile(posix) || isPageFile(posix)
      }).length
    } else {
      const posix = toPosix(relPath)
      if (isRouteFile(posix) || isPageFile(posix)) total += 1
    }
  }
  return total
}

/**
 * Count how many "kept" files from filesToKeep live inside an excluded dir.
 * These files are moved back before the build, so they do count in production.
 */
function countKeptFilesInExcludedDirs(exclusionPaths, keptRelPaths) {
  return keptRelPaths.filter((keptRel) => {
    const keptPosix = toPosix(keptRel)
    return exclusionPaths.some((excl) => keptPosix.startsWith(toPosix(excl) + '/') || keptPosix === toPosix(excl))
  }).length
}

function buildScriptKeptFiles() {
  if (!fs.existsSync(buildScriptPath)) return []
  const source = fs.readFileSync(buildScriptPath, 'utf8')
  const keptBlockMatch = source.match(/const filesToKeep = new Set\(\[([\s\S]*?)\]\)/)
  if (!keptBlockMatch) return []
  const block = keptBlockMatch[1]
  const joinMatches = block.match(/path\.join\(([^)]+)\)/g) || []
  return joinMatches.map((match) =>
    match
      .replace(/^path\.join\(/, '')
      .replace(/\)$/, '')
      .split(',')
      .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
      .join('/')
  )
}

function suspiciousRouteReason(relativePath) {
  const route = routeUrlFromFile(relativePath).toLowerCase()
  const segments = route.split('/').filter(Boolean)
  const reasons = []
  if (segments.some((segment) => /^test/.test(segment))) reasons.push('test route')
  if (segments.some((segment) => /^debug/.test(segment) || segment.includes('debug'))) reasons.push('debug route')
  if (segments.includes('dev')) reasons.push('dev route')
  if (segments.includes('legacy')) reasons.push('legacy route')
  if (segments.includes('mock') || segments.some((segment) => segment.includes('mock'))) reasons.push('mock route')
  if (segments.includes('qa') || segments.some((segment) => segment.includes('qa-'))) reasons.push('qa route')
  if (segments.includes('health') || route.endsWith('/health')) reasons.push('health/diagnostic route')
  if (segments.includes('admin') && !route.includes('/api/admin/automation/')) reasons.push('admin-only route')
  if (segments.includes('internal')) reasons.push('internal route')
  if (segments.includes('e2e')) reasons.push('e2e route')
  return reasons
}

function duplicateFeaturePatterns(apiRoutes) {
  const byParent = new Map()
  for (const route of apiRoutes) {
    const parent = route.split('/').slice(0, -1).join('/')
    const grandParent = parent.split('/').slice(0, -1).join('/')
    if (!byParent.has(grandParent)) byParent.set(grandParent, [])
    byParent.get(grandParent).push(route)
  }

  return Array.from(byParent.entries())
    .map(([parent, routes]) => ({ parent, count: routes.length, routes }))
    .filter((entry) => entry.count >= 6)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
}

function riskLevel(estimatedRoutes) {
  if (estimatedRoutes < GREEN_LIMIT) return 'green'
  if (estimatedRoutes <= YELLOW_LIMIT) return 'yellow'
  return 'red'
}

function printSection(title) {
  console.log(`\n## ${title}`)
}

const appFiles = walkFiles(appRoot, (absolute, name) => (
  name === 'node_modules' ||
  name === '.next' ||
  name.startsWith('.next-build') ||
  absolute.includes(`${path.sep}.claude${path.sep}`)
)).map((file) => toPosix(path.relative(repoRoot, file)))

const pageRoutes = appFiles.filter(isPageFile)
const apiRoutes = appFiles.filter((file) => file.startsWith('app/api/') && isRouteFile(file))
const nonApiRouteHandlers = appFiles.filter((file) => !file.startsWith('app/api/') && isRouteFile(file))
const layoutFiles = appFiles.filter(isLayoutFile)
const sourceRouteCount = pageRoutes.length + apiRoutes.length + nonApiRouteHandlers.length

const vercelConfig = readJson(vercelConfigPath) || {}
const vercelCounts = {
  // The cron schedule moved to cron-schedule.json; every other key below is
  // still genuine vercel.json config, so only this one is redirected.
  crons: countArray((readJson(cronSchedulePath) || vercelConfig).crons),
  rewrites: countArray(vercelConfig.rewrites),
  redirects: countArray(vercelConfig.redirects),
  headers: countArray(vercelConfig.headers),
  routes: countArray(vercelConfig.routes),
}
const vercelConfigRouteSignals = Object.values(vercelCounts).reduce((sum, value) => sum + value, 0)
const estimatedRouteSignals = sourceRouteCount + vercelConfigRouteSignals
const generatedFolders = detectGeneratedFolders()
const exclusions = buildScriptExclusions()
const keptFiles = buildScriptKeptFiles()
const excludedRouteCount = countRoutesInExcludedDirs(exclusions)
const keptInExcluded = countKeptFilesInExcludedDirs(exclusions, keptFiles)
const netExcluded = excludedRouteCount - keptInExcluded
const productionAdjustedRoutes = sourceRouteCount - netExcluded
const productionAdjustedSignals = productionAdjustedRoutes + vercelConfigRouteSignals

const folderCounts = new Map()
for (const route of [...pageRoutes, ...apiRoutes, ...nonApiRouteHandlers]) {
  const key = folderKey(route, route.startsWith('app/api/') ? 4 : 3)
  folderCounts.set(key, (folderCounts.get(key) || 0) + 1)
}
const topFolders = Array.from(folderCounts.entries())
  .map(([folder, count]) => ({ folder, count }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 15)

const suspiciousRoutes = apiRoutes
  .map((route) => ({ route, reasons: suspiciousRouteReason(route) }))
  .filter((entry) => entry.reasons.length > 0)
  .sort((a, b) => a.route.localeCompare(b.route))

const missingOldWorldCupRoutes = OLD_WORLD_CUP_CHAT_FEATURE_ROUTES.filter((route) => !pathExists(route))
const presentOldWorldCupRoutes = OLD_WORLD_CUP_CHAT_FEATURE_ROUTES.filter(pathExists)
const worldCupChatConsolidated = pathExists(WORLD_CUP_CHAT_ROUTE) && presentOldWorldCupRoutes.length === 0

console.log('AllFantasy Route Budget Audit')
console.log(`Generated at: ${new Date().toISOString()}`)

printSection('Summary')
console.log(`Source app route files (all, incl. dev/admin): ${sourceRouteCount}`)
console.log(`- App page routes: ${pageRoutes.length}`)
console.log(`- App API route handlers: ${apiRoutes.length}`)
console.log(`- Non-API route handlers: ${nonApiRouteHandlers.length}`)
console.log(`- Layout files (not counted as routes): ${layoutFiles.length}`)
console.log(`Build-excluded route dirs: ${exclusions.length} dirs, ${excludedRouteCount} routes, ${keptInExcluded} kept → ${netExcluded} net excluded`)
console.log(`Production source routes (after exclusions): ${productionAdjustedRoutes}`)
console.log(`Vercel config route signals: ${vercelConfigRouteSignals}`)
console.log(`- crons: ${vercelCounts.crons}`)
console.log(`- rewrites: ${vercelCounts.rewrites}`)
console.log(`- redirects: ${vercelCounts.redirects}`)
console.log(`- headers: ${vercelCounts.headers}`)
console.log(`- routes: ${vercelCounts.routes}`)
console.log(`Raw estimated signals (source only): ${estimatedRouteSignals}`)
console.log(`Production-adjusted signals: ${productionAdjustedSignals}`)
console.log(`Risk level: ${riskLevel(productionAdjustedSignals).toUpperCase()} (green < ${GREEN_LIMIT}, yellow ${GREEN_LIMIT}-${YELLOW_LIMIT}, red ${YELLOW_LIMIT + 1}+) [based on production-adjusted]`)

printSection('Top Route-Heavy Folders')
for (const entry of topFolders) {
  console.log(`${String(entry.count).padStart(4)}  ${entry.folder}`)
}

printSection('Suspicious Production-Excludable Routes')
if (suspiciousRoutes.length === 0) {
  console.log('No suspicious diagnostic/test/dev/admin route names detected.')
} else {
  for (const entry of suspiciousRoutes.slice(0, 40)) {
    console.log(`- ${entry.route} (${entry.reasons.join(', ')})`)
  }
  if (suspiciousRoutes.length > 40) {
    console.log(`...and ${suspiciousRoutes.length - 40} more.`)
  }
}

printSection('Duplicate Feature Route Patterns')
for (const entry of duplicateFeaturePatterns(apiRoutes)) {
  console.log(`- ${entry.parent}: ${entry.count} nested route handlers`)
}

printSection('Generated Folder Detection')
if (generatedFolders.length === 0) {
  console.log('No .next-build-fix* or .next-build-disabled-routes folders detected.')
} else {
  for (const folder of generatedFolders) {
    console.log(`- ${folder.name}: ${folder.files} files (generated; do not stage)`)
  }
}

printSection('Build Script Production Exclusions')
if (exclusions.length === 0) {
  console.log('No app route exclusions detected in scripts/vercel-next-build.cjs.')
} else {
  for (const exclusion of exclusions.slice(0, 40)) {
    console.log(`- ${exclusion}`)
  }
  if (exclusions.length > 40) console.log(`...and ${exclusions.length - 40} more.`)
}

printSection('World Cup Chat Consolidation')
console.log(`Consolidated route present: ${pathExists(WORLD_CUP_CHAT_ROUTE) ? 'yes' : 'no'}`)
console.log(`Old feature routes absent: ${presentOldWorldCupRoutes.length === 0 ? 'yes' : 'no'}`)
if (presentOldWorldCupRoutes.length > 0) {
  for (const route of presentOldWorldCupRoutes) console.log(`- Still present: ${route}`)
}
if (missingOldWorldCupRoutes.length > 0) {
  for (const route of missingOldWorldCupRoutes) console.log(`- Confirmed absent: ${route}`)
}

printSection('Recommendations')
if (riskLevel(productionAdjustedSignals) === 'red') {
  console.log('- Treat the route budget as actively at risk before adding any new App Router route files.')
} else if (riskLevel(productionAdjustedSignals) === 'yellow') {
  console.log('- Review route additions during PRs; prefer action dispatch or catch-all routes for related feature actions.')
} else {
  console.log('- Route budget is currently healthy, but keep related feature actions consolidated.')
}
console.log('- Keep World Cup chat features behind /api/brackets/world-cup/[challengeId]/chat?action=...')
console.log('- Prefer consolidating diagnostic/admin/dev routes behind existing admin or internal endpoints before adding new files.')
console.log('- Do not stage generated .next-build-fix* or .next-build-disabled-routes folders.')
console.log('- If Vercel route errors recur, compare this source count with .next/routes-manifest.json from a fresh build.')

if (!worldCupChatConsolidated) {
  process.exitCode = 1
}
