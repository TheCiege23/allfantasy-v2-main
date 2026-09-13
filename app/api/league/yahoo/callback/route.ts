/**
 * Historical Yahoo callback kept for the URI already registered in Yahoo's
 * developer console. Both entry points now execute one validation and storage
 * path, so a successful consent cannot land in a credential table the importer
 * never reads.
 */
export { GET } from '@/app/api/auth/yahoo/callback/route'
