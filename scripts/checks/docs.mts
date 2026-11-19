import { requiredValue } from '../../packages/contracts/src/invariant.ts'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { repositoryFiles } from './git.mts'
import { repositoryRoot } from './process.mts'

export function documentProblems(file: string, source: string, root: string): readonly string[] {
  const problems: string[] = []
  // Examples in code fences are not links to repository files.
  const prose = source.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
  const links = [...prose.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)].map((match) => requiredValue(match[1]))
  const definitions = new Map(
    [...prose.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+)/gm)].map((match) => [requiredValue(match[1]).toLowerCase(), requiredValue(match[2])]),
  )
  for (const match of prose.matchAll(/!?\[([^\]]+)\]\[([^\]]*)\]/g)) {
    const label = requiredValue(match[2] || match[1]).toLowerCase()
    const target = definitions.get(label)
    if (!target) {
      problems.push(`${file}: undefined reference link: ${label}`)
    } else {
      links.push(target)
    }
  }
  // Check definitions even when the link uses Markdown's shortcut form.
  links.push(...definitions.values())
  for (const rawLink of new Set(links)) {
    const link = rawLink.replace(/^<|>$/g, '')
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(link)) {
      continue
    }
    let target: string
    try {
      target = decodeURIComponent(requiredValue(link.split(/[?#]/)[0]))
    } catch {
      problems.push(`${file}: invalid link encoding: ${link}`)
      continue
    }
    const absolute = target ? resolve(dirname(resolve(root, file)), target) : resolve(root, file)
    const local = relative(root, absolute)
    if (local === '..' || local.startsWith('../') || (!existsSync(absolute) && local !== file)) {
      problems.push(`${file}: missing or outside-repository link: ${link}`)
      continue
    }
    if (link.includes('#') && absolute.endsWith('.md')) {
      let anchor: string
      try {
        anchor = decodeURIComponent(link.slice(link.indexOf('#') + 1))
      } catch {
        problems.push(`${file}: invalid anchor encoding: ${link}`)
        continue
      }
      const targetSource = local === file ? source : readFileSync(absolute, 'utf8')
      if (anchor && !markdownAnchors(targetSource).has(anchor)) {
        problems.push(`${file}: missing Markdown anchor: ${link}`)
      }
    }
  }
  if (
    (/^docs\/specs\/[^/]+\/(spec|plan)\.md$/.test(file) && !source.startsWith('# Archived')) ||
    /^docs\/(?:clausid-engineering-(?:plan|tracker)|prompt)\.md$/.test(file)
  ) {
    for (const field of ['Status', 'Owner', 'Issue', 'Verified against']) {
      if (!new RegExp(`^${field}: .+`, 'm').test(source)) {
        problems.push(`${file}: missing ${field} metadata`)
      }
    }
  }
  if (file === 'docs/clausid-engineering-tracker.md') {
    for (const row of source.split('\n').filter((line) => /^\|\s+\d\d[A-C]?\s+\|/.test(line))) {
      const fields = row.split('|').map((field) => field.trim())
      if (fields[4] === 'Implemented locally' && (!fields[5] || /pending|not yet/i.test(fields[5]))) {
        problems.push(`${file}: completed assignment lacks completed evidence: ${fields[1]}`)
      }
    }
    if (/^Status: Complete$/m.test(source) && /\|\s+(?:Pending|In progress)\s+\|/.test(source)) {
      problems.push(`${file}: complete tracker still has unfinished assignments`)
    }
  }
  return problems
}

export function markdownAnchors(source: string): ReadonlySet<string> {
  const anchors = new Set<string>(),
    counts = new Map<string, number>()
  const prose = source.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
  for (const match of prose.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = requiredValue(match[1])
      .replace(/<[^>]*>/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
      .replace(/\s/g, '-')
    const count = counts.get(slug) ?? 0
    counts.set(slug, count + 1)
    anchors.add(slug + (count ? `-${count}` : ''))
  }
  for (const match of prose.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) {
    anchors.add(requiredValue(match[1]))
  }
  return anchors
}

export function checkDocumentation(root = repositoryRoot): readonly string[] {
  const files = repositoryFiles(root).filter((file) => /^(README|AGENTS|CLAUDE)\.md$/.test(file) || /^docs\/.*\.md$/.test(file) || file.endsWith('/AGENTS.md'))
  return files.flatMap((file) => (existsSync(resolve(root, file)) ? documentProblems(file, readFileSync(resolve(root, file), 'utf8'), root) : []))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const problems = checkDocumentation()
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exitCode = 1
  } else {
    console.log('Documentation links, Markdown anchors, references, metadata and tracker consistency passed (remote URLs and semantic truth require review).')
  }
}
