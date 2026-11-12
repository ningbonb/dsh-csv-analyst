import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const run = promisify(execFile)

it('package gate accepts the allowed artifacts and rejects executable or extra release contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-csv-package-'))
  try {
    await mkdir(join(root, 'scripts'))
    await mkdir(join(root, 'lib'))
    await writeFile(join(root, 'scripts/check-package.mjs'), await readFile(new URL('../scripts/check-package.mjs', import.meta.url)))
    for (const name of ['README.md', 'README.zh.md', 'SECURITY.md', 'LICENSE', 'cordis.patch.yml', 'lib/index.d.ts']) await writeFile(join(root, name), '\n')
    const module = 'export const name="csv-analyst";export const inject=["tools","fs","workingDirectory"];export function apply(){}\n'
    await writeFile(join(root, 'lib/index.js'), module)
    const manifest = {
      name: 'dsh-csv-analyst', version: '0.1.0', type: 'module',
      files: ['lib', 'README.md', 'README.zh.md', 'SECURITY.md', 'LICENSE', 'cordis.patch.yml'],
      engines: { dsh: '0.2.2-rc.2' }, dsh: { bundle: { patch: './cordis.patch.yml' } }, scripts: {},
    }
    const check = () => run(process.execPath, [join(root, 'scripts/check-package.mjs')], { cwd: root, timeout: 15000 })
    await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
    expect((await check()).stdout).toContain('Package verified')
    for (const extra of [{ bin: { dangerous: './lib/index.js' } }, { scripts: { postinstall: 'echo unsafe' } }]) {
      await writeFile(join(root, 'package.json'), JSON.stringify({ ...manifest, ...extra }))
      await expect(check()).rejects.toThrow()
    }
    await writeFile(join(root, 'unexpected.txt'), 'not allowed')
    await writeFile(join(root, 'package.json'), JSON.stringify({ ...manifest, files: [...manifest.files, 'unexpected.txt'] }))
    await expect(check()).rejects.toThrow()
    await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
    await writeFile(join(root, 'lib/index.js'), module + 'eval("1")\n')
    await expect(check()).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
