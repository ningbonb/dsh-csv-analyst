import { describe, expect, it } from 'vitest'
import { parseCsv } from '../src/csv.ts'
import { Config } from '../src/config.ts'
import { config, signal, table } from './helpers.ts'

describe('complete CSV parsing', () => {
  it('preserves BOM, Chinese, quoted delimiters, escaped quotes and multiline cells', () => {
    expect(table('\ufeff城市,说明,金额\r\n广州,"hello, ""world""\nnext",0.10\r\n')).toEqual({
      columns: ['城市', '说明', '金额'], rows: [['广州', 'hello, "world"\nnext', '0.10']],
    })
  })
  it('skips physical empty lines without dropping a quoted empty single-column cell', () => {
    expect(table('\nname\n\n""\n \n\n')).toEqual({ columns: ['name'], rows: [[''], [' ']] })
  })
  it.each(['\t', ';', '|'])('uses explicit %j delimiters', delimiter => {
    expect(table(`name${delimiter}amount\nAlice${delimiter}5`, {}, delimiter).rows).toEqual([['Alice', '5']])
  })
  it('treats prototype names and spreadsheet formulas as inert data', () => {
    expect(table('__proto__,constructor,toString\n=HYPERLINK("x"),@SUM(1),+2').rows).toEqual([['=HYPERLINK("x")', '@SUM(1)', '+2']])
  })
  it('accepts a header-only file and preserves header spaces', () => {
    expect(table(' name ,amount')).toEqual({ columns: [' name ', 'amount'], rows: [] })
  })
  it.each(['', '\n\r\n', 'a,a\n1,2', 'a, \n1,2', 'a,b\n1', 'a,b\n1,2,3', 'a,b\n1,"unterminated'])('refuses invalid file %j', text => {
    expect(() => table(text)).toThrowError()
  })
  it('reports stable CSV errors without embedding hostile cell contents', () => {
    expect(() => table('a,b\n1,"secret')).toThrowError(expect.objectContaining({ code: 'CSV_INVALID' }))
  })
  it('rejects invalid UTF-8 and binary NUL input', () => {
    expect(() => parseCsv(new Uint8Array([0xff]), ',', config(), signal)).toThrowError(expect.objectContaining({ code: 'CSV_ENCODING' }))
    expect(() => table('a\0')).toThrowError(expect.objectContaining({ code: 'CSV_ENCODING' }))
  })
  it('enforces inclusive file, row, column and cell limits', () => {
    expect(table('a\n1', { maxBytes: 3, maxRows: 1, maxColumns: 1, maxCellChars: 1 }).rows).toHaveLength(1)
    for (const limits of [{ maxBytes: 2 }, { maxCellChars: 1 }, { maxRows: 1 }, { maxColumns: 1 }]) {
      expect(() => table('ab,cd\n12,34\n56,78', limits)).toThrowError(expect.objectContaining({ code: 'CSV_LIMIT' }))
    }
  })
  it('rejects a pre-aborted call with its original reason', () => {
    const abort = new AbortController()
    const reason = new Error('cancelled')
    abort.abort(reason)
    expect(() => parseCsv(new Uint8Array(), ',', config(), abort.signal)).toThrow(reason)
  })
})

describe('configuration admission', () => {
  it('provides all deployment defaults through a real Schemastery schema', () => {
    expect(Config({})).toEqual({
      maxBytes: 8388608, maxRows: 100000, maxColumns: 200, maxCellChars: 4096,
      maxReturnedRows: 200, maxOperations: 20, maxGroups: 10000,
      defaultPreviewRows: 5, defaultPageRows: 100,
      maxOutputBytes: 262144, maxNumericDigits: 100, averageDecimalPlaces: 12, batchRows: 1000,
    })
  })
  it.each([
    { maxRows: 0 }, { maxRows: 1.2 }, { maxRows: Infinity }, { maxBytes: 67108865 },
    { maxColumns: -1 }, { maxCellChars: 0 }, { maxReturnedRows: 0 },
    { maxOperations: 101 }, { maxGroups: 0 }, { maxOutputBytes: 0 },
    { maxNumericDigits: 0 }, { averageDecimalPlaces: -1 }, { averageDecimalPlaces: 101 }, { batchRows: 0 },
    { defaultPreviewRows: -1 }, { defaultPageRows: 0 },
  ])('refuses invalid configuration %j', values => {
    expect(() => Config(values)).toThrow()
  })
})
