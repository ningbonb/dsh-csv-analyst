import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { values } = parseArgs({
  options: { 'dsh-root': { type: 'string' }, replay: { type: 'string' }, record: { type: 'string' } },
})
assert.ok(values['dsh-root'], 'Pass --dsh-root with a built DSH 0.2.2-rc.2 checkout.')
assert.ok(Boolean(values.replay) !== Boolean(values.record), 'Choose exactly one of --replay <fixture> or --record <fixture>. Recording uses your configured local CodeMaker route.')
const dshRoot = resolve(values['dsh-root'])
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
if (values.record) {
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', resolve(values.record)], { cwd: packageRoot, encoding: 'utf8' })
  assert.notEqual(tracked.status, 0, 'Do not overwrite a committed Session recording; record a new scenario into an untracked path.')
}
const recorded = values.replay ? (await readFile(resolve(values.replay), 'utf8')).trim().split('\n').map(line => JSON.parse(line)) : undefined
const task = recorded
  ? recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user').data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  : 'Use csv_inspect to inspect sales.csv, then use csv_query to filter status equal to paid and group by region with a count metric named orders and a sum of amount named revenue. Do not use shell or other filesystem tools. State the exact totals, matched record count and missing numeric amount count for each region. Reply briefly in Chinese.'
const control = await mkdtemp(join(tmpdir(), 'dsh-csv-host-'))
const home = join(control, 'home')
const workspace = join(control, 'workspace')
const { mkdir } = await import('node:fs/promises')
await mkdir(home)
await mkdir(workspace)
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function execute(command, args, cwd = dshRoot, environment = {}) {
  const result = spawnSync(command, args, {
    cwd, env: { ...process.env, DSH_HOME: home, ...environment },
    encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024,
    shell: process.platform === 'win32',
  })
  assert.equal(result.error, undefined, `Command could not complete: ${command} ${args[0]}`)
  assert.equal(result.signal, null, 'Host check was terminated before completion.')
  assert.equal(result.status, 0, `Host command failed: ${command} ${args[0]}\n${result.stderr.slice(-2500)}`)
  return result.stdout
}

try {
  await writeFile(join(workspace, 'sales.csv'), await readFile(join(packageRoot, 'examples/sales.csv')))
  execute(pnpm, ['dsh', '--profile', 'csv-release', '--from-default-profile', 'headless', '--dump-config'])
  const archiveInfo = JSON.parse(execute(npm, ['pack', '--json', '--pack-destination', control], packageRoot))[0]
  execute(pnpm, ['dsh', 'plugin', '--profile', 'csv-release', 'add', join(control, archiveInfo.filename), '--ignore-scripts'])
  const composed = execute(pnpm, ['dsh', '--profile', 'csv-release', '--dump-config'])
  assert.ok(composed.includes('dsh-csv-analyst'), 'Packed bundle not present in composed profile.')
  console.log('PASS packed npm tarball installation and real profile composition.')

  const patch = join(control, 'model.patch.yml')
  let modelEnvironment = {}
  const commonPatch = `- id: fs-sandbox\n  config:\n    cwd: ${JSON.stringify(workspace)}\n- id: working-directory\n  config:\n    defaultDirectory: ${JSON.stringify(workspace)}\n- id: session-title-llm\n  disabled: true\n- id: plugin-package-inventory-deepseek\n  disabled: true\n- id: session-persistence-jsonl\n  config:\n    root: !!js dshHomePath("sessions")\n    compression: none\n`
  if (values.record) {
    const require = createRequire(join(dshRoot, 'package.json'))
    const yaml = require('js-yaml')
    const userHome = process.env.HOME ?? process.env.USERPROFILE
    assert.ok(userHome, 'No user home.')
    const settings = yaml.load(await readFile(join(userHome, '.dsh/settings.yaml'), 'utf8'))
    const provider = settings['llm-pi-ai']?.providers?.codemaker
    assert.ok(provider?.models?.some(model => model.id === 'deepseek-flash'), 'No configured deepseek-flash CodeMaker route.')
    await writeFile(join(home, 'settings.yaml'), yaml.dump({
      'llm-pi-ai': { providers: { codemaker: { ...provider, models: provider.models.filter(model => model.id === 'deepseek-flash') } } },
      'agent-default-model': { provider: 'codemaker', model: 'deepseek-flash' },
    }), { mode: 0o600 })
    const userCredentials = yaml.load(await readFile(join(userHome, '.dsh/.credentials.yaml'), 'utf8'))
    const key = userCredentials.refs?.[provider.apiKeyEnv]
    assert.ok(typeof key === 'string' && key.length > 0, 'Configured model credential is unavailable.')
    modelEnvironment = { [provider.apiKeyEnv]: key }
    await writeFile(join(home, '.credentials.yaml'), yaml.dump({ version: 1, refs: { [provider.apiKeyEnv]: key }, records: {} }), { mode: 0o600 })
    await writeFile(patch, commonPatch + yaml.dump([
      { id: 'credentials', config: { path: join(home, '.credentials.yaml'), watch: false } },
      { id: 'agent-default-model', config: { provider: 'codemaker', model: 'deepseek-flash' } },
      { id: 'llm-pi-ai', config: { providers: { codemaker: { ...provider, models: provider.models.filter(model => model.id === 'deepseek-flash') } } } },
      { id: 'llm-deepseek', disabled: true },
    ]))
  } else {
    await writeFile(patch, commonPatch + '- id: llm-pi-ai\n  disabled: true\n- id: llm-deepseek\n  disabled: true\n- id: agent-default-model\n  config:\n    provider: codemaker\n    model: deepseek-flash\n- insert:\n    - id: csv-replay\n      name: "@deepseek-ai/dsh-llm-replay"\n      config:\n        providers:\n          - id: codemaker\n            name: Replay\n            models:\n              - id: deepseek-flash\n')
  }
  const output = execute(pnpm, ['--dir', dshRoot, 'dsh', '--profile', 'csv-release', '--patch', patch, '--json', '--approval-policy', 'never', task], workspace, values.replay ? { DSH_SNAPSHOT_FILE: resolve(values.replay) } : modelEnvironment)
  const sessionRoot = join(home, 'sessions')
  const entries = await readdir(sessionRoot, { withFileTypes: true, recursive: true })
  const generations = entries.filter(entry => entry.isFile() && /^session\.v\d+\.jsonl$/u.test(entry.name)).sort((first, second) => Number(second.name.match(/\d+/u)[0]) - Number(first.name.match(/\d+/u)[0]))
  assert.ok(generations[0], 'No uncompressed current Session generation.')
  const bytes = await readFile(join(generations[0].parentPath, generations[0].name), 'utf8')
  const events = bytes.trim().split('\n').map(line => JSON.parse(line))
  const calls = events.filter(event => event.type === 'tool/call')
  const results = events.filter(event => event.type === 'tool/result')
  assert.ok(calls.some(event => JSON.stringify(event).includes('csv_inspect')), 'Model did not call csv_inspect.')
  assert.ok(calls.some(event => JSON.stringify(event).includes('csv_query')), 'Model did not call csv_query.')
  const resultText = results.map(event => JSON.stringify(event)).join('\n')
  assert.ok(resultText.includes('0.25'), 'Exact paid revenue absent from actual tool results.')
  assert.ok(resultText.includes('contributingRows'), 'Missing-value counts absent from actual tool results.')
  assert.ok(!results.some(event => event.data.message.isError), `A model tool call failed: ${JSON.stringify(results.filter(event => event.data.message.isError).map(event => ({ error: event.data.error, content: event.data.message.content })))}`)
  assert.deepEqual(calls.map(event => event.data.name), ['csv_inspect', 'csv_query'])
  const queryCall = calls.find(event => event.data.name === 'csv_query')
  const queryMessage = results.find(event => event.data.message.toolCallId === queryCall.data.callId).data.message
  const actual = JSON.parse(queryMessage.content.find(block => block.type === 'text').text)
  assert.deepEqual(actual.rows, [['广州', '3', '0.25'], ['上海', '1', '0']])
  assert.deepEqual(actual.contributingRows, [[3, 3], [1, 0]])
  assert.equal(actual.totalRows, 5)
  assert.equal(actual.matchedRows, 4)
  assert.equal(actual.truncated, false)
  assert.ok(output.includes('广州'), 'Expected region missing from headless output.')
  assert.equal(await readFile(join(workspace, 'sales.csv'), 'utf8'), await readFile(join(packageRoot, 'examples/sales.csv'), 'utf8'))
  if (values.record) {
    const normalizeUrl = pathToFileURL(join(dshRoot, 'packages/test-support/session-snapshot/src/normalize.ts')).href
    const projected = execute(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e',
      `import { readFileSync } from 'node:fs'; import { normalizeSessionSnapshot } from ${JSON.stringify(normalizeUrl)}; const text = readFileSync(${JSON.stringify(join(generations[0].parentPath, generations[0].name))}, 'utf8'); process.stdout.write(normalizeSessionSnapshot(text, { sessionIds: [], cwd: ${JSON.stringify(actual.path.slice(0, -'/sales.csv'.length))}, cwdAliases: [${JSON.stringify(workspace)}] }));`,
    ])
    assert.ok(!projected.includes('apiKeyEnv') && !projected.includes('Bearer '), 'Fixture may contain provider configuration.')
    assert.ok(!Object.values(modelEnvironment).some(secret => projected.includes(secret)), 'Fixture contains a model credential.')
    assert.ok(!projected.includes(control), 'Fixture contains a temporary test root.')
    await writeFile(resolve(values.record), projected)
  }
  if (recorded) assert.deepEqual(calls.map(event => ({ name: event.data.name, arguments: JSON.parse(event.data.arguments) })), recorded.filter(event => event.type === 'tool/call').map(event => ({ name: event.data.name, arguments: JSON.parse(event.data.arguments) })))
  console.log(`PASS ${values.record ? 'live configured model' : 'keyless recorded model'} → actual CSV tools → persisted Session; source file unchanged.`)
  execute(pnpm, ['dsh', 'plugin', '--profile', 'csv-release', 'remove', 'dsh-csv-analyst'])
  const profile = JSON.parse(await readFile(join(home, 'profiles/csv-release/package.json'), 'utf8'))
  assert.ok(!profile.dependencies?.['dsh-csv-analyst'])
  assert.ok(!profile.dsh.profile.bundles.includes('dsh-csv-analyst'))
  console.log('PASS packed bundle removal without user-profile modification.')
} finally {
  await rm(control, { recursive: true, force: true })
}
