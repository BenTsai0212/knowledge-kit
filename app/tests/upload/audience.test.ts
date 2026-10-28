// 上傳頁的「誰看得到」（#42）：對每種「可見等級 × 專案（含無專案）」，與 oracle.ts 對一份該條件的文件算出的可見範圍一致。
import { describe, expect, it } from "vitest";
import { clientConfig } from "../../src/client/load";
import { audienceRoles, formatBytes, todayIso } from "../../src/ui/upload-helpers";
import { expectedVisible } from "../db/oracle";
import type { Sample } from "../db/sample";

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

describe("todayIso、formatBytes", () => {
  it("今天的日期以本地時區計算", () => {
    expect(todayIso(new Date(2026, 0, 5, 0, 30))).toBe("2026-01-05");
    expect(todayIso(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });

  it("檔案大小", () => {
    expect([512, 2048, 5 * 1024 * 1024 + 300 * 1024].map(formatBytes)).toEqual(["512 B", "2.0 KB", "5.3 MB"]);
  });
});
