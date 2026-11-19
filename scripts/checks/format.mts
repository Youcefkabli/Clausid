// Format only maintained repository files; caller-supplied edit paths never expand to a directory.
import { existsSync, realpathSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { repositoryFiles } from './git.mts'
import { repositoryRoot, runCommand } from './process.mts'

export function maintainedFormatFile(file: string): boolean {
  return (
    /\.(?:ts|tsx|mts|mjs|json|md|ya?ml|css)$/.test(file) &&
    !/^(?:apps\/website\/|docs\/archive\/)/.test(file) &&
    !/(?:^|\/)(?:node_modules|dist|target|\.data|\.git)\//.test(file) &&
    !file.endsWith('.d.ts') &&
    file !== 'pnpm-lock.yaml'
  )
}

export function editFormatPaths(paths: readonly string[], root = repositoryRoot): readonly string[] {
  const base = realpathSync(root)
  return [
    ...new Set(
      paths
        .map((path) => {
          const absolute = resolve(base, path)
          if (!existsSync(absolute) || !statSync(absolute).isFile()) {
            return undefined
          }
          const local = relative(base, realpathSync(absolute)).replaceAll('\\', '/')
          if (local === '..' || local.startsWith('../') || !maintainedFormatFile(local)) {
            return undefined
          }
          return local
        })
        .filter((path): path is string => path !== undefined),
    ),
  ].sort()
}

export async function formatFiles(write: boolean, root = repositoryRoot, explicit?: readonly string[], onOutput?: (text: string) => void) {
  const files = editFormatPaths(explicit ?? repositoryFiles(root), root)
  // Batch literal file arguments, preserving spaces/quotes without a shell or broad directory writes.
  for (let index = 0; index < files.length; index += 80) {
    await runCommand(
      {
        id: write ? 'format-write' : 'format-check',
        command: 'pnpm',
        args: ['exec', 'vp', 'fmt', write ? '--write' : '--check', ...files.slice(index, index + 80)],
      },
      root,
      120_000,
      onOutput ? { onOutput } : {},
    )
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, ...paths] = process.argv.slice(2)
  if (mode !== 'check' && mode !== 'write') {
    throw new Error('Expected format check|write [explicit files].')
  }
  await formatFiles(mode === 'write', repositoryRoot, paths.length ? paths : undefined)
}
