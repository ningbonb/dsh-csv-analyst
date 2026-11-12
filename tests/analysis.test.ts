import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { inspectTable, queryTable } from '../src/analysis.ts'
import type { QueryArgs } from '../src/schema.ts'
import { config, signal, source, table } from './helpers.ts'

const sales = table('region,amount,status\n广州,0.10,paid\n广州,0.20,paid\n上海,10.00,pending\n上海,,paid\n广州,-0.05,paid')

function query(args: Omit<QueryArgs, 'path'> = {}, input = sales, limits = config()) {
  return queryTable(input, { path: source.path, ...args }, source, limits, signal)
}

describe('inspection and exact aggregate statistics', () => {
  it('counts every record and distinguishes blank, decimal and other cells', async () => {
    const result = await inspectTable(table('value\n1\n \ntext\n1e2\n12345'), { path: '/x', sample_rows: 2 }, source, config({ maxNumericDigits: 4 }), signal)
    expect(result.quality).toEqual([{ column: 'value', blankCells: 1, decimalCells: 1, otherCells: 3 }])
    expect(result.totalRows).toBe(5)
    expect(result.sample).toEqual([['1'], [' ']])
    expect(result.sampleTruncated).toBe(true)
  })
  it('supports zero previews, complete previews and empty tables', async () => {
    expect((await inspectTable(sales, { path: '/x', sample_rows: 0 }, source, config(), signal)).sample).toEqual([])
    const empty = await inspectTable(table('x'), { path: '/x' }, source, config({ maxReturnedRows: 1 }), signal)
    expect(empty.sampleTruncated).toBe(false)
    expect(empty.quality[0]).toEqual({ column: 'x', blankCells: 0, decimalCells: 0, otherCells: 0 })
  })
  it('uses configured preview and query defaults without changing page caps', async () => {
    const limits = config({ defaultPreviewRows: 2, defaultPageRows: 3 })
    expect((await inspectTable(sales, { path: '/x' }, source, limits, signal)).sample).toHaveLength(2)
    expect((await query({}, sales, limits)).returnedRows).toBe(3)
    expect((await inspectTable(sales, { path: '/x' }, source, config({ defaultPreviewRows: 0 }), signal)).sample).toEqual([])
  })
  it('uses exact-decimal sum, average, extrema and per-metric contributing counts', async () => {
    const result = await query({
      filters: [{ column: 'status', op: 'eq', value: 'paid' }],
      group_by: ['region'],
      metrics: [
        { op: 'count', as: 'orders' }, { op: 'sum', column: 'amount', as: 'revenue' },
        { op: 'avg', column: 'amount', as: 'average' }, { op: 'min', column: 'amount', as: 'smallest' },
        { op: 'max', column: 'amount', as: 'largest' },
      ],
    })
    expect(result.rows).toEqual([['广州', '3', '0.25', '0.083333333333', '-0.05', '0.2'], ['上海', '1', '0', null, null, null]])
    expect(result.contributingRows).toEqual([[3, 3, 3, 3, 3], [1, 0, 0, 0, 0]])
    expect(result.totalRows).toBe(5)
    expect(result.matchedRows).toBe(4)
    expect(result.resultRows).toBe(2)
  })
  it('rounds averages half up with configurable decimal places', async () => {
    const result = await query({ metrics: [{ op: 'avg', column: 'amount', as: 'mean' }] }, table('amount\n1\n2'), config({ averageDecimalPlaces: 0 }))
    expect(result.rows).toEqual([['2']])
  })
  it('gives honest empty aggregates without manufacturing a group', async () => {
    const metrics = [{ op: 'count', as: 'count' }, { op: 'sum', column: 'amount', as: 'sum' }, { op: 'avg', column: 'amount', as: 'avg' }] as const
    expect((await query({ metrics: [...metrics] }, table('amount'))).rows).toEqual([['0', '0', null]])
    expect((await query({ group_by: ['amount'], metrics: [...metrics] }, table('amount'))).rows).toEqual([])
  })
  it('keeps groups collision-free for control characters and prototype-like keys', async () => {
    const result = await query({ group_by: ['first', 'second'], metrics: [{ op: 'count', as: 'count' }] }, table('first,second\n__proto__,constructor\n"x|y",z\nx,"y|z"'))
    expect(result.resultRows).toBe(3)
  })
  it('does not lose large integer or small decimal digits', async () => {
    const result = await query({ metrics: [{ op: 'sum', column: 'n', as: 'sum' }] }, table('n\n9007199254740993\n0.000000000000000001\n-9007199254740992'))
    expect(result.rows).toEqual([['1.000000000000000001']])
  })
  it('proves exact sums against independently generated integer cents', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.integer({ min: -10000000, max: 10000000 }), { maxLength: 120 }), async values => {
      const cents = values.reduce((sum, value) => sum + BigInt(value), 0n)
      const input = { columns: ['amount'], rows: values.map(value => [String(value / 100)]) }
      const result = await query({ metrics: [{ op: 'sum', column: 'amount', as: 'sum' }] }, input)
      const actual = String(result.rows[0]![0])
      const [integer, fraction = ''] = actual.replace('-', '').split('.')
      const restored = BigInt(integer!) * 100n + BigInt(fraction.padEnd(2, '0'))
      expect(actual.startsWith('-') ? -restored : restored).toBe(cents)
    }), { numRuns: 150, seed: 20261112 })
  })
})

describe('filters, sorting and complete counting', () => {
  it.each([
    ['eq', '0.1', 1], ['ne', '0.1', 3], ['gt', '0.1', 2],
    ['gte', '0.1', 3], ['lt', '0.1', 1], ['lte', '0.1', 2],
  ] as const)('compares decimal %s without binary floating-point', async (op, value, expected) => {
    expect((await query({ filters: [{ column: 'amount', mode: 'decimal', op, value }] })).matchedRows).toBe(expected)
  })
  it.each([
    ['eq', 'paid', 4], ['ne', 'paid', 1], ['contains', 'aid', 4],
  ] as const)('applies case-sensitive text %s', async (op, value, expected) => {
    expect((await query({ filters: [{ column: 'status', op, value }] })).matchedRows).toBe(expected)
  })
  it.each([['empty', 1], ['not_empty', 4]] as const)('filters %s cells', async (op, count) => {
    expect((await query({ filters: [{ column: 'amount', op }] })).matchedRows).toBe(count)
  })
  it('ANDs conditions and validates numerical data even if another condition fails', async () => {
    expect((await query({ filters: [{ column: 'region', op: 'eq', value: '广州' }, { column: 'amount', op: 'gt', mode: 'decimal', value: '0' }] })).matchedRows).toBe(2)
    await expect(query({ filters: [{ column: 'x', op: 'eq', value: 'never' }, { column: 'amount', op: 'gt', mode: 'decimal', value: '0' }] }, table('x,amount\na,secret'))).rejects.toMatchObject({ code: 'CSV_NUMBER' })
  })
  it('sorts numeric output, pages after aggregation and preserves full counts', async () => {
    const result = await query({
      group_by: ['region'], metrics: [{ op: 'sum', column: 'amount', as: 'sum' }],
      sort: [{ column: 'sum', direction: 'desc', mode: 'decimal' }], limit: 1,
    })
    expect(result.rows).toEqual([['上海', '10']])
    expect(result.matchedRows).toBe(5)
    expect(result.resultRows).toBe(2)
    expect(result.truncated).toBe(true)
  })
  it('sorts numeric blanks and null aggregates last in either direction', async () => {
    for (const direction of ['asc', 'desc'] as const) {
      expect((await query({ sort: [{ column: 'amount', mode: 'decimal', direction }] })).rows.at(-1)![1]).toBe('')
      expect((await query({
        group_by: ['region'], metrics: [{ op: 'avg', column: 'amount', as: 'avg' }],
        filters: [{ column: 'status', op: 'eq', value: 'paid' }],
        sort: [{ column: 'avg', mode: 'decimal', direction }],
      })).rows.at(-1)).toEqual(['上海', null])
    }
  })
  it('keeps two missing numeric sort keys stable and places a later populated key first', async () => {
    const result = await query({
      group_by: ['region'], metrics: [{ op: 'avg', column: 'amount', as: 'avg' }],
      sort: [{ column: 'avg', mode: 'decimal' }],
    }, table('region,amount\nfirst,\nsecond,\nthird,1'))
    expect(result.rows).toEqual([['third', '1'], ['first', null], ['second', null]])
  })
  it('supports stable multi-key text and decimal sorting', async () => {
    const result = await query({ select: ['name', 'n'], sort: [{ column: 'name' }, { column: 'n', mode: 'decimal' }] }, table('name,n\nb,10\na,2\na,1\na,1'))
    expect(result.rows).toEqual([['a', '1'], ['a', '1'], ['a', '2'], ['b', '10']])
    const text = await query({ sort: [{ column: 'n', direction: 'desc' }] }, table('n\n10\n2'))
    expect(text.rows).toEqual([['2'], ['10']])
  })
  it('supports projection, offsets beyond the last row and bounded defaults', async () => {
    const result = await query({ select: ['status'], offset: 4 }, sales, config({ maxReturnedRows: 1 }))
    expect(result.rows).toEqual([['paid']])
    expect(result.truncated).toBe(true)
    expect(result.contributingRows).toEqual([])
    expect((await query({ offset: 100 })).returnedRows).toBe(0)
  })
})

describe('fail-closed arguments and resource budgets', () => {
  it.each([
    { limit: 0 }, { limit: 201 }, { limit: 1.5 }, { offset: -1 }, { offset: NaN },
    { select: [] }, { select: ['amount', 'amount'] }, { select: ['missing'] },
    { group_by: ['region'] }, { group_by: ['region', 'region'], metrics: [{ op: 'count', as: 'n' }] },
    { select: ['amount'], metrics: [{ op: 'count', as: 'n' }] },
    { metrics: [{ op: 'count', column: 'amount', as: 'n' }] },
    { metrics: [{ op: 'sum', as: 'n' }] }, { metrics: [{ op: 'sum', column: 'missing', as: 'n' }] },
    { metrics: [{ op: 'count', as: ' ' }] }, { group_by: ['region'], metrics: [{ op: 'count', as: 'region' }] },
    { sort: [{ column: 'missing' }] },
    { filters: [{ column: 'amount', op: 'empty', value: '' }] },
    { filters: [{ column: 'amount', op: 'eq' }] },
    { filters: [{ column: 'amount', op: 'gt', value: '1' }] },
    { filters: [{ column: 'amount', op: 'contains', mode: 'decimal', value: '1' }] },
  ] satisfies Omit<QueryArgs, 'path'>[])('rejects %j', async args => {
    await expect(query(args)).rejects.toMatchObject({ code: 'INVALID_ARGS' })
  })
  it('bounds each user-controlled operation list', async () => {
    for (const args of [
      { select: ['region', 'amount'] },
      { filters: [{ column: 'region', op: 'empty' }, { column: 'amount', op: 'empty' }] },
      { group_by: ['region', 'amount'] },
      { metrics: [{ op: 'count', as: 'n' }, { op: 'count', as: 'm' }] },
      { sort: [{ column: 'region' }, { column: 'amount' }] },
    ] satisfies Omit<QueryArgs, 'path'>[]) await expect(query(args, sales, config({ maxOperations: 1 }))).rejects.toMatchObject({ code: 'INVALID_ARGS' })
  })
  it('rejects invalid numeric content rather than guessing units or losing money', async () => {
    for (const value of ['1,000', '1e3', '￥5', 'NaN', 'Infinity', '=1+1', '12345', 'secret']) {
      await expect(query({ metrics: [{ op: 'sum', column: 'amount', as: 'sum' }] }, { columns: ['amount'], rows: [[value]] }, config({ maxNumericDigits: 4 }))).rejects.toMatchObject({ code: 'CSV_NUMBER' })
    }
    await expect(query({ filters: [{ column: 'amount', op: 'eq', mode: 'decimal', value: 'bad' }] })).rejects.toMatchObject({ code: 'CSV_NUMBER' })
    await expect(query({ sort: [{ column: 'region', mode: 'decimal' }] })).rejects.toMatchObject({ code: 'CSV_NUMBER' })
  })
  it('refuses excess group cardinality instead of returning partial totals', async () => {
    await expect(query({ group_by: ['region'], metrics: [{ op: 'count', as: 'n' }] }, sales, config({ maxGroups: 1 }))).rejects.toMatchObject({ code: 'CSV_LIMIT' })
  })
  it('refuses invalid inspection limits', async () => {
    await expect(inspectTable(sales, { path: '/x', sample_rows: -1 }, source, config(), signal)).rejects.toMatchObject({ code: 'INVALID_ARGS' })
  })
  it('yields so scheduled cancellation interrupts analysis and quality scans', async () => {
    for (const run of [
      (abortSignal: AbortSignal) => queryTable(sales, { path: '/x' }, source, config({ batchRows: 1 }), abortSignal),
      (abortSignal: AbortSignal) => inspectTable(sales, { path: '/x' }, source, config({ batchRows: 1 }), abortSignal),
    ]) {
      const controller = new AbortController()
      const task = run(controller.signal)
      controller.abort(new Error('user-cancelled'))
      await expect(task).rejects.toMatchObject({ name: 'AbortError' })
    }
  })
  it('preserves pre-abort reasons', async () => {
    const controller = new AbortController()
    controller.abort(new Error('pre-aborted'))
    await expect(queryTable(sales, { path: '/x' }, source, config(), controller.signal)).rejects.toThrow('pre-aborted')
    await expect(inspectTable(sales, { path: '/x' }, source, config(), controller.signal)).rejects.toThrow('pre-aborted')
  })
})
