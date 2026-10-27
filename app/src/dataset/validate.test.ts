import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import type { ClientConfig } from "../client/types";
import { dataset, type Dataset } from "./load";
import { validateDataset } from "./validate";

const HANDBOOK = "documents/employee-handbook.zh-TW.json";
const copy = (): { config: ClientConfig; data: Dataset } => ({
  config: structuredClone(clientConfig),
  data: structuredClone(dataset),
});

describe("validateDataset", () => {
  it("client/data/ 的資料集通過檢查", () => {
    expect(validateDataset(clientConfig, dataset)).toEqual([]);
  });

  it("讀入文件、實體與關係", () => {
    expect(Object.keys(dataset.documents)).toContain(HANDBOOK);
    expect(dataset.entities.entities.length).toBeGreaterThan(0);
    expect(dataset.relations.relations.length).toBeGreaterThan(0);
  });

  it("語言、可見等級、專案必須存在於 client/ 設定", () => {
    const { config, data } = copy();
    const doc = data.documents[HANDBOOK];
    doc.language = "ja";
    doc.project = "unknown";
    doc.passages[0].visibility = "secret";
    doc.passages[1].language = "fr";
    expect(validateDataset(config, data)).toEqual([
      { file: `data/${HANDBOOK}`, path: "/language", message: "語言 ja 不在 client.json 的 languages 內" },
      { file: `data/${HANDBOOK}`, path: "/project", message: "專案 unknown 不存在於 access.json" },
      { file: `data/${HANDBOOK}`, path: "/passages/0/visibility", message: "可見等級 secret 不存在於 access.json" },
      { file: `data/${HANDBOOK}`, path: "/passages/1/language", message: "語言 fr 不在 client.json 的 languages 內" },
    ]);
  });

  it("段落不得比所屬文件寬鬆", () => {
    const { config, data } = copy();
    const doc = data.documents[HANDBOOK];
    doc.visibility = "internal";
    doc.project = "aurora";
    doc.passages[0].visibility = "public";
    doc.passages[1].project = "harbor";
    doc.passages[2].visibility = "confidential";
    doc.passages[3].project = "aurora";
    expect(validateDataset(config, data)).toEqual([
      { file: `data/${HANDBOOK}`, path: "/passages/0/visibility", message: "段落比所屬文件寬鬆（public < internal）" },
      { file: `data/${HANDBOOK}`, path: "/passages/1/project", message: "段落的專案 harbor 與所屬文件的專案 aurora 不同" },
    ]);
  });

  it("沒有專案的文件可以有屬於專案的段落", () => {
    const { config, data } = copy();
    data.documents[HANDBOOK].passages[0].project = "aurora";
    expect(validateDataset(config, data)).toEqual([]);
  });

  it("文件、段落、實體、關係的 id 不得重複", () => {
    const { config, data } = copy();
    const en = data.documents["documents/employee-handbook.en.json"];
    en.id = "employee-handbook-zh";
    en.passages.push({ id: "employee-handbook-zh-01", text: "重複" });
    data.entities.entities.push({ ...data.entities.entities[0] });
    data.relations.relations.push({ ...data.relations.relations[0] });
    const last = (list: unknown[]) => list.length - 1;
    expect(validateDataset(config, data)).toEqual([
      { file: `data/${HANDBOOK}`, path: "/id", message: "文件 id employee-handbook-zh 與 data/documents/employee-handbook.en.json 重複" },
      // 檔名排序後英文版先處理，所以重複報在中文版
      {
        file: `data/${HANDBOOK}`,
        path: "/passages/0/id",
        message: "段落 id employee-handbook-zh-01 與 data/documents/employee-handbook.en.json 重複",
      },
      {
        file: "data/entities.json",
        path: `/entities/${last(data.entities.entities)}/id`,
        message: `實體 id ${data.entities.entities[0].id} 重複`,
      },
      {
        file: "data/relations.json",
        path: `/relations/${last(data.relations.relations)}/id`,
        message: `關係 id ${data.relations.relations[0].id} 重複`,
      },
    ]);
  });

  it("實體與關係的類型必須存在，關係的兩端必須符合關係類型", () => {
    const { config, data } = copy();
    const e = data.entities.entities.push({ id: "vendor-x", type: "vendor", name: "x", sources: ["employee-handbook-zh-01"] }) - 1;
    const r = data.relations.relations.length;
    data.relations.relations.push(
      { id: "r-bad-type", type: "reports-to", from: "person-wu-yizhen", to: "team-people", sources: ["employee-handbook-zh-04"] },
      // member-of 只接受 person → team
      { id: "r-reversed", type: "member-of", from: "team-people", to: "person-wu-yizhen", sources: ["employee-handbook-zh-04"] },
      { id: "r-missing", type: "member-of", from: "person-nobody", to: "team-people", sources: ["employee-handbook-zh-04"] },
    );
    expect(validateDataset(config, data)).toEqual([
      { file: "data/entities.json", path: `/entities/${e}/type`, message: "實體類型 vendor 不存在於 knowledge-model.json" },
      { file: "data/relations.json", path: `/relations/${r}/type`, message: "關係類型 reports-to 不存在於 knowledge-model.json" },
      { file: "data/relations.json", path: `/relations/${r + 1}/from`, message: "member-of 的 from 不接受實體類型 team" },
      { file: "data/relations.json", path: `/relations/${r + 1}/to`, message: "member-of 的 to 不接受實體類型 person" },
      { file: "data/relations.json", path: `/relations/${r + 2}/from`, message: "實體 person-nobody 不存在" },
    ]);
  });

  it("出處段落與預設問題的答案段落必須存在", () => {
    const { config, data } = copy();
    data.entities.entities[0].sources.push("nope-01");
    data.relations.relations[0].sources = ["nope-02"];
    config.scenarios.scenarios[0].questions[0].answerPassages = ["nope-03"];
    expect(validateDataset(config, data)).toEqual([
      { file: "data/entities.json", path: "/entities/0/sources/4", message: "出處段落 nope-01 不存在" },
      { file: "data/relations.json", path: "/relations/0/sources/0", message: "出處段落 nope-02 不存在" },
      { file: "scenarios.json", path: "/scenarios/0/questions/0/answerPassages/0", message: "答案段落 nope-03 不存在於資料集" },
    ]);
  });

  it("dataset.path 必須是 data/", () => {
    const { config, data } = copy();
    config.client.dataset.path = "dataset/";
    expect(validateDataset(config, data)).toEqual([
      { file: "client.json", path: "/dataset/path", message: "app 目前只支援 data/（import.meta.glob 的路徑必須是字面值）" },
    ]);
  });
});
