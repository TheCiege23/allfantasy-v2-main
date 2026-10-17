/** Synthetic native-draft verification; never permits a production target. */
import base from './playwright.config'
import {defineConfig} from '@playwright/test'
import {parse} from 'dotenv'
import {readFileSync} from 'node:fs'
import path from 'node:path'
const envFile=process.env.AF_E2E_ENV_FILE ?? path.resolve(__dirname,'.env.test')
const url=process.env.DATABASE_URL ?? parse(readFileSync(envFile)).DATABASE_URL
if(!new URL(url).hostname.startsWith('ep-muddy-leaf-') || !new URL(url).hostname.endsWith('.neon.tech'))throw new Error('KNOWN_TEST_DATABASE_REQUIRED')
const env: Record<string,string>={...process.env as Record<string,string>,DATABASE_URL:url,DIRECT_URL:url,POSTGRES_URL:url,POSTGRES_PRISMA_URL:url,POSTGRES_URL_NON_POOLING:url,NEON_DATABASE_URL:url,AF_NATIVE_DRAFT_TEST_DB:'1',UPSTASH_REDIS_REST_URL:'',UPSTASH_REDIS_REST_TOKEN:'',REDIS_URL:'',REDIS_HOST:'',RESEND_API_KEY:'',META_CONVERSIONS_API_TOKEN:'',META_PIXEL_ID:'',NEXT_PUBLIC_META_PIXEL_ID:'',NEXTAUTH_SECRET:'guarded-test-cookie-secret',AUTH_SECRET:'guarded-test-cookie-secret',NEXTAUTH_URL:'http://127.0.0.1:3249',NODE_OPTIONS:process.env.NODE_OPTIONS ?? '',AF_NEXT_DIST_DIR:'.next-native-auth-tournament',PORT:'3249',AF_USE_DB_CACHE_ONLY:'1',AF_DISABLE_LIVE_API_ON_PAGE_LOAD:'1',AF_DISABLE_IMAGE_LOOKUP_ON_PAGE_LOAD:'1',AF_DISABLE_ADP_LIVE_MERGE_ON_PAGE_LOAD:'1',AF_DISABLE_STATS_LIVE_MERGE_ON_PAGE_LOAD:'1',AF_DISABLE_AI_LIVE_CALLS:'1'}
Object.assign(process.env,env)
export default defineConfig({...base,globalSetup:undefined,workers:1,retries:0,testDir:path.resolve(__dirname,'e2e'),testMatch:'native-draft-authenticated-testdb.spec.ts',reporter:'line',projects:base.projects?.filter(p=>p.name==='chromium'),use:{...base.use,baseURL:env.NEXTAUTH_URL},webServer:{command:'node node_modules/next/dist/bin/next dev -p 3249 --hostname 127.0.0.1',cwd:__dirname,url:env.NEXTAUTH_URL+'/api/auth/csrf',reuseExistingServer:false,timeout:360000,env}})
