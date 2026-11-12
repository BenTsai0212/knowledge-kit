# 動態參考（#249）

[`motion-reference.css`](motion-reference.css) 是設計畫布（Claude 的設計畫布「Knowledge Kit 新設計」的動態提案頁與補齊畫面頁）上 `@keyframes` 與使用方式的逐字擷取（2026-11-11），是動態的唯一來源：**只能由設計更新，實作照抄**。本文件補上畫布上每個元素的延遲、時間對應的刻度，以及無法照抄的例外。

`app/src/ui/app.css` 中與參考檔同名的 `@keyframes`，正規化空白與數字寫法後必須與參考檔相同；列在下面「例外」的，必須與「實作的寫法」相同（`app/src/ui/motion-reference.test.ts`）。

## 時間對應的刻度

參考檔中的毫秒數對應 [`docs/design.md`「刻度」](../design.md#刻度)。實作時一律寫成 `--motion-*` 變數（`app/src/ui/motion.ts` 產生，減少動態時為 0ms），不寫毫秒數。

| 參考檔 | 刻度 | 變數 |
| --- | --- | --- |
| 120ms | fast | `--motion-fast` |
| 220ms | base | `--motion-base` |
| 300ms | expand | `--motion-expand` |
| 400ms | sweep | `--motion-sweep` |
| 520ms | settle | `--motion-settle` |
| 延遲 60ms／80ms | stagger | `--motion-stagger-list`／`--motion-stagger-sentence`（對話框本體的 60ms、邀請碼錯誤說明的 80ms，#246） |
| `.a-timer` 的 5000ms | progress | toast 的倒數線跟著 `TOAST_MS`（10 秒，`ReviewPage.tsx`），經 `motionDuration()` 以 `--toast-duration` 帶入（#246 決定補充 3） |

曲線同樣用 `--ease-*`：`cubic-bezier(.2,0,0,1)` 是進場、`cubic-bezier(.4,0,1,1)` 是退場、`cubic-bezier(.3,1.5,.5,1)` 是 settle、`linear` 是 `--ease-linear`（progress，#244）。入口頁主視覺等持續循環的裝飾動畫不套用刻度（`docs/design.md`「入口頁主視覺」）。

## 每個元素的延遲（畫布上的 `animation-delay`）

| 畫板 | 元素 | 動畫 | 延遲 |
| --- | --- | --- | --- |
| AI 問答 | 檢索小卡（第 1／2／3 張） | rise | 0／60／120ms |
| AI 問答 | 回答第 1／2 句 | rise | 0／80ms |
| AI 問答 | 引用標號 1／2／3 | pop | 220／300／380ms |
| AI 問答 | 回答提到（實體、接著問） | rise | 560／620／680ms |
| AI 問答 | 拒答虛線框；「可以試試」三項 | fade；rise | 600ms；820／880／940ms |
| AI 問答 | 中斷：「回答不完整」；重試區 | rise | 300ms；360ms |
| 全域 | 切換語言：新文字 | fade | 60ms（舊文字 fadeout 0ms） |
| 全域 | 語意模型下載的節點 | node | 0／200ms |
| 全域 | 邀請碼錯誤的說明 | drop | 80ms |
| 全域 | 評測完成的四項指標 | pop | 900／960／1020／1080ms |
| 審核 | 核准結果 | pop | 420ms |
| 審核 | 說法不同的連線（`grow`） | grow | 0／80／200ms |
| 審核 | 段落旁的標示 | rise | 300／360／420／480ms |
| 審核 | toast | toast | 160ms |
| 上傳 | 段落數、預覽標題 | fade | 400ms、300ms |
| 上傳 | 預覽段落 ¶1／¶2 | rise | 460／520ms |
| 上傳 | 萃取的底線（依序） | under | 200／420／640／860／1080ms |
| 上傳 | 批次 1／2／3 | batch | 0／600／1200ms |
| 上傳 | 實體數、關係數 | pop | 1500／1560ms |
| 上傳 | 說法不同的說明；組數 | slide；pop | 200ms；300ms |
| 上傳 | 已送審的標記；待審數量 | fly；bump | 300ms；950ms（參考檔的 `.a-fly`、`.a-bump`） |

上傳的批次條在畫布上也叫 `.a-grow`（600ms linear），與審核的 `.a-grow`（400ms）同名不同值，參考檔改名為 `.a-batch`。

## 畫布的不一致與決定

畫布上同名的動畫有兩處數值不同，統一採「AI 問答」畫板的值（#249）：

- `kPopS`：「AI 問答」「全域」是 `scale(.4)`，「審核」「上傳」是 `scale(.6)` → 統一為 `scale(.4)`。
- `kDim`：「AI 問答」是 `.55`，「審核」是 `.5` → 統一為 `.55`。

## 例外

無法照抄的 `@keyframes`。「實作的寫法」是 `app.css` 中的內容（正規化前的空白不拘），測試以此比對。

| 名稱 | 原因 | 實作的寫法 |
| --- | --- | --- |
| `kRise` | 回答的句子是行內元素，`transform` 對行內元素無效（#234），改以 `position: relative` 的 `top` 升起，距離相同 | `from{opacity:0;top:8px}` |
| `kSweep` | 引用段落的 `mark` 平時以 `background-color` 顯示完整螢光（減少動態時直接到位、動畫結束後留著）；刷過時底色要保持透明，只有 `background-image` 長出 | `from{background-color:transparent;background-size:0% 100%}to{background-color:transparent;background-size:100% 100%}` |
| `kFloat` | 主視覺的 SVG 以 `viewBox="0 0 100 100"` 為單位，畫布的 `-5px` 在這裡約是場景的 5%；保留畫布的節奏，位移縮小 | `0%,100%{transform:translate(0,0)}50%{transform:translate(0,-0.8px)}` |
| `kFlyTo` | 畫布的起點寫死畫布座標 `translate(560px,600px)`；實際畫面中「人工審核」步驟與導覽「待審」的距離依視窗大小而定，起點依實際版面計算，以 CSS 變數帶入（#242 PR 3） | `0%{opacity:0;transform:translate(var(--fly-x),var(--fly-y)) scale(.6)}12%{opacity:1}88%{opacity:1}100%{opacity:0;transform:none}` |
| `kGlow` | 光暈是 SVG 的圓，`box-shadow` 對 SVG 無效；改以圓的不透明度與縮放呈現 | `0%,100%{opacity:0;transform:scale(.6)}50%{opacity:1;transform:scale(1)}` |

## 參考檔以外的 keyframes

參考檔沒有、實作另外加入的 `@keyframes`。名稱不與參考檔重複，不在照抄的檢查範圍內；寫法由 `app/src/ui/review-page.test.ts` 比對。

| 名稱 | 用途 | 實作的寫法 |
| --- | --- | --- |
| `kOutLeft` | 待審的「退回」往左淡出（`docs/design.md`「全互動對照表」的「待審」列）。參考檔的 `kOut` 往右，留給「核准全部」（#243 決定 3） | `to{opacity:0;transform:translateX(-56px)}` |
