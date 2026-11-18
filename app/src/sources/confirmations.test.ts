// 已確認段落的失效判斷（ADR 0013 決定 6）：純函式，不讀資料庫
import { describe, expect, it } from "vitest";
import { confirmationStatus, type ConflictLink } from "./confirmations";

const link = (newPassage: string, oldPassage: string, decision: ConflictLink["decision"]): ConflictLink => ({ newPassage, oldPassage, decision });

describe("confirmationStatus", () => {
  it("沒有說法不同，或全部是「不是說法不同」：有效", () => {
    expect(confirmationStatus("p", [])).toEqual({ kind: "valid" });
    expect(confirmationStatus("p", [link("x", "y", "coexist")])).toEqual({ kind: "valid" });
    expect(confirmationStatus("p", [link("n", "p", "not_conflict"), link("p", "o", "not_conflict")])).toEqual({ kind: "valid" });
  });

  it("並存或尚未處理：兩端都是「有不同說法」，連到另一段", () => {
    expect(confirmationStatus("p", [link("n", "p", "coexist")])).toEqual({ kind: "disputed", passageId: "n" });
    expect(confirmationStatus("p", [link("p", "o", "coexist")])).toEqual({ kind: "disputed", passageId: "o" });
    expect(confirmationStatus("p", [link("n", "p", null)])).toEqual({ kind: "disputed", passageId: "n" });
    expect(confirmationStatus("p", [link("p", "o", null)])).toEqual({ kind: "disputed", passageId: "o" });
  });

  it("以新的為準：舊的一段被取代，新的一段仍有效", () => {
    expect(confirmationStatus("p", [link("n", "p", "supersede")])).toEqual({ kind: "superseded", passageId: "n" });
    expect(confirmationStatus("p", [link("p", "o", "supersede")])).toEqual({ kind: "valid" });
  });

  it("屬於多組時取最嚴重的一種（被取代 > 有不同說法 > 有效），同一種取第一組", () => {
    const links = [link("p", "o", "supersede"), link("a", "p", "coexist"), link("b", "p", null), link("c", "p", "supersede"), link("d", "p", "supersede")];
    expect(confirmationStatus("p", links)).toEqual({ kind: "superseded", passageId: "c" });
    expect(confirmationStatus("p", links.slice(0, 3))).toEqual({ kind: "disputed", passageId: "a" });
    expect(confirmationStatus("p", [link("p", "o", "supersede"), link("p", "q", "not_conflict")])).toEqual({ kind: "valid" });
  });
});
