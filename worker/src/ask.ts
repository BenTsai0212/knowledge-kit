// POST /api/ask。依序檢查同站、邀請碼、body、當日次數；任何一步失敗都不呼叫上游。
import { ConfigError, findAccessCode, parseAccessCodes, parseList, type AccessCode } from "./access";
import { errorResponse } from "./errors";
import { isAllowedOrigin } from "./origin";
import { parseAskBody } from "./request";
import { utcDate, type UsageLimiter } from "./usage";

export interface AskEnv {
  ACCESS_CODES?: string;
  DISABLED_GROUPS?: string;
  DAILY_LIMIT?: string;
  MAX_PROMPT_CHARS?: string;
  ALLOWED_ORIGINS?: string;
}

export interface AskDeps {
  usage: UsageLimiter;
  now: () => Date;
}

interface AskConfig {
  codes: AccessCode[];
  disabledGroups: Set<string>;
  dailyLimit: number;
  maxPromptChars: number;
  allowedOrigins: string[];
}

export const DEFAULT_DAILY_LIMIT = 30;
export const DEFAULT_MAX_PROMPT_CHARS = 20_000;

function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new ConfigError(`${name} 必須是正整數`);
  return value;
}

async function readConfig(env: AskEnv): Promise<AskConfig> {
  if (!env.ACCESS_CODES) throw new ConfigError("未設定 ACCESS_CODES");
  return {
    codes: await parseAccessCodes(env.ACCESS_CODES),
    disabledGroups: new Set(parseList(env.DISABLED_GROUPS)),
    dailyLimit: positiveInt("DAILY_LIMIT", env.DAILY_LIMIT, DEFAULT_DAILY_LIMIT),
    maxPromptChars: positiveInt("MAX_PROMPT_CHARS", env.MAX_PROMPT_CHARS, DEFAULT_MAX_PROMPT_CHARS),
    allowedOrigins: parseList(env.ALLOWED_ORIGINS),
  };
}

export async function handleAsk(request: Request, env: AskEnv, deps: AskDeps): Promise<Response> {
  let config: AskConfig;
  try {
    config = await readConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return errorResponse("misconfigured", 500);
    throw err;
  }
  if (!isAllowedOrigin(request, config.allowedOrigins)) return errorResponse("forbidden_origin", 403);

  // 沒有、錯誤或已停用的碼都回同一個錯誤，避免猜碼
  const code = request.headers.get("X-Access-Code");
  const match = code ? await findAccessCode(config.codes, code) : null;
  if (!match || config.disabledGroups.has(match.group)) return errorResponse("invalid_access_code", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_request", 400);
  }
  const parsed = parseAskBody(body, config.maxPromptChars);
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  let allowed: boolean;
  try {
    allowed = await deps.usage.consume(match.key, utcDate(deps.now()), config.dailyLimit);
  } catch {
    // 免費額度用完等情況；為了不讓費用失控，此時不放行
    return errorResponse("limit_unavailable", 503);
  }
  if (!allowed) return errorResponse("daily_limit", 429);

  // 上游呼叫與串流在 #16 的下一個 PR 實作
  return errorResponse("not_implemented", 501);
}
