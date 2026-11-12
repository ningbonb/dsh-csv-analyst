# Release verification

Verification date: 2026-11-12. Host baseline: DeepSeek Harness `0.2.2-rc.2`, upstream commit `e8f7b93a344964de3dca1ace9e72b6e4d6de87cb`. Local environment: macOS arm64, Node `25.6.1`, pnpm `11.28.5`.

## Release gates

`pnpm check` runs strict TypeScript, warning-free Oxlint, the test suite with 100% statements/branches/functions/lines gates over every shipped source module, ESM/declaration compilation and package inspection. Test cases include quoted/multiline/BOM CSV, explicit delimiters, blank cells, irregular records, oversized files and outputs, invalid decimals, exact sums beyond JavaScript's safe-integer range, independently generated integer-cent properties, multi-key sorting, honest empty aggregates, missing-value counts, paging, cancellation, session-relative paths, policy denial, unload/remount and in-flight disposal. The release-content gate also has negative controls for bins, installation hooks, unexpected files and dynamic code.

`pnpm audit` scans production and development dependencies. Two initial Vitest mocker advisories were eliminated by upgrading Vitest and its coverage package to `4.1.12`; the final advisory scan reported no known vulnerabilities. This is a point-in-time registry result, not proof that unknown defects are absent.

`pnpm host:check --dsh-root <built-checkout> --record tests/snapshots/session.v4.jsonl` installs the actual npm tarball into an isolated profile, boots the shipped headless composition, drives a configured live model against a synthetic sales export, checks the real canonical CSV results, verifies persisted tool calls/results and unchanged source bytes, then removes the bundle. It does not install into or alter a user's normal profiles. Any model credential used for this development-only operation is confined to the child environment and a private temporary home removed in `finally`; the fixture is rejected if it contains that credential.

`pnpm host:check --dsh-root <built-checkout> --replay tests/snapshots/session.v4.jsonl` performs the same packaged install, real agent-loop execution, exact-results checks and uninstall without model credentials or provider requests. The recorded Session owns the user task and model tool-call sequence. DSH's own snapshot normalizer removes volatile clocks and generated directory paths and tokenizes request prompt/schema bulk.

Recording and normalization refuse any path already tracked by Git. To add another scenario, record into a new untracked scenario directory and retain existing committed Session generations.

CI executes `pnpm check` and dependency audit on Linux, macOS and Windows. A separate Linux job checks out the exact host baseline, builds it and runs the packed-bundle Session replay. Workflow dependencies are pinned by commit. Consult [the workflow run](https://github.com/ningbonb/dsh-csv-analyst/actions/workflows/ci.yml) for remote results; a configured job is not evidence of a successful run.

## Counting and performance evidence

The synthetic five-record example produced exactly two tool calls: `csv_inspect`, then `csv_query`. Filtering paid records yielded four matches; Guangzhou had three records, exact revenue `0.25`, and zero missing amount cells. Shanghai had one record, revenue `0`, and one missing amount cell. The missing cell did not contribute a numeric zero. Neither the live model nor the replay changed the source file.

A separate local built-artifact calculation parsed and summed 100,000 synthetic records (1,540,013 input bytes). The independently expected result was `100000` records and exact sum `4999500`; both assertions passed. One observed parse-plus-analysis run took approximately 113 ms and had a final process RSS of 135 MiB. This is one machine's observation, not peak memory, a repeated benchmark, a performance guarantee or a comparison with another implementation.

## Web screenshots

The `0.1.1` images in `docs/screenshots/` show the real Web application from the same host baseline and the plugin's local `0.1.1` tree. A scratch Harness home, synthetic CSV workspace and isolated browser context kept personal sessions out of the images. The in-browser directory picker was selected through the shipped test overlay; no conversation events, tool values or model replies were injected.

A live configured `deepseek-flash` model completed the analysis; a follow-up requested a concise report without business assumptions. The screenshots show that follow-up report and the actual grouped `csv_query` result, including four matched records and numeric-contribution counts. One earlier numeric filter omitted `mode: decimal` and was rejected before the model corrected it; the model also ran a no-op `printf` despite the prompt asking for CSV tools only. This demonstrates model behavior, not a plugin sandbox exemption or a guarantee of perfect model instruction-following.

The built-in browser allowed inspection but refused filesystem screenshot export. The existing repository Playwright driver with system Chrome saved both images from the same persisted live-model session at 1440 × 850; the overview frame and result-detail frame were visually reviewed. Screenshots contain no API key, authentication URL or real customer data, and the source CSV remained unchanged.

## Remaining limits

The end-to-end recorded model scenario exercises the Native executor. PTC receives the same schema-defined canonical values through DSH's existing tool mechanism, but this release does not claim a separate real-model PTC run. No custom GUI is introduced; the screenshots establish only the captured Web views, not a desktop visual test.

The documented host baseline has compatibility evidence; it is not an installation restriction. The plugin performs no version check, and broader compatibility is not established merely by removing version limits. CSV parsing and final sorting are synchronous within resource limits; cancellation is cooperative, not a hard CPU deadline. Read permissions and provider confidentiality belong to the host configuration. The plugin cannot verify whether a business export is authentic, deduplicated or a complete statement of payments.
