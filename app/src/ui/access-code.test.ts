import { describe, expect, it } from "vitest";
import { clearAccessCode, loadAccessCode, saveAccessCode, type CodeStorage } from "./access-code";

const memory = (): CodeStorage & { items: Map<string, string> } => {
  const items = new Map<string, string>();
  return { items, getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), removeItem: (k) => void items.delete(k) };
};
const broken: CodeStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("邀請碼的保存", () => {
  it("存入、讀出、清除", () => {
    const storage = memory();
    expect(loadAccessCode(storage)).toBeNull();
    saveAccessCode("code-for-test", storage);
    expect(loadAccessCode(storage)).toBe("code-for-test");
    clearAccessCode(storage);
    expect(loadAccessCode(storage)).toBeNull();
    expect(storage.items.size).toBe(0);
  });

  it("sessionStorage 無法使用時不拋錯", () => {
    expect(() => saveAccessCode("x", broken)).not.toThrow();
    expect(loadAccessCode(broken)).toBeNull();
    expect(() => clearAccessCode(broken)).not.toThrow();
    expect(loadAccessCode(null)).toBeNull();
  });
});

describe("邀請碼不放 localStorage", () => {
  it("app/src/ 的程式不使用 localStorage", () => {
    const sources = import.meta.glob<string>("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
    const files = Object.entries(sources).filter(([path]) => !path.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(10);
    expect(files.filter(([, text]) => /\blocalStorage\b/.test(text)).map(([path]) => path)).toEqual([]);
  });
});
