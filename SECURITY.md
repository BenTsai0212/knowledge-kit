# Security policy

English | [繁體中文摘要](#繁體中文摘要)

## Supported versions

Only the `main` branch and the online demo are supported. Forks are maintained by their owners.

## Reporting a vulnerability

Use GitHub's **Private vulnerability reporting**: in this repo, open **Security → Report a vulnerability**.

- **Don't report vulnerabilities in public Issues**, Pull Requests, or discussions.
- No email address is provided for reports.
- Don't include API keys, access codes, or personal information in the report. Describe where they are instead.

## Scope

In scope:

- The Worker (`worker/`): the access code check, daily limits (`DAILY_LIMIT`, `GLOBAL_DAILY_LIMIT`), the same-site check, and the model allowlist of `/api/ask`.
- Leaked secrets: API keys or other secrets in the repo, its git history, or CI logs.
- Dependencies used by this repo.

## Known limitations

The following are known and are not treated as vulnerabilities. Details are in [worker/README.md](worker/README.md) ("已知限制") and [docs/deploy.md](docs/deploy.md) ("限制").

- The permissions are for demonstration: all data is in the browser, so visibility levels and project permissions are not real access control.
- Anyone with an access code can forge the `Origin` header (for example with curl) and call `/api/ask` directly. Costs are bounded by the access codes and daily limits.
- The public trial code is public: anyone can use up its daily limit, or the site-wide daily limit, for the day.

## Response

Reports are handled on a best-effort basis. There is no SLA.

## 繁體中文摘要

- **支援範圍**：只有 `main` 與線上 demo。
- **回報方式**：GitHub 的 Private vulnerability reporting（本 repo 的 Security → Report a vulnerability）。不要在公開的 Issue 回報；不提供 email。
- 回報時不要附上金鑰、邀請碼或個人資料。
- **範圍內**：Worker（`/api/ask` 的邀請碼、次數上限、同站檢查、模型白名單）、敏感資料外洩（repo、git 歷史或 CI 紀錄中的金鑰）、依賴套件。
- **已知限制，不算漏洞**（見 [worker/README.md](worker/README.md)「已知限制」、[docs/deploy.md](docs/deploy.md)「限制」）：展示用權限在瀏覽器內、可以偽造 `Origin`、公開碼可以用完當日額度。
- **回應時間**：盡力而為，不承諾 SLA。
