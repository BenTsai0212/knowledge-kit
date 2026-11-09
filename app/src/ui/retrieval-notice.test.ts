// 檢索提示（#171）：語意模型準備中顯示「載入中」或「下載中」與進度，準備好後消失，降級時改顯示降級提示；keyword-hash 不顯示。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fill, strings } from "../client/i18n";
import { preparesModel, RETRIEVAL_DEFAULTS, type ProviderFallback } from "../retrieval/providers";
import { megabytes, PREPARING, retrievalNotice, sameDisplay, type ProviderStatus } from "./retrieval-notice";
import { RetrievalNotice } from "./RetrievalNotice";

const MB = 1024 * 1024;
const SEMANTIC = preparesModel(RETRIEVAL_DEFAULTS["multilingual-e5-small"]);
const KEYWORD = preparesModel(RETRIEVAL_DEFAULTS["keyword-hash"]);
const downloading = (loaded: number, total: number): ProviderStatus => ({ state: "preparing", progress: { loaded, total } });
const FALLBACK: ProviderFallback = { from: "multilingual-e5-small", reason: "download" };
const READY: ProviderStatus = { state: "ready", fallback: null };

const render = (preparesModel: boolean, status: ProviderStatus, language = "zh-TW") =>
  renderToStaticMarkup(createElement(RetrievalNotice, { language, preparesModel, status }));

describe("preparesModel", () => {
  it("只有語意向量要先準備模型", () => {
    expect([SEMANTIC, KEYWORD]).toEqual([true, false]);
  });
});

describe("retrievalNotice", () => {
  it("準備中、還沒有下載進度（查快取或從快取載入）：載入中", () => {
    expect(retrievalNotice(SEMANTIC, PREPARING)).toEqual({ kind: "loading" });
  });

  it("下載中：顯示已下載與總大小", () => {
    expect(retrievalNotice(SEMANTIC, downloading(12 * MB, 129 * MB))).toEqual({ kind: "downloading", loaded: 12 * MB, total: 129 * MB });
    expect(retrievalNotice(SEMANTIC, downloading(0, 129 * MB))).toEqual({ kind: "downloading", loaded: 0, total: 129 * MB });
  });

  it("下載完成、初始化中：改回載入中", () => {
    expect(retrievalNotice(SEMANTIC, downloading(129 * MB, 129 * MB))).toEqual({ kind: "loading" });
  });

  it("準備好：不顯示", () => {
    expect(retrievalNotice(SEMANTIC, READY)).toBeNull();
  });

  it("降級：改顯示降級提示", () => {
    expect(retrievalNotice(SEMANTIC, { state: "ready", fallback: FALLBACK })).toEqual({ kind: "fallback", fallback: FALLBACK });
  });

  it("keyword-hash：準備中與準備好都不顯示", () => {
    for (const status of [PREPARING, downloading(1, 2), READY]) expect(retrievalNotice(KEYWORD, status)).toBeNull();
  });
});

describe("RetrievalNotice", () => {
  const s = strings("zh-TW");

  it("準備中顯示載入中，不顯示進度", () => {
    const html = render(SEMANTIC, PREPARING);
    expect(html).toContain(s.modelLoadingTitle);
    expect(html).not.toContain("<progress");
  });

  it("下載中顯示進度的數字（MB，小數一位）與進度條", () => {
    const html = render(SEMANTIC, downloading(12_939_428, 135_392_183));
    expect(html).toContain(s.modelDownloadingTitle);
    expect(html).toContain(fill(s.modelDownloadProgress, { loaded: "12.3", total: "129.1" }));
    expect(html).toContain('<progress value="12939428" max="135392183">');
  });

  it("英文也顯示進度", () => {
    expect(render(SEMANTIC, downloading(5 * MB, 10 * MB), "en")).toContain(fill(strings("en").modelDownloadProgress, { loaded: "5.0", total: "10.0" }));
  });

  it("準備好後不顯示任何內容", () => {
    expect(render(SEMANTIC, READY)).toBe("");
  });

  it("降級時顯示降級提示，不顯示準備中的提示", () => {
    const html = render(SEMANTIC, { state: "ready", fallback: FALLBACK });
    expect(html).toContain(s.retrievalFallbackTitle);
    expect(html).toContain(s.retrievalFallback.download);
    expect(html).not.toContain(s.modelLoadingTitle);
  });

  it("keyword-hash 的客戶畫面不變", () => {
    for (const status of [PREPARING, downloading(1, 2), READY]) expect(render(KEYWORD, status)).toBe("");
  });
});

describe("megabytes 與 sameDisplay", () => {
  it("以 1024 × 1024 bytes 為 1 MB，到小數一位", () => {
    expect([megabytes(0), megabytes(MB), megabytes(135_392_183)]).toEqual(["0.0", "1.0", "129.1"]);
  });

  it("顯示的數字沒變時不更新；狀態改變時更新", () => {
    expect(sameDisplay(downloading(MB, 10 * MB), downloading(MB + 100, 10 * MB))).toBe(true);
    expect(sameDisplay(downloading(MB, 10 * MB), downloading(2 * MB, 10 * MB))).toBe(false);
    expect(sameDisplay(PREPARING, PREPARING)).toBe(true);
    expect(sameDisplay(PREPARING, downloading(0, 10 * MB))).toBe(false);
    expect(sameDisplay(downloading(0, 10 * MB), READY)).toBe(false);
  });
});
