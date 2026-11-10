// 上傳頁的「誰看得到」（#42）：對每種「可見等級 × 專案（含無專案）」，與 oracle.ts 對一份該條件的文件算出的可見範圍一致。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { audienceRoles, defaultVisibility, formatBytes, todayIso } from "../../src/ui/upload-helpers";
import { expectedVisible } from "../db/oracle";
import type { Sample } from "../db/sample";
import type { AccessFile } from "../../src/client/types";

const access = clientConfig.access;
const LEVELS = access.visibilityLevels.map((l) => l.id);
const PROJECTS = [null, ...access.projects.map((p) => p.id)];

describe("audienceRoles", () => {
  it.each(LEVELS.flatMap((level) => PROJECTS.map((project) => [level, project] as const)))("%s × %s：與 oracle 一致", (level, project) => {
    const sample: Sample = {
      docs: [{ id: "doc", level, project }],
      passages: [{ id: "p", doc: "doc", level, project }],
      entities: [],
      relations: [],
    };
    const expected = access.roles.filter((r) => expectedVisible(access, sample, r.id).documents.includes("doc")).map((r) => r.id);
    expect(audienceRoles(access, level, project).map((r) => r.id)).toEqual(expected);
  });

  it("參考情境：機密只有主管、青翼專案的內部文件是一般員工與主管、公開無專案是所有角色", () => {
    expect(audienceRoles(access, "confidential", null).map((r) => r.id)).toEqual(["manager"]);
    expect(audienceRoles(access, "internal", "bluewing").map((r) => r.id)).toEqual(["staff", "manager"]);
    expect(audienceRoles(access, "public", null).map((r) => r.id)).toEqual(["guest", "staff", "manager"]);
  });
});

describe("defaultVisibility", () => {
  const rank = new Map(access.visibilityLevels.map((l) => [l.id, l.rank]));

  it.each(access.roles.map((r) => [r.id, r] as const))("%s：預設為自己能選的最嚴格等級", (_, role) => {
    const level = defaultVisibility(access, role.id);
    const choosable = access.visibilityLevels.filter((l) => l.rank <= rank.get(role.visibility)!);
    expect(choosable.map((l) => l.id)).toContain(level);
    expect(rank.get(level)).toBe(Math.max(...choosable.map((l) => l.rank)));
  });

  it("參考情境：主管預設機密、一般員工預設內部，能上傳的身分都不預設公開", () => {
    expect(defaultVisibility(access, "manager")).toBe("confidential");
    expect(defaultVisibility(access, "staff")).toBe("internal");
    expect(defaultVisibility(access, "guest")).toBe("public");
    for (const role of access.roles.filter((r) => r.canUpload)) expect(defaultVisibility(access, role.id)).not.toBe("public");
  });

  it("同 rank 時取 access.json 中較前面的；身分不存在時為空字串", () => {
    const tied: AccessFile = {
      ...access,
      visibilityLevels: [
        { ...access.visibilityLevels[0], id: "low", rank: 0 },
        { ...access.visibilityLevels[0], id: "high-a", rank: 1 },
        { ...access.visibilityLevels[0], id: "high-b", rank: 1 },
      ],
      roles: [{ ...access.roles[0], id: "r", visibility: "high-b" }],
    };
    expect(defaultVisibility(tied, "r")).toBe("high-a");
    expect(defaultVisibility(access, "nobody")).toBe("");
  });
});

describe("todayIso、formatBytes", () => {
  it("今天的日期以本地時區計算", () => {
    expect(todayIso(new Date(2026, 0, 5, 0, 30))).toBe("2026-01-05");
    expect(todayIso(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });

  it("檔案大小", () => {
    expect([512, 2048, 5 * 1024 * 1024 + 300 * 1024].map(formatBytes)).toEqual(["512 B", "2.0 KB", "5.3 MB"]);
  });
});
