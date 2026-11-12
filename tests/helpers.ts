import { Config } from '../src/config.ts'
import { parseCsv } from '../src/csv.ts'

export const signal = new AbortController().signal
export const source = { path: '/data/sales.csv', bytes: 123, sha256: 'fixture-sha256', delimiter: ',' }

export function config(overrides: Partial<Config> = {}): Config {
  return Config(overrides)
}

export function table(text: string, overrides: Partial<Config> = {}, delimiter = ',') {
  return parseCsv(new TextEncoder().encode(text), delimiter, config(overrides), signal)
}
