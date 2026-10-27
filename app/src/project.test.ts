import { describe, expect, it } from "vitest";
import { getProjectName } from "./project";

describe("getProjectName", () => {
  it("回傳專案名稱", () => {
    expect(getProjectName()).toBe("knowledge-kit");
  });
});
