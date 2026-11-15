# 參考文獻

設計決定引用的文獻與業界準則。ADR 與 `docs/design.md` 以引用標記（例如 [amershi2019](#amershi2019)）連到這裡，fork 的人可以從這裡查到每個設計的依據。

## 規則

- 一項一個引用標記（`作者姓氏＋年份`，業界準則用簡短名稱），以 `###` 標題寫，其他文件連到 `docs/references.md#<標記>`。
- 每一項都寫：書目（作者、年份、題目、出處）、類型、連結（DOI、arXiv 或官方頁面）、主張（一句話）、用在哪裡。
- 類型：會議論文、期刊論文、業界準則、技術報告；連結是 arXiv 或作者自存的版本時另外註明。只有預印本、未正式發表時標「預印本」。
- 只放書目與一句摘要，不放論文全文或圖表。
- 「已用於設計」是 repo 中有引用的；「研究主線參考」是研究討論中查證過、尚未用於設計的，設計採用時移到「已用於設計」，並補上用在哪裡。
- ADR 或設計文件引用文獻時，同一個 PR 把它加進這裡（見 [ADR 的規則](adr/README.md#規則)）。

## 已用於設計

### amershi2019

- **書目**：Amershi 等，Guidelines for Human-AI Interaction，CHI 2019
- **類型**：會議論文
- **連結**：https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/
- **主張**：人機互動 18 條準則（G9 容易修正、G15 鼓勵細緻回饋）；作者強調不是勾選清單
- **用在哪裡**：[ADR 0007](adr/0007-retraction-and-answer-reports.md)「背景」（撤回核准與回答錯誤回報）、[ADR 0011](adr/0011-seam-only-review.md)「設計依據」

### pair-errors

- **書目**：Google PAIR，People + AI Guidebook，Errors + Graceful Failure
- **類型**：業界準則
- **連結**：https://pair.withgoogle.com/chapter/errors-failing/
- **主張**：設計要預期 AI 會錯，讓錯誤可以被發現與回復
- **用在哪裡**：[ADR 0007](adr/0007-retraction-and-answer-reports.md)「背景」

### green2022

- **書目**：Green，The Flaws of Policies Requiring Human Oversight of Government Algorithms，Computer Law & Security Review，2022
- **類型**：期刊論文（連結是 arXiv 版本）
- **連結**：https://arxiv.org/abs/2109.05067
- **主張**：要求「人在迴路中審核」的政策常無法發揮效果，反而讓人承擔責任
- **用在哪裡**：[ADR 0007](adr/0007-retraction-and-answer-reports.md)「背景」、[ADR 0011](adr/0011-seam-only-review.md)「背景」「設計依據」

### parasuraman2010

- **書目**：Parasuraman & Manzey，Complacency and Bias in Human Use of Automation，Human Factors 52(3)，2010
- **類型**：期刊論文
- **連結**：https://doi.org/10.1177/0018720810376055
- **主張**：人在監督自動化時會自滿、偏向採信自動化，專家也一樣
- **用在哪裡**：[ADR 0007](adr/0007-retraction-and-answer-reports.md)「背景」、[ADR 0011](adr/0011-seam-only-review.md)「背景」「設計依據」

### bainbridge1983

- **書目**：Bainbridge，Ironies of Automation，Automatica 19(6)，1983
- **類型**：期刊論文
- **連結**：https://doi.org/10.1016/0005-1098(83)90046-8
- **主張**：自動化越完整，人越難在需要時接手
- **用在哪裡**：[ADR 0011](adr/0011-seam-only-review.md)「背景」「設計依據」

## 研究主線參考

查證過、尚未用於設計；「用在哪裡」在設計採用時補上。

### horvitz1999

- **書目**：Horvitz，Principles of Mixed-Initiative User Interfaces，CHI 1999
- **類型**：會議論文
- **連結**：https://www.microsoft.com/en-us/research/publication/principles-mixed-initiative-user-interfaces/
- **主張**：AI 不確定時才主動介入，並衡量打擾的代價
- **用在哪裡**：尚未使用

### jakesch2023

- **書目**：Jakesch 等，Co-Writing with Opinionated Language Models Affects Users' Views，CHI 2023
- **類型**：會議論文（連結是康乃爾大學的新聞稿）
- **連結**：https://news.cornell.edu/node/326526
- **主張**：帶立場的 AI 建議會改變人的看法，多數人沒察覺
- **用在哪裡**：尚未使用

### kim2024

- **書目**：Kim 等，"I'm Not Sure, But..."，FAccT 2024
- **類型**：會議論文
- **連結**：https://facctconference.org/static/papers24/facct24-56.pdf
- **主張**：第一人稱的不確定語氣讓人對 AI 的信任更恰當
- **用在哪裡**：尚未使用

### lee2025

- **書目**：Lee 等，The Impact of Generative AI on Critical Thinking，CHI 2025
- **類型**：會議論文（連結是作者自存的版本）
- **連結**：https://advait.org/files/lee_2025_ai_critical_thinking_survey.pdf
- **主張**：越信任 AI 越少批判思考；工作轉向資訊驗證與整合
- **用在哪裡**：尚未使用

### sarkar2024

- **書目**：Sarkar，AI Should Challenge, Not Obey，Communications of the ACM 67(10)，2024
- **類型**：期刊論文（連結是 arXiv 版本）
- **連結**：https://arxiv.org/abs/2411.02263
- **主張**：AI 應該挑戰人的想法，而不是服從
- **用在哪裡**：尚未使用

### bucinca2021

- **書目**：Buçinca 等，To Trust or to Think，CSCW 2021
- **類型**：會議論文
- **連結**：https://www.eecs.harvard.edu/~kgajos/papers/2021/bucinca2021trust.shtml
- **主張**：強迫思考的設計能減少過度依賴，但使用者比較不喜歡
- **用在哪裡**：尚未使用

### bansal2021

- **書目**：Bansal 等，Does the Whole Exceed its Parts?，CHI 2021
- **類型**：會議論文（連結是 arXiv 版本）
- **連結**：https://arxiv.org/abs/2006.14779
- **主張**：AI 的解釋讓人更容易接受建議，不論對錯
- **用在哪裡**：尚未使用

### ehsan2024

- **書目**：Ehsan 等，Seamful XAI，CSCW 2024
- **類型**：會議論文（連結是 arXiv 版本）
- **連結**：https://arxiv.org/abs/2211.06753
- **主張**：揭露系統的接縫（假設與實際情境的落差），而不是隱藏
- **用在哪裡**：尚未使用

### passi2022

- **書目**：Passi & Vorvoreanu，Overreliance on AI，Microsoft，2022
- **類型**：技術報告
- **連結**：https://www.microsoft.com/en-us/research/?p=854967
- **主張**：過度依賴 AI 的成因與緩解方式綜整
- **用在哪裡**：尚未使用

### hirsch2017

- **書目**：Hirsch 等，Designing Contestability，DIS 2017
- **類型**：會議論文（連結是 dblp 的書目頁）
- **連結**：https://dblp.uni-trier.de/rec/conf/ACMdis/HirschMNIA17.html
- **主張**：人要能反駁、修正 AI 的判斷
- **用在哪裡**：尚未使用

### chiang2024

- **書目**：Chiang 等，Enhancing AI-Assisted Group Decision Making through LLM-Powered Devil's Advocate，IUI 2024
- **類型**：會議論文（連結是 arXiv 版本）
- **連結**：https://arxiv.org/abs/2403.01791
- **主張**：AI 當反方能促進思考，也可能帶偏人
- **用在哪裡**：尚未使用

### wang2024

- **書目**：Wang 等，Resolving Knowledge Conflicts in Large Language Models，COLM 2024
- **類型**：會議論文（連結是 arXiv 版本）
- **連結**：https://arxiv.org/abs/2310.00935
- **主張**：模型遇到互相衝突的來源時容易只採一邊
- **用在哪裡**：尚未使用
