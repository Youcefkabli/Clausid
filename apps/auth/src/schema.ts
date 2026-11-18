import Database from 'better-sqlite3'
import { getMigrations } from 'better-auth/db/migration'
import { createAuth } from './policy.ts'

const database = new Database(':memory:')
try {
  const auth = createAuth({
    database,
    origin: 'http://localhost',
    secret: 'development-only-schema-inspection',
    clientIpHeader: 'x-clausid-client-ip',
    sendMail: async () => {},
  })
  console.log(await (await getMigrations(auth.options)).compileMigrations())
} finally {
  database.close()
}
