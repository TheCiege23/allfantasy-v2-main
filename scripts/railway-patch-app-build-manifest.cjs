'use strict'

/**
 * Railway / Linux builds sometimes emit CSS files under .next/static/css while
 * app-build-manifest.json lists zero CSS assets for /layout. Next then serves
 * HTML with scripts but no <link rel="stylesheet"> tags — the site looks bare.
 *
 * This post-build patch attaches every built CSS file to /layout (and to any
 * page entry that inherited layout chunks but lost the CSS references). It
 * also repairs App Router client reference manifests, which are what Next uses
 * at request time to emit real <link rel="stylesheet"> tags.
 */

const fs = require('node:fs')
const path = require('node:path')

const repoRoot = process.cwd()
const isRailway = !!(
  process.env.RAILWAY_PROJECT_ID ||
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RAILWAY_SERVICE_ID ||
  process.env.RAILWAY_DEPLOYMENT_ID ||
  process.env.RAILWAY_GIT_COMMIT_SHA
)
const railwayDistDir = process.env.RAILWAY_GIT_COMMIT_SHA
  ? `.next-railway-${process.env.RAILWAY_GIT_COMMIT_SHA}`
  : '.next-railway'
const distDir = process.env.AF_NEXT_DIST_DIR || (isRailway ? railwayDistDir : '.next')
const manifestPath = path.join(repoRoot, distDir, 'app-build-manifest.json')
const cssDir = path.join(repoRoot, distDir, 'static', 'css')

function readCssAssets() {
  if (!fs.existsSync(cssDir)) return []
  return fs
    .readdirSync(cssDir)
    .filter((name) => name.endsWith('.css'))
    .sort()
    .map((name) => `static/css/${name}`)
}

function insertCssIntoAssets(assets, cssAssets) {
  if (!Array.isArray(assets) || cssAssets.length === 0) return assets

  const withoutCss = assets.filter((asset) => !String(asset).includes('.css'))
  const mainAppIdx = withoutCss.findIndex((asset) => String(asset).includes('main-app'))
  const layoutJsIdx = withoutCss.findIndex((asset) => String(asset).includes('app/layout'))

  let insertAt = layoutJsIdx > -1 ? layoutJsIdx : withoutCss.length
  if (mainAppIdx > -1 && insertAt <= mainAppIdx) {
    insertAt = mainAppIdx + 1
  }

  const next = [...withoutCss]
  next.splice(insertAt, 0, ...cssAssets)
  return next
}

function walkFiles(dir, predicate, results = []) {
  if (!fs.existsSync(dir)) return results

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(entryPath, predicate, results)
      continue
    }
    if (predicate(entryPath)) results.push(entryPath)
  }

  return results
}

function parseClientReferenceManifest(source, filePath) {
  const match = source.match(
    /^(.*?globalThis\.__RSC_MANIFEST\["(?:\\.|[^"\\])+"\]=)(\{.*\})(;?)$/s,
  )
  if (!match) {
    throw new Error(`could not find client reference manifest payload in ${filePath}`)
  }

  return {
    prefix: match[1],
    manifest: JSON.parse(match[2]),
    suffix: match[3],
  }
}

function isRootLayoutEntry(entryKey) {
  return /(?:^|[\\/])app[\\/]layout$/.test(entryKey)
}

/*
 * Derives the root-layout entry key from a sibling entry, for manifests that
 * carry no `app/layout` key of their own.
 *
 * ⚠ THE PREFIX COMES FROM `entryKey`, NOT FROM `normalized`. It used to slice
 * the normalized copy — all forward slashes — and then re-join it with a
 * backslash separator, so a Windows key
 *     C:\srv\app\page   ->   C:/srv\app\layout
 * came back with mixed separators. Next resolves entryCSSFiles by exact string,
 * so the CSS was attached under a key nothing reads: the page ships with no
 * stylesheet link, which is the failure this whole script exists to prevent,
 * reached quietly and with the script reporting success.
 *
 * Latent rather than live — Railway builds on Linux, where the two branches
 * agree — but only because of where it runs, not because of what it does.
 *
 * `replace(/\\/g, '/')` is one character for one character, so `appIndex` is a
 * valid index into the ORIGINAL string too, and `entryKey[appIndex]` is the
 * separator this key actually uses at the boundary that matched. Reading it
 * there rather than sniffing the whole string also fixes the case of a key that
 * mixes both: the rebuild now follows the local separator instead of letting a
 * single stray backslash anywhere in the path pick for the entire result.
 */
function inferRootLayoutEntry(entryKeys) {
  for (const entryKey of entryKeys) {
    const normalized = entryKey.replace(/\\/g, '/')
    const appIndex = normalized.lastIndexOf('/app/')
    if (appIndex === -1) continue

    const separator = entryKey[appIndex]
    const prefix = entryKey.slice(0, appIndex)
    return `${prefix}${separator}app${separator}layout`
  }

  return null
}

function mergeCssAssets(current, cssAssets) {
  const existingCss = Array.isArray(current)
    ? current.filter((asset) => String(asset).endsWith('.css'))
    : []
  return Array.from(new Set([...existingCss, ...cssAssets]))
}

function patchClientReferenceManifests(cssAssets) {
  const serverAppDir = path.join(repoRoot, distDir, 'server', 'app')
  const files = walkFiles(
    serverAppDir,
    (filePath) => filePath.endsWith('_client-reference-manifest.js'),
  )

  if (files.length === 0) {
    console.error(`[railway-patch-manifest] no client reference manifests under ${distDir}/server/app`)
    process.exit(1)
  }

  let patchedFiles = 0
  let filesWithLayoutCss = 0

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8')
    const { prefix, manifest, suffix } = parseClientReferenceManifest(source, filePath)
    const entryCSSFiles = manifest.entryCSSFiles || {}
    manifest.entryCSSFiles = entryCSSFiles

    let layoutKeys = Object.keys(entryCSSFiles).filter(isRootLayoutEntry)
    if (layoutKeys.length === 0) {
      const inferredKey = inferRootLayoutEntry(Object.keys(entryCSSFiles))
      if (inferredKey) {
        layoutKeys = [inferredKey]
      }
    }

    let fileChanged = false
    let fileHasLayoutCss = false

    for (const layoutKey of layoutKeys) {
      const nextCss = mergeCssAssets(entryCSSFiles[layoutKey], cssAssets)
      if (nextCss.length > 0) fileHasLayoutCss = true

      const current = Array.isArray(entryCSSFiles[layoutKey]) ? entryCSSFiles[layoutKey] : []
      const hasSameCss =
        current.length === nextCss.length &&
        current.every((asset, index) => asset === nextCss[index])

      if (!hasSameCss) {
        entryCSSFiles[layoutKey] = nextCss
        fileChanged = true
      }
    }

    if (fileHasLayoutCss) filesWithLayoutCss += 1

    if (fileChanged) {
      fs.writeFileSync(filePath, `${prefix}${JSON.stringify(manifest)}${suffix}`)
      patchedFiles += 1
    }
  }

  if (filesWithLayoutCss === 0) {
    console.error('[railway-patch-manifest] no client reference manifest has root layout CSS assets')
    process.exit(1)
  }

  console.log(
    `[railway-patch-manifest] client reference manifests with layout CSS: ${filesWithLayoutCss}/${files.length}`,
  )
  if (patchedFiles > 0) {
    console.log(`[railway-patch-manifest] patched ${patchedFiles} client reference manifest(s)`)
  }
}

function patchManifest() {
  if (!fs.existsSync(manifestPath)) {
    console.error('[railway-patch-manifest] missing app-build-manifest.json')
    process.exit(1)
  }

  const cssAssets = readCssAssets()
  if (cssAssets.length === 0) {
    console.error('[railway-patch-manifest] no CSS files under .next/static/css')
    process.exit(1)
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const pages = manifest.pages || manifest
  const layoutKey = '/layout'
  const layoutAssets = pages[layoutKey] || []
  const layoutCssBefore = layoutAssets.filter((asset) => String(asset).includes('.css'))

  if (layoutCssBefore.length === 0) {
    pages[layoutKey] = insertCssIntoAssets(layoutAssets, cssAssets)
    console.log(
      `[railway-patch-manifest] injected ${cssAssets.length} CSS asset(s) into ${layoutKey}`,
    )
  } else {
    console.log(`[railway-patch-manifest] ${layoutKey} already lists ${layoutCssBefore.length} CSS asset(s)`)
  }

  let patchedPages = 0
  for (const [pageKey, assets] of Object.entries(pages)) {
    if (pageKey === layoutKey || !Array.isArray(assets)) continue
    const hasLayoutJs = assets.some((asset) => String(asset).includes('app/layout'))
    const hasCss = assets.some((asset) => String(asset).includes('.css'))
    if (hasLayoutJs && !hasCss) {
      pages[pageKey] = insertCssIntoAssets(assets, cssAssets)
      patchedPages += 1
    }
  }

  if (patchedPages > 0) {
    console.log(`[railway-patch-manifest] patched ${patchedPages} page entries missing CSS`)
  }

  manifest.pages = pages
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const layoutCssAfter = (pages[layoutKey] || []).filter((asset) => String(asset).includes('.css'))
  if (layoutCssAfter.length === 0) {
    console.error('[railway-patch-manifest] /layout still has no CSS assets after patch')
    process.exit(1)
  }

  console.log(`[railway-patch-manifest] ✓ /layout CSS assets: ${layoutCssAfter.length}`)
  patchClientReferenceManifests(cssAssets)
}

patchManifest()
