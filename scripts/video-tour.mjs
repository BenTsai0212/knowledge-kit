// 功能介紹影片（#370，docs/testing.md「功能介紹影片」）的轉檔：把 e2e/video-tour.spec.ts 錄下的 webm（桌機一段、手機一段）
// 剪掉等待的時間（資料庫載入、萃取、評測的執行），接成一支 1280×800 的 mp4（H.264）。轉檔用 ffmpeg，不是 npm 的相依套件。
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

export const WIDTH = 1280;
export const HEIGHT = 800;
export const FPS = 25;
// 每支的上限（位元組）與長度（秒）
export const MAX_BYTES = 10 * 1024 * 1024;
export const MIN_SECONDS = 120;
export const MAX_SECONDS = 180;
// 手機畫面左右的底色（與 Light 模式的頁面底色相近）
const PAD_COLOR = "0xf4f5f7";

/** 合併重疊或相鄰的區間，去掉長度不大於 0 的區間，依開始時間排序。區間的單位是秒。 */
export function mergeCuts(cuts) {
  const sorted = cuts.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** 剪掉 cuts 的區間後留下的秒數。 */
export function keptSeconds(duration, cuts) {
  const removed = mergeCuts(cuts).reduce((sum, [start, end]) => sum + Math.max(0, Math.min(end, duration) - Math.max(start, 0)), 0);
  return duration - removed;
}

const round = (n) => Number(n.toFixed(3));

/** ffmpeg 的 select 濾鏡：留下不在任何區間內的畫格，再重新計時。沒有區間時只重新計時。 */
export function selectFilter(cuts) {
  const merged = mergeCuts(cuts);
  const retime = `setpts=N/${FPS}/TB`;
  if (merged.length === 0) return `fps=${FPS},${retime}`;
  const inside = merged.map(([start, end]) => `between(t\\,${round(start)}\\,${round(end)})`).join("+");
  return `fps=${FPS},select='not(${inside})',${retime}`;
}

/**
 * 轉檔的 ffmpeg 參數。clips：依序接起來的片段，每段是 { file, cuts, kind }；kind 是 "desktop"（縮放到 1280×800）
 * 或 "mobile"（等比縮放到 800 高，左右補底色）。crf 越大檔案越小。
 */
export function ffmpegArgs(clips, output, crf = 30) {
  const inputs = clips.flatMap((c) => ["-i", c.file]);
  const scale = (kind) =>
    kind === "mobile"
      ? `scale=-2:${HEIGHT}:flags=lanczos,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:0:color=${PAD_COLOR}`
      : `scale=${WIDTH}:${HEIGHT}:flags=lanczos`;
  const parts = clips.map((c, i) => `[${i}:v]${selectFilter(c.cuts)},${scale(c.kind)},setsar=1,format=yuv420p[v${i}]`);
  const joined = clips.map((_, i) => `[v${i}]`).join("");
  const graph = [...parts, `${joined}concat=n=${clips.length}:v=1:a=0[out]`].join(";");
  return [
    "-y",
    ...inputs,
    "-filter_complex",
    graph,
    "-map",
    "[out]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    String(crf),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    output,
  ];
}

/** 影片的秒數（ffprobe）。 */
export function probeSeconds(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], { encoding: "utf8" });
  return Number(out.trim());
}

/** 轉檔；超過 MAX_BYTES 時提高 crf 重轉（最多到 40）。回傳 mp4 的秒數與位元組數。 */
export function encode(clips, output) {
  let crf = 30;
  for (;;) {
    execFileSync("ffmpeg", ffmpegArgs(clips, output, crf), { stdio: ["ignore", "ignore", "inherit"] });
    const bytes = statSync(output).size;
    if (bytes <= MAX_BYTES || crf >= 40) return { seconds: probeSeconds(output), bytes, crf };
    crf += 3;
  }
}
