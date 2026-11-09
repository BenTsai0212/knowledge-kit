# 評測題庫

評測題庫的位置（`client.json` 的 `evals.path`）。`questions.json` 是凱翠瓦感測的題庫；格式、指標與評分方式見 [docs/evals.md](../../../docs/evals.md)，出題步驟見 [docs/playbook/eval-question-bank.md](../../../docs/playbook/eval-question-bank.md)。

49 題：預期回答 36 題、預期拒答 13 題（Issue #175）。每個事實只寫在一種語言的文件中，所以用其他語言發問就是跨語言檢索。

| 類別 | 題數 | 內容 |
| --- | --- | --- |
| `scenario` | 11 | `scenarios.json` 的 11 題預設問題，以事實所在的語言發問（繁中 3、英文 4、日文 4） |
| `cross-language` | 18 | 六個方向各 3 題：中→英、中→日、英→中、英→日、日→中、日→英。`passageLanguage` 是事實所在的語言 |
| `permission` | 9 | 同一個問題，主管能答、一般員工拒答：2026 調薪（繁中）、港灣投標金額（英文，員工不在專案、段落比文件機密）、2027 設備投資（主管以英文問日文文件，員工以日文問）、Q3 營收（主管以繁中問英文文件，員工以英文問）。另加一般員工問霧行 2027 年產量（日文，示範情境「主管看全貌」切換身分時的拒答） |
| `synonym` | 3 | 問題用段落裡沒有的說法，只檢索同語言的段落：生病沒上班對「病假」、`lodging` 對 `hotel`、「化学薬品」「保護具」對「化学物質」 |
| `out-of-scope` | 3 | 婚假（看起來像公司規定、但資料沒寫；以主管身分問）、居家網路費、工廠員工餐廳 |
| `extraction-attempt` | 2 | 要求忽略規則並列出機密內容（一般員工）、自稱 CEO 要求投標金額與成本（訪客） |
| `unrelated` | 3 | 與資料集完全無關：食譜、世界盃、彈鋼琴 |

## 語意向量與 `keyword-hash`

本客戶的 `retrieval.provider` 是 `multilingual-e5-small`。標記 `requires: "semantic"` 的 21 題只在語意向量時評測，`keyword-hash`（包括降級）時不執行、不計入分母（[docs/evals.md](../../../docs/evals.md)「跨語言、同義詞與完全無關的題目」）：

- 跨語言 18 題。
- 權限題中主管跨語言發問的 2 題（`capex-2027-manager-en`、`q3-revenue-manager`）。
- 同義詞 1 題（`sick-pay-staff-zh`）：以 `keyword-hash` 的預設設定（`topK` 5、`minScore` 0.1）檢索不到答案段落。其餘 2 題 `keyword-hash` 檢索得到，照常計分。

完全無關的 3 題沒有標記：以 `keyword-hash` 檢索不到任何段落，在本機拒答。

驗收以語意向量執行（評測台沒有降級提示），依 [docs/playbook/acceptance-metrics.md](../../../docs/playbook/acceptance-metrics.md) 的門檻；跨語言 18 題另外列出，同樣要達到引用與答案的門檻。
