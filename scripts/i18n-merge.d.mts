import type { Plugin } from "vite";

export interface Reference {
  dir: string;
  languages: string[];
  defaultLanguage: string;
  i18n: Record<string, unknown>;
}
export function mergeStrings<T>(reference: T, override: unknown): { strings: T; fallback: string[] };
export function fallbackLanguage(language: string, referenceLanguages: string[], referenceDefault: string): string;
export function readReference(referenceDir?: string): Reference;
export function mergedStrings(clientDir: string, language: string, reference?: Reference): { strings: unknown; source: string; fallback: string[] };
export function i18nMergePlugin(clientDir: string, referenceDir?: string): Plugin;
