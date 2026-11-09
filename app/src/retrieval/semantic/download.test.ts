// 模型檔的下載與驗證：以假的 bytes、fetch 與 CacheStorage 測試，不連網（#163）。
import { describe, expect, it } from "vitest";
import { cacheName, loadVerifiedFiles, ModelLoadError, sha256Hex, type DownloadDeps } from "./download";
import { E5_MODEL, modelFileUrl, type ModelSpec } from "./model-files";

const bytesOf = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
const A = bytesOf("config");
const B = bytesOf("weights!");

async function spec(): Promise<ModelSpec> {
  return {
    id: "example/model",
    revision: "0123456789abcdef0123456789abcdef01234567",
    prefix: { query: "", passage: "" },
    files: [
      { path: "config.json", bytes: A.byteLength, sha256: await sha256Hex(A) },
      { path: "onnx/model.onnx", bytes: B.byteLength, sha256: await sha256Hex(B) },
    ],
  };
}

// 假的 CacheStorage：只記錄用到的 cache 名稱與內容
function fakeCaches() {
  const stores = new Map<string, Map<string, Uint8Array<ArrayBuffer>>>();
  const caches: DownloadDeps["caches"] = {
    async open(name) {
      const store = stores.get(name) ?? new Map();
      stores.set(name, store);
      return {
        async match(url: string) {
          const bytes = store.get(url);
          return bytes && new Response(bytes);
        },
        async put(url: string, response: Response) {
          store.set(url, new Uint8Array(await response.arrayBuffer()));
        },
        async delete(url: string) {
          return store.delete(url);
        },
      } as unknown as Cache;
    },
  };
  return { caches, stores };
}

function fakeFetch(bodies: Record<string, Uint8Array<ArrayBuffer> | number>) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    const body = bodies[url];
    return typeof body === "number" ? new Response(null, { status: body }) : new Response(body ?? null, { status: body ? 200 : 404 });
  };
  return { fetch, calls };
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => expect.unreachable("應該拋錯"),
    (error: unknown) => {
      expect(error).toBeInstanceOf(ModelLoadError);
      return error as ModelLoadError;
    },
  );

describe("loadVerifiedFiles", () => {
  it("雜湊相符：交出 bytes 並寫入以 commit 區分的快取；第二次只讀快取", async () => {
    const model = await spec();
    const { caches, stores } = fakeCaches();
    const net = fakeFetch({ [modelFileUrl(model, "config.json")]: A, [modelFileUrl(model, "onnx/model.onnx")]: B });

    const files = await loadVerifiedFiles(model, { fetch: net.fetch, caches });
    expect([...files.keys()]).toEqual(["config.json", "onnx/model.onnx"]);
    expect(files.get("onnx/model.onnx")).toEqual(B);
    expect([...stores.keys()]).toEqual([cacheName(model)]);
    expect(cacheName(model)).toContain(model.revision);

    await loadVerifiedFiles(model, { fetch: net.fetch, caches });
    expect(net.calls).toHaveLength(2);
  });

  it("下載的檔案雜湊不符：拋錯，不寫入快取", async () => {
    const model = await spec();
    const { caches, stores } = fakeCaches();
    const tampered = bytesOf("weights?");
    const net = fakeFetch({ [modelFileUrl(model, "config.json")]: A, [modelFileUrl(model, "onnx/model.onnx")]: tampered });

    const error = await failure(loadVerifiedFiles(model, { fetch: net.fetch, caches }));
    expect([error.reason, error.path]).toEqual(["sha256", "onnx/model.onnx"]);
    expect(stores.get(cacheName(model))?.has(modelFileUrl(model, "onnx/model.onnx"))).toBe(false);
  });

  it("大小不符：拋錯", async () => {
    const model = await spec();
    const { caches } = fakeCaches();
    const net = fakeFetch({ [modelFileUrl(model, "config.json")]: bytesOf("config + more") });
    expect((await failure(loadVerifiedFiles(model, { fetch: net.fetch, caches }))).reason).toBe("size");
  });

  it("快取中的檔案雜湊不符：刪除後重新下載", async () => {
    const model = await spec();
    const { caches, stores } = fakeCaches();
    const net = fakeFetch({ [modelFileUrl(model, "config.json")]: A, [modelFileUrl(model, "onnx/model.onnx")]: B });
    const store = new Map([[modelFileUrl(model, "onnx/model.onnx"), bytesOf("weights?")]]);
    stores.set(cacheName(model), store);

    const files = await loadVerifiedFiles(model, { fetch: net.fetch, caches });
    expect(files.get("onnx/model.onnx")).toEqual(B);
    expect(store.get(modelFileUrl(model, "onnx/model.onnx"))).toEqual(B);
    expect(net.calls).toContain(modelFileUrl(model, "onnx/model.onnx"));
  });

  it("HTTP 錯誤：拋錯", async () => {
    const model = await spec();
    const { caches } = fakeCaches();
    const net = fakeFetch({ [modelFileUrl(model, "config.json")]: 503 });
    const error = await failure(loadVerifiedFiles(model, { fetch: net.fetch, caches }));
    expect([error.reason, error.message]).toEqual(["http", "model file config.json: HTTP 503"]);
  });

  it("連不上（fetch 拋錯）：與 HTTP 錯誤同樣算下載失敗", async () => {
    const model = await spec();
    const { caches } = fakeCaches();
    const offline = async () => Promise.reject(new TypeError("Failed to fetch"));
    const error = await failure(loadVerifiedFiles(model, { fetch: offline, caches }));
    expect([error.reason, error.path, error.message]).toEqual(["http", "config.json", "model file config.json: fetch failed: Failed to fetch"]);
  });

  // E5_MODEL 已全部登記，以測試自己的 ModelSpec 測未登記的情形
  it("有檔案未登記 SHA-256：一個檔都不下載就拋錯", async () => {
    const model = await spec();
    const { caches } = fakeCaches();
    const net = fakeFetch({});
    const unregistered = { ...model, files: [model.files[0], { ...model.files[1], sha256: null }] };
    expect((await failure(loadVerifiedFiles(unregistered, { fetch: net.fetch, caches }))).reason).toBe("unregistered");
    expect(net.calls).toEqual([]);
  });
});

describe("下載進度（#171）", () => {
  // 分成多段送出的回應，模擬大檔逐段到達
  const chunked = (bytes: Uint8Array<ArrayBuffer>, size: number) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < bytes.byteLength; i += size) controller.enqueue(bytes.slice(i, i + size));
          controller.close();
        },
      }),
    );

  async function download(model: ModelSpec, caches: DownloadDeps["caches"]) {
    const reports: { loaded: number; total: number }[] = [];
    const bodies: Record<string, Uint8Array<ArrayBuffer>> = { [modelFileUrl(model, "config.json")]: A, [modelFileUrl(model, "onnx/model.onnx")]: B };
    const fetch = async (url: string) => chunked(bodies[url], 3);
    const files = await loadVerifiedFiles(model, { fetch, caches }, (progress) => reports.push(progress));
    return { files, reports };
  }

  it("沒有快取：連網前回報 0，之後逐段累計到登記大小的合計；交出的 bytes 與驗證不變", async () => {
    const model = await spec();
    const total = A.byteLength + B.byteLength;
    const { files, reports } = await download(model, fakeCaches().caches);
    expect(files.get("config.json")).toEqual(A);
    expect(files.get("onnx/model.onnx")).toEqual(B);
    // config（6 bytes）分 3＋3，weights!（8 bytes）分 3＋3＋2
    expect(reports.map((r) => r.loaded)).toEqual([0, 3, 6, 6, 9, 12, 14]);
    expect(reports.every((r) => r.total === total)).toBe(true);
  });

  it("部分檔案在快取：從快取讀到的大小計入已下載", async () => {
    const model = await spec();
    const { caches, stores } = fakeCaches();
    stores.set(cacheName(model), new Map([[modelFileUrl(model, "config.json"), A]]));
    const { reports } = await download(model, caches);
    expect(reports.map((r) => r.loaded)).toEqual([6, 9, 12, 14]);
  });

  it("全部在快取：不回報進度", async () => {
    const model = await spec();
    const { caches } = fakeCaches();
    await download(model, caches);
    const { reports } = await download(model, caches);
    expect(reports).toEqual([]);
  });

  it("回應超過登記大小：進度不超過合計，照樣以大小不符拒絕", async () => {
    const model = await spec();
    const reports: number[] = [];
    const fetch = async () => chunked(bytesOf("config + more"), 4);
    const error = await failure(loadVerifiedFiles(model, { fetch, caches: fakeCaches().caches }, (p) => reports.push(p.loaded)));
    expect(error.reason).toBe("size");
    expect(Math.max(...reports)).toBe(A.byteLength);
  });
});

describe("E5_MODEL", () => {
  it("固定在 commit SHA，網址不含 main 等會變動的 ref", () => {
    expect(E5_MODEL.revision).toMatch(/^[0-9a-f]{40}$/);
    for (const file of E5_MODEL.files) {
      expect(modelFileUrl(E5_MODEL, file.path)).toBe(`https://huggingface.co/Xenova/multilingual-e5-small/resolve/${E5_MODEL.revision}/${file.path}`);
    }
  });

  it("每個檔案都已登記 64 位小寫 hex 的 SHA-256", () => {
    expect(E5_MODEL.files).toHaveLength(5);
    for (const file of E5_MODEL.files) expect(file.sha256, file.path).toMatch(/^[0-9a-f]{64}$/);
  });

  it("q8 模型與 tokenizer 都在清單中", () => {
    expect(E5_MODEL.files.map((f) => f.path)).toEqual(
      expect.arrayContaining(["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"]),
    );
  });
});
