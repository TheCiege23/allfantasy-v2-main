const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const esbuild = require('esbuild')

async function main() {
  fs.mkdirSync('tmp', { recursive: true })
  await esbuild.build({
    entryPoints: ['scripts/pirate-mobile-harness.tsx'], bundle: true, platform: 'browser',
    outfile: 'tmp/pirate-mobile.js', jsx: 'automatic', alias: { '@': path.resolve(process.cwd()) },
    logLevel: 'warning',
  })
  const result = spawnSync(process.execPath, [
    'node_modules/tailwindcss/lib/cli.js', '-i', 'app/globals.css', '-o', 'tmp/pirate-mobile.css',
    '--content', 'components/pirate/PirateHome.tsx,scripts/pirate-mobile-harness.tsx',
  ], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw Error(result.stderr || result.stdout || 'Tailwind build failed')
  console.log('Pirate mobile browser assets built')
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
