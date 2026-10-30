// 評測題庫中需要資料集的檢查（docs/evals.md「檢查」）。Schema 與只需 client/ 設定的規則由 check:client 檢查。
// 可見範圍以 oracle.ts 計算，與評分判定滲漏的依據相同。
import type { ClientConfig } from "../client/types";
import type { DatasetError } from "../dataset/validate";
import type { Dataset } from "../dataset/load";
import { EVALS_ROOT } from "./load";
import { datasetSample, expectedVisible } from "./oracle";
import type { QuestionsFile } from "./types";

export function validateEvals(config: ClientConfig, data: Dataset, file: QuestionsFile): DatasetError[] {
  const errors: DatasetError[] = [];
  const at = (i: number, j: number) => `/questions/${i}/answerPassages/${j}`;
  const push = (path: string, message: string) => errors.push({ file: `${EVALS_ROOT}questions.json`, path, message });

  if (config.client.evals.path.replace(/\/?$/, "/") !== EVALS_ROOT) {
    errors.push({ file: "client.json", path: "/evals/path", message: `app 目前只支援 ${EVALS_ROOT}（JSON import 的路徑必須是字面值）` });
  }

  const sample = datasetSample(data);
  const passages = new Set(sample.passages.map((p) => p.id));
  const roles = new Set(config.access.roles.map((r) => r.id));
  file.questions.forEach((q, i) => {
    const visible = new Set(expectedVisible(config.access, sample, q.role).passages);
    q.answerPassages.forEach((id, j) => {
      if (!passages.has(id)) push(at(i, j), `答案段落 ${id} 不存在於資料集`);
      // 角色不存在時由 check:client 回報
      else if (!roles.has(q.role)) return;
      else if (q.expect === "answer" && !visible.has(id)) push(at(i, j), `角色 ${q.role} 看不到答案段落 ${id}`);
      else if (q.expect === "refusal" && q.category === "permission" && visible.has(id)) {
        push(at(i, j), `權限題的角色 ${q.role} 看得到答案段落 ${id}，應該能回答`);
      }
    });
  });
  return errors;
}
