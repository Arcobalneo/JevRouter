#!/usr/bin/env node
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.id === 2) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "search", description: "Search records", inputSchema: { type: "object" } }] } })}\n`);
    }
  }
});
