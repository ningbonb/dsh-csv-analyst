/** Loader-validated resource and presentation limits. @module */
import Schema from '@deepseek-ai/schemastery'

/** Limits applied independently to each tool call. */
export interface Config {
  /** Maximum file size in bytes; oversized input is refused, never sampled. */
  maxBytes: number
  /** Maximum complete data records, excluding the header and empty lines. */
  maxRows: number
  /** Maximum header fields. */
  maxColumns: number
  /** Maximum UTF-16 code units in any header or cell. */
  maxCellChars: number
  /** Maximum returned rows per page. */
  maxReturnedRows: number
  /** Maximum filters, selected columns, group columns, metrics or sort keys. */
  maxOperations: number
  /** Maximum distinct aggregation groups. */
  maxGroups: number
  /** Maximum UTF-8 bytes of a serialized successful result. */
  maxOutputBytes: number
  /** Maximum decimal digits per numeric input, including leading zeros. */
  maxNumericDigits: number
  /** Decimal places for averages, rounded half up; sums remain exact. */
  averageDecimalPlaces: number
  /** Records processed between cancellation checkpoints and event-loop yields. */
  batchRows: number
}

/** Resource defaults; all deployment-varying limits can be changed in YAML. */
export const Config: Schema<Partial<Config>, Config> = Schema.object({
  maxBytes: Schema.number().step(1).min(1).max(64 * 1024 * 1024).default(8 * 1024 * 1024),
  maxRows: Schema.number().step(1).min(1).max(1_000_000).default(100_000),
  maxColumns: Schema.number().step(1).min(1).max(1000).default(200),
  maxCellChars: Schema.number().step(1).min(1).max(100_000).default(4096),
  maxReturnedRows: Schema.number().step(1).min(1).max(10_000).default(200),
  maxOperations: Schema.number().step(1).min(1).max(100).default(20),
  maxGroups: Schema.number().step(1).min(1).max(100_000).default(10_000),
  maxOutputBytes: Schema.number().step(1).min(1).max(8 * 1024 * 1024).default(256 * 1024),
  maxNumericDigits: Schema.number().step(1).min(1).max(1000).default(100),
  averageDecimalPlaces: Schema.number().step(1).min(0).max(100).default(12),
  batchRows: Schema.number().step(1).min(1).max(10_000).default(1000),
})
