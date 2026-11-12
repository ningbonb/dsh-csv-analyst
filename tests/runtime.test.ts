import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolsService } from '@deepseek-ai/dsh-tools'
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as plugin from '../src/index.ts'
import type { Config } from '../src/config.ts'
import { Config as validateConfig } from '../src/config.ts'
import { directoryAgent } from './agent-fixture.ts'

let ctx: Context
let root: string

async function mount(overrides: Partial<Config> = {}) {
  return ctx.plugin(plugin, validateConfig(overrides))
}

async function call(name: string, args: object, signal = new AbortController().signal) {
  const result = await ctx.tools.execute({
    calls: [{ type: 'tool-call', id: ToolCallId('csv-test-call'), name, arguments: JSON.stringify(args) }],
    signal,
  })
  return result.results[0]!.result
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-csv-test-')))
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolsService)
  await ctx.plugin(NativeExecutor)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(SessionProjections)
  await ctx.plugin(WorkingDirectory, { defaultDirectory: root })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

describe('real Cordis, filesystem and native tool pipeline', () => {
  it('registers both tools, returns typed output and keeps the source unchanged', async () => {
    await mount()
    const bytes = 'region,amount\n广州,0.10\n广州,0.20'
    await writeFile(join(root, 'sales.csv'), bytes)
    const result = await call('csv_inspect', { path: 'sales.csv' })
    expect(result.isError).toBeFalsy()
    expect(result.value).toMatchObject({
      path: join(root, 'sales.csv'), totalRows: 2,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      columns: ['region', 'amount'],
    })
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.value) }])
    const sum = await call('csv_query', { path: 'sales.csv', metrics: [{ op: 'sum', column: 'amount', as: 'sum' }] })
    expect(sum.isError).toBeFalsy()
    expect(sum.value).toMatchObject({ rows: [['0.3']], contributingRows: [[2]] })
    expect(await readFile(join(root, 'sales.csv'), 'utf8')).toBe(bytes)
  })
  it('unregisters on unload and remounts without duplicate registration', async () => {
    const fiber = await mount()
    expect(ctx.tools.get('csv_inspect')).toBeDefined()
    expect(ctx.tools.get('csv_query')).toBeDefined()
    await fiber.dispose()
    expect(ctx.tools.get('csv_inspect')).toBeUndefined()
    expect(ctx.tools.get('csv_query')).toBeUndefined()
    await mount()
    expect(ctx.tools.get('csv_query')).toBeDefined()
  })
  it('resolves relative paths against the owning session, not the provider default', async () => {
    await mount()
    const { mkdir } = await import('node:fs/promises')
    const directory = join(root, 'session')
    await mkdir(directory)
    await writeFile(join(directory, 'sales.csv'), 'amount\n1')
    const agent = directoryAgent(ctx, directory)
    const result = await ctx.tools.execute({
      agent,
      signal: new AbortController().signal,
      calls: [{ type: 'tool-call', id: ToolCallId('relative-path'), name: 'csv_query', arguments: '{"path":"sales.csv"}' }],
    })
    expect(result.results[0]!.result.value).toMatchObject({ path: join(directory, 'sales.csv'), rows: [['1']] })
  })
  it('honors real pre-execute policy denials without reading any bytes', async () => {
    await mount()
    const read = vi.spyOn(ctx.fs, 'readBytes')
    ctx.tools.guard(() => ({ reason: 'fixture policy denies access', info: { name: 'PermissionError', code: 'TEST_DENIED' } }))
    const result = await call('csv_query', { path: 'sales.csv' })
    expect(result.isError).toBe(true)
    expect(read).not.toHaveBeenCalled()
  })
  it('observes missing files and preserves typed filesystem errors', async () => {
    await mount()
    const observed = vi.fn()
    ctx.on('fs/observed', observed)
    const result = await call('csv_inspect', { path: 'missing.csv' })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { name: 'FsError', code: 'FS_NOT_FOUND' } })
    expect(observed.mock.calls[0]![1]).toEqual({ kind: 'absent' })
    const directory = await call('csv_query', { path: root })
    expect(directory.error).toMatchObject({ info: { code: 'FS_NOT_REGULAR_FILE' } })
  })
  it('applies its byte cap inside the filesystem provider', async () => {
    await mount({ maxBytes: 3 })
    await writeFile(join(root, 'large.csv'), 'name\nvalue')
    const result = await call('csv_query', { path: 'large.csv' })
    expect(result.error).toMatchObject({ info: { code: 'FS_TOO_LARGE' } })
  })
  it('fails oversize output rather than silently truncating values', async () => {
    await mount({ maxOutputBytes: 1 })
    await writeFile(join(root, 'sales.csv'), 'amount\n1')
    const result = await call('csv_query', { path: 'sales.csv' })
    expect(result.error).toMatchObject({ info: { name: 'CsvError', code: 'CSV_LIMIT' } })
  })
  it('validates model JSON and hand-checked arguments before returning success', async () => {
    await mount()
    for (const args of [{ path: ' ' }, { path: 42 }, { path: 'x', delimiter: '.' }, { path: 'x', filters: [{ column: 'a', op: 'eq', value: '1', script: 'evil' }] }]) {
      const result = await call('csv_query', args)
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { code: 'INVALID_ARGS' } })
    }
  })
  it('retains stable decoding and numeric error codes', async () => {
    await mount()
    await writeFile(join(root, 'binary.csv'), new Uint8Array([0xff]))
    expect((await call('csv_inspect', { path: 'binary.csv' })).error).toMatchObject({ info: { code: 'CSV_ENCODING' } })
    await writeFile(join(root, 'bad.csv'), 'amount\nsecret')
    expect((await call('csv_query', { path: 'bad.csv', metrics: [{ op: 'sum', column: 'amount', as: 'sum' }] })).error).toMatchObject({ info: { code: 'CSV_NUMBER' } })
  })
  it('contains cancellation in the real executor', async () => {
    await mount()
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    const result = await call('csv_query', { path: 'x' }, controller.signal)
    expect(result.isError).toBe(true)
  })
  it('cancels and drains an in-flight provider read before unloading', async () => {
    const fiber = await mount()
    await writeFile(join(root, 'sales.csv'), 'amount\n1')
    const started = Promise.withResolvers<void>()
    vi.spyOn(ctx.fs, 'readBytes').mockImplementation(async (_target, signal) => {
      started.resolve()
      await new Promise<void>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
      })
      return new Uint8Array()
    })
    const reading = call('csv_query', { path: 'sales.csv' })
    await started.promise
    await fiber.dispose()
    const result = await reading
    expect(result.error).toMatchObject({ info: { name: 'AbortError', code: 'ABORTED' } })
    expect(ctx.tools.get('csv_query')).toBeUndefined()
  })
  it('provides pure replay-compatible generic read presenters', async () => {
    await mount()
    for (const name of ['csv_inspect', 'csv_query']) {
      expect(ctx.tools.get(name)!.presentCall?.({ path: 'sales.csv' })).toMatchObject({ card: 'generic', kind: 'read', locations: [{ path: 'sales.csv' }] })
    }
  })
  it('shows the effective configured defaults and caps in model-facing schemas', async () => {
    await mount({ maxReturnedRows: 2, defaultPreviewRows: 1, defaultPageRows: 10 })
    expect(JSON.stringify(ctx.tools.get('csv_inspect')!.parameters)).toContain('from 0 to 2. Defaults to 1.')
    expect(JSON.stringify(ctx.tools.get('csv_query')!.parameters)).toContain('from 1 to 2. Defaults to 2.')
  })
})
