# 畫面流程圖引用的畫板

設計畫布「00 設計稿總覽」的**畫面流程圖**（`Z-Wireflow`）引用的 20 個畫板原始碼（#329），以及「接縫與討論版」一頁的 5 個畫板（#392）。**視覺（版面、尺寸、層次、元件樣式）以這些畫板為準**；優先順序與其他設計文件的關係見 [設計稿 v1 總覽](../README.md)：

> 權限與行為的決定（#247 等 Issue 的 `## 決定`、ADR）＞ 畫板 ＞ [design.md](../../../design.md) 的文字

- 每個 `*.dc.html` 都是畫布匯出的內容原樣，不改任何字元；sha256 與 #329 留言「## 畫板原始碼 1／7」～「7／7」、#392 留言「## 畫板原始碼 1／5」～「5／5」相同。要更新畫板時，整個檔案換成畫布的新版本，並在 PR 描述列出新的 sha256。
- 畫板是給人與 agent 閱讀的設計參考：不被 `app/` import，也不進 build。檔案引用的 `./support.js` 與 `{{…}}` 範本是畫布的執行環境，不在 repo 中，所以不能直接用瀏覽器打開。
- 實作一律用 `client/theme.json` 的 token 與 `client/i18n/` 的文字，不照抄畫板的色碼與字串。
- 審查有對應畫板的 PR 時，把實作截圖與畫板並排比對（[decision-center.md](../../../workflow/decision-center.md)「審查 PR」）。

## 畫面流程圖引用的畫板

| 檔名 | 畫布上的名稱 | 對應 |
| --- | --- | --- |
| `K-Login.dc.html` | 日常工具 · 登入 | 入口（登入） |
| `K-Home.dc.html` | 日常工具 · 首頁 | 首頁、桌機左側欄 |
| `K-Uploads.dc.html` | 日常工具 · 送出後與我的上傳 | 上傳 › 我的上傳 |
| `K-Answer.dc.html` | 日常工具 · 拒答的出路與回報結果 | 問答的拒答與回報結果 |
| `QA.dc.html` | 問答（附出處） | 問答與原文 |
| `Graph.dc.html` | 知識圖譜 | 圖譜與實體面板 |
| `G-Scale.dc.html` | 大量節點時的圖譜 | 三層語意縮放 |
| `I-States.dc.html` | 錯誤與額度 · 問答中的各種狀態 | 錯誤與額度 |
| `F-Timeline.dc.html` | 補齊 · 時間軸 | 時間軸 |
| `F-Review.dc.html` | 補齊 · 待審完整頁 | 待審 |
| `B-Ingest.dc.html` | B · 上傳與萃取 | 上傳與萃取 |
| `F-Empty.dc.html` | 補齊 · 空狀態與回報清單 | 空狀態、待審 › 回報 |
| `F-Evals.dc.html` | 補齊 · 評測台 | 評測台 |
| `J-Report.dc.html` | 品質報告 · A4 兩頁 | 品質報告 |
| `H-QA.dc.html` | 展示模式 · 問答 | 展示模式的問答 |
| `H-Graph.dc.html` | 展示模式 · 圖譜 | 展示模式的圖譜 |
| `G-Mobile-Graph.dc.html` | 手機 · 入口、圖譜、實體 | 手機 |
| `G-Mobile-QA.dc.html` | 手機 · 問答、原文、身分 | 手機 |
| `G-Mobile-Pages.dc.html` | 手機 · 時間軸、上傳、待審、評測台、更多 | 手機 |
| `K-Mobile.dc.html` | 日常工具 · 手機 | 手機的登入、首頁、我的上傳 |

## 接縫與討論版的畫板

設計畫布「接縫與討論版（ADR 0011／0012、#377）」一頁，每個畫板並排桌機 1280、平板 820、手機 390 三種尺寸（#392）。

| 檔名 | 畫布上的名稱 | 對應 |
| --- | --- | --- |
| `S-Spec.dc.html` | 元件規格 · AI 發言的六種外觀 | 問你、另一種讀法、補充、記錄、說法不同、人的回答（`AskCard`、`refusal-ask`） |
| `S-Refusal.dc.html` | 問答 · 答不出來時先確認要找的 | #377 |
| `S-Review.dc.html` | 待審 · 只審接縫與已直接收錄 | #378 PR 4a、4b、5（待審頁） |
| `S-QA.dc.html` | 問答 · 同名反問與說法不同的提問 | #380 PR 4、5a、5b |
| `S-Request.dc.html` | 首頁 · 請上傳者確認 | #378 PR 5（上傳者的首頁） |

## 畫板的顏色名稱與 token

畫板以 `{{t.<名稱>}}` 引用顏色（`QA`、`Graph` 是提案 A、`B-Ingest` 是提案 B 的早期畫板，直接寫色碼；色碼與下表的 Light／Dark 值相同時照表對應）。實作一律用 `client/theme.json` 的 token，不寫死色碼。

| 畫板 | `client/theme.json` |
| --- | --- |
| `bg` | `background` |
| `surface` | `surface` |
| `raised` | `surfaceRaised` |
| `text` | `text` |
| `muted` | `textMuted` |
| `line` | `border` |
| `primary`、`onPrimary` | 同名 |
| `evid` | `mark` |
| `inkBg`、`inkFg` | `text`、`surface`（反白的選中狀態） |
| `dash` | 沒有對應的 token：虛線框沿用現有寫法（`border` 或 `textMuted` 的虛線） |
| `primarySoft` | `color-mix(in srgb, var(--color-primary) 12%, var(--color-surface))`（現有寫法） |
| `success`、`warning`、`conflict`、`conflictSoft`、`conflictText`、`markSoft`、`markText` | 同名 |
| `successSoft`、`warningSoft` | 以 `color-mix()` 由 `success`／`warning` 與 `surface` 調出，不新增色碼 |
| `ePerson`、`eTeam`、`eProject` | 知識模型的實體類型色（`client/knowledge-model.json`） |
| `eP`、`eT`、`eJ` | 同上（`H-Graph` 的簡寫：人員、團隊、專案，#349） |
| `pSoft` | 類型色的淡底：`color-mix(in srgb, 類型色 14%, var(--color-surface))`（`.entity-badge` 的現有寫法，#349） |
| `dot` | `border`（圖譜的點狀底紋，#349） |
| `mark` | `mark`（與 `evid` 不同：`S-*` 的 5 個畫板的 `mark` 是 `#FFE066`，就是 token 的 `mark`，#392） |
| `markLine` | 沒有對應的 token：用 `mark`；需要較深的細邊時以 `color-mix()` 由 `mark` 與 `text` 調出，不新增色碼（#392） |
| `overlay` | `overlay`（#392） |
| `shadow` | 沿用現有的陰影寫法（#392） |
| `board`、`bezel` | 畫布底色與裝置外框，不實作（#392） |

### 上表以外的名稱

畫板中還用到以下名稱（以 #329 的 20 個檔案為準）。視覺對齊 Issue 遇到時確認對應，確認後補進上表：

- **與 `client/theme.json` 同名**：`danger`、`focus`、`markReading`、`reading`、`readingText`。
- **尚未對應**：`core`、`edge`、`far`、`mid`、`glow`、`panel`（入口主視覺與圖譜的節點、連線、景深）；`inputLine`、`tSoft`。

## 設計稿用、不實作的內容

- Light／Dark 切換按鈕（實作跟隨系統設定；展示模式依 #262）
- 「預覽身分（設計稿用）」等切換畫板狀態的控制項
- 「設計稿說明」虛線框、示意的數字與資料（實作一律用目前身分看得到的資料，#247）
- 畫板上方的步驟切換（①～⑦）、「狀態」切換與 Light／Dark 按鈕（#392）
- 裝置外框與並排的三種尺寸標題（「桌機 · 1280」等，#392）

## 已知與決定衝突的地方

畫板與決定衝突時以決定為準。之後的視覺對齊 Issue 發現新的衝突時補在這裡。

- `F-Timeline` 的鎖頭虛線框（表示看不到的文件）違反 #247「沒有權限的內容當作不存在」：不實作
- `S-Review` 撤回時有「補充（選填）」輸入框，但 ADR 0011 決定 5 與 migration 0013 只記撤回理由（`reason`），沒有補充欄位：依優先順序以 ADR 為準，不實作這個輸入框（#392）
