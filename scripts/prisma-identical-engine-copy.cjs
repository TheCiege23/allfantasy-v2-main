const fs = require('node:fs')
const path = require('node:path')

const engine = path.resolve(__dirname, '../node_modules/.prisma/client/query_engine-windows.dll.node')

async function recoverIdenticalEngineCopy(source, target, error, io = fs.promises) {
  if (!['EPERM', 'EACCES', 'EBUSY'].includes(error?.code)) return false
  if (typeof source !== 'string' || typeof target !== 'string') return false
  const destination = path.resolve(target)
  const temporary = path.resolve(source)
  if (destination !== engine || !temporary.startsWith(`${engine}.tmp`) || !/^\d+$/.test(temporary.slice(`${engine}.tmp`.length))) return false
  try {
    const incoming = await io.readFile(temporary)
    const existing = await io.readFile(destination)
    if (!incoming.equals(existing)) return false
    // The loaded DLL already has the exact requested bytes. Remove only this copy.
    await io.unlink(temporary)
    return true
  } catch {
    return false
  }
}

if (process.platform === 'win32' && process.env.AF_PRISMA_IDENTICAL_ENGINE_COPY === '1') {
  const rename = fs.promises.rename.bind(fs.promises)
  fs.promises.rename = async (source, target) => {
    try { return await rename(source, target) } catch (error) {
      if (!(await recoverIdenticalEngineCopy(source, target, error))) throw error
    }
  }
}

module.exports = { recoverIdenticalEngineCopy }
