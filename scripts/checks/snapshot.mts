// Validate immutable Git content without stashing, switching or rewriting the user's checkout.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { cleanGitEnvironment, git, hasCommit } from './git.mts'

export type Snapshot = { readonly root: string; readonly env: NodeJS.ProcessEnv; readonly dispose: () => void }

function linkEntry(source: string, destination: string, sourceRoot: string, targetRoot: string) {
  const actual = realpathSync(source)
  const local = relative(sourceRoot, actual).split(sep).join('/')
  // Workspace packages must resolve to staged/pushed source, never the dirty checkout.
  const workspaceSource = /^(apps|packages)\//.test(local) && !local.split('/').includes('node_modules')
  const target = workspaceSource ? resolve(targetRoot, local) : actual
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : undefined)
}

function dependencies(source: string, destination: string, sourceRoot: string, targetRoot: string) {
  if (!existsSync(source)) {
    return
  }
  if (existsSync(destination)) {
    throw new Error('Snapshot unexpectedly tracks node_modules; refusing to overwrite it.')
  }
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && !['.pnpm', '.bin'].includes(entry.name)) {
      continue
    }
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.name.startsWith('@') && entry.isDirectory()) {
      mkdirSync(to)
      for (const name of readdirSync(from)) {
        linkEntry(join(from, name), join(to, name), sourceRoot, targetRoot)
      }
    } else {
      linkEntry(from, to, sourceRoot, targetRoot)
    }
  }
}

export function createSnapshot(source: string, selection: { readonly kind: 'staged' } | { readonly kind: 'commit'; readonly commit: string }): Snapshot {
  source = realpathSync(source)
  const root = mkdtempSync(join(tmpdir(), 'clausid-git-check-'))
  const env = cleanGitEnvironment(source)
  const dispose = () => rmSync(root, { recursive: true, force: true })
  try {
    git(['clone', '--quiet', '--shared', '--no-checkout', '--', source, root], source, { env })
    // The temporary repository must not recursively invoke this checkout's hooks.
    const emptyHooks = join(root, '.git', 'clausid-empty-hooks')
    mkdirSync(emptyHooks)
    git(['config', '--local', 'core.hooksPath', emptyHooks], root, { env })
    if (selection.kind === 'staged') {
      const index = git(['ls-files', '--stage', '-z'], source)
      if (
        index
          .split('\0')
          .filter(Boolean)
          .some((record) => !/^\d{6} [\da-f]{40,64} 0\t/.test(record))
      ) {
        throw new Error('Resolve unmerged index entries before verification.')
      }
      git(['read-tree', '--empty'], root, { env })
      git(['update-index', '-z', '--index-info'], root, { env, input: index })
      if (hasCommit(source)) {
        const head = git(['rev-parse', '--verify', 'HEAD'], source).trim()
        git(['update-ref', 'HEAD', head], root, { env })
      }
    } else {
      git(['read-tree', selection.commit], root, { env })
      git(['update-ref', 'HEAD', selection.commit], root, { env })
    }
    git(['checkout-index', '--all', '--force'], root, { env })
    dependencies(join(source, 'node_modules'), join(root, 'node_modules'), source, root)
    for (const group of ['apps', 'packages']) {
      if (!existsSync(join(source, group))) {
        continue
      }
      for (const entry of readdirSync(join(source, group), { withFileTypes: true })) {
        if (!entry.isDirectory() || !existsSync(join(root, group, entry.name))) {
          continue
        }
        dependencies(join(source, group, entry.name, 'node_modules'), join(root, group, entry.name, 'node_modules'), source, root)
      }
    }
    // Type checking may need generated declarations. Full app/PDF profiles rebuild Wasm.
    const generated = join('packages', 'pdf-engine', 'dist')
    if (existsSync(join(source, generated)) && !existsSync(join(root, generated))) {
      cpSync(join(source, generated), join(root, generated), { recursive: true })
    }
    return { root, env, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}
