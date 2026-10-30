// docs/evals.md 中的模型評分 prompt 全文與 grade.ts 一致。
import { expect, it } from "vitest";
import doc from "../../../docs/evals.md?raw";
import { GRADE_SYSTEM_PROMPT } from "./grade";

it("docs/evals.md 的模型評分 prompt 與 GRADE_SYSTEM_PROMPT 相同", () => {
  expect(doc).toContain(`\`\`\`\n${GRADE_SYSTEM_PROMPT}\n\`\`\``);
});
