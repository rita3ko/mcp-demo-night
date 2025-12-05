# MCP Night Demo: MCP vs Codemode

A side-by-side comparison of two AI agent approaches for interacting with APIs, built on Cloudflare Workers.

**Live Demo:** [https://fluma-demo.rita.workers.dev](https://fluma-demo.rita.workers.dev)

## Overview

This demo compares two different paradigms for AI agents:

### MCP Agent (Traditional)
The AI model calls MCP tools directly. Each tool invocation is a separate function call that the model decides to make.

```
User: "Create an event for tomorrow"
    ↓
AI Model → calls create_event tool → gets result → responds to user
```

### Codemode Agent (Code-First)
The AI model generates JavaScript code that calls a typed API. The code is executed in a sandboxed environment.

```
User: "Create an event for tomorrow"
    ↓
AI Model → generates JS code → code executes in sandbox → responds to user
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     demo-agent                               │
│  ┌─────────────────┐         ┌─────────────────┐           │
│  │   MCP Agent     │         │  Codemode Agent │           │
│  │                 │         │                 │           │
│  │ Calls MCP tools │         │ Generates code  │           │
│  │ directly        │         │ executed in     │           │
│  │                 │         │ dynamic workers │           │
│  └────────┬────────┘         └────────┬────────┘           │
│           │                           │                     │
│           └───────────┬───────────────┘                     │
│                       │                                     │
│                       ▼                                     │
│            ┌─────────────────┐                              │
│            │  Fluma MCP      │                              │
│            │  (Shared DO)    │                              │
│            │                 │                              │
│            │  SQLite DB for  │                              │
│            │  events, RSVPs  │                              │
│            └─────────────────┘                              │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
mcp-night-demo/
├── fluma/              # MCP server for event management
│   └── src/
│       ├── index.ts    # MCP tools and server setup
│       └── db/         # SQLite schema
│
├── demo-agent/         # Comparison UI and agents
│   ├── src/
│   │   ├── mcp-agent.ts      # Traditional MCP approach
│   │   ├── codemode-agent.ts # Code generation approach
│   │   └── tools.ts          # MCP tool definitions
│   └── public/
│       └── index.html        # Side-by-side UI
│
└── README.md
```

## Quick Start

### Prerequisites
- Node.js 18+
- Cloudflare account
- Wrangler CLI (`npm install -g wrangler`)

### Local Development

1. **Clone and install:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/mcp-night-demo.git
   cd mcp-night-demo
   
   # Install dependencies for both projects
   cd fluma && npm install && cd ..
   cd demo-agent && npm install && cd ..
   ```

2. **Set up environment variables:**
   ```bash
   # In demo-agent/.dev.vars
   CF_ACCOUNT_ID=your_account_id
   CF_GATEWAY_ID=your_gateway_id
   CF_AIG_TOKEN=your_ai_gateway_token
   FLUMA_MCP_URL=http://localhost:8788/sse
   ```

3. **Start the servers:**
   ```bash
   # Terminal 1 - Fluma MCP server
   cd fluma && npm run dev
   
   # Terminal 2 - Demo agent
   cd demo-agent && npm run dev
   ```

4. **Open the demo:**
   Visit [http://localhost:8787](http://localhost:8787)

### Deployment

```bash
# Deploy Fluma
cd fluma && npm run deploy

# Set secrets for demo-agent
cd demo-agent
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_GATEWAY_ID
wrangler secret put CF_AIG_TOKEN

# Deploy demo-agent
npm run deploy
```

## Tech Stack

- **Runtime:** Cloudflare Workers + Durable Objects
- **AI:** Claude via Cloudflare AI Gateway (AI SDK v5)
- **MCP:** Model Context Protocol with HTTP Streamable transport
- **Code Execution:** Cloudflare Dynamic Worker Loaders
- **Database:** SQLite (via Durable Objects)
- **Framework:** [agents](https://www.npmjs.com/package/agents) for chat infrastructure

## How It Works

### MCP Agent
1. Receives user message
2. Claude decides which MCP tool to call
3. Tool executes against Fluma API
4. Claude summarizes the result

### Codemode Agent
1. Receives user message
2. Claude generates TypeScript/JavaScript code
3. Code is executed in a sandboxed dynamic worker
4. The worker calls Fluma's MCP API
5. Claude summarizes the execution result

Both agents share the same Fluma backend, so events created by one are visible to the other.

## License

MIT
