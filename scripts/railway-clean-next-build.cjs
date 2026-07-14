'use strict'

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
const distDirName = process.env.AF_NEXT_DIST_DIR || (isRailway ? railwayDistDir : '.next')
const nextDir = path.join(repoRoot, distDirName)
const legacyNextDir = path.join(repoRoot, '.next')
const maxAttempts = 4
const retryDelayMs = 1000
const retryableRemoveErrors = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY'])

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function tryQuarantineBusyPath(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    console.log(`[railway-clean] removed ${label}`)
    return true
  }

  const quarantinePath = path.join(
    repoRoot,
    `${path.basename(targetPath)}-busy-${Date.now()}-${process.pid}`,
  )
  const quarantineLabel = path.relative(repoRoot, quarantinePath)

  try {
    fs.renameSync(targetPath, quarantinePath)
    console.warn(
      `[railway-clean] moved busy ${label} to ${quarantineLabel}; continuing with fresh ${label}`,
    )
  } catch (err) {
    console.warn(
      `[railway-clean] ${label} is still busy and could not be moved: ${err.code ?? err.message}; continuing build`,
    )
    return false
  }

  try {
    fs.rmSync(quarantinePath, {
      recursive: true,
      force: true,
      maxRetries: 2,
      retryDelay: retryDelayMs,
    })
    console.log(`[railway-clean] removed ${quarantineLabel}`)
  } catch (err) {
    console.warn(
      `[railway-clean] could not remove quarantined ${quarantineLabel}: ${err.code ?? err.message}; continuing build`,
    )
  }

  return true
}

function removePath(targetPath) {
  const label = path.relative(repoRoot, targetPath)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      fs.rmSync(targetPath, {
        recursive: true,
        force: true,
        maxRetries: 1,
        retryDelay: retryDelayMs,
      })
      console.log(`[railway-clean] removed ${label}`)
      return
    } catch (err) {
      const code = err?.code
      if (!retryableRemoveErrors.has(code)) {
        console.warn(`[railway-clean] could not remove ${label}: ${code ?? err.message}`)
        process.exitCode = 1
        return
      }

      if (attempt < maxAttempts) {
        console.warn(
          `[railway-clean] ${label} is locked (${code}, attempt ${attempt}/${maxAttempts}); retrying in ${retryDelayMs}ms`,
        )
        sleep(retryDelayMs)
        if (!fs.existsSync(targetPath)) {
          console.log(`[railway-clean] removed ${label}`)
          return
        }
        continue
      }

      console.warn(
        `[railway-clean] ${label} is still locked (${code}) after ${maxAttempts} attempts`,
      )
      tryQuarantineBusyPath(targetPath, label)
    }
  }
}

if (fs.existsSync(nextDir)) {
  removePath(nextDir)
} else {
  console.log(`[railway-clean] skip: ${distDirName} is missing`)
}

if (legacyNextDir !== nextDir) {
  if (fs.existsSync(legacyNextDir)) {
    removePath(legacyNextDir)
  } else {
    console.log('[railway-clean] skip: .next is missing')
  }
}
