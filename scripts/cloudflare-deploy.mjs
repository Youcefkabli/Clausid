import { readFile, writeFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'))
const dryRun = process.argv[2] === '--dry-run'
if (dryRun) {
  config.vars.PUBLIC_ORIGIN ||= 'https://clausid.example.test'
  config.vars.MAIL_FROM ||= 'mail@example.test'
}
const { MAIL_FROM, PUBLIC_ORIGIN } = config.vars
if (!/^[^\s@]+@[^\s@]+$/.test(MAIL_FROM) || !URL.canParse(PUBLIC_ORIGIN) || new URL(PUBLIC_ORIGIN).origin !== PUBLIC_ORIGIN
    || !PUBLIC_ORIGIN.startsWith('https://')) {
  throw new Error('Set MAIL_FROM to an onboarded sender and PUBLIC_ORIGIN to the exact HTTPS origin in wrangler.jsonc.')
}
config.send_email[0].allowed_sender_addresses = [MAIL_FROM]
const generated = '.wrangler.clausid.json'
await writeFile(generated, JSON.stringify(config), { flag: 'wx' })
try {
  const commands = dryRun
    ? [['deploy', '--dry-run', '--outdir', '.data/cloudflare-build']]
    : [['d1', 'migrations', 'apply', 'AUTH_DB', '--remote'], ['deploy']]
  for (const args of commands) {
    const result = spawnSync('pnpm', ['exec', 'wrangler', ...args, '--config', generated], { stdio: 'inherit' })
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1
      break
    }
  }
} finally {
  await rm(generated)
}
