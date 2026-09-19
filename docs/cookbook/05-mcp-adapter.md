# 05 · MCP adapter

**Goal**: expose JevRouter as a single MCP tool (`jev_route`) for MCP-native agents, without executing the selected capability implicitly.

## What you get

A stdio MCP server exposing exactly one tool:

- **`jev_route`** — input: the current `request` plus a `candidates` array (`type: "model" | "subagent" | "mcp_tool" | "skill" | "cli" | "dsh"`); output: `selected`, confidence, probabilities, and policy status. Nothing is executed.

## Register in your host

Codex (`~/.codex/config.toml` or project MCP config):

```toml
[mcp_servers.jevrouter]
command = "npx"
args = ["-y", "github:BillionsBobby/JevRouter", "serve-mcp"]
env_vars = ["OPENROUTER_API_KEY"]
```

Claude Code (`.mcp.json`):

```json
{
  "mcpServers": {
    "jevrouter": {
      "command": "npx",
      "args": ["-y", "github:BillionsBobby/JevRouter", "serve-mcp"],
      "env": { "OPENROUTER_API_KEY": "your-key" }
    }
  }
}
```

`agent setup --with-mcp` writes these for you ([recipe 03](03-use-with-codex.md)).

## Smoke-test the server by hand

```bash
(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | OPENROUTER_API_KEY="your-key" npx --yes github:BillionsBobby/JevRouter serve-mcp --provider openrouter)
```

Expected: an `initialize` result naming `serverInfo.name: "jevrouter"`, then a `tools/list` result with one tool, `jev_route`.

## When to use which interface

- The agent already loads tools through MCP → this adapter.
- One-off or scripted decisions → CLI `route`/`plan` ([recipe 01](01-route-your-first-request.md)).
- Tight loops and custom policies → SDK `route()`/`plan()`.
