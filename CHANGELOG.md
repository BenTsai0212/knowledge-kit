# Changelog

All notable changes to this project are recorded in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

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
