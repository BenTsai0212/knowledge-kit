// POST /api/ask。依序檢查同站、邀請碼、body、當日次數（每個碼，再來是全站）；任何一步失敗都不呼叫上游。
// 通過後轉發到 Claude Messages API 並串流回傳（upstream.ts）。
import { ConfigError, findAccessCode, parseAccessCodes, parseList, type AccessCode } from "./access";
import { errorResponse, type ErrorType } from "./errors";
import { isAllowedOrigin } from "./origin";
import { parseAskBody } from "./request";
import { buildUpstreamBody, classifyHttpError, MESSAGES_URL, relayStream, upstreamHeaders, type Fetch } from "./upstream";
import { utcDate, type UsageLimiter } from "./usage";

export interface AskEnv {
  ANTHROPIC_API_KEY?: string;
  ACCESS_CODES?: string;
  DISABLED_GROUPS?: string;
  DAILY_LIMIT?: string;
  GLOBAL_DAILY_LIMIT?: string;
  MAX_PROMPT_CHARS?: string;
  ALLOWED_ORIGINS?: string;
}

export interface AskDeps {
  usage: UsageLimiter;
  now: () => Date;
  fetch: Fetch;
  log: (entry: LogEntry) => void;
}

// 每次請求一行 log。不含金鑰、邀請碼與提示全文
export interface LogEntry {
  event: "ask";
  status: number;
  error?: ErrorType;
  stopReason?: string;
  upstreamStatus?: number;
  requestId?: string;
  group?: string;
  model?: string;
  promptChars?: number;
}

interface AskConfig {
  apiKey: string;
  codes: AccessCode[];
  disabledGroups: Set<string>;
  dailyLimit: number;
  // 全站（所有碼合計）的每日次數；未設定時不限制
  globalDailyLimit: number | undefined;
  maxPromptChars: number;
  allowedOrigins: string[];
}

export const DEFAULT_DAILY_LIMIT = 30;
export const DEFAULT_MAX_PROMPT_CHARS = 20_000;
// 全站計數的 Durable Object 名稱；每個碼的名稱是 64 字元的雜湊值，不會重複
export const GLOBAL_USAGE_KEY = "global";

function positiveInt<T extends number | undefined>(name: string, raw: string | undefined, fallback: T): number | T {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new ConfigError(`${name} 必須是正整數`);
  return value;
}

async function readConfig(env: AskEnv): Promise<AskConfig> {
  if (!env.ANTHROPIC_API_KEY) throw new ConfigError("未設定 ANTHROPIC_API_KEY");
  if (!env.ACCESS_CODES) throw new ConfigError("未設定 ACCESS_CODES");
  return {
    apiKey: env.ANTHROPIC_API_KEY,
    codes: await parseAccessCodes(env.ACCESS_CODES),
    disabledGroups: new Set(parseList(env.DISABLED_GROUPS)),
    dailyLimit: positiveInt("DAILY_LIMIT", env.DAILY_LIMIT, DEFAULT_DAILY_LIMIT),
    globalDailyLimit: positiveInt("GLOBAL_DAILY_LIMIT", env.GLOBAL_DAILY_LIMIT, undefined),
    maxPromptChars: positiveInt("MAX_PROMPT_CHARS", env.MAX_PROMPT_CHARS, DEFAULT_MAX_PROMPT_CHARS),
    allowedOrigins: parseList(env.ALLOWED_ORIGINS),
  };
}

export async function handleAsk(request: Request, env: AskEnv, deps: AskDeps): Promise<Response> {
  const entry: LogEntry = { event: "ask", status: 0 };
  const fail = (type: ErrorType, status: number, extra: Partial<LogEntry> = {}) => {
    deps.log({ ...entry, ...extra, status, error: type });
    return errorResponse(type, status);
  };

  let config: AskConfig;
  try {
    config = await readConfig(env);
  } catch (err) {
    // ConfigError 的訊息只寫原因，不含碼與金鑰，但仍不寫進 log
    if (err instanceof ConfigError) return fail("misconfigured", 500);
    throw err;
  }
  if (!isAllowedOrigin(request, config.allowedOrigins)) return fail("forbidden_origin", 403);

  // 沒有、錯誤或已停用的碼都回同一個錯誤，避免猜碼
  const code = request.headers.get("X-Access-Code");
  const match = code ? await findAccessCode(config.codes, code) : null;
  if (!match || config.disabledGroups.has(match.group)) return fail("invalid_access_code", 401);
  entry.group = match.group;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", 400);
  }
  const parsed = parseAskBody(body, config.maxPromptChars);
  if (!parsed.ok) return fail(parsed.error, 400);
  entry.model = parsed.ask.model;
  entry.promptChars = parsed.promptChars;

  // 先扣每個碼的次數，再扣全站的次數；被全站上限擋下時，該碼已扣的一次不退還
  const date = utcDate(deps.now());
  let limited: ErrorType | undefined;
  try {
    if (!(await deps.usage.consume(match.key, date, config.dailyLimit))) limited = "daily_limit";
    else if (config.globalDailyLimit !== undefined && !(await deps.usage.consume(GLOBAL_USAGE_KEY, date, config.globalDailyLimit)))
      limited = "global_daily_limit";
  } catch {
    // 免費額度用完等情況；為了不讓費用失控，此時不放行
    return fail("limit_unavailable", 503);
  }
  if (limited) return fail(limited, 429);

  // 上游失敗時不退還次數（#16 決定 3），也不重試
  let upstream: Response;
  try {
    upstream = await deps.fetch(MESSAGES_URL, {
      method: "POST",
      headers: upstreamHeaders(config.apiKey),
      body: JSON.stringify(buildUpstreamBody(parsed.ask)),
    });
  } catch {
    return fail("upstream_error", 502);
  }
  if (!upstream.ok || !upstream.body) {
    const { type, status, ...extra } = await classifyHttpError(upstream);
    return fail(type, status, extra);
  }

  const requestId = upstream.headers.get("request-id") ?? undefined;
  const stream = relayStream(upstream.body, ({ stopReason, error }) =>
    deps.log({ ...entry, status: 200, upstreamStatus: upstream.status, ...(requestId && { requestId }), ...(stopReason && { stopReason }), ...(error && { error }) }),
  );
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
  });
}
