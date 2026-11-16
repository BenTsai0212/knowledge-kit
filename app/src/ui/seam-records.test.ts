// 人的理解的顯示（ADR 0012 決定 6，畫板 S-QA）：先作答或略過才看得到同事的理解；只顯示角色與日期；記錄不用綠色或勾勾
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { strings } from "../client/i18n";
import { clientConfig } from "../client/load";
import { OTHER_CHOICE, type Interpretation } from "../conflicts/interpretations";
import css from "./app.css?raw";
import { roleLabel } from "./ReportResult";
import { pairKey, pairRecords, recordRows } from "./seam-records";
import { SeamRecords } from "./SeamRecords";

const language = clientConfig.client.defaultLanguage;
const s = strings(language);
const roles = clientConfig.access.roles.map((r) => r.id);
const cssText = css.replace(/\/\*[\s\S]*?\*\//g, "");
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");

const interpretation = (extra: Partial<Interpretation>): Interpretation => ({
  id: `in-${Math.random()}`,
  passageA: "p-a",
  passageB: "p-b",
  choice: "我覺得是後來改過",
  changedAfterChallenge: false,
  note: null,
  createdBy: roles[0],
  createdAt: "2026-05-20T08:00:00Z",
  mine: false,
  ...extra,
});

const render = (items: Interpretation[], skipped: boolean, showLocked: boolean) =>
  renderToStaticMarkup(createElement(SeamRecords, { language, items, skipped, title: s.dialogueRecordTitle, showLocked }));

describe("recordRows", () => {
  const peer = interpretation({ choice: "我覺得是不同的情況" });
  const mine = interpretation({ mine: true });

  it("還沒作答也沒略過：不顯示同事的理解", () => {
    expect(recordRows([peer], false)).toEqual({ mine: [], peers: [], locked: true });
  });

  it("留下理解之後：自己的與同事的分開", () => {
    expect(recordRows([peer, mine], false)).toEqual({ mine: [mine], peers: [peer], locked: false });
  });

  it("略過之後也看得到同事的理解", () => {
    expect(recordRows([peer], true)).toEqual({ mine: [], peers: [peer], locked: false });
  });

  it("pairRecords：兩段順序不拘，只取同一組", () => {
    const other = interpretation({ passageA: "p-a", passageB: "p-c" });
    expect(pairRecords([peer, other], "p-b", "p-a")).toEqual([peer]);
    expect(pairKey("p-b", "p-a")).toBe(pairKey("p-a", "p-b"));
  });
});

describe("SeamRecords", () => {
  it("回答卡片：還沒作答時不顯示任何東西", () => {
    expect(render([interpretation({})], false, false)).toBe("");
  });

  it("原文欄：還沒作答時說明先作答才看得到同事的理解，不透露同事的選擇", () => {
    const html = render([interpretation({})], false, true);
    expect(html).toContain(escape(s.dialogueRecordLocked));
    expect(html).not.toContain("我覺得是後來改過");
  });

  it("作答後：自己的理解與同事的理解，只顯示角色與日期；都不是時顯示說明", () => {
    const peerRole = roles.at(-1)!;
    const html = render(
      [interpretation({ mine: true, choice: OTHER_CHOICE, note: "兩份都對" }), interpretation({ createdBy: peerRole, choice: "我覺得是不同的情況" })],
      false,
      false,
    );
    expect(html).toContain(escape(s.dialogueRecordTitle));
    expect(html).toContain("兩份都對");
    expect(html).not.toContain(`>${OTHER_CHOICE}<`);
    expect(html).toContain(escape(s.dialogueRecordPeers));
    expect(html).toContain("我覺得是不同的情況");
    expect(html).toContain(escape(roleLabel(peerRole, language)));
  });

  it("記錄的外觀：上方虛線、沒有框；不用 success、danger、warning", () => {
    const rules = cssText.match(/\.seam-record[\w-]*[^{]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    const block = cssText.match(/\n\.seam-record\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toContain("border-top: 1px dashed");
    expect(block).not.toMatch(/background|border:/);
    for (const rule of rules) expect(rule).not.toMatch(/--color-(success|danger|warning)/);
  });
});
