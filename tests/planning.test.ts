import { test } from "node:test";
import assert from "node:assert/strict";
import { beamSelectSequence, describeGroup, extractTargets, groupOf, ruleDecompose } from "../src/planning.js";
import type { CapabilityManifest, JevChoiceAnswer } from "../src/types.js";

function answer(probabilities: Record<string, number>): JevChoiceAnswer {
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return { type: "choice", choice, probabilities, confidence: 1 };
}

test("beamSelectSequence avoids degenerate repetition while keeping legitimate repeats", () => {
  // Jev loves "write" at every step, but "read" is a close second at steps 1-2.
  const steps = [
    answer({ write: 0.6, read: 0.4 }),
    answer({ write: 0.55, read: 0.45 }),
    answer({ write: 0.9, read: 0.1 }),
  ];
  assert.deepEqual(beamSelectSequence(steps, ["write", "read"], 0), ["write", "write", "write"]);
  const diversified = beamSelectSequence(steps, ["write", "read"], 1.0);
  assert.deepEqual(diversified, ["write", "read", "write"]);
});

test("beamSelectSequence keeps the argmax sequence when probabilities are decisive", () => {
  const steps = [answer({ a: 0.99, b: 0.01 }), answer({ a: 0.99, b: 0.01 })];
  assert.deepEqual(beamSelectSequence(steps, ["a", "b"], 2.0), ["a", "a"]);
});

test("ruleDecompose splits on discourse markers and bullets", () => {
  const withMarkers = ruleDecompose("First, read the PDF. Then compare the clauses. Finally, write the CSV file.");
  assert.equal(withMarkers.length, 3);
  assert.match(withMarkers[0], /read the PDF/);
  assert.match(withMarkers[2], /write the CSV/);
  const bullets = ruleDecompose("Do the chores:\n- fetch the repo info\n- save to github_info.json\n- commit the file");
  assert.equal(bullets.length, 3);
  assert.match(bullets[0], /fetch the repo info/);
  const plain = ruleDecompose("Just one long unstructured request without markers.");
  assert.deepEqual(plain, ["Just one long unstructured request without markers."]);
});

test("extractTargets finds files, URLs, backticked names and identifiers", () => {
  const targets = extractTargets("Read `new_law.pdf` and Household_Appliances.xlsx, call https://api.github.com/repositories/1000000, then check repo 1000.");
  assert.ok(targets.includes("new_law.pdf"));
  assert.ok(targets.includes("Household_Appliances.xlsx"));
  assert.ok(targets.some((t) => t.startsWith("https://api.github.com")));
  assert.ok(targets.includes("1000"));
});

test("groupOf and describeGroup use metadata group/server with type fallback", () => {
  const manifest: CapabilityManifest = { id: "read", name: "read", type: "mcp_tool", description: "read", metadata: { server: "filesystem" } };
  assert.equal(groupOf(manifest, "server"), "filesystem");
  assert.equal(groupOf({ id: "x", name: "x", type: "cli", description: "x" }, "server"), "cli");
  const text = describeGroup("filesystem", [manifest]);
  assert.match(text, /filesystem \(1 capabilities\): read/);
});
