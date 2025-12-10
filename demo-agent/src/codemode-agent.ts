import { AIChatAgent } from 'agents/ai-chat-agent';
import {
  convertToModelMessages,
  streamText,
  tool,
  stepCountIs,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from 'ai';
import { z } from 'zod';
import { createGatewayModel } from './model';

type Env = {
  CF_ACCOUNT_ID: string;
  CF_GATEWAY_ID: string;
  CF_AIG_TOKEN: string;
  FLUMA_MCP_URL: string;
  MCP_CHAT_AGENT: DurableObjectNamespace;
  CODEMODE_CHAT_AGENT: DurableObjectNamespace;
  CODE_EXECUTOR: any; // WorkerLoader binding
};

// Session ID for the MCP agent DO - must match frontend
const MCP_AGENT_SESSION = 'session-v6';

// Type for usage tracking
type UsageData = { inputTokens: number; outputTokens: number };

export class CodemodeChatAgent extends AIChatAgent<Env> {
  // In-memory cache for types (per DO instance)
  private cachedTypes: string | null = null;

  /**
   * Get the shared MCP session ID from the MCP agent.
   * This ensures both agents talk to the same Fluma DO.
   */
  private async getSharedSessionId(): Promise<string> {
    const mcpAgentId = this.env.MCP_CHAT_AGENT.idFromName(MCP_AGENT_SESSION);
    const mcpAgentStub = this.env.MCP_CHAT_AGENT.get(mcpAgentId) as any;
    return await mcpAgentStub.getSharedSessionId();
  }

  /**
   * Fetch and cache TypeScript type definitions from Fluma.
   * Cached in memory for the lifetime of this DO instance.
   */
  private async getToolTypes(): Promise<string> {
    if (this.cachedTypes) {
      return this.cachedTypes;
    }

    const typesUrl = this.env.FLUMA_MCP_URL.replace('/sse', '/types');
    const response = await fetch(typesUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch types: ${response.status} ${response.statusText}`);
    }
    
    this.cachedTypes = await response.text();
    return this.cachedTypes;
  }



  async onChatMessage(onFinish: StreamTextOnFinishCallback<ToolSet>) {
    const model = createGatewayModel({
      CF_ACCOUNT_ID: this.env.CF_ACCOUNT_ID,
      CF_GATEWAY_ID: this.env.CF_GATEWAY_ID,
      CF_AIG_TOKEN: this.env.CF_AIG_TOKEN,
    });

    // Fetch types from Fluma (cached after first fetch)
    const generatedTypes = await this.getToolTypes();

    // Helper to summarize large results to reduce token usage
    const summarizeResult = (result: any): any => {
      // If it's an array with more than 5 items, summarize it
      if (Array.isArray(result)) {
        if (result.length === 0) {
          return { count: 0, items: [] };
        }
        
        if (result.length > 5) {
          return {
            count: result.length,
            sample: result[0],
            message: `${result.length} items returned (showing first as sample)`
          };
        }
        
        // Small arrays - return as-is
        return result;
      }
      
      // If it's an object, check for nested arrays that should be summarized
      if (result && typeof result === 'object') {
        const summarized: any = {};
        for (const [key, value] of Object.entries(result)) {
          if (Array.isArray(value) && value.length > 5) {
            // Summarize large nested arrays
            summarized[key] = {
              count: value.length,
              sample: value[0],
              message: `${value.length} items (showing first as sample)`
            };
          } else {
            summarized[key] = value;
          }
        }
        return summarized;
      }
      
      // Primitives - return as-is
      return result;
    };

    // Create the codemode meta-tool - Claude generates the code directly
    const codemodeTool = tool({
      description: 'Execute JavaScript code to accomplish a task using Fluma tools. Use this when you need to work with events, RSVPs, or user profiles.',
      inputSchema: z.object({
        code: z.string().describe('An async JavaScript function (as a string) that uses the codemode API to accomplish the task. Must be an async arrow function that returns a value.'),
      }),
      execute: async ({ code }) => {
        try {
          // Execute the generated code using Dynamic Worker Loader
          const result = await this.executeCode(code);

          // Return summarized result (code is omitted - Claude already has it)
          return JSON.stringify({
            success: true,
            result: summarizeResult(result),
          }, null, 2);
        } catch (error: any) {
          // Don't include code in error - Claude already has it
          return JSON.stringify({
            success: false,
            error: error.message,
          }, null, 2);
        }
      },
    });

    const systemPrompt = `You are a helpful assistant for Fluma, an event management app.

You have access to a "codemode" tool that executes JavaScript code to interact with the Fluma API.

## Available API (via the \`codemode\` object):
${generatedTypes}

## Code Generation Rules:
1. Write an async arrow function that returns a value: \`async () => { ... }\`
2. Use object arguments: \`codemode.create_event({ title: "...", ... })\`
3. Use ISO 8601 dates: \`"2024-12-25T18:00:00Z"\`
4. For multiple operations, use Promise.all() or sequential awaits
5. Always return the result(s)

## Examples:
- List events: \`async () => await codemode.list_events({})\`
- Create event: \`async () => await codemode.create_event({ title: "Party", location: "NYC", date: "2024-12-25T18:00:00Z" })\`
- Multiple ops: \`async () => { const events = await codemode.list_events({}); return events; }\`

IMPORTANT: Batch multiple operations into ONE codemode call when possible.
Be warm and concise in your responses.`;

    const result = streamText({
      model,
      system: systemPrompt,
      messages: convertToModelMessages(this.messages),
      tools: { codemode: codemodeTool },
      stopWhen: stepCountIs(3),
      onFinish: async (event) => {
        // Accumulate usage in DO storage (now just Claude, no separate codegen)
        const usage = event.usage;
        const currentUsage = await this.ctx.storage.get<UsageData>('total-usage') || { inputTokens: 0, outputTokens: 0 };
        const newUsage = {
          inputTokens: currentUsage.inputTokens + (usage?.inputTokens || 0),
          outputTokens: currentUsage.outputTokens + (usage?.outputTokens || 0),
        };
        await this.ctx.storage.put('total-usage', newUsage);
        
        onFinish(event as any);
      },
    });

    return result.toUIMessageStreamResponse();
  }
  
  // Method to get usage (can be called via RPC)
  // Returns same structure as before for API compatibility, but codegen is always 0
  async getUsage(): Promise<{
    claude: UsageData;
    codegen: UsageData;
    total: UsageData;
  }> {
    const total = await this.ctx.storage.get<UsageData>('total-usage') || { inputTokens: 0, outputTokens: 0 };
    return {
      claude: total,
      codegen: { inputTokens: 0, outputTokens: 0 }, // No longer using separate codegen model
      total,
    };
  }
  
  // Method to reset usage
  async resetUsage(): Promise<void> {
    await this.ctx.storage.put('total-usage', { inputTokens: 0, outputTokens: 0 });
  }
  
  // Method to clear all state (conversation history, usage, cache)
  async clearState(): Promise<void> {
    // Clear our custom state
    await this.ctx.storage.delete('total-usage');
    
    // Clear in-memory cache
    this.cachedTypes = null;
    
    // Clear messages from the AIChatAgent framework
    try {
      this.sql`DELETE FROM cf_ai_chat_agent_messages`;
      this.sql`DELETE FROM cf_ai_chat_stream_chunks`;
      this.sql`DELETE FROM cf_ai_chat_stream_metadata`;
    } catch (e) {
      // Tables might not exist yet (first run)
    }
  }

  // Get debug info for diagnostics
  async getDebugInfo(): Promise<object> {
    const usage = await this.getUsage();
    
    // Get message structure (role + content length for each)
    const messages = this.messages ?? [];
    const messageStructure = messages.map((msg: any) => ({
      role: msg?.role ?? 'unknown',
      contentLength: typeof msg?.content === 'string' 
        ? msg.content.length 
        : (msg?.content ? JSON.stringify(msg.content).length : 0),
    }));

    // Try to get shared session ID (may fail if MCP agent not initialized)
    let sharedSessionId = null;
    try {
      sharedSessionId = await this.getSharedSessionId();
    } catch (e) {
      // Ignore - MCP agent may not be initialized
    }

    return {
      sharedSessionId,
      messagesCount: messages.length,
      messageStructure,
      cachedTypesLength: this.cachedTypes?.length ?? null,
      toolsCount: 1,
      usage,
      architecture: 'single-model (Claude generates code directly)',
    };
  }

  /**
   * Execute generated code in a sandboxed dynamic worker isolate.
   * 
   * The code is wrapped in a worker module that:
   * 1. Uses a fixed session ID (Fluma routes all to same DO)
   * 2. Creates a `codemode` Proxy object that calls tools
   * 3. Executes the AI-generated async function
   * 4. Returns the result
   */
  private async executeCode(code: string): Promise<any> {
    // Derive the HTTP MCP URL from the SSE URL
    const mcpHttpUrl = this.env.FLUMA_MCP_URL.replace('/sse', '/mcp');
    
    // Get the shared session ID from MCP agent
    const sessionId = await this.getSharedSessionId();
    
    // Build the dynamic worker module
    const workerCode = `
export default {
  async fetch(req, env, ctx) {
    try {
      const MCP_URL = "${mcpHttpUrl}";
      const SESSION_ID = "${sessionId}";
      
      // Helper to parse SSE response and extract JSON-RPC result
      function parseSSEResponse(text) {
        const lines = text.split('\\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            return JSON.parse(line.slice(6));
          }
        }
        throw new Error('No data in SSE response');
      }
      
      // Helper to call MCP tools with the persistent session
      async function callTool(toolName, args) {
        const response = await fetch(MCP_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'mcp-session-id': SESSION_ID,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: {
              name: toolName,
              arguments: args || {},
            },
          }),
        });
        
        const responseText = await response.text();
        const result = parseSSEResponse(responseText);
        
        if (result.error) {
          throw new Error(result.error.message);
        }
        
        const textContent = result.result?.content?.[0]?.text;
        if (textContent) {
          try {
            return JSON.parse(textContent);
          } catch {
            return textContent;
          }
        }
        return result.result;
      }
      
      // Create the codemode proxy object
      const codemode = new Proxy(
        {},
        {
          get: (target, prop) => {
            return (args) => callTool(prop, args);
          }
        }
      );

      // Execute the AI-generated code
      const userCode = ${code};
      const result = await userCode();
      
      return new Response(JSON.stringify({ success: true, result }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: err.message,
        stack: err.stack
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}
`;

    // Generate a unique ID for this execution
    const executionId = `code-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Get the dynamic worker using Worker Loader
    const worker = this.env.CODE_EXECUTOR.get(executionId, async () => {
      return {
        compatibilityDate: '2025-06-01',
        compatibilityFlags: ['nodejs_compat'],
        mainModule: 'executor.js',
        modules: {
          'executor.js': workerCode,
        },
        // Allow fetch to MCP server (needed for tool calls)
        // In production, you'd want to restrict this more
        globalOutbound: undefined,
        env: {},
      };
    });

    // Call the dynamic worker
    const entrypoint = worker.getEntrypoint();
    const response = await entrypoint.fetch('http://localhost/execute');
    const result = await response.json() as { success: boolean; result?: any; error?: string; stack?: string };

    if (!result.success) {
      throw new Error(result.error || 'Code execution failed');
    }

    return result.result;
  }
}
