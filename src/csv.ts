/** Strict bounded CSV parsing; cells remain inert strings. @module */
import Papa from 'papaparse'
import { CsvError } from './errors.ts'
import type { Config } from './config.ts'

/** Complete validated CSV records with a unique, nonempty header. */
export interface Table {
  columns: string[]
  rows: string[][]
}

/**
 * Parse an entire bounded UTF-8 CSV without inferring delimiters or numbers.
 * @param bytes - Complete file contents admitted by the filesystem byte limit.
 * @param delimiter - Explicit single-character field separator.
 * @param config - Record, field and cell limits.
 * @param signal - Cancellation checked before parsing and after every record.
 * @returns Header and complete data records, excluding physically empty lines.
 */
export function parseCsv(bytes: Uint8Array, delimiter: string, config: Config, signal: AbortSignal): Table {
  signal.throwIfAborted()
  if (bytes.byteLength > config.maxBytes) throw new CsvError('File exceeds maxBytes; split the file or raise the configured limit.', 'CSV_LIMIT')
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new CsvError('Input is not valid UTF-8. Export as UTF-8 CSV before retrying.', 'CSV_ENCODING')
  }
  if (text.includes('\0')) throw new CsvError('NUL bytes are not accepted; export a text CSV rather than a binary workbook.', 'CSV_ENCODING')
  const rows: string[][] = []
  let columns: string[] | undefined
  let previousCursor = 0
  Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: false,
    dynamicTyping: false,
    step(result, parser) {
      signal.throwIfAborted()
      const rawRecord = text.slice(previousCursor, result.meta.cursor)
      previousCursor = result.meta.cursor
      if (rawRecord === '' || /^[\r\n]+$/u.test(rawRecord)) return
      if (result.errors.length > 0) {
        parser.abort()
        throw new CsvError(`Malformed CSV near record ${rows.length + 2}: ${result.errors[0]!.code}.`, 'CSV_INVALID')
      }
      const cells = result.data
      if (cells.some(cell => cell.length > config.maxCellChars)) {
        parser.abort()
        throw new CsvError('A header or cell exceeds maxCellChars.', 'CSV_LIMIT')
      }
      if (columns === undefined) {
        if (cells.length > config.maxColumns) throw new CsvError('Header exceeds maxColumns.', 'CSV_LIMIT')
        if (cells.some(cell => cell.trim() === '') || new Set(cells).size !== cells.length) {
          throw new CsvError('Headers must be nonblank and unique; rename duplicate columns before retrying.', 'CSV_INVALID')
        }
        columns = cells
      } else {
        if (cells.length !== columns.length) {
          throw new CsvError(`Record ${rows.length + 2} has ${cells.length} fields; expected ${columns.length}.`, 'CSV_INVALID')
        }
        if (rows.length >= config.maxRows) throw new CsvError('File exceeds maxRows; no partial result was computed.', 'CSV_LIMIT')
        rows.push(cells)
      }
    },
  })
  if (columns === undefined) throw new CsvError('CSV is empty; a header record is required.', 'CSV_INVALID')
  return { columns, rows }
}
