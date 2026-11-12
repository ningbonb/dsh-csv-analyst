/** Stable failures retained by the DSH tool pipeline. @module */
import { HarnessError } from '@deepseek-ai/dsh-error'

/** Expected CSV decoding, parsing, resource, or numeric-data failure. */
export class CsvError extends HarnessError {
  constructor(message: string, code: 'CSV_INVALID' | 'CSV_LIMIT' | 'CSV_ENCODING' | 'CSV_NUMBER') {
    super(message, code)
  }
}
