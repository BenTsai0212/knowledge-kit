// verifiedCache 搭配真正的 transformers.js：以測試自己準備的小檔跑 pipeline() 讀設定與 tokenizer 的階段，
// 不下載模型、不連網（#168）。multilingual-e5-small.test.ts 以注入的假模型測試，經過不到這段流程。
import { describe, expect, it } from "vitest";
import { E5_MODEL } from "./model-files";
import { useVerifiedFilesOnly } from "./runtime";

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)) as Uint8Array<ArrayBuffer>;

// 只放 transformers.js 需要讀的欄位，不是真正的模型檔；不放 ONNX 模型
const files = new Map([
  ["config.json", json({ model_type: "xlm-roberta", architectures: ["XLMRobertaModel"] })],
  ["tokenizer_config.json", json({ tokenizer_class: "XLMRobertaTokenizer" })],
  [
    "tokenizer.json",
    json({
      version: "1.0",
      truncation: null,
      padding: null,
      added_tokens: [],
      normalizer: null,
      pre_tokenizer: { type: "Whitespace" },
      post_processor: null,
      decoder: null,
      model: { type: "WordLevel", vocab: { "<unk>": 0, hello: 1 }, unk_token: "<unk>" },
    }),
  ],
]);

const load = async () => {
  const transformers = await import("@huggingface/transformers");
  useVerifiedFilesOnly(transformers.env, E5_MODEL, files);
  return transformers;
};

describe("verifiedCache 與 transformers.js", () => {
  it("get_pipeline_files() 不帶 revision 時也讀得到驗證過的設定與 tokenizer_config.json", async () => {
    const { ModelRegistry } = await load();
    const found = await ModelRegistry.get_pipeline_files("feature-extraction", E5_MODEL.id, { device: "wasm", dtype: "q8" });
    expect(found).toEqual(expect.arrayContaining(["config.json", "tokenizer.json", "tokenizer_config.json"]));
  });

  it("以固定 commit 載入 tokenizer", async () => {
    const { AutoTokenizer } = await load();
    const tokenizer = await AutoTokenizer.from_pretrained(E5_MODEL.id, { revision: E5_MODEL.revision });
    expect(tokenizer.encode("hello")).toEqual([1]);
  });

  it("pipeline() 讀完設定與 tokenizer，停在找不到 ONNX 模型", async () => {
    const { pipeline } = await load();
    // Node 版的 transformers.js 不支援 wasm 裝置，改用 cpu；瀏覽器中的 wasm 由人以量測頁確認
    const loading = pipeline("feature-extraction", E5_MODEL.id, { dtype: "q8", device: "cpu", revision: E5_MODEL.revision });
    await expect(loading).rejects.toThrow(/onnx\/model_quantized\.onnx/);
  });
});
