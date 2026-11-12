# Security

## Supported release

Report vulnerabilities for the current npm release on DSH `0.2.2-rc.2`. Compatibility with other host versions is not established.

## Threat model

CSV bytes, header names and model-generated arguments are untrusted. Arguments are admitted through DSH's typed tool schema, then value and cross-field constraints are checked. File reads use the injected filesystem provider with a byte limit at the read itself; no unbounded read precedes that limit.

The package has no executable bin, installation hook, network client, direct filesystem implementation, mutation tool or subprocess. Its CSV parser and decimal arithmetic are maintained dependencies, not custom implementations. Row/column/cell/group/digit/output limits bound memory and CPU work. Synchronous parsing and sorting are not forcibly interruptible; do not raise their limits indiscriminately.

Results use matrices, not objects keyed by attacker-controlled headers. Group keys are JSON-encoded arrays, and accumulators use `Map`. Spreadsheet formulas and links are plain text: neither is evaluated or opened. This release does not export files that another spreadsheet application might execute.

The plugin does not implement isolation beyond DSH's configured tool policy and filesystem provider. Host read permissions may allow files outside the working directory, and symlink resolution belongs to that provider. A row preview can disclose personal data or secrets to the model provider and durable session storage. Prompt injection is reduced by explicit tool guidance and inert parsing, **not eliminated**.

Input files can change between calls. Results identify the exact read bytes with SHA-256, but do not attest the producer, authenticity, fraud, business meaning or a multi-call transactional snapshot. Numeric totals must not be presented as verified payments or real customers without independent evidence.

Dependency audit results are point-in-time advisory checks, not a guarantee of no vulnerabilities. CI scans the complete dependency graph; a dependency alert blocks release pending investigation.

## Reporting

Use this repository's GitHub **private vulnerability reporting**, when enabled, instead of opening a public issue with sensitive details. Include the package/DSH/Node versions, a minimal synthetic CSV and the observed failure. Do not include API credentials, customer exports or session logs containing private data.
