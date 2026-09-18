import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RouteResult } from "./types.js";

export async function saveDecision(result: RouteResult, directory = ".jevrouter/decisions"): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${result.decision_id}.json`);
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  return path;
}
