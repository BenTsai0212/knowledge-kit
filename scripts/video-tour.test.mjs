import { describe, expect, it } from "vitest";
import { ffmpegArgs, keptSeconds, mergeCuts, selectFilter } from "./video-tour.mjs";

describe("mergeCuts", () => {
  it("合併重疊與相鄰的區間，去掉空的區間，依開始時間排序", () => {
    expect(
      mergeCuts([
        [10, 12],
        [1, 3],
        [2, 5],
        [5, 6],
        [8, 8],
      ]),
    ).toEqual([
      [1, 6],
      [10, 12],
    ]);
  });
});

describe("keptSeconds", () => {
  it("扣掉剪掉的秒數，超出影片長度的部分不算", () => {
    expect(
      keptSeconds(100, [
        [10, 20],
        [15, 30],
        [95, 120],
      ]),
    ).toBe(75);
    expect(keptSeconds(40, [])).toBe(40);
  });
});

describe("selectFilter", () => {
  it("沒有區間時只固定畫格率與重新計時", () => {
    expect(selectFilter([])).toBe("fps=25,setpts=N/25/TB");
  });

  it("留下區間以外的畫格，逗號跳脫", () => {
    expect(
      selectFilter([
        [1.23456, 2],
        [5, 7.5],
      ]),
    ).toBe("fps=25,select='not(between(t\\,1.235\\,2)+between(t\\,5\\,7.5))',setpts=N/25/TB");
  });
});

describe("ffmpegArgs", () => {
  it("桌機縮放到 1280×800、手機補邊，依序接起來輸出 H.264 的 mp4", () => {
    const args = ffmpegArgs(
      [
        { file: "desktop.webm", cuts: [[0, 2]], kind: "desktop" },
        { file: "mobile.webm", cuts: [], kind: "mobile" },
      ],
      "out.mp4",
      28,
    );
    expect(args.slice(0, 5)).toEqual(["-y", "-i", "desktop.webm", "-i", "mobile.webm"]);
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("[0:v]fps=25,select='not(between(t\\,0\\,2))',setpts=N/25/TB,scale=1280:800:flags=lanczos,setsar=1,format=yuv420p[v0]");
    expect(graph).toContain("[1:v]fps=25,setpts=N/25/TB,scale=-2:800:flags=lanczos,pad=1280:800:(ow-iw)/2:0:");
    expect(graph.endsWith("[v0][v1]concat=n=2:v=1:a=0[out]")).toBe(true);
    expect(args).toEqual(expect.arrayContaining(["libx264", "-crf", "28", "yuv420p", "+faststart"]));
    expect(args.at(-1)).toBe("out.mp4");
  });
});
