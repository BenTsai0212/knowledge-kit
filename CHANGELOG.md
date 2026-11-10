# Changelog

All notable changes to this project are recorded in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [2.0.0]

Cross-language retrieval: ask in one language and find documents written in another ([RFC 0002](docs/rfcs/0002-public-release.md)).

### Cross-language retrieval

- Optional in-browser semantic vectors with `multilingual-e5-small`, selected with `"retrieval": { "provider": "multilingual-e5-small" }` in `client.json`. A question in one language retrieves passages written in another ([docs/retrieval.md](docs/retrieval.md#語意向量multilingual-e5-small), [ADR 0006](docs/adr/0006-semantic-retrieval.md)).
- The model files are pinned to a fixed commit and checked against their size and SHA-256 before use, then cached in Cache Storage. The ONNX Runtime WASM is served by the app itself instead of a CDN.
- While the model is being prepared, the Q&A and evaluation pages show a "downloading model" notice with progress (about 129 MB on the first visit).
- If preparation fails (download error, integrity mismatch, or initialization error), retrieval falls back to `keyword-hash` and shows a notice, so Q&A keeps working.
- `keyword-hash` remains the default; clients that don't select semantic vectors download no model and no extra code.

### Fictional multilingual client

- `clients/kestrova-demo/`: a fictional sensor manufacturer with documents in Traditional Chinese, English, and Japanese, each fact written in only one language.
- Its 18 cross-language questions across six language directions scored 18/18 for both citations and answers, and the full question bank met every acceptance threshold with no permission leaks ([evaluation results](clients/kestrova-demo/evals/README.md#驗收結果)).

### Evaluation

- Question banks support `passageLanguage` (retrieve only passages in another language), `requires: "semantic"`, and the cross-language, synonym, and unrelated categories. Questions that need semantic vectors are shown as not applicable under `keyword-hash` and are left out of the totals ([docs/evals.md](docs/evals.md#跨語言同義詞與完全無關的題目)).
- After a fallback, the evaluation page uses the retrieval settings actually in effect instead of the semantic thresholds.

### Docs

- The steps for setting up a new client and adding a language were updated from the `kestrova-demo` setup ([docs/playbook/new-client-setup.md](docs/playbook/new-client-setup.md), [docs/playbook/add-language.md](docs/playbook/add-language.md)).
- `clients/` holds only fictional demo clients; real clients belong in their own forks ([clients/README.md](clients/README.md)).

### Online demo

- Unchanged: it uses the reference scenario with `keyword-hash` and downloads no model. To try cross-language retrieval, run `clients/kestrova-demo/` locally with `KK_CLIENT=kestrova-demo` ([clients/README.md](clients/README.md)).

### Other changes

- CI checks clients that select semantic vectors with `keyword-hash`, and the Playwright tests block model downloads ([docs/testing.md](docs/testing.md)).
- Development workflow tooling updates.

## [1.0.0]

The first release: phase 1 of [RFC 0001](docs/rfcs/0001-project-charter.md) and the online demo.

### Features

- Q&A that cites the passages it is based on and refuses when the visible documents don't contain the answer ([docs/qa.md](docs/qa.md)).
- Visibility levels and project permissions enforced by row-level security in PGlite, a knowledge graph with shortest paths, and a timeline ([docs/data-model.md](docs/data-model.md), [docs/graph.md](docs/graph.md)).
- Document upload with reviewed entity extraction and detection of conflicting information ([docs/upload.md](docs/upload.md), [docs/extraction.md](docs/extraction.md), [docs/conflicts.md](docs/conflicts.md)).
- An evaluation page that scores a question bank for citations, key points, refusals, and leaks ([docs/evals.md](docs/evals.md)).
- Multilingual interface and retrieval, theme colors, and dark mode, all from the client settings, so another organization needs only its own `client/` or `clients/<name>/` folder ([docs/client-config.md](docs/client-config.md)).

See the [README](README.md#features) for the full feature list.

### Online demo

- <https://knowledge-kit-demo.bentsai0212.workers.dev>, served by a Cloudflare Worker that forwards questions to the Claude Messages API ([docs/deploy.md](docs/deploy.md)).
- A public trial code is already filled in. All visitors share its daily question limit, so the quota may run out for the day. To request your own access code, open an Issue with the "Access code request" template.
- The evaluation page is hidden, and uploaded documents exist only in the browser. Don't enter or upload personal or confidential information.

### License and security

- Released under the [MIT License](LICENSE).
- Vulnerability reports: see [SECURITY.md](SECURITY.md).

### Changes since the repo went public

- Presentation mode: add `?mode=presentation` to the URL to show only Q&A and the graph ([docs/qa.md](docs/qa.md#展示模式)).
- [docs/workflow/fork.md](docs/workflow/fork.md) now covers the Actions setting that requires approval before workflows run for external contributors' pull requests.
- The development workflow tooling (rules for coding agents, the runner, and the check tools) was upgraded to template v0.20.
