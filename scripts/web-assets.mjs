import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const directory = 'dist'
const manifest = 'clausid-assets.json'
const files = await readdir(directory, { recursive: true, withFileTypes: true })
const assets = files
  .filter((file) => file.isFile() && file.name !== manifest)
  .map((file) => '/' + join(file.parentPath, file.name).slice(directory.length + 1))
  .sort()
await writeFile(join(directory, manifest), JSON.stringify(assets))
