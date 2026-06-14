import { fileURLToPath } from "node:url";
import path from "node:path";

export const PIPELINE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.join(PIPELINE_DIR, "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const PIPELINE_DATA = path.join(DATA_DIR, "pipeline");
export const PUBLIC_DATA = path.join(ROOT_DIR, "public", "data");

export function dataPath(...segments: string[]): string {
  return path.join(DATA_DIR, ...segments);
}

export function pipelinePath(...segments: string[]): string {
  return path.join(PIPELINE_DATA, ...segments);
}

export function publicDataPath(...segments: string[]): string {
  return path.join(PUBLIC_DATA, ...segments);
}
