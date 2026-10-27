// 資料集的跨檔檢查（docs/dataset.md「檢查」）。Schema 已由 check:client 驗證，這裡只檢查與 client/ 設定的對應。
import type { ClientConfig } from "../client/types";
import { DATASET_ROOT, type Dataset } from "./load";

export interface DatasetError {
  file: string;
  path: string;
  message: string;
}

export function validateDataset(config: ClientConfig, data: Dataset): DatasetError[] {
  const errors: DatasetError[] = [];
  const push = (file: string, path: string, message: string) => errors.push({ file: `${data.root}${file}`, path, message });

  const languages = new Set(config.client.languages);
  const ranks = new Map(config.access.visibilityLevels.map((l) => [l.id, l.rank]));
  const projects = new Set(config.access.projects.map((p) => p.id));
  const entityTypes = new Set(config.knowledgeModel.entityTypes.map((t) => t.id));
  const relationTypes = new Map(config.knowledgeModel.relationTypes.map((t) => [t.id, t]));

  const datasetPath = config.client.dataset.path.replace(/\/?$/, "/");
  if (datasetPath !== DATASET_ROOT) {
    errors.push({ file: "client.json", path: "/dataset/path", message: `app 目前只支援 ${DATASET_ROOT}（import.meta.glob 的路徑必須是字面值）` });
  }

  const checkLanguage = (file: string, path: string, language: string) => {
    if (!languages.has(language)) push(file, path, `語言 ${language} 不在 client.json 的 languages 內`);
  };
  const checkLevel = (file: string, path: string, level: string) => {
    if (!ranks.has(level)) push(file, path, `可見等級 ${level} 不存在於 access.json`);
  };
  const checkProject = (file: string, path: string, project: string | undefined) => {
    if (project !== undefined && !projects.has(project)) push(file, path, `專案 ${project} 不存在於 access.json`);
  };

  const documentIds = new Map<string, string>();
  const passageIds = new Map<string, string>();
  for (const [file, doc] of Object.entries(data.documents).sort(([a], [b]) => a.localeCompare(b))) {
    if (documentIds.has(doc.id)) push(file, "/id", `文件 id ${doc.id} 與 ${data.root}${documentIds.get(doc.id)} 重複`);
    documentIds.set(doc.id, file);
    checkLanguage(file, "/language", doc.language);
    checkLevel(file, "/visibility", doc.visibility);
    checkProject(file, "/project", doc.project);

    doc.passages.forEach((p, i) => {
      const at = `/passages/${i}`;
      if (passageIds.has(p.id)) push(file, `${at}/id`, `段落 id ${p.id} 與 ${data.root}${passageIds.get(p.id)} 重複`);
      passageIds.set(p.id, file);
      if (p.language !== undefined) checkLanguage(file, `${at}/language`, p.language);
      if (p.visibility !== undefined) {
        checkLevel(file, `${at}/visibility`, p.visibility);
        const own = ranks.get(p.visibility);
        const parent = ranks.get(doc.visibility);
        if (own !== undefined && parent !== undefined && own < parent) {
          push(file, `${at}/visibility`, `段落比所屬文件寬鬆（${p.visibility} < ${doc.visibility}）`);
        }
      }
      if (p.project !== undefined) {
        checkProject(file, `${at}/project`, p.project);
        if (doc.project !== undefined && p.project !== doc.project) {
          push(file, `${at}/project`, `段落的專案 ${p.project} 與所屬文件的專案 ${doc.project} 不同`);
        }
      }
    });
  }

  const checkSources = (file: string, path: string, sources: string[]) =>
    sources.forEach((s, i) => {
      if (!passageIds.has(s)) push(file, `${path}/${i}`, `出處段落 ${s} 不存在`);
    });

  const entityTypeOf = new Map<string, string>();
  data.entities.entities.forEach((e, i) => {
    const at = `/entities/${i}`;
    if (entityTypeOf.has(e.id)) push("entities.json", `${at}/id`, `實體 id ${e.id} 重複`);
    entityTypeOf.set(e.id, e.type);
    if (!entityTypes.has(e.type)) push("entities.json", `${at}/type`, `實體類型 ${e.type} 不存在於 knowledge-model.json`);
    checkSources("entities.json", `${at}/sources`, e.sources);
  });

  const relationIds = new Set<string>();
  data.relations.relations.forEach((r, i) => {
    const at = `/relations/${i}`;
    if (relationIds.has(r.id)) push("relations.json", `${at}/id`, `關係 id ${r.id} 重複`);
    relationIds.add(r.id);
    const type = relationTypes.get(r.type);
    if (!type) push("relations.json", `${at}/type`, `關係類型 ${r.type} 不存在於 knowledge-model.json`);
    for (const end of ["from", "to"] as const) {
      const entityType = entityTypeOf.get(r[end]);
      if (entityType === undefined) push("relations.json", `${at}/${end}`, `實體 ${r[end]} 不存在`);
      else if (type && !type[end].includes(entityType)) {
        push("relations.json", `${at}/${end}`, `${r.type} 的 ${end} 不接受實體類型 ${entityType}`);
      }
    }
    checkSources("relations.json", `${at}/sources`, r.sources);
  });

  // 預設問題的答案段落（scenarios.json）
  config.scenarios.scenarios.forEach((s, i) =>
    s.questions.forEach((q, j) =>
      q.answerPassages.forEach((id, k) => {
        if (!passageIds.has(id)) {
          errors.push({ file: "scenarios.json", path: `/scenarios/${i}/questions/${j}/answerPassages/${k}`, message: `答案段落 ${id} 不存在於資料集` });
        }
      }),
    ),
  );
  return errors;
}

export function formatErrors(errors: DatasetError[]): string {
  return errors.map((e) => `${e.file} ${e.path}：${e.message}`).join("\n");
}
