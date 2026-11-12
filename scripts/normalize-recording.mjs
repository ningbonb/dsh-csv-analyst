import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [rootArg, fixtureArg] = process.argv.slice(2)
assert.ok(rootArg && fixtureArg, 'Usage: node scripts/normalize-recording.mjs <built-dsh-root> <uncommitted-fixture>')
const root = resolve(rootArg)
const fixture = resolve(fixtureArg)
const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', fixture], { cwd: dirname(fixture), encoding: 'utf8' })
assert.notEqual(tracked.status, 0, 'Normalize only a new, untracked recording; committed Session generations are not rewritten.')
const raw = await readFile(fixture, 'utf8')
const events = raw.trim().split('\n').map(line => JSON.parse(line))
const cwd = events[0].cwd
assert.equal(events[0].version, 4)
assert.ok(typeof cwd === 'string')
const normalize = pathToFileURL(join(root, 'packages/test-support/session-snapshot/src/normalize.ts')).href
const result = spawnSync(process.execPath, [
  '--import', 'tsx/esm', '--input-type=module', '-e',
  `import { readFileSync } from 'node:fs'; import { normalizeSessionSnapshot } from ${JSON.stringify(normalize)}; process.stdout.write(normalizeSessionSnapshot(readFileSync(${JSON.stringify(fixture)}, 'utf8'), { sessionIds: [], cwd: ${JSON.stringify(cwd)}, cwdAliases: [${JSON.stringify(cwd.replace('/private/var/', '/var/'))}] }));`,
], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 })
assert.equal(result.error, undefined)
assert.equal(result.status, 0, result.stderr)
assert.ok(!result.stdout.includes('/Users/') && !result.stdout.includes('/Volumes/') && !result.stdout.includes('/var/folders/'))
const systems = events.filter(event => event.type === 'system/message').map(event => event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
const schemas = events.filter(event => event.type === 'request/header').map(event => event.data.header.tools)
const uniqueSystems = [...new Set(systems)]
const uniqueSchemas = [...new Set(schemas.map(value => JSON.stringify(value)))]
assert.equal(uniqueSystems.length, 1, 'This one-shot scenario must keep one system prompt.')
assert.equal(uniqueSchemas.length, 1, 'This one-shot scenario must keep one tool catalog.')
await writeFile(fixture, result.stdout)
await writeFile(join(dirname(fixture), 'system-prompt.expected.md'), uniqueSystems[0] + '\n')
await writeFile(join(dirname(fixture), 'tool-schemas.expected.json'), JSON.stringify(JSON.parse(uniqueSchemas[0]), null, 2) + '\n')
console.log('Normalized Session V4 recording and extracted its one owned prompt/schema pair.')
