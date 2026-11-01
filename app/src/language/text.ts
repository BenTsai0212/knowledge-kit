// 語言模組的對外函式（#83）：檢索的切詞（retrieval/tokenize.ts）與上傳的切段（upload/chunk.ts）經由這裡處理語言規則。
import { FULLWIDTH_PUNCTUATION, OTHER, SCRIPTS, SENTENCE_ENDS, type ScriptRule } from "./scripts";
import { STOPWORDS } from "./stopwords";

export interface Segment {
  text: string;
  mode: "bigram" | "word";
  isStopword: (token: string) => boolean;
  stem: (word: string) => string;
}

interface Compiled {
  pattern: RegExp;
  rules: { test: RegExp; rule: ScriptRule; isStopword: Segment["isStopword"]; stem: Segment["stem"] }[];
}

function compile(scripts: readonly ScriptRule[], other: ScriptRule): Compiled {
  const known = scripts.map((r) => r.chars).join("");
  const pattern = new RegExp([...scripts.map((r) => `[${r.chars}]+`), `(?:(?![${known}])[${other.chars}])+`].join("|"), "gu");
  const rules = [...scripts, other].map((rule) => {
    const stopwords = rule.stopwords === undefined ? undefined : STOPWORDS[rule.stopwords];
    return {
      test: new RegExp(`^[${rule.chars}]`, "u"),
      rule,
      isStopword: (token: string) => stopwords?.has(token) ?? false,
      stem: rule.stem ?? ((word: string) => word),
    };
  });
  return { pattern, rules };
}

const DEFAULT = compile(SCRIPTS, OTHER);

// 依文字類別把文字切成小段，每段帶著所屬類別的切詞方式、停用詞與字尾處理；不屬於任何類別的字元（標點、空白）去掉。
// scripts、other 只供測試指定規則
export function segments(text: string, scripts?: readonly ScriptRule[], other: ScriptRule = OTHER): Segment[] {
  const { pattern, rules } = scripts === undefined ? DEFAULT : compile(scripts, other);
  const out: Segment[] = [];
  for (const [run] of text.matchAll(pattern)) {
    const { rule, isStopword, stem } = rules.find((r) => r.test.test(run))!;
    if (rule.mode === "segmenter") {
      for (const s of new Intl.Segmenter(rule.locale, { granularity: "word" }).segment(run)) {
        if (s.isWordLike) out.push({ text: s.segment, mode: "word", isStopword, stem });
      }
    } else out.push({ text: run, mode: rule.mode, isStopword, stem });
  }
  return out;
}

// 換行與句子相連時不加空白的字元
const JOINS = new RegExp(`[${SCRIPTS.filter((r) => r.joinsWithoutSpace).map((r) => r.chars).join("")}${FULLWIDTH_PUNCTUATION}]`, "u");

// 段落內的換行：兩側都是不加空白的字元時直接相連，否則換成空白
export function joinLine(text: string, line: string): string {
  if (text === "") return line;
  return JOINS.test(text.at(-1)!) && JOINS.test(line[0]) ? text + line : `${text} ${line}`;
}

// 切開的句子再合併：前一句以不加空白的字元結尾時直接相連
export function joinSentence(text: string, sentence: string): string {
  if (text === "") return sentence;
  return JOINS.test(text.at(-1)!) ? text + sentence : `${text} ${sentence}`;
}

const SENTENCE_BREAK = new RegExp(`(?<=[${SENTENCE_ENDS.fullwidth}])|(?<=[${SENTENCE_ENDS.halfwidth}])\\s+`);

// 依句尾斷開段落，去掉前後空白與空句
export function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(SENTENCE_BREAK)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}
