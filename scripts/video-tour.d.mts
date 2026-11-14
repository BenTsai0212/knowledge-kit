export type Cut = [number, number];
export interface Clip {
  file: string;
  cuts: Cut[];
  kind: "desktop" | "mobile";
}
export const WIDTH: number;
export const HEIGHT: number;
export const FPS: number;
export const MAX_BYTES: number;
export const MIN_SECONDS: number;
export const MAX_SECONDS: number;
export function mergeCuts(cuts: Cut[]): Cut[];
export function keptSeconds(duration: number, cuts: Cut[]): number;
export function selectFilter(cuts: Cut[]): string;
export function ffmpegArgs(clips: Clip[], output: string, crf?: number): string[];
export function probeSeconds(file: string): number;
export function encode(clips: Clip[], output: string): { seconds: number; bytes: number; crf: number };
