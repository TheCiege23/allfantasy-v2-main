const path = require('path')
const fs = require('node:fs')

// Railway prebuild (scripts/railway-tailwind-prebuild.cjs) replaces app/globals.css
// with fully compiled Tailwind output before `next build`. Running the tailwindcss
// PostCSS plugin on that file again purges most utilities (~666KB -> ~12KB) and
// breaks styling. When @tailwind directives are absent, use autoprefixer only.
function globalsCssIsPrecompiled() {
  try {
    const globalsPath = path.join(__dirname, 'app', 'globals.css')
    const source = fs.readFileSync(globalsPath, 'utf8')
    return !source.includes('@tailwind')
  } catch {
    return false
  }
}

const precompiled = globalsCssIsPrecompiled()

module.exports = {
  plugins: precompiled
    ? {
        autoprefixer: {},
      }
    : {
        tailwindcss: { config: path.join(__dirname, 'tailwind.config.js') },
        autoprefixer: {},
      },
}
