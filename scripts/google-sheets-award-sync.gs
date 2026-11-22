// Add this file to the Road To Glory tracker Apps Script project, then run connectAfAwardVoting once per league.
const AF_AWARD_CONNECTIONS = 'AF_AWARD_CONNECTIONS'
const AF_AWARD_TRACKER_ID = 'AF_AWARD_TRACKER_ID'
const AF_AWARD_SHEET = 'Award Votes'
const AF_AWARD_HEADERS = ['League', 'Season', 'Award', 'Choice', 'Votes', 'Total votes',
  'Outcome', 'Winner', 'Closes at (ET)', 'Last synced (ET)', 'League ID', 'Ballot ID', 'Choice ID']

function connectAfAwardVoting() {
  const ui = SpreadsheetApp.getUi()
  const input = ui.prompt('Connect AllFantasy award voting',
    'Paste the connection from League awards → Connect a Google Sheet.', ui.ButtonSet.OK_CANCEL)
  if (input.getSelectedButton() !== ui.Button.OK) return
  const connection = JSON.parse(input.getResponseText())
  if (!connection?.leagueId || !connection?.token ||
    !/^https:\/\/[^/]+\/api\/shared\/chat\/threads\/[^/]+\/polls\?view=award-sheet$/.test(String(connection.url))) {
    throw new Error('Use the connection copied from AllFantasy.')
  }
  const properties = PropertiesService.getScriptProperties()
  const lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet()
    properties.setProperty(AF_AWARD_TRACKER_ID, sheet.getId())
    const connections = JSON.parse(properties.getProperty(AF_AWARD_CONNECTIONS) || '{}')
    if (!/^[a-zA-Z0-9_-]+$/.test(connection.leagueId) || ['constructor', 'prototype', '__proto__'].includes(connection.leagueId)) {
      throw new Error('Invalid league ID.')
    }
    afAwardRows(readAfAwardExport(connection), '', connection.leagueId)
    connections[connection.leagueId] = { url: connection.url, token: connection.token }
    properties.setProperty(AF_AWARD_CONNECTIONS, JSON.stringify(connections))
    const prior = ScriptApp.getProjectTriggers().filter((trigger) => trigger.getHandlerFunction() === 'syncAfAwardVotes')
    if (!prior.length) ScriptApp.newTrigger('syncAfAwardVotes').timeBased().everyMinutes(15).create()
  } finally {
    lock.releaseLock()
  }
  syncAfAwardVotes()
}

function readAfAwardExport(connection) {
  const res = UrlFetchApp.fetch(connection.url, {
    headers: { Authorization: 'Bearer ' + connection.token }, followRedirects: false, muteHttpExceptions: true,
  })
  if (res.getResponseCode() !== 200) throw new Error('AllFantasy award sync returned ' + res.getResponseCode())
  return JSON.parse(res.getContentText())
}

function afAwardCell(value) {
  return typeof value === 'string' && /^[=+@-]/.test(value) ? "'" + value : value
}

function afAwardRows(data, stamp, leagueId) {
  if (data.leagueId !== leagueId || !Array.isArray(data.awards)) throw new Error('Wrong award export league.')
  const rows = []
  for (const award of data.awards) {
    if (!Array.isArray(award.options) || !award.id || !Number.isFinite(Date.parse(award.closesAt))) {
      throw new Error('Invalid award export.')
    }
    const closes = Utilities.formatDate(new Date(award.closesAt), 'America/New_York', 'yyyy-MM-dd HH:mm')
    for (const option of award.options) {
      if (!Number.isInteger(option.count) || option.count < 0) throw new Error('Invalid option tally.')
      rows.push([data.league, award.season ?? '', award.name, option.label, option.count, award.totalVotes,
        award.outcome, award.winner || '', closes, stamp, leagueId, award.id, option.id])
    }
  }
  return rows
}

function syncAfAwardVotes() {
  const properties = PropertiesService.getScriptProperties()
  const spreadsheetId = properties.getProperty(AF_AWARD_TRACKER_ID)
  if (!spreadsheetId) return
  const lock = LockService.getScriptLock()
  if (!lock.tryLock(1000)) return
  try {
    const ss = SpreadsheetApp.openById(spreadsheetId)
    const sheet = ss.getSheetByName(AF_AWARD_SHEET) || ss.insertSheet(AF_AWARD_SHEET)
    if (!sheet.getLastRow()) {
      sheet.getRange(1, 1, 1, AF_AWARD_HEADERS.length).setValues([AF_AWARD_HEADERS])
        .setFontWeight('bold').setFontColor('#ffffff').setBackground('#17666a')
      sheet.setFrozenRows(1)
      sheet.setColumnWidth(1, 240)
      sheet.setColumnWidth(3, 240)
      sheet.setColumnWidth(4, 220)
      const me = Session.getEffectiveUser()
      const protection = sheet.protect().setDescription('Road To Glory award sync')
      protection.addEditor(me)
      const editors = protection.getEditors().filter((user) => user.getEmail() !== me.getEmail())
      if (editors.length) protection.removeEditors(editors)
      if (protection.canDomainEdit()) protection.setDomainEdit(false)
    }
    if (sheet.getRange(1, 1, 1, AF_AWARD_HEADERS.length).getValues()[0].some((cell, i) => cell !== AF_AWARD_HEADERS[i])) {
      throw new Error('A tab named Award Votes has a different layout.')
    }
    const oldSize = sheet.getLastRow() - 1
    const prior = oldSize ? sheet.getRange(2, 1, oldSize, AF_AWARD_HEADERS.length).getValues() : []
    const overrides = new Map()
    const errors = []
    const stamp = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd HH:mm')
    const connections = JSON.parse(properties.getProperty(AF_AWARD_CONNECTIONS) || '{}')
    for (const [id, connection] of Object.entries(connections)) {
      try {
        overrides.set(id, afAwardRows(readAfAwardExport(connection), stamp, id))
      } catch {
        errors.push(id)
      }
    }
    const rows = [...prior.filter((row) => !overrides.has(String(row[10]))), ...[...overrides.values()].flat()]
    const need = rows.length + 1 - sheet.getMaxRows()
    if (need > 0) sheet.insertRowsAfter(sheet.getMaxRows(), need)
    if (rows.length) {
      sheet.getRange(2, 9, rows.length, 5).setNumberFormat('@')
      sheet.getRange(2, 1, rows.length, AF_AWARD_HEADERS.length).setValues(rows.map((row) => row.map(afAwardCell)))
    }
    if (oldSize > rows.length) sheet.getRange(rows.length + 2, 1, oldSize - rows.length, AF_AWARD_HEADERS.length).clearContent()
    sheet.getRange('A1').setNote(errors.length
      ? 'Some leagues could not refresh. Latest successful data remains visible. Reconnect those leagues in Apps Script.'
      : 'Latest export check ' + stamp + ' ET. Each row is a choice tally.')
  } finally {
    lock.releaseLock()
  }
}
