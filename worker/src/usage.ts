// 每個邀請碼的每日次數。每個碼一個 Durable Object（以碼的 SHA-256 命名），以 UTC 日期換日。
export interface UsageRecord {
  date: string;
  count: number;
}

export function consume(record: UsageRecord | undefined, date: string, limit: number): { record: UsageRecord; allowed: boolean } {
  const count = record?.date === date ? record.count : 0;
  if (count >= limit) return { record: { date, count }, allowed: false };
  return { record: { date, count: count + 1 }, allowed: true };
}

export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// SQLite 後端的 Durable Object（wrangler.jsonc 的 new_sqlite_classes）；同一物件的請求依序處理，計數不會超賣
export class UsageCounter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const { date, limit } = await request.json<{ date: string; limit: number }>();
    const result = consume(await this.state.storage.get<UsageRecord>("usage"), date, limit);
    if (result.allowed) await this.state.storage.put("usage", result.record);
    return Response.json({ allowed: result.allowed });
  }
}

export interface UsageLimiter {
  // 回傳是否還在上限內（並已計入這一次）；Durable Object 無法使用時拋出錯誤
  consume(key: string, date: string, limit: number): Promise<boolean>;
}

export function durableUsage(namespace: DurableObjectNamespace): UsageLimiter {
  return {
    async consume(key, date, limit) {
      const stub = namespace.get(namespace.idFromName(key));
      const res = await stub.fetch("https://usage/consume", { method: "POST", body: JSON.stringify({ date, limit }) });
      if (!res.ok) throw new Error(`UsageCounter 回應 ${res.status}`);
      return (await res.json<{ allowed: boolean }>()).allowed;
    },
  };
}
