# Read-only, complete-file CSV analysis

The CSV tools extend DSH through `tools`, `fs` and `workingDirectory`; they do not introduce a competing filesystem provider, application launcher or model loop. The bundle pins its tested DSH release so incompatible host APIs fail at profile admission rather than during a user task.

Statistics cover the complete byte-bounded input. Record, group, digit and output caps reject the operation instead of publishing partial totals. Pagination applies after filtering and aggregation. All results include counts and a byte digest so users can identify sampling and changed source files.

Exact decimal strings preserve financial totals and large identifiers. Missing numeric cells have separate contributing counts, and invalid nonempty numbers fail instead of being silently dropped. Explicit delimiters and unique nonblank headers prevent guesses and duplicate-column overwrites.

The tools remain read-only to avoid file-replacement races, spreadsheet formula injection on export and approval for generated executable code. Returned content still enters model requests and session history; read-only is not a confidentiality promise. Generic DSH read cards render the persisted JSON tool content without a custom GUI or reconstruction from mutable plugin state.

Each plugin instance owns cancellation and in-flight operation tracking. Cordis disposal unregisters tools, cancels work and waits for quiescence before releasing injected providers. There is no global cache or current-file singleton.
