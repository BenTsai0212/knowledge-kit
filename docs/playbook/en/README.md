# Playbook

Method documents for preparing a second-brain demo for a new client. In order of use:

| Step | Document | Audience | Purpose |
| --- | --- | --- | --- |
| 1 | [Requirements checklist](requirements-checklist.md) | Can be shared with the client | First interview: what to demo, who will see it, and who can see what |
| 2 | [Data inventory](data-inventory.md) | Can be given to the client to fill in | List document types, sensitivity, languages, and owners to decide what the demo is based on |
| 3 | [Data security](data-security.md) | Can be shared with the client | How the demo handles data, and what must never go into it |
| 4 | [Building the evaluation question bank](eval-question-bank.md) | Internal (can be shared for reference) | Write questions with the client and measure answer quality |
| 5 | [Acceptance metrics](acceptance-metrics.md) | Internal (can be shared for reference) | Thresholds the demo must meet before delivery, and how to read the results |

Technical settings (each file in `client/`) are described in [docs/client-config.md](../../client-config.md); the full steps for setting up a new client are in item 13 (new-client setup steps, not yet written).

## Writing principles

- **Neutral**: never name a real client, partner, or industry-specific company; examples always use the fictional company from the reference scenario.
- **No overclaiming**: the demo is a prototype for demonstration, not a production system. Describe it as a "demo" or "prototype" and do not promise production features, performance, or security.
- **Traditional Chinese and English versions**: `docs/playbook/` is in Traditional Chinese and `docs/playbook/en/` is in English, with the same content. Update both together.
