import type { CapabilityManifest, JevChoiceAnswer } from "./types.js";

/**
 * Beam-search over per-step probability distributions to pick a coherent tool
 * sequence instead of independent per-step argmax. Repeating a tool costs
 * `lambda` nats per prior occurrence, so degenerate sequences (same tool 5x)
 * lose to plausible progressions while legitimate repeats (2x) can still win.
 */
export function beamSelectSequence(
  stepAnswers: JevChoiceAnswer[],
  candidateIds: string[],
  lambda: number,
  beamWidth = 64,
): string[] {
  interface Beam { seq: string[]; score: number; }
  let beams: Beam[] = [{ seq: [], score: 0 }];
  for (const answer of stepAnswers) {
    const expanded: Beam[] = [];
    for (const beam of beams) {
      for (const id of candidateIds) {
        const probability = answer.probabilities[id] ?? 0;
        const repeats = beam.seq.filter((tool) => tool === id).length;
        expanded.push({
          seq: [...beam.seq, id],
          score: beam.score + Math.log(Math.max(probability, 1e-9)) - lambda * repeats,
        });
      }
    }
    expanded.sort((a, b) => b.score - a.score);
    beams = expanded.slice(0, beamWidth);
  }
  return beams[0]?.seq ?? stepAnswers.map((answer) => answer.choice);
}

const ORDER_MARKERS = /^(?:first|firstly|step\s+\d+|then|next|after\s+(?:that|this|wards?)|second(?:ly)?|third(?:ly)?|finally|lastly|eventually|首先|第一|第二|第三|然后|接下来|随后|接着|最后|最终)[,:：、\s]/i;

/**
 * Rule-based instruction decomposition: splits a multi-step request into
 * ordered sub-goals using bullet/numbered lines or discourse markers
 * (First/Then/Finally/首先/然后/最后...). Returns the whole request as a
 * single sub-goal when no structure is found.
 */
export function ruleDecompose(request: string): string[] {
  const lines = request.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bulleted = lines.filter((line) => /^(?:[-*•]|\d+[.)、])\s+\S/.test(line));
  let goals: string[];
  if (bulleted.length >= 2 && bulleted.length >= lines.length / 2) {
    goals = bulleted.map((line) => line.replace(/^(?:[-*•]|\d+[.)、])\s+/, "").trim());
  } else {
    const sentences = request
      .replace(/\r?\n/g, " ")
      .split(/(?<=[.。!?？;；])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    goals = [];
    let current = "";
    for (const sentence of sentences) {
      if (ORDER_MARKERS.test(sentence) && current) {
        goals.push(current.trim());
        current = sentence.replace(ORDER_MARKERS, "");
      } else {
        current = current ? `${current} ${sentence}` : sentence.replace(ORDER_MARKERS, "");
      }
    }
    if (current.trim()) goals.push(current.trim());
  }
  goals = goals.filter((goal) => goal.length > 0);
  return goals.length >= 2 ? goals : [request];
}

const TARGET_PATTERNS = [
  /`([^`]+)`/g,
  /[\w./-]+\.(?:pdf|xlsx|xls|docx|doc|pptx|ppt|csv|tsv|tex|bib|md|txt|json|jsonl|html?|xml|ya?ml|png|jpe?g|zip|tar|gz)\b/gi,
  /https?:\/\/[^\s)>\]"']+/g,
  /\b\d{3,}\b/g,
];

/** Extract concrete targets (file names, URLs, identifiers) mentioned in the request. */
export function extractTargets(request: string, max = 20): string[] {
  const found = new Set<string>();
  for (const pattern of TARGET_PATTERNS) {
    for (const match of request.matchAll(pattern)) {
      const value = (match[1] ?? match[0]).trim().replace(/[.,;:]+$/, "");
      if (value && value.length <= 120) found.add(value);
      if (found.size >= max) return [...found];
    }
  }
  return [...found];
}

/** Group key used by hierarchical routing: manifest metadata group/server, else the capability type. */
export function groupOf(candidate: CapabilityManifest, groupBy: "server" | "type" = "server"): string {
  if (groupBy === "type") return candidate.type;
  const metadata = candidate.metadata ?? {};
  return String(metadata.group ?? metadata.server ?? candidate.type);
}

/** One-line criteria text for a candidate group in the coarse stage of hierarchical routing. */
export function describeGroup(group: string, members: CapabilityManifest[]): string {
  const names = members.map((member) => member.name).join(", ");
  const truncated = names.length > 400 ? `${names.slice(0, 400)}…` : names;
  return `${group} (${members.length} capabilities): ${truncated}`;
}
