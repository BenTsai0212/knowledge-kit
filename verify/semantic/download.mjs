// 下載候選模型到 .verify-models/（不進版本控制），驗證大小與雜湊；不符時刪檔並失敗。
// 執行：NODE_USE_ENV_PROXY=1 node verify/semantic/download.mjs
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_DIR, MODELS } from "./models.mjs";

const verify = (buf, expect) => {
  if (buf.length !== expect.size) return `大小 ${buf.length} ≠ ${expect.size}`;
  if (expect.sha256 && createHash("sha256").update(buf).digest("hex") !== expect.sha256) return "SHA-256 不符";
  if (expect.gitSha1) {
    const blob = createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
    if (blob !== expect.gitSha1) return "git blob SHA-1 不符";
  }
  return null;
};

const manifest = [];
for (const m of MODELS) {
  for (const [file, expect] of Object.entries(m.files)) {
    const path = fileURLToPath(new URL(`${m.id}/${file}`, MODEL_DIR));
    let buf = existsSync(path) ? readFileSync(path) : null;
    if (!buf || verify(buf, expect)) {
      const url = `https://huggingface.co/${m.id}/resolve/${m.revision}/${file}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}：HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
      const error = verify(buf, expect);
      if (error) throw new Error(`${m.id}/${file}：${error}`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, buf);
    }
    manifest.push({ model: m.id, revision: m.revision, file, bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") });
  }
}
for (const r of manifest) console.log([r.model, r.file, r.bytes, r.sha256].join("\t"));
if (process.argv.includes("--clean")) rmSync(MODEL_DIR, { recursive: true, force: true });
