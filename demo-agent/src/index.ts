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
const SESSION_ID = 'session-v6';

// Debug endpoint - returns diagnostic info for both agents
app.get('/api/debug', async (c) => {
  const mcpId = c.env.MCP_CHAT_AGENT.idFromName(SESSION_ID);
  const mcpStub = c.env.MCP_CHAT_AGENT.get(mcpId) as any;
  const mcpDebug = await mcpStub.getDebugInfo();
  
  const codemodeId = c.env.CODEMODE_CHAT_AGENT.idFromName(SESSION_ID);
  const codemodeStub = c.env.CODEMODE_CHAT_AGENT.get(codemodeId) as any;
  const codemodeDebug = await codemodeStub.getDebugInfo();
  
  return c.json({
    timestamp: new Date().toISOString(),
    sessionId: SESSION_ID,
    flumaUrl: c.env.FLUMA_MCP_URL,
    mcp: mcpDebug,
    codemode: codemodeDebug,
  });
});

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

// Admin: Reset Fluma events (clear all events from the Fluma MCP server)
app.post('/api/admin/reset-fluma', async (c) => {
  try {
    const flumaUrl = c.env.FLUMA_MCP_URL.replace('/sse', '/admin/reset');
    const response = await fetch(flumaUrl, { method: 'POST' });
    const result = await response.json();
    return c.json(result);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Admin page
app.get('/admin', async (c) => {
  const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin - MCP vs Codemode</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
          colors: {
            border: '#27272a',
            background: '#09090b',
            foreground: '#fafafa',
            muted: '#18181b',
            'muted-foreground': '#a1a1aa',
          }
        }
      }
    }
  </script>
  <style>
    body { font-family: 'Inter', system-ui, sans-serif; background: #09090b; color: #fafafa; }
  </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">
  <div class="w-full max-w-md space-y-6">
    <div class="text-center">
      <h1 class="text-2xl font-semibold">Admin Panel</h1>
      <p class="text-sm text-muted-foreground mt-1">Manage demo state</p>
    </div>
    
    <div class="space-y-4">
      <!-- Reset Events -->
      <div class="p-4 rounded-lg border border-border bg-zinc-900">
        <h2 class="text-sm font-medium mb-2">Reset Events</h2>
        <p class="text-xs text-muted-foreground mb-3">Clear all events from the Fluma database. Users will be kept.</p>
        <button onclick="resetFluma()" id="reset-fluma-btn" class="w-full px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-colors">
          Clear All Events
        </button>
      </div>
      
      <!-- Reset Session -->
      <div class="p-4 rounded-lg border border-border bg-zinc-900">
        <h2 class="text-sm font-medium mb-2">Reset Session</h2>
        <p class="text-xs text-muted-foreground mb-3">Clear conversation history and token counts for both agents.</p>
        <button onclick="clearSession()" id="clear-session-btn" class="w-full px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded-lg text-sm font-medium transition-colors">
          Clear Session State
        </button>
      </div>
      
      <!-- Reset Everything -->
      <div class="p-4 rounded-lg border border-border bg-zinc-900">
        <h2 class="text-sm font-medium mb-2">Full Reset</h2>
        <p class="text-xs text-muted-foreground mb-3">Clear everything: events, conversation history, and token counts.</p>
        <button onclick="fullReset()" id="full-reset-btn" class="w-full px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm font-medium transition-colors">
          Reset Everything
        </button>
      </div>
      
      <!-- Token Usage -->
      <div class="p-4 rounded-lg border border-border bg-zinc-900">
        <h2 class="text-sm font-medium mb-2">Current Token Usage</h2>
        <div id="usage-display" class="text-xs text-muted-foreground">Loading...</div>
        <button onclick="refreshUsage()" class="mt-3 w-full px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors">
          Refresh
        </button>
      </div>
    </div>
    
    <!-- Status Message -->
    <div id="status" class="hidden p-3 rounded-lg text-sm text-center"></div>
    
    <!-- Back Link -->
    <div class="text-center">
      <a href="/" class="text-sm text-muted-foreground hover:text-white transition-colors">&larr; Back to Demo</a>
    </div>
  </div>

  <script>
    function showStatus(message, isError = false) {
      const status = document.getElementById('status');
      status.textContent = message;
      status.className = 'p-3 rounded-lg text-sm text-center ' + (isError ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400');
      status.classList.remove('hidden');
      setTimeout(() => status.classList.add('hidden'), 3000);
    }
    
    async function resetFluma() {
      const btn = document.getElementById('reset-fluma-btn');
      btn.disabled = true;
      btn.textContent = 'Clearing...';
      try {
        const res = await fetch('/api/admin/reset-fluma', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showStatus('All events cleared successfully');
        } else {
          showStatus(data.error || 'Failed to clear events', true);
        }
      } catch (e) {
        showStatus('Error: ' + e.message, true);
      }
      btn.disabled = false;
      btn.textContent = 'Clear All Events';
    }
    
    async function clearSession() {
      const btn = document.getElementById('clear-session-btn');
      btn.disabled = true;
      btn.textContent = 'Clearing...';
      try {
        const res = await fetch('/api/clear', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showStatus('Session state cleared successfully');
          refreshUsage();
        } else {
          showStatus('Failed to clear session', true);
        }
      } catch (e) {
        showStatus('Error: ' + e.message, true);
      }
      btn.disabled = false;
      btn.textContent = 'Clear Session State';
    }
    
    async function fullReset() {
      const btn = document.getElementById('full-reset-btn');
      btn.disabled = true;
      btn.textContent = 'Resetting...';
      try {
        await fetch('/api/admin/reset-fluma', { method: 'POST' });
        await fetch('/api/clear', { method: 'POST' });
        showStatus('Full reset completed successfully');
        refreshUsage();
      } catch (e) {
        showStatus('Error: ' + e.message, true);
      }
      btn.disabled = false;
      btn.textContent = 'Reset Everything';
    }
    
    async function refreshUsage() {
      try {
        const res = await fetch('/api/usage');
        const usage = await res.json();
        const mcpTotal = (usage.mcp?.inputTokens || 0) + (usage.mcp?.outputTokens || 0);
        const codemodeTotal = (usage.codemode?.inputTokens || 0) + (usage.codemode?.outputTokens || 0);
        document.getElementById('usage-display').innerHTML = 
          '<div class="space-y-1">' +
          '<div class="flex justify-between"><span>MCP Agent:</span><span class="text-green-400">' + mcpTotal.toLocaleString() + ' tokens</span></div>' +
          '<div class="flex justify-between"><span>Codemode Agent:</span><span class="text-orange-400">' + codemodeTotal.toLocaleString() + ' tokens</span></div>' +
          '</div>';
      } catch (e) {
        document.getElementById('usage-display').textContent = 'Failed to load usage';
      }
    }
    
    // Load usage on page load
    refreshUsage();
  </script>
</body>
</html>`;
  
  return c.html(html);
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
