# 視覺與動態設計規格 v1

決策與理由見 [ADR 0008](adr/0008-design-system.md)；本文件是實作依據。設計稿在 Claude 的設計畫布上（#223），本文件寫出實作需要的全部數值，不依賴畫布。

## 三條原則

1. **出處是主角**：證據色只用在引用標號與原文螢光，介面其他地方不用。
2. **誠實的空白**：查不到、沒權限、說法不同、空狀態都是設計過的狀態：虛線框、說明原因、給下一步；不用紅色、不搖晃。
3. **動態只解釋因果**：畫面動，是為了說明東西從哪裡來、往哪裡去；減少動態時一律直接到位。

## 顏色 token

Light 來自提案 A「墨與螢光」，Dark 來自提案 B「晶格」。對比值是該 token 放在它常用的底色上（WCAG 2.x）；文字組合全部 ≥ 4.5:1。

| 鍵 | 用途 | Light | Dark | 對比 L／D | 狀態 |
| --- | --- | --- | --- | --- | --- |
| `background` | 整頁底色 | `#F5F6F3` | `#0A0D14` | — | 改值 |
| `surface` | 卡片、面板、導覽 | `#FFFFFF` | `#111621` | — | 改值 |
| `surfaceRaised` | 列、晶片、次要區塊 | `#EDEFF2` | `#182030` | — | 新增 |
| `reading` | 原文閱讀紙面（Dark 也是亮色） | `#FFFFFF` | `#F4F6FA` | — | 新增 |
| `readingText` | 紙面上的文字 | `#14171A` | `#141A24` | 16.6／16.1 | 新增 |
| `text` | 主要文字 | `#14171A` | `#E7ECF5` | 16.6／16.4 | 改值 |
| `textMuted` | 次要文字、標籤 | `#5B6470` | `#8B97AD` | 5.5／6.1 | 改值 |
| `border` | 分隔線、框線（裝飾用） | `#DDE1E4` | `#253044` | — | 改值 |
| `primary` | 只代表「可以操作」：按鈕、連結、選取 | `#2340C8` | `#3EE6D2` | 8.0／11.6 | 改值 |
| `onPrimary` | 主色上的文字 | `#FFFFFF` | `#04201D` | 8.0／10.9 | 改值 |
| `focus` | 鍵盤焦點框 | `#2340C8` | `#3EE6D2` | 8.0／11.6 | 新增 |
| `mark` | 證據：選取的引用、原文螢光 | `#FFE066` | `#FFB547` | 13.8／10.6 | 改值 |
| `markSoft` | 證據：引用標號預設底色 | `#FFF3BF` | `#3A2A0E` | 16.1／10.3 | 新增 |
| `markText` | 證據底色上的文字 | `#14171A` | `#FFD9A0` | — | 新增 |
| `markReading` | 亮色紙面上的螢光 | `#FFE066` | `#FFE2B0` | 13.8／13.9 | 新增 |
| `conflict` | 說法不同：圖示、框線、文字 | `#A3266A` | `#FF7AA8` | 6.9／7.4 | 新增 |
| `conflictSoft` | 說法不同的底色 | `#FCE8F1` | `#2A1420` | — | 新增 |
| `conflictText` | 說法不同底色上的文字 | `#7A1D50` | `#FFD3E2` | 8.5／12.8 | 新增 |
| `success` | 通過、已核准 | `#1A6E33` | `#6CC489` | 6.3／8.5 | 改值 |
| `warning` | 提醒（只用於文字＋圖示，不做大面積底色） | `#9A3D00` | `#FF9466` | 6.9／8.3 | 改值 |
| `danger` | 錯誤（輸入不正確等） | `#B42318` | `#FF8A80` | 6.6／7.9 | 改值 |
| `info` | 一般資訊，與 `primary` 相同 | `#2340C8` | `#3EE6D2` | 8.0／11.6 | 改值 |
| `onStatus` | 狀態色上的文字 | `#FFFFFF` | `#0A0D14` | — | 改值 |
| `overlay` | 對話框遮罩 | `#14171A73` | `#000000A6` | — | 改值 |
| `graphFallback` | 沒有設定顏色的實體 | `#8A929C` | `#8B97AD` | — | 改值 |

- **客戶不能改的鍵**：`mark`、`markSoft`、`markText`、`markReading`（證據只用一個顏色，ADR 0008）。
- **A 與 B 的五個矛盾已定案**：引用標號兩模式都用證據色系（不用主色）；說法不同兩模式都用洋紅；英文內文 Inter、等寬 JetBrains Mono；實體顏色一律用客戶設定；警告色往橘紅偏移，避開證據琥珀。

### 引用標號的三個狀態

| 狀態 | Light（底／字） | Dark（底／字） |
| --- | --- | --- |
| 預設 | `markSoft`／`markText`，內框 1px `mark` 84%＋`markText` | `markSoft`／`markText`，內框 1px `mark` 40%＋`markSoft` |
| hover | `mark`／`markText`，內框 1px `mark` 73%＋`markText` | `mark` 17%＋`markSoft`／`markReading` 90%＋`text`，內框 1px `mark` |
| 選取（原文已開） | `text`／`mark` | `mark`／`markSoft` |

- 「A 百分比＋B」是 `color-mix(in srgb, var(--color-A) 百分比, var(--color-B))`；不另設 token，證據色只由 `mark`、`markSoft`、`markText`、`markReading` 決定（#225 決定 1）。比例同時寫在 `scripts/check-client.mjs` 的 `CITATION_MIX`，`check:client` 依此檢查對比（[docs/client-config.md](client-config.md)「對比度」）。
- 與設計稿的差異：Light 的兩個內框比設計稿（`#E8B800`、`#C9A400`）稍暗；Dark 預設內框用 40%，對 `surface` 3.3:1（設計稿的 `#7A5A20` 只有 2.9:1）；Dark 選取的字用 `markSoft`（設計稿 `#1A1200`），對 `mark` 7.8:1。

原文螢光：Light 用 `mark`；Dark 的原文放在 `reading` 紙面上，用 `markReading`。

### 實體顏色

- 客戶在 `client/knowledge-model.json` 只設定一個顏色；Light 原樣使用，對 `surface` 至少 3:1（圖形元件標準）。
- Dark 保留色相與彩度，把 OKLCH 亮度提高到至少 0.75：`oklch(from var(--entity) max(l, 0.75) c h)`。
- 實體一律「形狀＋顏色」雙重區分：人員圓形、部門圓角方形、專案小圓角方形。
- 參考情境「專案」原本的 `#B26A00` 在 Dark 推導後接近證據琥珀，已改為紫色 `#7A52C7`；`check:client` 在實體色相與證據色相差小於 25° 時警告（#229，[docs/client-config.md](client-config.md)「對比度」）。設計稿上的 Dark 實體色是目測近似值，實作以公式算出的值為準。

## 字體、圓角、焦點框

| 項目 | 值 |
| --- | --- |
| `fonts.body` | `Inter, "Noto Sans TC", system-ui, sans-serif`，內文 15／26 |
| `fonts.heading` | `"Noto Sans TC", Inter, system-ui, sans-serif`，700 |
| `fonts.mono`（新增） | `"JetBrains Mono", ui-monospace, monospace`：ID、數量、關係名稱、引用標號 |
| `fonts.display`（新增） | `"Space Grotesk", Inter, sans-serif`：只用於字標與大數字 |
| `radius` | small 6px（標號、輸入框）、medium 10px（按鈕）、large 16px（卡片、面板）、pill 999px |
| 焦點框 | `:focus-visible` 時 2px 實線 `focus`、外推 2px；圖譜節點用同色外環 |

字型檔的取得方式（自備、只載入用到的字，或維持系統字型）尚未決定。

## 狀態的共同語言

- **拒答**：虛線框原地出現，說明「找不到可以回答這個問題的資料」，列出「可以試試」。
- **沒權限**：說「有內容但你看不到」與數量，不透露標題；身分徽章固定是 `text` 底、`background` 字。
- **說法不同**：兩種說法並列，`conflict` 色，三個決定按鈕；被取代的說法劃線但保留出處。
- **空狀態**：虛線框＋一個線條圖示＋原因＋最多兩個下一步，不用插圖。
- **demo 標示**：每個畫面都看得到「虛構資料」「展示用權限」（RFC 0001）；線上 demo 的問答與上傳頁顯示 `demoQaNotice`、`demoUploadNotice`。

## 產品 icon（K 晶格）

一條直線（書背＝文件）長出兩條分支（結構），右上節點是證據。形狀固定，顏色跟著主題。原始檔在 [docs/images/icon/](images/icon/)。

| 檔案 | 用途 |
| --- | --- |
| `knowledge-kit-light.svg` | Light：墨 `#14171A`、主色節點 `#2340C8`、證據節點 `#FFE066`（墨色描邊） |
| `knowledge-kit-dark.svg` | Dark：霧白 `#E7ECF5`、主色節點 `#3EE6D2`、證據節點 `#FFB547` |
| `knowledge-kit-mono.svg` | 單色 `currentColor`，證據節點改為空心環 |
| `knowledge-kit-16.svg` | 32px 以下：線加粗、去掉交點與描邊，只留證據節點（`#E8B800`） |

- 網格 48、磚塊圓角 11、線寬 3.5、節點半徑 3.5／4.5、安全區內縮 10。
- 換客戶時，下方節點讀 `primary`，證據節點讀 `mark`；證據節點不換色。
- 不要：漸層、發光、旋轉翻轉、拉長、把證據節點改成主色。
- 組合字標：icon＋「Knowledge Kit」（`fonts.display`）＋分隔線＋客戶名稱。分隔線只在同一行時使用；側欄寬度放不下一行，改用兩行版本：第一行 icon＋「Knowledge Kit」，第二行客戶名稱，不加分隔線。

實作（#226）：

- 頁首（`app/src/ui/Sidebar.tsx`）的組合字標用 `app/src/ui/ProductIcon.tsx` 繪製：磚塊讀 `surface`／`border`，線條與交點讀 `text`，下方節點讀 `primary`，證據節點讀 `mark`、描邊讀 `markText`（Light 是墨色；Dark 是淡琥珀，接近原始檔的不描邊）。icon 是裝飾（`aria-hidden`），產品名稱是 i18n 的 `productName`，客戶名稱取自 `client.json` 的 `displayName`。側欄用兩行版本；客戶名稱沿用 `h1` 的大小與字重、`text` 色（客戶 demo 中客戶名稱是主角，不比產品名稱弱）。
- 32px 以下（含）元件改畫簡化版；簡化版的證據節點也讀 `mark`（原始檔的 `#E8B800` 不是 token）。
- favicon 是 `app/public/favicon.svg`：`knowledge-kit-16.svg` 的形狀與 Light 顏色，以 SVG 內的 `@media (prefers-color-scheme: dark)` 改用 Dark 的 `surface`、`border`、`text`、`mark`。不隨客戶換色（16px 版本沒有主色節點）。`app/src/ui/product-icon.test.ts` 檢查形狀與顏色和原始檔一致。

## 動態

### 原則

1. **因果**：東西從觸發它的地方出現，消失時往它去的地方走。
2. **真實進度**：等待時顯示真的數字（段落數、批次、MB、第幾題），不用假的轉圈與進度條。
3. **隨時可中斷**：動畫中仍可操作，新的操作直接接手。
4. **不懲罰**：錯誤、拒答、沒權限不搖晃、不閃紅。
5. **減少動態**：`prefers-reduced-motion` 時全部 0ms；等待改用文字與數字。
6. **證據最後到**：所有「長出東西」的時刻都依「文件 → 結構 → 證據」的順序（與 icon 相同）。

Light 與 Dark 共用同一套時間與曲線。

### 刻度

| 名稱 | 時間 | 曲線 | 用在 |
| --- | --- | --- | --- |
| fast | 120ms | `cubic-bezier(.2,0,0,1)` | 按下、hover、勾選、標號變實心、所有退場 |
| base | 220ms | 同上 | 面板、列、句子、toast、對話框、語言與主題交叉淡換 |
| expand | 300ms | 同上 | 列的展開與收合、圖譜節點展開（沿用 `EXPAND_MS`） |
| sweep | 400ms | 同上 | 原文螢光刷亮、萃取底線、圖譜平移（沿用 `PAN_MS`） |
| settle | 520ms | `cubic-bezier(.3,1.5,.5,1)` | 只給「新的知識」：引用標號、核准後的節點、icon、數字跳動 |
| progress | 實際時間 | `linear` | 下載、萃取批次、評測題數、路徑脈衝（每跳 300ms）、toast 倒數 |
| stagger | 60／80ms | — | 清單 60ms、回答的句子 80ms；超過 6 項後不再延遲 |

退場一律用 `cubic-bezier(.4,0,1,1)`。所有時間經過 `app/src/ui/motion.ts` 的 `motionDuration()`。

### 全互動對照表

| 區域 | 互動 | 動態 | 刻度 |
| --- | --- | --- | --- |
| 進入 | 輸入邀請碼 | 表單收起，主畫面由下 8px 升起 | base |
| 進入 | 邀請碼錯誤 | 說明往下展開、邊線換 `danger`；保留輸入，不搖晃 | base |
| 進入 | 下載語意模型 | icon 節點循環＋真實 MB 進度；完成時停在完整狀態 | progress |
| 進入 | 改用關鍵字檢索 | 提示從對話頂端推開內容，常駐 | expand |
| 問答 | 送出問題 | 問題泡泡從輸入框升上對話區，輸入框清空 | base |
| 問答 | 回答中（檢索） | 找到的段落以小卡逐張出現，附文件名與段落編號 | stagger |
| 問答 | 回答到達 | 逐句升起；每句完成後引用標號才彈出 | base＋settle |
| 問答 | 打開原文 | 標號變實心 → 面板從右滑入 → 螢光刷過該段 | fast→sweep |
| 問答 | 回答提到／接著問 | 回答完成後才逐一出現 | stagger |
| 問答 | 拒答 | 虛線框原地淡入、不位移；「可以試試」逐項出現 | base |
| 問答 | 回答中斷／額度 | 已收到的文字降為 55%、標「回答不完整」，重試在原地出現 | base |
| 問答 | 回報有錯 | 表單從按鈕處展開；送出後收合為一行確認 | expand |
| 圖譜 | 點節點／展開 | 新節點從被點的節點長出、灰轉類型色；平移讓它靠中 | expand＋sweep |
| 圖譜 | 只看它／回到全部 | 其他節點退到 15% 不透明，不消失 | base |
| 圖譜 | 搜尋名稱 | 符合的節點加外框，平移到第一個結果 | sweep |
| 圖譜 | 找路徑 | 路徑逐段畫出，再由脈衝從起點走到終點 | progress |
| 圖譜 | 撤回核准 | 先預覽：會消失的節點變虛線；確認後縮小退場 | fast |
| 時間軸 | 依實體篩選 | 不符合的文件變淡（不消失）；位置不跳動 | base |
| 上傳 | 拖放檔案 | 框線變實線、底色變淺、圖示上浮 6px；放下後檔案卡片落定 | fast＋settle |
| 上傳 | 讀取與預覽 | 段落數出現，預覽段落逐條升起 | stagger |
| 上傳 | 確認上傳 | 確認區從底部升起，先列「誰看得到」 | base |
| 上傳 | 萃取中 | 批次格依真實進度填滿；找到的字詞依序畫出類型色底線，計數跳動 | progress＋sweep |
| 上傳 | 比對說法不同 | 句子標 `conflictSoft`，說明從右滑入，組數彈出 | base＋settle |
| 上傳 | 已送審 | 一顆標記飛向導覽的「待審」，數字跳一下 | settle |
| 上傳 | 讀取／批次失敗 | 原地換成說明與「重新選檔／重試」，其他批次結果保留 | base |
| 待審 | 選擇合併對象 | 列向下展開；選定後兩者之間畫出連線 | expand |
| 待審 | 核准一筆 | 列收合、下方往上補；toast 升起附「撤銷」與倒數線 | expand |
| 待審 | 退回 | 列往左淡出（與核准方向相反），可撤銷 | fast |
| 待審 | 撤銷 | 列在原位置重新展開，toast 文字原地換掉 | expand |
| 待審 | 核准全部 | 各列依序往右離開（往圖譜方向），結果彈出 | stagger＋settle |
| 待審 | 說法不同：並存 | 兩卡之間畫出等號，兩邊標上關聯 | sweep |
| 待審 | 說法不同：取代 | 舊卡變淡、刪除線由左畫到右 | sweep |
| 評測台 | 評測中 | 每題結果回來就填一格（通過／未通過）；真實題數 | progress |
| 評測台 | 評測完成 | 四項指標依序彈出 | settle |
| 全域 | 切換身分 | 看不到的內容模糊退場，原位換成上鎖虛線框；高度不變 | base |
| 全域 | 切換語言／主題 | 原地交叉淡換，不滑動、不做圓形擴散 | base |
| 全域 | toast | 上升 12px，底部細線倒數，滑鼠移上暫停 | base |
| 全域 | 對話框 | 遮罩淡入；本體 98%→100%，延後 60ms | base |

### 入口頁主視覺

入口頁左側是沒有文字的知識圖譜動態，右側是邀請碼面板。

- **三層景深**：遠景 26 個模糊小點（`translateZ(-520px)`、blur 1.2px）、中景 16 個半透明節點（`-220px`）、前景是參考情境的 14 個實體與關係；整個場景在 `perspective: 1100px` 中約 26 秒擺動一次（rotateY ±9°、rotateX ±5°），產生視差。
- **連結的動態**：進場時遠景、中景、前景依序出現；之後關係線上有光點流動（其中一條是證據色），每隔約 2.5 秒在兩個原本沒連線的節點間畫出新連線、停留後淡去；前景節點各自輕微浮動，3 個核心節點週期性發出光暈。
- 預設 Dark；減少動態時顯示靜止的完整網路。

實作（#228）：

- 入口頁是 `App.tsx` 的 `main.entry`：左側主視覺 `app/src/ui/EntryHero.tsx`，右側是邀請碼表單與語意模型的下載進度（`RetrievalNotice`）；寬度 900px 以下主視覺在上（高 18rem）、面板在下。「虛構資料」「展示用權限」沿用左側導覽頁首的標示。
- 版面是 `app/src/ui/entry-hero.ts` 的純函式（固定亂數種子）：前景取 `client/data/` 中關係最多的 18 個實體（參考情境是全部 14 個），以力導向排版，形狀依類型的圖示（人員圓形、部門圓角方形、專案小圓角方形），填色是類型色；遠景與中景各連最近的兩個鄰居；新連線 4 條、每 2.5 秒一條。關係最多的 3 個節點是發光的核心節點；流動光點最多 6 條線，第一條用 `mark`。
- 動態全部是 `app.css` 的 CSS 動畫（`kOrbit`、`kPop`、`kFloat`、`kTwinkle`、`kDraw`、`kTravel`、`kForm`、`kGlow`），不用 JS 計時器；主視覺在表單畫出後的下一個畫格才繪製。持續循環的裝飾動畫不套用「刻度」（`motion.test.ts` 排除 `.hero`，數值由 `entry-hero.test.ts` 檢查）。
- 低階裝置（`navigator.hardwareConcurrency` 或 `deviceMemory` 為 4 以下）：遠景 10、中景 8 個節點，遠景不模糊。
- 主視覺是裝飾（`aria-hidden`），不含文字。
- 與規格的差異：主題跟隨系統設定（Light／Dark 都成立），不強制 Dark；Dark 的實體色以 `color-mix(in srgb, 類型色 75%, text)` 調亮，近似「實體顏色」的 OKLCH 公式（結構測試不接受 `oklch()`）。

## 尚未設計

手機與平板版面、圖譜鍵盤操作與螢幕報讀器、品質報告列印版面、英文版面檢查、大量節點時的圖譜。
