/** Read-only table operations with exact sums and explicit missing-value counts. @module */
import { setImmediate } from 'node:timers/promises'
import { Decimal } from 'decimal.js'
import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import { CsvError } from './errors.ts'
import type { Config } from './config.ts'
import type { Table } from './csv.ts'
import type { InspectArgs, InspectResult, QueryArgs, QueryResult } from './schema.ts'

/** File identity for one completed bounded read. */
export interface Source {
  path: string
  sha256: string
  bytes: number
  delimiter: string
}

function decimalText(value: string, config: Config): string | undefined {
  const trimmed = value.trim()
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(trimmed)) return undefined
  if (trimmed.replace(/\D/gu, '').length > config.maxNumericDigits) return undefined
  return trimmed
}

function decimalConstructor(config: Config): typeof Decimal {
  return Decimal.clone({ precision: config.maxNumericDigits * 2 + String(config.maxRows).length + 10 })
}

function requireDecimal(value: string, column: string, config: Config, Numeric: typeof Decimal): Decimal {
  const parsed = decimalText(value, config)
  if (parsed === undefined) throw new CsvError(`Column "${column}" contains an invalid decimal or exceeds maxNumericDigits. Use csv_inspect to check data quality.`, 'CSV_NUMBER')
  return new Numeric(parsed)
}

async function checkpoint(index: number, config: Config, signal: AbortSignal): Promise<void> {
  if (index % config.batchRows === 0) {
    await setImmediate(undefined, { signal })
    signal.throwIfAborted()
  }
}

function pageInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ToolArgsError([`${field} must be an integer between ${minimum} and ${maximum}.`])
  }
  return value
}

function columnIndex(columns: readonly string[], column: string): number {
  const index = columns.indexOf(column)
  if (index < 0) throw new ToolArgsError([`Unknown column "${column}". Use csv_inspect for exact header names.`])
  return index
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new ToolArgsError([`${label} must not contain duplicates.`])
}

/**
 * Compute quality counts over every record and return a bounded preview.
 * @param table - Complete validated records.
 * @param args - Validated inspection arguments.
 * @param source - Identity of the bytes actually read.
 * @param config - Resource limits.
 * @param signal - Cancellation during quality scanning.
 * @returns Full-file quality counts and an explicitly marked sample.
 */
export async function inspectTable(table: Table, args: InspectArgs, source: Source, config: Config, signal: AbortSignal): Promise<InspectResult> {
  signal.throwIfAborted()
  const limit = pageInteger(args.sample_rows ?? Math.min(5, config.maxReturnedRows), 0, config.maxReturnedRows, 'sample_rows')
  const quality = table.columns.map(column => ({ column, blankCells: 0, decimalCells: 0, otherCells: 0 }))
  for (const [index, row] of table.rows.entries()) {
    await checkpoint(index, config, signal)
    for (const [field, cell] of row.entries()) {
      const counts = quality[field]!
      if (cell.trim() === '') counts.blankCells++
      else if (decimalText(cell, config) !== undefined) counts.decimalCells++
      else counts.otherCells++
    }
  }
  signal.throwIfAborted()
  return { ...source, totalRows: table.rows.length, columns: table.columns, quality, sample: table.rows.slice(0, limit), sampleTruncated: limit < table.rows.length }
}

interface MetricState {
  count: number
  value: Decimal | null
}

interface OutputRow {
  cells: (string | null)[]
  counts: number[]
}

/**
 * Filter, aggregate, sort and page a complete table without executing user code.
 * @param table - Complete validated records.
 * @param args - Schema-validated declarative query.
 * @param source - Identity of the bytes actually read.
 * @param config - Resource and average-rounding limits.
 * @param signal - Cancellation during full-table scanning.
 * @returns Exact decimal strings, full counts, and explicitly marked paging.
 */
export async function queryTable(table: Table, args: QueryArgs, source: Source, config: Config, signal: AbortSignal): Promise<QueryResult> {
  signal.throwIfAborted()
  const offset = pageInteger(args.offset ?? 0, 0, Number.MAX_SAFE_INTEGER, 'offset')
  const limit = pageInteger(args.limit ?? Math.min(100, config.maxReturnedRows), 1, config.maxReturnedRows, 'limit')
  const filters = args.filters ?? []
  const metrics = args.metrics ?? []
  const groupColumns = args.group_by ?? []
  const selected = args.select ?? table.columns
  const sorts = args.sort ?? []
  for (const [label, operations] of Object.entries({ filters, metrics, group_by: groupColumns, sort: sorts, ...args.select === undefined ? {} : { select: args.select } })) {
    if (operations.length > config.maxOperations) throw new ToolArgsError([`${label} exceeds maxOperations (${config.maxOperations}).`])
  }
  if (args.select !== undefined && (selected.length === 0 || metrics.length > 0)) throw new ToolArgsError(['select must be nonempty and cannot be combined with metrics.'])
  if (groupColumns.length > 0 && metrics.length === 0) throw new ToolArgsError(['group_by requires at least one metric.'])
  unique(selected, 'select')
  unique(groupColumns, 'group_by')
  const selectedIndices = selected.map(column => columnIndex(table.columns, column))
  const groupIndices = groupColumns.map(column => columnIndex(table.columns, column))
  const Numeric = decimalConstructor(config)
  const conditions = filters.map(filter => {
    const index = columnIndex(table.columns, filter.column)
    const mode = filter.mode ?? 'text'
    const unary = filter.op === 'empty' || filter.op === 'not_empty'
    if (unary ? filter.value !== undefined : filter.value === undefined) throw new ToolArgsError(['empty/not_empty take no value; all other filters require a value.'])
    if (['gt', 'gte', 'lt', 'lte'].includes(filter.op) && mode !== 'decimal') throw new ToolArgsError(['gt/gte/lt/lte require mode: decimal.'])
    if (filter.op === 'contains' && mode === 'decimal') throw new ToolArgsError(['contains requires mode: text.'])
    const comparison = mode === 'decimal' && !unary ? requireDecimal(filter.value!, filter.column, config, Numeric) : undefined
    return (row: string[]): boolean => {
      const value = row[index]!
      const blank = value.trim() === ''
      if (filter.op === 'empty') return blank
      if (filter.op === 'not_empty') return !blank
      if (filter.op === 'contains') return value.includes(filter.value!)
      if (mode === 'text') return filter.op === 'eq' ? value === filter.value : value !== filter.value
      if (blank) return false
      const order = requireDecimal(value, filter.column, config, Numeric).comparedTo(comparison!)
      return { eq: order === 0, ne: order !== 0, gt: order > 0, gte: order >= 0, lt: order < 0, lte: order <= 0 }[filter.op]
    }
  })
  const metricIndices = metrics.map(metric => {
    if (metric.as.trim() === '') throw new ToolArgsError(['Metric aliases must be nonblank.'])
    if (metric.op === 'count') {
      if (metric.column !== undefined) throw new ToolArgsError(['count counts records and takes no column.'])
      return -1
    }
    if (metric.column === undefined) throw new ToolArgsError([`${metric.op} requires a column.`])
    return columnIndex(table.columns, metric.column)
  })
  const columns = metrics.length > 0 ? [...groupColumns, ...metrics.map(metric => metric.as)] : selected
  unique(columns, 'output columns')
  const sortIndices = sorts.map(sort => ({ index: columnIndex(columns, sort.column), ...sort }))
  const groups = new Map<string, { keys: string[]; states: MetricState[] }>()
  const rows: OutputRow[] = []
  const createGroup = (keys: string[]) => ({ keys, states: metrics.map(() => ({ count: 0, value: null as Decimal | null })) })
  if (metrics.length > 0 && groupColumns.length === 0) groups.set('[]', createGroup([]))
  let matchedRows = 0
  for (const [index, row] of table.rows.entries()) {
    await checkpoint(index, config, signal)
    const decisions = conditions.map(condition => condition(row))
    if (!decisions.every(Boolean)) continue
    matchedRows++
    if (metrics.length === 0) {
      rows.push({ cells: selectedIndices.map(field => row[field]!), counts: [] })
      continue
    }
    const keys = groupIndices.map(field => row[field]!)
    const key = JSON.stringify(keys)
    let group = groups.get(key)
    if (group === undefined) {
      if (groups.size >= config.maxGroups) throw new CsvError('Distinct groups exceed maxGroups; filter more narrowly.', 'CSV_LIMIT')
      group = createGroup(keys)
      groups.set(key, group)
    }
    for (const [metricIndex, metric] of metrics.entries()) {
      const state = group.states[metricIndex]!
      if (metric.op === 'count') {
        state.count++
        continue
      }
      const cell = row[metricIndices[metricIndex]!]!
      if (cell.trim() === '') continue
      const value = requireDecimal(cell, metric.column!, config, Numeric)
      state.count++
      switch (metric.op) {
        case 'sum':
        case 'avg': state.value = (state.value ?? new Numeric(0)).plus(value); break
        case 'min': state.value = state.value === null || value.lessThan(state.value) ? value : state.value; break
        case 'max': state.value = state.value === null || value.greaterThan(state.value) ? value : state.value; break
      }
    }
  }
  for (const group of groups.values()) {
    rows.push({
      cells: [
        ...group.keys,
        ...metrics.map((metric, index) => {
          const state = group.states[index]!
          if (metric.op === 'count') return String(state.count)
          if (state.value === null) return metric.op === 'sum' ? '0' : null
          if (metric.op === 'avg') return state.value.div(state.count).toDecimalPlaces(config.averageDecimalPlaces, Numeric.ROUND_HALF_UP).toFixed()
          return state.value.toFixed()
        }),
      ],
      counts: group.states.map(state => state.count),
    })
  }
  const decorated = rows.map(row => ({
    row,
    keys: sortIndices.map(sort => {
      const cell = row.cells[sort.index]!
      if (sort.mode !== 'decimal') return cell
      return cell === null || cell.trim() === '' ? null : requireDecimal(cell, sort.column, config, Numeric)
    }),
  }))
  decorated.sort((left, right) => {
    for (const [index, sort] of sortIndices.entries()) {
      const first = left.keys[index]!
      const second = right.keys[index]!
      if (first === null && second === null) continue
      if (first === null) return 1
      if (second === null) return -1
      const order = typeof first === 'string' && typeof second === 'string'
        ? first < second ? -1 : first > second ? 1 : 0
        : new Numeric(first).comparedTo(new Numeric(second))
      if (order !== 0) return sort.direction === 'desc' ? -order : order
    }
    return 0
  })
  signal.throwIfAborted()
  const page = decorated.slice(offset, offset + limit).map(entry => entry.row)
  return {
    ...source,
    totalRows: table.rows.length,
    columns,
    rows: page.map(row => row.cells),
    contributingRows: metrics.length > 0 ? page.map(row => row.counts) : [],
    matchedRows,
    resultRows: rows.length,
    returnedRows: page.length,
    offset,
    truncated: offset > 0 || offset + page.length < rows.length,
    averageDecimalPlaces: config.averageDecimalPlaces,
  }
}
