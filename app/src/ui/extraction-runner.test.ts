import { describe, expect, it } from "vitest";
import { clientConfig } from "../client/load";
import type { Database } from "../db/database";
import { planExtraction, runExtraction } from "../extraction/run";
import { fakeTransport } from "../qa/testing";
import { createExtractionRunner } from "./extraction-runner";

const passages = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, content: `第 ${i + 1} 段虛構內容。`.padEnd(900, "測") }));
const config = { ...clientConfig, client: { ...clientConfig.client, upload: { ...clientConfig.client.upload, extractMaxBatches: 3 } } };
// 第一批就被拒，不會寫入，所以不需要真的資料庫
const NO_DB = {} as Database;

describe("createExtractionRunner", () => {
  it("執行中才算萃取中；邀請碼被拒而停止後，即使還有 waiting 的批次也不再是萃取中（#47 審查）", async () => {
    const changes: string[][] = [];
    const runner = createExtractionRunner((running) => changes.push([...running]));
    const state = planExtraction(config, { documentId: "d1", uploader: "staff", documentLanguage: "zh-TW", passages });
    expect(state.batches).toHaveLength(3);
    const transport = fakeTransport(() => [{ type: "error", error: "invalid_access_code" }]);

    const pending = runner.run("d1", () => runExtraction({ db: NO_DB, transport, config }, state));
    expect(runner.isRunning("d1")).toBe(true);
    const final = await pending;

    expect(final!.batches.map((b) => b.status)).toEqual(["failed", "waiting", "waiting"]);
    expect(runner.isRunning("d1")).toBe(false);
    expect(changes).toEqual([["d1"], []]);
  });

  it("同一份文件同時只執行一個；失敗時也會結束執行紀錄", async () => {
    const runner = createExtractionRunner();
    let release = () => {};
    const first = runner.run("d1", () => new Promise<void>((r) => (release = r)));
    expect(await runner.run("d1", async () => "second")).toBeUndefined();
    release();
    await first;
    await expect(runner.run("d1", async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(runner.isRunning("d1")).toBe(false);
  });
});
