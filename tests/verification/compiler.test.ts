// Compile deliberately invalid and valid programs with the actual shared options to detect strictness regressions.
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import ts from 'typescript'
import { repositoryRoot } from '../../scripts/checks/process.mts'

function diagnostics(source: string) {
  const config = ts.getParsedCommandLineOfConfigFile(
    join(repositoryRoot, 'tsconfig.base.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  )
  if (!config) {
    throw new Error('Missing shared compiler configuration.')
  }
  const options = { ...config.options, types: [] },
    file = join(repositoryRoot, 'strictness-fixture.ts')
  const host = ts.createCompilerHost(options)
  const original = host.getSourceFile.bind(host)
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === file ? ts.createSourceFile(path, source, languageVersion, true) : original(path, languageVersion, onError, shouldCreateNewSourceFile)
  return ts
    .getPreEmitDiagnostics(ts.createProgram([file], options, host))
    .filter((item) => item.file?.fileName === file)
    .map((item) => item.code)
}

it('rejects unchecked indexes, undefined optionals, implicit returns, overrides, index properties and fallthrough', () => {
  const codes = diagnostics(`
    export {};
    const values: string[]=[]; values[0].trim();
    const optional: {value?:string}={value:undefined};
    function choose(flag:boolean){if(flag)return 1;}
    class Base {run(){}}; class Child extends Base {run(){}}
    const record: Record<string,string>={}; record.name;
    function fall(value:number){switch(value){case 0: console.log(value);case 1:return;}}
  `)
  for (const code of [2532, 2375, 7030, 4114, 4111, 7029]) {
    expect(codes).toContain(code)
  }
})

it('accepts checked indexes, omitted optionals, explicit returns and overrides', () => {
  expect(
    diagnostics(`
    export {};
    const values: string[]=[]; const first=values[0]; if(first!==undefined)first.trim();
    const optional: {value?:string}={};
    function choose(flag:boolean){return flag?1:0;}
    class Base {run(){}}; class Child extends Base {override run(){}}
    const record: Record<string,string>={}; record['name'];
    function fall(value:number){switch(value){case 0: console.log(value);return;case 1:return;}}
  `),
  ).toEqual([])
})
