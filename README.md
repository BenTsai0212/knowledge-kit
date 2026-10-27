# knowledge-kit

以虛構資料為新客戶快速建立知識平台（第二大腦）demo 的 template。換客戶時只修改客戶設定，不改程式。
方向與範圍見 [RFC 0001 專案章程](docs/rfcs/0001-project-charter.md)，技術選型見 [ADR 0001](docs/adr/0001-tech-stack.md)。

本 repo 由 dev-workflow-template 建立，workflow 規則見 [`docs/workflow/`](docs/workflow/)；coding agent 的規則見 [AGENTS.md](AGENTS.md)。

## 快速開始

需要 Node 22 以上。

```bash
npm install
npm run dev          # 開發伺服器（Vite）
npm run typecheck    # 型別檢查
npm test             # 單元測試（Vitest）
npm run build        # build 到 dist/
npx wrangler dev     # 以 Worker 在本機提供 dist/ 與 /api/*（先執行 npm run build）
```

## 內容

| 路徑 | 內容 |
| --- | --- |
| `app/` | 前端（Vite＋React＋TypeScript） |
| `worker/` | Cloudflare Worker（TypeScript）：提供 `dist/` 靜態檔與 `/api/*` |
| `docs/rfcs/`、`docs/adr/` | 專案章程與決策紀錄 |
| `docs/workflow/` | 憲法與 workflow 手冊 |
| `tools/workflow/` | workflow 工具 |
