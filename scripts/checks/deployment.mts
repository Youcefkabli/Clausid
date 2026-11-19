import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { repositoryRoot, runCommand } from './process.mts'

// This uses --dry-run only: no migration or remote deployment is performed.
await runCommand({ id: 'cloudflare-bundle', command: 'pnpm', args: ['run', 'deploy', '--dry-run'] })
const generated = execFileSync(process.execPath, ['src/schema.ts'], {
  cwd: resolve(repositoryRoot, 'apps/auth'),
  encoding: 'utf8',
})
const committed = readFileSync(resolve(repositoryRoot, 'deploy/d1/0001_auth.sql'), 'utf8')
if (generated !== committed) {
  throw new Error('Better Auth schema differs from deploy/d1/0001_auth.sql. Review the migration explicitly.')
}
console.log('Cloudflare dry run and auth schema parity passed.')
