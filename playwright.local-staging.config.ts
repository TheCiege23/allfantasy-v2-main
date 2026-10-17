import base from './playwright.config'

const databaseUrl = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.pathname !== '/allfantasy_staging') {
  throw new Error('Local staging Playwright runs require the isolated 127.0.0.1/allfantasy_staging database.')
}

export default {
  ...base,
  globalSetup: undefined,
  workers: 1,
}
