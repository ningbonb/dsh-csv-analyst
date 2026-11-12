import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { queryTable } from '../src/analysis.ts'
import { config, signal, source, table } from './helpers.ts'

it('replays the documented paid-order scenario with explicit missing-amount evidence', async () => {
  const csv = await readFile(new URL('../examples/sales.csv', import.meta.url), 'utf8')
  const result = await queryTable(table(csv), {
    path: source.path,
    filters: [{ column: 'status', op: 'eq', value: 'paid' }],
    group_by: ['region'],
    metrics: [{ op: 'count', as: 'orders' }, { op: 'sum', column: 'amount', as: 'revenue' }],
  }, source, config(), signal)
  const expected = JSON.parse(await readFile(new URL('./snapshots/paid-by-region.json', import.meta.url), 'utf8'))
  expect(result).toEqual(expected)
})
