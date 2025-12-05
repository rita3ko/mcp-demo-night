# Demo Agent

Side-by-side comparison UI for MCP vs Codemode AI agent approaches.

## Overview

This Cloudflare Worker hosts two AI chat agents that both interact with the Fluma event management API, but using different paradigms:

- **MCP Agent:** Calls MCP tools directly via the AI SDK
- **Codemode Agent:** Generates and executes JavaScript code in sandboxed workers

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Demo Agent Worker                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    Hono App                           │   │
│  │  /agents/mcp-chat-agent/*     → MCPChatAgent DO      │   │
│  │  /agents/codemode-chat-agent/* → CodemodeChatAgent DO│   │
│  │  /api/usage/*                 → Usage tracking       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─────────────────┐         ┌─────────────────┐           │
│  │  MCPChatAgent   │         │CodemodeChatAgent│           │
│  │  (Durable Obj)  │         │  (Durable Obj)  │           │
│  │                 │         │                 │           │
│  │ - Chat history  │         │ - Chat history  │           │
│  │ - MCP session   │         │ - Code gen      │           │
│  │ - Token usage   │         │ - Dynamic exec  │           │
│  └────────┬────────┘         └────────┬────────┘           │
│           │                           │                     │
│           └───────────┬───────────────┘                     │
│                       │                                     │
│                       ▼                                     │
│              Fluma MCP Server                               │
└─────────────────────────────────────────────────────────────┘
```

## Key Files

| File | Description |
|------|-------------|
| `src/index.ts` | Hono app with routing and API endpoints |
| `src/mcp-agent.ts` | Traditional MCP tool-calling agent |
| `src/codemode-agent.ts` | Code generation + execution agent |
| `src/tools.ts` | MCP tool definitions for AI SDK |
| `src/model.ts` | AI Gateway model configuration |
| `public/index.html` | Split-screen comparison UI |

## MCP Agent

The MCP agent uses the standard AI SDK tool-calling pattern:

```typescript
const tools = createFlumaTools(mcpUrl, sessionId);

const result = streamText({
  model,
  system: systemPrompt,
  messages: this.messages,
  tools,
  stopWhen: stepCountIs(5),
});
```

Tools are defined with Zod schemas and execute HTTP requests to the Fluma MCP server.

## Codemode Agent

The Codemode agent generates executable JavaScript:

1. **Type Generation:** Converts MCP tool schemas to TypeScript interfaces
2. **Code Generation:** Uses GPT-4 to generate async functions
3. **Sandboxed Execution:** Runs code in dynamic worker isolates
4. **Result Handling:** Parses output and returns to the model

```typescript
// Generated code example
async function() {
  const events = await codemode.list_events({ filter: 'upcoming' });
  const event = await codemode.create_event({
    title: "Team Meeting",
    location: "Conference Room A",
    date: "2024-12-20T14:00:00Z"
  });
  return { events, newEvent: event };
}
```

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `CF_ACCOUNT_ID` | Cloudflare account ID |
| `CF_GATEWAY_ID` | AI Gateway ID |
| `CF_AIG_TOKEN` | AI Gateway authentication token |
| `FLUMA_MCP_URL` | URL to Fluma MCP server |

### Local Development

```bash
# Create .dev.vars file
cat > .dev.vars << EOF
CF_ACCOUNT_ID=your_account_id
CF_GATEWAY_ID=your_gateway_id
CF_AIG_TOKEN=your_token
FLUMA_MCP_URL=http://localhost:8788/sse
EOF

# Start development server
npm run dev
```

### Deployment

```bash
# Set production secrets
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_GATEWAY_ID
wrangler secret put CF_AIG_TOKEN

# Deploy
npm run deploy
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agents/mcp-chat-agent/:id` | WebSocket | MCP agent chat |
| `/agents/codemode-chat-agent/:id` | WebSocket | Codemode agent chat |
| `/api/usage/mcp` | GET | Get MCP agent token usage |
| `/api/usage/codemode` | GET | Get Codemode agent token usage |
| `/api/usage/reset` | POST | Reset usage counters |
| `/api/clear` | POST | Clear all agent state |

## UI Features

- **Split-screen view:** See both agents respond simultaneously
- **Markdown rendering:** Proper formatting for AI responses
- **Code display:** Shows generated code (Codemode) and tool calls (MCP)
- **Token tracking:** Compare token usage between approaches
- **Session summary:** End session to see efficiency comparison
