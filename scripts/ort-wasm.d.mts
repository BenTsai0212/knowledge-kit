import type { Plugin } from "vite";

export const ORT_WASM_DIR: string;
export const ORT_WASM_FILES: string[];
export const MAX_STATIC_FILE_BYTES: number;
export const SEMANTIC_PROVIDERS: string[];
export function usesSemanticProvider(clientDir: string): boolean;
export function copyOrtWasm(outDir: string, sourceDir?: string): void;
export function ortWasmPlugin(clientDir: string, sourceDir?: string): Plugin;
