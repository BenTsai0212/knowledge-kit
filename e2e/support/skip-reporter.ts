// 略過的測試（#77 決定 4）：列出每個略過的測試與原因（test.skip 的說明），CI 中另寫進 job summary。
// 參考情境（KK_CLIENT 未設定）不得有任何略過：有的話整次執行算失敗。
import { appendFileSync } from "node:fs";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { clientName } from "./client";

interface Skipped {
  title: string;
  reason: string;
}

export default class SkipReporter implements Reporter {
  private skipped: Skipped[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== "skipped") return;
    const annotation = [...result.annotations, ...test.annotations].find((a) => a.type === "skip" && a.description);
    this.skipped.push({ title: test.titlePath().filter(Boolean).join(" › "), reason: annotation?.description ?? "（沒有寫明原因）" });
  }

  async onEnd(): Promise<{ status?: FullResult["status"] } | void> {
    const target = clientName === "" ? "參考情境 client/" : `clients/${clientName}/`;
    const lines = this.skipped.map((x) => `- ${x.title}：${x.reason}`);
    if (lines.length > 0) console.log(`\n略過的測試（${target}）：\n${lines.join("\n")}`);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      appendFileSync(summary, `### Playwright：${target}\n\n${lines.length > 0 ? `略過的測試：\n\n${lines.join("\n")}` : "沒有略過的測試"}\n\n`);
    }
    if (clientName === "" && this.skipped.length > 0) {
      console.error("參考情境不得略過任何測試（#77 決定 4）");
      return { status: "failed" };
    }
  }
}
