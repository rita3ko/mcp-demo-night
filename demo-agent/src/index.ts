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
        
        // Codemode now has breakdown: claude, codegen, total
        const codemode = usage.codemode || {};
        const claudeTotal = (codemode.claude?.inputTokens || 0) + (codemode.claude?.outputTokens || 0);
        const codegenTotal = (codemode.codegen?.inputTokens || 0) + (codemode.codegen?.outputTokens || 0);
        const codemodeTotal = (codemode.total?.inputTokens || 0) + (codemode.total?.outputTokens || 0);
        
        document.getElementById('usage-display').innerHTML = 
          '<div class="space-y-2">' +
          '<div class="flex justify-between"><span>MCP Agent:</span><span class="text-green-400">' + mcpTotal.toLocaleString() + ' tokens</span></div>' +
          '<div class="border-t border-zinc-700 pt-2 mt-2">' +
          '<div class="flex justify-between"><span>Codemode Total:</span><span class="text-orange-400">' + codemodeTotal.toLocaleString() + ' tokens</span></div>' +
          '<div class="flex justify-between text-xs text-muted-foreground ml-2"><span>└ Claude:</span><span>' + claudeTotal.toLocaleString() + '</span></div>' +
          '<div class="flex justify-between text-xs text-muted-foreground ml-2"><span>└ Codegen (GPT-4.1):</span><span>' + codegenTotal.toLocaleString() + '</span></div>' +
          '</div>' +
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

// MCP-only UI
app.get('/just-mcp', async (c) => {
  const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MCP Agent</title>
  
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'system-ui', 'sans-serif'],
            mono: ['JetBrains Mono', 'monospace'],
          },
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
    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: #09090b;
      color: #fafafa;
    }
    
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
    
    .markdown-content { line-height: 1.6; }
    .markdown-content p { margin-bottom: 0.75rem; }
    .markdown-content p:last-child { margin-bottom: 0; }
    .markdown-content strong { font-weight: 600; color: #fafafa; }
    .markdown-content em { font-style: italic; }
    .markdown-content ul, .markdown-content ol { margin: 0.5rem 0; padding-left: 1.25rem; }
    .markdown-content ul { list-style-type: disc; }
    .markdown-content ol { list-style-type: decimal; }
    .markdown-content li { margin: 0.25rem 0; }
    .markdown-content code {
      background: rgba(0, 0, 0, 0.3);
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85em;
    }
    .markdown-content pre {
      background: rgba(0, 0, 0, 0.3);
      padding: 0.75rem;
      border-radius: 0.375rem;
      overflow-x: auto;
      margin: 0.5rem 0;
    }
    .markdown-content pre code { background: none; padding: 0; }
    .markdown-content h1, .markdown-content h2, .markdown-content h3 {
      font-weight: 600;
      margin-top: 1rem;
      margin-bottom: 0.5rem;
    }
    .markdown-content h1 { font-size: 1.25rem; }
    .markdown-content h2 { font-size: 1.125rem; }
    .markdown-content h3 { font-size: 1rem; }
    .markdown-content a { color: #60a5fa; text-decoration: underline; }
    .markdown-content blockquote {
      border-left: 2px solid #3f3f46;
      padding-left: 0.75rem;
      margin: 0.5rem 0;
      color: #a1a1aa;
    }
  </style>
</head>
<body class="h-screen flex flex-col overflow-hidden">
  
  <!-- Header -->
  <header class="flex-shrink-0 border-b border-border px-6 py-4">
    <div class="max-w-4xl mx-auto flex items-center justify-between">
      <div>
        <h1 class="text-lg font-semibold">MCP Agent</h1>
        <p class="text-sm text-muted-foreground">Traditional tool-calling approach</p>
      </div>
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2 mr-4">
          <span id="status-dot" class="h-2 w-2 rounded-full bg-zinc-500"></span>
          <span id="status-text" class="text-xs text-muted-foreground">Connecting...</span>
        </div>
        <button onclick="resetAll()" class="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 rounded-md transition-colors">
          Reset
        </button>
        <button onclick="endSession()" class="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors">
          End Session
        </button>
      </div>
    </div>
  </header>
  
  <!-- Main Content -->
  <div class="flex-1 overflow-y-auto min-h-0">
    <div id="messages" class="max-w-4xl mx-auto p-4 space-y-3"></div>
  </div>
  
  <!-- Input Area -->
  <div class="flex-shrink-0 border-t border-border p-4">
    <div class="flex gap-3 max-w-4xl mx-auto">
      <input 
        type="text" 
        id="user-input" 
        placeholder="Ask the MCP agent something..." 
        class="flex-1 px-4 py-2 bg-zinc-900 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-zinc-600"
        onkeypress="if(event.key === 'Enter') sendMessage()"
      >
      <button onclick="sendMessage()" class="px-4 py-2 bg-white text-black font-medium rounded-lg text-sm hover:bg-zinc-200 transition-colors">
        Send
      </button>
    </div>
  </div>
  
  <!-- Session Summary Modal -->
  <div id="session-summary" class="hidden fixed inset-0 bg-black/80 items-center justify-center z-50">
    <div class="bg-zinc-900 border border-border rounded-xl p-6 max-w-md w-full mx-4">
      <h3 class="text-lg font-semibold mb-4">Session Summary</h3>
      <div class="space-y-4 mb-6">
        <div class="p-3 bg-zinc-800 rounded-lg">
          <div class="flex justify-between items-center">
            <span class="text-sm text-green-400">MCP Agent</span>
            <span id="total-tokens" class="text-sm font-mono">0 tokens</span>
          </div>
          <div class="flex justify-between text-xs text-muted-foreground mt-1">
            <span>Input: <span id="input-tokens">0</span></span>
            <span>Output: <span id="output-tokens">0</span></span>
          </div>
        </div>
      </div>
      <div class="flex gap-3">
        <button onclick="closeSummary()" class="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors">
          Close
        </button>
        <button onclick="resetAll()" class="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm transition-colors">
          Reset
        </button>
      </div>
    </div>
  </div>

  <script>
    const SESSION_ID = 'session-v6';
    let ws = null;
    const messagesContainer = document.getElementById('messages');
    
    // Streaming state
    let streamingElement = null;
    let streamingContent = '';
    
    // Tool input streaming state
    let toolStreamingElement = null;
    let toolStreamingInput = '';
    let toolStreamingName = '';
    
    function updateStatus(connected) {
      const dot = document.getElementById('status-dot');
      const text = document.getElementById('status-text');
      if (connected) {
        dot.className = 'h-2 w-2 rounded-full bg-green-500';
        text.textContent = 'Connected';
      } else {
        dot.className = 'h-2 w-2 rounded-full bg-zinc-500';
        text.textContent = 'Disconnected';
      }
    }
    
    function connectAgent() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(\`\${protocol}//\${window.location.host}/agents/mcp-chat-agent/\${SESSION_ID}\`);
      ws.onopen = () => updateStatus(true);
      ws.onclose = () => updateStatus(false);
      ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
    }
    
    function handleMessage(data) {
      if (data.type === 'cf_agent_use_chat_response' && data.body) {
        try {
          const event = JSON.parse(data.body);
          
          switch (event.type) {
            case 'text-start':
              streamingElement = createAssistantMessage();
              streamingContent = '';
              messagesContainer.appendChild(streamingElement);
              break;
              
            case 'text-delta':
              if (!streamingElement) {
                streamingElement = createAssistantMessage();
                streamingContent = '';
                messagesContainer.appendChild(streamingElement);
              }
              streamingContent += event.delta || '';
              const contentEl = streamingElement.querySelector('.message-content');
              if (contentEl) {
                contentEl.innerHTML = renderMarkdown(streamingContent);
              }
              messagesContainer.scrollTop = messagesContainer.scrollHeight;
              break;
              
            case 'text-end':
              if (streamingElement && streamingContent) {
                const finalContentEl = streamingElement.querySelector('.message-content');
                if (finalContentEl) {
                  finalContentEl.innerHTML = renderMarkdown(streamingContent);
                }
              }
              streamingElement = null;
              streamingContent = '';
              break;
              
            case 'tool-input-start':
              toolStreamingName = event.toolName || 'unknown';
              toolStreamingInput = '';
              toolStreamingElement = createToolCallElement(toolStreamingName);
              messagesContainer.appendChild(toolStreamingElement);
              break;
            
            case 'tool-input-delta':
              if (toolStreamingElement && event.delta) {
                toolStreamingInput += event.delta;
                updateToolCallContent(toolStreamingElement, toolStreamingInput);
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
              }
              break;
              
            case 'tool-input-available':
              if (toolStreamingElement) {
                const finalInput = typeof event.input === 'string' ? event.input : JSON.stringify(event.input, null, 2);
                updateToolCallContent(toolStreamingElement, finalInput);
                toolStreamingElement = null;
                toolStreamingInput = '';
              } else {
                addToolCall(event.toolName, event.input);
              }
              break;
              
            case 'tool-output-available':
              addToolResult(event.output);
              break;
          }
        } catch (e) {}
      }
    }
    
    function createAssistantMessage() {
      const div = document.createElement('div');
      div.className = 'p-3 rounded-lg bg-zinc-900 border-l-2 border-green-500/30';
      div.innerHTML = '<div class="message-content text-sm markdown-content"></div>';
      return div;
    }
    
    function renderMarkdown(text) {
      if (typeof marked !== 'undefined') {
        marked.setOptions({ breaks: true, gfm: true });
        return marked.parse(text);
      }
      return escapeHtml(text);
    }
    
    function addUserMessage(text) {
      const div = document.createElement('div');
      div.className = 'p-3 rounded-lg bg-zinc-800 ml-8';
      div.innerHTML = \`<div class="text-sm">\${escapeHtml(text)}</div>\`;
      messagesContainer.appendChild(div);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    function createToolCallElement(toolName) {
      const div = document.createElement('div');
      div.className = 'p-3 rounded-lg bg-zinc-900/50 border border-border';
      div.innerHTML = \`
        <div class="text-xs text-green-400 font-medium mb-2">Tool: \${escapeHtml(toolName)}</div>
        <pre class="tool-input-content text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap"><span class="animate-pulse">generating...</span></pre>
      \`;
      return div;
    }
    
    function updateToolCallContent(element, content) {
      const pre = element.querySelector('.tool-input-content');
      if (pre) {
        let displayContent = content;
        try {
          const parsed = JSON.parse(content);
          displayContent = JSON.stringify(parsed, null, 2);
        } catch (e) {}
        pre.textContent = displayContent;
      }
    }
    
    function addToolCall(toolName, input) {
      if (!input) return;
      const div = document.createElement('div');
      div.className = 'p-3 rounded-lg bg-zinc-900/50 border border-border';
      div.innerHTML = \`
        <div class="text-xs text-green-400 font-medium mb-2">Tool: \${escapeHtml(toolName || 'unknown')}</div>
        <pre class="text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">\${escapeHtml(JSON.stringify(input, null, 2))}</pre>
      \`;
      messagesContainer.appendChild(div);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    function addToolResult(output) {
      const div = document.createElement('div');
      const displayText = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
      div.className = 'p-3 rounded-lg bg-zinc-900/50 border border-border';
      div.innerHTML = \`
        <div class="text-xs text-green-400 font-medium mb-2">Result</div>
        <pre class="text-xs font-mono text-muted-foreground overflow-x-auto">\${escapeHtml(displayText)}</pre>
      \`;
      messagesContainer.appendChild(div);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    let chatMessages = [];
    
    function sendMessage() {
      const input = document.getElementById('user-input');
      const message = input.value.trim();
      if (!message) return;
      
      streamingElement = null;
      streamingContent = '';
      toolStreamingElement = null;
      toolStreamingInput = '';
      toolStreamingName = '';
      
      addUserMessage(message);
      
      chatMessages.push({ id: crypto.randomUUID(), role: 'user', content: message });
      
      const payload = JSON.stringify({
        type: 'cf_agent_use_chat_request',
        id: crypto.randomUUID(),
        init: {
          method: 'POST',
          body: JSON.stringify({ messages: chatMessages })
        }
      });
      
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
      
      input.value = '';
    }
    
    async function endSession() {
      try {
        const res = await fetch('/api/usage/mcp');
        const usage = await res.json();
        
        const inputTokens = usage.inputTokens || 0;
        const outputTokens = usage.outputTokens || 0;
        const totalTokens = inputTokens + outputTokens;
        
        document.getElementById('total-tokens').textContent = \`\${totalTokens.toLocaleString()} tokens\`;
        document.getElementById('input-tokens').textContent = inputTokens.toLocaleString();
        document.getElementById('output-tokens').textContent = outputTokens.toLocaleString();
      } catch (e) {
        console.error('Failed to fetch usage:', e);
      }
      
      document.getElementById('session-summary').classList.remove('hidden');
      document.getElementById('session-summary').classList.add('flex');
    }
    
    function closeSummary() {
      document.getElementById('session-summary').classList.add('hidden');
      document.getElementById('session-summary').classList.remove('flex');
    }
    
    async function resetAll() {
      try {
        await fetch('/api/clear', { method: 'POST' });
        await fetch('/api/admin/reset-fluma', { method: 'POST' });
        window.location.reload();
      } catch (e) {
        console.error('Failed to reset:', e);
        window.location.reload();
      }
    }
    
    connectAgent();
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
