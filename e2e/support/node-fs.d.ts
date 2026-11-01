// e2e 的 tsconfig 不含 Node 的型別（沒有 @types/node），只宣告 support/ 用到的部分
declare module "node:fs" {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function appendFileSync(path: string, data: string): void;
}

declare const process: { env: Record<string, string | undefined> };
