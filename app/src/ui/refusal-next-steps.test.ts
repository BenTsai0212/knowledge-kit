import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import { TRANSLATIONS } from "../client/i18n";
import { refusalNextSteps } from "./refusal-next-steps";

describe("refusalNextSteps", () => {
  it("能上傳的身分多一項上傳；換個說法與改問負責的人永遠都有", () => {
    expect(refusalNextSteps({ canUpload: true })).toEqual(["rephrase", "askPerson", "upload"]);
    expect(refusalNextSteps({ canUpload: false })).toEqual(["rephrase", "askPerson"]);
  });

  it("輸入只有上傳能力：同一身分不論「資料沒寫」或「沒有權限」，清單都相同", () => {
    // 參數是唯一的依據；即使呼叫端多傳拒答原因或問題，也不影響結果
    for (const canUpload of [true, false]) {
      const extra = (reason: string) => ({ canUpload, reason, question: reason }) as { canUpload: boolean };
      expect(refusalNextSteps(extra("no_data"))).toEqual(refusalNextSteps(extra("no_permission")));
    }
  });

  it("清單的文字不提權限、等級、專案或身分", () => {
    const { visibilityLevels, projects, roles } = clientConfig.access;
    const labels = [...visibilityLevels, ...projects, ...roles].flatMap((x) => Object.values(x.label));
    for (const [language, s] of Object.entries(TRANSLATIONS)) {
      const text = [s.refusalNextTitle, s.refusalNextRephrase, s.refusalNextAskPerson, s.refusalNextUpload, s.refusalGotoUpload].join("\n");
      for (const label of labels) expect(text, language).not.toContain(label);
      expect(text, language).not.toMatch(/權限|権限|permission|access/i);
    }
  });
});
