import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const packed = spawnSync(npm, ['pack', '--dry-run', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' })
assert.equal(packed.status, 0, packed.stderr)
const [archive] = JSON.parse(packed.stdout)
const paths = archive.files.map(file => file.path)
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
assert.equal(manifest.engines.dsh, '0.2.2-rc.2')
assert.equal(manifest.type, 'module')
assert.equal(manifest.bin, undefined)
for (const hook of ['install', 'postinstall', 'preinstall', 'prepare']) assert.equal(manifest.scripts[hook], undefined)
for (const required of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/index.d.ts', 'README.md', 'README.zh.md', 'LICENSE', 'SECURITY.md']) assert.ok(paths.includes(required), `Missing ${required}`)
for (const path of paths) assert.match(path, /^(lib\/[a-z-]+\.(js|d\.ts)|package\.json|cordis\.patch\.yml|README(\.zh)?\.md|LICENSE|SECURITY\.md)$/u, `Unexpected published file: ${path}`)
for (const path of paths.filter(path => path.endsWith('.js'))) {
  const code = readFileSync(path, 'utf8')
  assert.doesNotMatch(code, /(?:from\s+|import\s*\()['"][^'"]+\.ts['"]/u)
  assert.doesNotMatch(code, /\beval\s*\(|\bnew\s+Function\s*\(|node:(?:child_process|fs|http|https|net)/u)
}
const plugin = await import('../lib/index.js')
assert.equal(plugin.name, 'csv-analyst')
assert.equal(typeof plugin.apply, 'function')
assert.deepEqual(plugin.inject, ['tools', 'fs', 'workingDirectory'])
console.log(`Package verified: ${archive.filename}, ${paths.length} allowlisted files, ${archive.size} bytes; no executable bin or installation hooks.`)
