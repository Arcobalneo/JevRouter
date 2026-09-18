import { createHash, randomUUID } from "node:crypto";
import type { JsonSchema } from "./types.js";

export function requestId(prefix = "req"): string {
  return `${prefix}_${randomUUID()}`;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function riskRank(level: string): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[level] ?? 3;
}

export function compactError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function validateJsonInput(value: unknown, schema: JsonSchema | undefined, path = "$"): string[] {
  if (!schema) return [];
  const errors: string[] = [];
  const type = schema.type;
  if (type && !matchesType(value, type)) errors.push(`${path} must be ${type}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => stableJson(candidate) === stableJson(value))) {
    errors.push(`${path} must match one of enum values`);
  }
  if (type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const objectValue = value as Record<string, unknown>;
    for (const required of schema.required ?? []) {
      if (!(required in objectValue)) errors.push(`${path}.${required} is required`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in objectValue) errors.push(...validateJsonInput(objectValue[key], childSchema, `${path}.${key}`));
    }
  }
  if (type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => errors.push(...validateJsonInput(item, schema.items, `${path}[${index}]`)));
  }
  return errors;
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "object") return Boolean(value && typeof value === "object" && !Array.isArray(value));
  if (type === "array") return Array.isArray(value);
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "null") return value === null;
  return true;
}
