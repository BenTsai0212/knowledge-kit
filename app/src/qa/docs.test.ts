// docs/qa.md 中的 system prompt 全文與 prompt.ts 一致。
import { expect, it } from "vitest";
import doc from "../../../docs/qa.md?raw";
import { systemPrompt } from "./prompt";

it("docs/qa.md 的 system prompt 與 systemPrompt() 相同（以 {companyName}、{languageName} 代入）", () => {
  const expected = systemPrompt("{companyName}", "en").replace("Answer in English", "Answer in {languageName}");
  expect(doc).toContain(`\`\`\`\n${expected}\n\`\`\``);
});
