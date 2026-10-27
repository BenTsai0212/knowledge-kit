import { describe, expect, it } from "vitest";
import { findAccessCode, parseAccessCodes, parseList } from "./access";

describe("parseAccessCodes", () => {
  it("解析分組格式，忽略空白與空的組", async () => {
    const codes = await parseAccessCodes(" sales: AAAA1111 , BBBB2222 ;; partner-a:CCCC3333; ");
    expect(codes.map((c) => c.group)).toEqual(["sales", "sales", "partner-a"]);
  });

  it.each([
    ["沒有冒號", "salesAAAA1111", "格式錯誤"],
    ["多個冒號", "sales:AAAA1111:x", "格式錯誤"],
    ["組名格式錯誤", "Sales:AAAA1111", "組名格式錯誤"],
    ["組名重複", "sales:AAAA1111;sales:BBBB2222", "組名 sales 重複"],
    ["碼太短", "sales:AAA111", "格式錯誤的碼"],
    ["碼含符號", "sales:AAAA-1111", "格式錯誤的碼"],
    ["同一個碼出現在兩組", "sales:AAAA1111;demo:AAAA1111", "重複的碼"],
    ["沒有任何碼", " ; ", "沒有任何碼"],
  ])("%s 視為設定錯誤", async (_name, raw, message) => {
    await expect(parseAccessCodes(raw)).rejects.toThrow(message);
  });

  it("錯誤訊息不含碼本身", async () => {
    await expect(parseAccessCodes("sales:AAAA1111;demo:AAAA1111")).rejects.not.toThrow("AAAA1111");
  });
});

describe("findAccessCode", () => {
  it("找到碼所屬的組，key 是碼的 SHA-256", async () => {
    const codes = await parseAccessCodes("sales:AAAA1111;demo:BBBB2222");
    const match = await findAccessCode(codes, "BBBB2222");
    expect(match?.group).toBe("demo");
    expect(match?.key).toMatch(/^[0-9a-f]{64}$/);
    expect(match?.key).not.toContain("BBBB2222");
  });

  it("不存在的碼回傳 null（大小寫視為不同）", async () => {
    const codes = await parseAccessCodes("sales:AAAA1111");
    expect(await findAccessCode(codes, "aaaa1111")).toBeNull();
  });
});

describe("parseList", () => {
  it("逗號分隔，忽略空白與空值", () => {
    expect(parseList(" a, ,b ")).toEqual(["a", "b"]);
    expect(parseList(undefined)).toEqual([]);
  });
});
