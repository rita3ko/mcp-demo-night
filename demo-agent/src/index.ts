import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { routeAgentRequest } from 'agents';
import { MCPChatAgent } from './mcp-agent';
import { CodemodeChatAgent } from './codemode-agent';

type Env = {
  CF_ACCOUNT_ID: string;
  CF_GATEWAY_ID: string;
  CF_AIG_TOKEN: string;
  FLUMA_MCP_URL: string;
  MCP_CHAT_AGENT: DurableObjectNamespace;
  CODEMODE_CHAT_AGENT: DurableObjectNamespace;
  CODE_EXECUTOR: any; // WorkerLoader binding for dynamic code execution
};

const app = new Hono<{ Bindings: Env }>();

// Enable CORS
app.use('*', cors());

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Session ID for DO instances - must match the frontend
const SESSION_ID = 'session-v5';

// Get usage for both agents (combined)
app.get('/api/usage', async (c) => {
  const mcpId = c.env.MCP_CHAT_AGENT.idFromName(SESSION_ID);
  const mcpStub = c.env.MCP_CHAT_AGENT.get(mcpId) as any;
  const mcpUsage = await mcpStub.getUsage();
  
  const codemodeId = c.env.CODEMODE_CHAT_AGENT.idFromName(SESSION_ID);
  const codemodeStub = c.env.CODEMODE_CHAT_AGENT.get(codemodeId) as any;
  const codemodeUsage = await codemodeStub.getUsage();
  
  return c.json({
    mcp: mcpUsage,
    codemode: codemodeUsage
  });
});

// Get usage for MCP agent
app.get('/api/usage/mcp', async (c) => {
  const id = c.env.MCP_CHAT_AGENT.idFromName(SESSION_ID);
  const stub = c.env.MCP_CHAT_AGENT.get(id) as any;
  const usage = await stub.getUsage();
  return c.json(usage);
});

// Get usage for Codemode agent
app.get('/api/usage/codemode', async (c) => {
  const id = c.env.CODEMODE_CHAT_AGENT.idFromName(SESSION_ID);
  const stub = c.env.CODEMODE_CHAT_AGENT.get(id) as any;
  const usage = await stub.getUsage();
  return c.json(usage);
});

// Reset usage for both agents
app.post('/api/usage/reset', async (c) => {
  const mcpId = c.env.MCP_CHAT_AGENT.idFromName(SESSION_ID);
  const mcpStub = c.env.MCP_CHAT_AGENT.get(mcpId) as any;
  await mcpStub.resetUsage();
  
  const codemodeId = c.env.CODEMODE_CHAT_AGENT.idFromName(SESSION_ID);
  const codemodeStub = c.env.CODEMODE_CHAT_AGENT.get(codemodeId) as any;
  await codemodeStub.resetUsage();
  
  return c.json({ success: true });
});

// Clear all state for both agents (conversation history, MCP session, usage)
app.post('/api/clear', async (c) => {
  const mcpId = c.env.MCP_CHAT_AGENT.idFromName(SESSION_ID);
  const mcpStub = c.env.MCP_CHAT_AGENT.get(mcpId) as any;
  await mcpStub.clearState();
  
  const codemodeId = c.env.CODEMODE_CHAT_AGENT.idFromName(SESSION_ID);
  const codemodeStub = c.env.CODEMODE_CHAT_AGENT.get(codemodeId) as any;
  await codemodeStub.clearState();
  
  return c.json({ success: true, message: 'Cleared all state for both agents' });
});

// Agent WebSocket routes
app.all('/agents/*', async (c) => {
  const response = await routeAgentRequest(c.req.raw, c.env);
  if (response) {
    return response;
  }
  return c.notFound();
});

// Serve static files (handled by wrangler assets)
// The public/index.html will be served at /

export default app;

// Export the Durable Object classes
export { MCPChatAgent } from './mcp-agent';
export { CodemodeChatAgent } from './codemode-agent';

// Export the ToolExecutor entrypoint for dynamic code execution
export { ToolExecutor } from './tool-executor';
