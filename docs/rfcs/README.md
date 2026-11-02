# RFC：專案章程與重大提案

單人專案只需要一份 **RFC 0001 專案章程**，在初始化時寫，之後很少修改。後續的技術決定直接寫成 ADR。
有協作者時（協作模組），跨範圍的方向性變更再開新的 RFC 取得共識。

## RFC 0001 專案章程要回答

- 要解決什麼問題、給誰用
- 不做什麼
- 分幾個階段，每個階段的門檻（對應 Milestone）

## 流程

1. 開 `docs/<topic>-rfc` 分支，複製下方範本新增 `docs/rfcs/NNNN-<topic>.md`，狀態填 `Proposed`。
2. 開 PR（標籤 `rfc`）。
3. 單人：自己確認後改為 `Accepted` 並合併。協作：依協作模組的規則取得對方同意。
4. RFC 內難以反悔的決定同步寫成 ADR。
5. 要改方向時開修訂 PR 或新 RFC，不直接改已接受的內容。

## 範本

```markdown
# RFC NNNN：標題

- 狀態：Proposed | Accepted | Rejected | Superseded by RFC NNNN
- 日期：YYYY-MM-DD
- 相關：Issue／PR／ADR

## 摘要
## 問題與使用者
## 提案
## 不做什麼
## 階段與門檻
## 待決問題
```

## 索引

| 編號 | 標題 | 狀態 |
| --- | --- | --- |
| [0001](0001-project-charter.md) | knowledge-kit 專案章程 | Accepted |
| [0002](0002-public-release.md) | 公開發表與授權 | Accepted |
