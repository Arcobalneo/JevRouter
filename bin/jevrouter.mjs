#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const compiled = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const source = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const result = spawnSync(
  process.execPath,
  existsSync(compiled) ? [compiled, ...process.argv.slice(2)] : ["--import", "tsx", source, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
