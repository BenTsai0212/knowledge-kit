// ACCESS_CODES 的格式：組名:碼,碼;組名:碼。組可用 DISABLED_GROUPS 停用。
const GROUP = /^[a-z][a-z0-9-]{0,31}$/;
const CODE = /^[A-Za-z0-9]{8,}$/;

export interface AccessCode {
  group: string;
  digest: Uint8Array;
}

export class ConfigError extends Error {}

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// 錯誤訊息只寫位置與原因，不含碼本身
export async function parseAccessCodes(raw: string): Promise<AccessCode[]> {
  const groups = new Set<string>();
  const seen = new Set<string>();
  const result: AccessCode[] = [];
  for (const [i, entry] of raw.split(";").entries()) {
    if (entry.trim() === "") continue;
    const [group, codes, ...rest] = entry.split(":").map((s) => s.trim());
    if (codes === undefined || rest.length > 0) throw new ConfigError(`ACCESS_CODES 第 ${i + 1} 組格式錯誤`);
    if (!GROUP.test(group)) throw new ConfigError(`ACCESS_CODES 第 ${i + 1} 組的組名格式錯誤`);
    if (groups.has(group)) throw new ConfigError(`ACCESS_CODES 組名 ${group} 重複`);
    groups.add(group);
    for (const code of codes.split(",").map((s) => s.trim())) {
      if (!CODE.test(code)) throw new ConfigError(`ACCESS_CODES 組 ${group} 有格式錯誤的碼`);
      if (seen.has(code)) throw new ConfigError(`ACCESS_CODES 組 ${group} 有重複的碼`);
      seen.add(code);
      result.push({ group, digest: await sha256(code) });
    }
  }
  if (result.length === 0) throw new ConfigError("ACCESS_CODES 沒有任何碼");
  return result;
}

// 以雜湊值做固定時間比較，並比完所有碼，避免從回應時間推測碼
export async function findAccessCode(codes: readonly AccessCode[], code: string): Promise<{ group: string; key: string } | null> {
  const digest = await sha256(code);
  let found: AccessCode | null = null;
  for (const candidate of codes) {
    let diff = 0;
    for (let i = 0; i < digest.length; i++) diff |= digest[i] ^ candidate.digest[i];
    if (diff === 0) found = candidate;
  }
  return found && { group: found.group, key: toHex(digest) };
}

export function parseList(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
}
