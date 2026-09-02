'use strict'

const { execFileSync } = require('node:child_process')

const isRailway = Boolean(
  process.env.RAILWAY_PROJECT_ID ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_SERVICE_ID ||
    process.env.RAILWAY_DEPLOYMENT_ID ||
    process.env.RAILWAY_GIT_COMMIT_SHA,
)

if (!isRailway) {
  console.log('[railway-postbuild] not a Railway build; skipping Railway manifest checks')
  process.exit(0)
}

const node = process.execPath
const scripts = [
  'scripts/railway-patch-app-build-manifest.cjs',
  'scripts/railway-postbuild-css-audit.cjs',
]

for (const script of scripts) {
  console.log(`[railway-postbuild] running ${script}`)
  execFileSync(node, [script], { stdio: 'inherit', env: process.env })
}