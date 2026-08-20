/*
 * Resolves `server-only` to a no-op for node-run verification scripts.
 *
 * ⚠ THIS IS A LOADER SHIM, NOT A LICENCE TO CALL SERVER CODE FROM A CLIENT. Next
 * picks the harmless variant of this package through the `react-server` export
 * condition; plain node picks the throwing one. Stubbing it reproduces what the
 * server runtime already does rather than defeating a real guard.
 */
const Module = require('module')
const orig = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'server-only') return {}
  return orig.apply(this, arguments)
}
