/** Typed model input and canonical matrix results, independent of header names. @module */
import type { InferArgs, InferValue } from '@deepseek-ai/dsh-tools'

/** Shared file inputs for both tools. */
export const fileParameters = {
  path: { type: 'string', required: true, description: 'CSV file path; relative paths use the session working directory.' },
  delimiter: { type: 'string', enum: [',', '\t', ';', '|'], description: 'Field delimiter. Omit for comma; use "\\t" for TSV. No automatic guessing.' },
} as const

/** Inspection inputs. */
export const inspectParameters = {
  ...fileParameters,
  sample_rows: { type: 'integer', description: 'Preview record count, from 0 to the configured page limit. Defaults to 5 or the page limit, whichever is smaller.' },
} as const

/** Declarative query inputs; no SQL, JavaScript, regular expressions, or formulas. */
export const queryParameters = {
  ...fileParameters,
  select: { type: 'array', items: { type: 'string' }, description: 'Exact header names to return, in order. Omit for all columns. Cannot combine with metrics.' },
  filters: {
    type: 'array',
    description: 'All conditions must match. Numeric conditions reject nonempty nonnumeric cells rather than silently dropping them.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        column: { type: 'string', required: true },
        op: { type: 'string', required: true, enum: ['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty'] },
        mode: { type: 'string', enum: ['text', 'decimal'], description: 'Defaults to text. gt/gte/lt/lte require decimal. Text matching is case-sensitive and untrimmed.' },
        value: { type: 'string', description: 'Required except for empty/not_empty. Decimals use a dot, no exponent, currency sign or thousands separators.' },
      },
    },
  },
  group_by: { type: 'array', items: { type: 'string' }, description: 'Exact header names for grouping. Requires metrics. Empty cells form their own group.' },
  metrics: {
    type: 'array',
    description: 'Aggregates over all matched records, before paging. Blank numeric cells are excluded; other invalid numbers fail. Empty sum is "0"; empty avg/min/max is null.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        op: { type: 'string', required: true, enum: ['count', 'sum', 'avg', 'min', 'max'] },
        column: { type: 'string', description: 'Required for sum/avg/min/max; omit for count, which counts records.' },
        as: { type: 'string', required: true, description: 'Unique output column name; must not duplicate a group column.' },
      },
    },
  },
  sort: {
    type: 'array',
    description: 'Sort output by exact output column names before paging. Nulls sort last in either direction; ties retain source order.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        column: { type: 'string', required: true },
        direction: { type: 'string', enum: ['asc', 'desc'], description: 'Defaults to asc.' },
        mode: { type: 'string', enum: ['text', 'decimal'], description: 'Defaults to text. Use decimal for numerical order; blank and null cells sort last.' },
      },
    },
  },
  offset: { type: 'integer', description: 'Zero-based output row offset. Defaults to 0. Each page rereads the source; compare sha256 across pages.' },
  limit: { type: 'integer', description: 'Returned output row count, from 1 to the configured page limit. Defaults to 100 or that limit, whichever is smaller.' },
} as const

const sourceProperties = {
  path: { type: 'string', required: true },
  sha256: { type: 'string', required: true },
  bytes: { type: 'integer', required: true },
  delimiter: { type: 'string', required: true },
  totalRows: { type: 'integer', required: true },
} as const

/** Canonical inspection result, including quality counts across the complete file. */
export const inspectOutput = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...sourceProperties,
    columns: { type: 'array', required: true, items: { type: 'string' } },
    quality: {
      type: 'array', required: true,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          column: { type: 'string', required: true },
          blankCells: { type: 'integer', required: true },
          decimalCells: { type: 'integer', required: true },
          otherCells: { type: 'integer', required: true },
        },
      },
    },
    sample: { type: 'array', required: true, items: { type: 'array', items: { type: 'string' } } },
    sampleTruncated: { type: 'boolean', required: true },
  },
} as const

/** Canonical query result with complete counts and explicit paging. */
export const queryOutput = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...sourceProperties,
    columns: { type: 'array', required: true, items: { type: 'string' } },
    rows: { type: 'array', required: true, items: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'null' }] } } },
    contributingRows: { type: 'array', required: true, items: { type: 'array', items: { type: 'integer' } }, description: 'For each returned aggregate row, the contributing count for each metric in requested order. Empty for a nonaggregate query.' },
    matchedRows: { type: 'integer', required: true },
    resultRows: { type: 'integer', required: true },
    returnedRows: { type: 'integer', required: true },
    offset: { type: 'integer', required: true },
    truncated: { type: 'boolean', required: true },
    averageDecimalPlaces: { type: 'integer', required: true },
  },
} as const

/** Inspection input after tool schema validation. */
export type InspectArgs = InferArgs<typeof inspectParameters>
/** Query input after tool schema validation. */
export type QueryArgs = InferArgs<typeof queryParameters>
/** Inspection result available to Native and PTC callers. */
export type InspectResult = InferValue<typeof inspectOutput>
/** Query result available to Native and PTC callers. */
export type QueryResult = InferValue<typeof queryOutput>
