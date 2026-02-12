---
name: adding-mcps
description: How to configure MCP (Model Context Protocol) servers for the Fern agent. Reference when adding external tool servers like web fetching, documentation lookup, or browser automation.
---

# Adding MCP Servers

MCPs (Model Context Protocol servers) are external processes or remote services that provide additional tools to the agent. They are configured in `opencode.jsonc` and auto-discovered at startup.

## Configuration file

MCP servers are defined in `src/.opencode/opencode.jsonc` under the `mcp` key:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "server-name": {
      // server config here
    }
  }
}
```

## Local MCP servers

Local MCPs run as child processes on the same machine. Communication happens over stdio.

```jsonc
{
  "mcp": {
    "fetch": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-fetch"]
    }
  }
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | `"local"` |
| `command` | Yes | Array of strings — the command and its arguments |
| `environment` | No | Key-value env vars passed to the process |
| `enabled` | No | `true` (default) or `false` to disable without removing |
| `timeout` | No | Connection timeout in milliseconds |

### Examples

**Filesystem access:**
```jsonc
{
  "mcp": {
    "filesystem": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
    }
  }
}
```

**With environment variables:**
```jsonc
{
  "mcp": {
    "my-service": {
      "type": "local",
      "command": ["npx", "-y", "my-mcp-package"],
      "environment": {
        "API_KEY": "your-key-here"
      }
    }
  }
}
```

## Remote MCP servers

Remote MCPs connect to HTTP endpoints. Supports OAuth for authenticated services.

```jsonc
{
  "mcp": {
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | `"remote"` |
| `url` | Yes | The MCP server endpoint URL |
| `enabled` | No | `true` (default) or `false` to disable |
| `headers` | No | Custom HTTP headers (e.g., auth tokens) |
| `oauth` | No | OAuth config object, or `false` to disable OAuth auto-detection |
| `timeout` | No | Connection timeout in milliseconds |

### OAuth config (for authenticated remote MCPs)

```jsonc
{
  "mcp": {
    "authenticated-service": {
      "type": "remote",
      "url": "https://api.example.com/mcp",
      "oauth": {
        "clientId": "{env:MY_CLIENT_ID}",
        "clientSecret": "{env:MY_CLIENT_SECRET}",
        "scope": "tools:read"
      }
    }
  }
}
```

## How MCPs work at runtime

1. OpenCode reads `opencode.jsonc` at startup
2. For each enabled MCP, it creates a client connection (stdio for local, HTTP for remote)
3. Client calls `listTools()` to discover available tools
4. MCP tools are converted to AI SDK tools and prefixed with the server name: `{serverName}_{toolName}`
5. Tools appear alongside native OpenCode tools and Fern's custom tools
6. When the agent calls an MCP tool, OpenCode routes the call to the MCP server

## Tool naming

MCP tools are auto-prefixed with the server name:

- Server `"web"` with tool `fetch` → agent sees `web_fetch`
- Server `"context7"` with tool `resolve` → agent sees `context7_resolve`

Choose short, clear server names since they become part of the tool name.

## Disabling an MCP

Set `enabled: false` to temporarily disable without removing config:

```jsonc
{
  "mcp": {
    "fetch": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-fetch"],
      "enabled": false
    }
  }
}
```

## Disabling specific MCP tools

If an MCP provides tools you don't want, disable them in the `tools` config:

```jsonc
{
  "tools": {
    "fetch_unwanted_tool": false
  }
}
```

## Current MCPs

| Server | Type | Package/URL | Tools provided |
|--------|------|-------------|---------------|
| `fetch` | Local | `@modelcontextprotocol/server-fetch` | `fetch` — fetch any URL and convert to Markdown |

## Finding MCP servers

- Official Anthropic MCPs: `@modelcontextprotocol/server-*` packages on npm
- Community MCPs: Search npm for `mcp-server-*` or check github.com/modelcontextprotocol/servers
- Remote MCPs: Many services now offer hosted MCP endpoints (e.g., Context7, Exa)

## Useful MCPs to consider

| MCP | What it does | Config |
|-----|-------------|--------|
| `@modelcontextprotocol/server-fetch` | Fetch web content as Markdown | Local, no API key |
| Context7 | Library documentation lookup | Remote, free tier (1k req/mo) |
| Playwright | Browser automation | Local, no API key |
| Brave Search | Web search | Local, needs API key |
| Exa | AI-powered web search | Local, needs API key |
