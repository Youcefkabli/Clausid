// Check authored source and dependency records, independently of an agent or Git invocation.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { z } from 'zod'
import { repositoryFiles } from './git.mts'
import { repositoryRoot } from './process.mts'

export type Finding = { readonly rule: string; readonly file: string; readonly line: number; readonly message: string }
const exceptionSchema = z
  .object({
    rule: z.literal('type-assertion'),
    file: z.string().min(1),
    symbol: z.string().min(1),
    reason: z.string().min(30),
    test: z.string().min(1),
  })
  .strict()
export type PolicyException = z.infer<typeof exceptionSchema>
const exceptionsSchema = z.array(exceptionSchema)

function owner(node: ts.Node): string | undefined {
  for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
    if ((ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name) {
      return parent.name.getText()
    }
    if (ts.isVariableDeclaration(parent) && (ts.isArrowFunction(parent.initializer ?? parent) || ts.isFunctionExpression(parent.initializer ?? parent))) {
      return parent.name.getText()
    }
  }
  return undefined
}

export function sourceProblems(file: string, source: string, root: string, exceptions: readonly PolicyException[] = []): readonly Finding[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const findings: Finding[] = []
  const report = (node: ts.Node, rule: string, message: string) => {
    findings.push({ rule, file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, message })
  }
  const assertionAllowed = (node: ts.Node) => exceptions.some((item) => item.file === file && item.rule === 'type-assertion' && item.symbol === owner(node))
  function imports(node: ts.Node) {
    const specifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? node.arguments[0]
          : undefined
    if (!specifier || !ts.isStringLiteral(specifier)) {
      return
    }
    const target = specifier.text.startsWith('.') ? relative(root, resolve(root, dirname(file), specifier.text)).replaceAll('\\', '/') : specifier.text
    const group = (path: string) =>
      path.startsWith('packages/contracts/') || path.startsWith('@clausid/contracts')
        ? 'contracts'
        : path.startsWith('apps/web/') || path === '@clausid/web' || path.startsWith('@clausid/web/')
          ? 'web'
          : path.startsWith('apps/worker/') || path === '@clausid/worker' || path.startsWith('@clausid/worker/')
            ? 'worker'
            : path.startsWith('apps/auth/') || path === '@clausid/auth' || path.startsWith('@clausid/auth/')
              ? 'auth'
              : path.startsWith('apps/website/')
                ? 'website'
                : undefined
    const from = group(file),
      to = group(target)
    if (!from || !to || from === to || to === 'contracts') {
      return
    }
    if (from === 'worker' && file === 'apps/worker/src/cloudflare.ts' && to === 'auth' && /apps\/auth\/src\/(policy|operations)\.ts$/.test(target)) {
      return
    }
    report(node, 'source-layer', `${from} cannot import ${to} implementation; use its boundary contract.`)
  }
  function visit(node: ts.Node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      report(node, 'no-any', 'Narrow unknown data instead of using any.')
    }
    if (ts.isEnumDeclaration(node)) {
      report(node, 'no-enum', 'Use a literal union and exhaustive handling.')
    }
    if (ts.isNonNullExpression(node)) {
      report(node, 'no-non-null', 'Check the required value at its owner before use.')
    }
    if ((ts.isAsExpression(node) && node.type.getText(ast) !== 'const') || ts.isTypeAssertionExpression(node)) {
      if (!assertionAllowed(node)) {
        report(node, 'type-assertion', 'Parse/narrow the value or use an explicitly reviewed validated adapter.')
      }
    }
    if (ts.isTypeReferenceNode(node) && node.typeName.getText(ast) === 'Partial') {
      report(node, 'no-partial', 'Declare supported optional fields explicitly.')
    }
    if (ts.isCallExpression(node) && node.typeArguments?.length && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'json') {
      report(node, 'typed-json', 'A json<T>() argument does not parse external data.')
    }
    imports(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source)
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) {
      continue
    }
    const comment = scanner.getTokenText()
    const line = ast.getLineAndCharacterOfPosition(scanner.getTokenPos()).line + 1
    if (/@ts-(nocheck|ignore)\b/.test(comment) || /@ts-expect-error\b(?![^\n]*: .{15})/.test(comment)) {
      findings.push({
        rule: 'compiler-suppression',
        file,
        line,
        message: 'Compiler suppression must not hide unchecked code; a deliberate expect-error test needs a reason.',
      })
    }
    if (/\b(?:oxlint|eslint)-disable/.test(comment) && !/\b(?:oxlint|eslint)-disable-next-line\s+[\w/-]+(?:\s*,\s*[\w/-]+)*\s+-- .{15}/.test(comment)) {
      findings.push({ rule: 'lint-suppression', file, line, message: 'A narrow lint suppression requires a written reason after --.' })
    }
  }
  if (/\.(test|spec)\.ts$/.test(file) && !/^\s*(\/\/|\/\*)/.test(source)) {
    findings.push({ rule: 'test-purpose', file, line: 1, message: 'Open the test with its observable goal and method.' })
  }
  return findings
}

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
})
export function dependencyProblems(names: readonly string[], documentation: string): readonly string[] {
  const records = [...documentation.matchAll(/^### `((?:npm|cargo):[^`]+)`\s*$/gm)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined)
  const expected = new Set(names),
    actual = new Set(records)
  const problems: string[] = []
  for (const name of expected) {
    if (!actual.has(name)) {
      problems.push(`Missing dependency decision: ${name}`)
    }
  }
  for (const name of actual) {
    if (!expected.has(name)) {
      problems.push(`Undeclared dependency record: ${name}`)
    }
  }
  if (records.length !== actual.size) {
    problems.push('Duplicate dependency decision heading.')
  }
  for (const section of documentation.split(/^### /m).slice(1)) {
    for (const field of ['Does', 'Why not the platform', 'Cost']) {
      if (!section.includes(`**${field}:**`)) {
        problems.push(`Dependency decision is missing ${field}.`)
      }
    }
  }
  return problems
}

export function exceptionProblems(exceptions: readonly PolicyException[], files: readonly string[], root: string): readonly string[] {
  const problems: string[] = []
  const identities = new Set<string>()
  for (const item of exceptions) {
    if (!exceptionSchema.safeParse(item).success) {
      problems.push('Invalid policy exception metadata.')
      continue
    }
    const identity = `${item.rule}:${item.file}:${item.symbol}`
    if (identities.has(identity)) {
      problems.push(`Duplicate policy exception: ${identity}`)
    }
    identities.add(identity)
    if (!files.includes(item.file) || !files.includes(item.test) || !/\.(test|spec)\.ts$/.test(item.test) || /[*?]/.test(item.file + item.symbol + item.test)) {
      problems.push(`Invalid exception scope: ${identity}`)
      continue
    }
    const source = readFileSync(join(root, item.file), 'utf8')
    const findings = sourceProblems(item.file, source, root)
    const ast = ts.createSourceFile(item.file, source, ts.ScriptTarget.Latest, true)
    let used = false
    function visit(node: ts.Node) {
      if (((ts.isAsExpression(node) && node.type.getText(ast) !== 'const') || ts.isTypeAssertionExpression(node)) && owner(node) === item.symbol) {
        used = true
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
    if (!used || !findings.some((finding) => finding.rule === item.rule)) {
      problems.push(`Stale exception: ${identity}`)
    }
  }
  return problems
}

export function checkPolicy(root = repositoryRoot): readonly string[] {
  const files = repositoryFiles(root).filter((file) => existsSync(join(root, file)))
  const exceptionFile = join(root, 'scripts/checks/policy-exceptions.json')
  const exceptions = existsSync(exceptionFile) ? exceptionsSchema.parse(JSON.parse(readFileSync(exceptionFile, 'utf8'))) : []
  const problems = [...exceptionProblems(exceptions, files, root)]
  for (const file of files.filter((file) => /\.(ts|tsx|mts)$/.test(file) && !file.endsWith('.d.ts') && !file.startsWith('apps/website/'))) {
    for (const finding of sourceProblems(file, readFileSync(join(root, file), 'utf8'), root, exceptions)) {
      problems.push(`${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`)
    }
  }
  const names = new Set<string>()
  for (const file of files.filter((file) => /^(?:package\.json|(?:apps|packages)\/[^/]+\/package\.json)$/.test(file))) {
    const manifest = packageSchema.parse(JSON.parse(readFileSync(join(root, file), 'utf8')))
    for (const dependencies of [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies, manifest.optionalDependencies]) {
      for (const name of Object.keys(dependencies ?? {})) {
        names.add(`npm:${name}`)
      }
    }
  }
  const metadataSchema = z.object({ packages: z.array(z.object({ dependencies: z.array(z.object({ name: z.string() })) })) })
  for (const file of files.filter((file) => /^packages\/[^/]+\/Cargo.toml$/.test(file))) {
    const result = execFileSync('cargo', ['metadata', '--no-deps', '--format-version=1', '--locked'], {
      cwd: join(root, dirname(file)),
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    for (const entry of metadataSchema.parse(JSON.parse(result)).packages) {
      for (const dependency of entry.dependencies) {
        names.add(`cargo:${dependency.name}`)
      }
    }
  }
  problems.push(...dependencyProblems([...names], readFileSync(join(root, 'docs/dependencies.md'), 'utf8')))
  return problems
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const problems = checkPolicy()
    if (problems.length) {
      console.error(problems.join('\n'))
      process.exitCode = 1
    } else {
      console.log('Source policy, exception scopes and dependency decisions passed; no legacy baseline.')
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
