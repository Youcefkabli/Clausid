import { getMigrations } from 'better-auth/db/migration'
import { auth, database } from './config.ts'

await (await getMigrations(auth.options)).runMigrations()
database.close()
