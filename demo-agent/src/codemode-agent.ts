import { AIChatAgent } from 'agents/ai-chat-agent';
import {
  convertToModelMessages,
  streamText,
  generateObject,
  tool,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from 'ai';
import { z } from 'zod';
import { createGatewayModel, createCodeGenModel } from './model';

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
const MCP_AGENT_SESSION = 'session-v5';

export class CodemodeChatAgent extends AIChatAgent<Env> {
  // In-memory cache for types and descriptions (per DO instance)
  private cachedTypes: string | null = null;
  private cachedDescriptions: string | null = null;

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

  /**
   * Fetch and cache tool descriptions from Fluma.
   * Cached in memory for the lifetime of this DO instance.
   */
  private async getToolDescriptions(): Promise<string> {
    if (this.cachedDescriptions) {
      return this.cachedDescriptions;
    }

    const descriptionsUrl = this.env.FLUMA_MCP_URL.replace('/sse', '/descriptions');
    const response = await fetch(descriptionsUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch descriptions: ${response.status} ${response.statusText}`);
    }
    
    this.cachedDescriptions = await response.text();
    return this.cachedDescriptions;
  }

  async onChatMessage(onFinish: StreamTextOnFinishCallback<ToolSet>) {
    const model = createGatewayModel({
      CF_ACCOUNT_ID: this.env.CF_ACCOUNT_ID,
      CF_GATEWAY_ID: this.env.CF_GATEWAY_ID,
      CF_AIG_TOKEN: this.env.CF_AIG_TOKEN,
    });

    const codeGenModel = createCodeGenModel({
      CF_ACCOUNT_ID: this.env.CF_ACCOUNT_ID,
      CF_GATEWAY_ID: this.env.CF_GATEWAY_ID,
      CF_AIG_TOKEN: this.env.CF_AIG_TOKEN,
    });

    // Fetch types and descriptions from Fluma (cached after first fetch)
    const [generatedTypes, toolDescriptions] = await Promise.all([
      this.getToolTypes(),
      this.getToolDescriptions(),
    ]);

    // Create the codemode meta-tool
    const codemodeTool = tool({
      description: 'Generate and execute JavaScript code to accomplish a task using Fluma tools. Use this when you need to work with events, RSVPs, or user profiles.',
      inputSchema: z.object({
        functionDescription: z.string().describe('Description of what the code should accomplish'),
      }),
      execute: async ({ functionDescription }) => {
        try {
          // Generate code using OpenAI gpt-4.1 via AI Gateway (better structured output)
          // Note: The prompt must contain the word "JSON" for OpenAI's response_format requirement
          const codeGenResult = await generateObject({
            model: codeGenModel,
            schema: z.object({ code: z.string() }),
            prompt: `You are a code generating machine. Return your response as JSON with a "code" field.

In addition to regular javascript, you can also use the following functions:

${generatedTypes}      

Generate an async function that achieves the goal. This async function doesn't accept any arguments.
Return ONLY the JavaScript code in the "code" field of your JSON response.

Important notes:
- Always pass arguments as an object: codemode.get_profile({}) not codemode.get_profile()
- For dates, use ISO 8601 format: "2025-01-04T18:00:00Z"
- The function should return the final result

Example code:
async function() {
  const result = await codemode.create_event({
    title: "My Event",
    location: "San Francisco",
    date: "2024-12-20T18:00:00Z"
  });
  return result;
}

User request: ${functionDescription}`,
          });

          const generatedCode = codeGenResult.object.code;

          // Execute the generated code using Dynamic Worker Loader
          const result = await this.executeCode(generatedCode);

          return JSON.stringify({
            success: true,
            code: generatedCode,
            result,
          }, null, 2);
        } catch (error: any) {
          return JSON.stringify({
            success: false,
            error: error.message,
          }, null, 2);
        }
      },
    });

    const systemPrompt = `You are a helpful assistant for Fluma, an event management application.

You have access to a special "codemode" tool that generates and executes JavaScript code to accomplish tasks.
The codemode tool can work with:

${toolDescriptions}

When users ask about events, RSVPs, or their profile, use the codemode tool with a clear function description.

IMPORTANT: After executing code, always provide a detailed, human-friendly summary of the results. For events, include:
- Event title
- Location  
- Date and time (formatted nicely)
- Host information
- RSVP status if applicable

Never just say "Found X events" - always list the actual event details.`;

    const result = streamText({
      model,
      system: systemPrompt,
      messages: convertToModelMessages(this.messages),
      tools: { codemode: codemodeTool },
      maxSteps: 2,
      onFinish: async (event) => {
        // Accumulate usage in DO storage
        const usage = event.usage;
        const currentUsage = await this.ctx.storage.get<{inputTokens: number, outputTokens: number}>('total-usage') || { inputTokens: 0, outputTokens: 0 };
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
  
  // Method to get total usage (can be called via RPC)
  async getUsage(): Promise<{inputTokens: number, outputTokens: number}> {
    return await this.ctx.storage.get<{inputTokens: number, outputTokens: number}>('total-usage') || { inputTokens: 0, outputTokens: 0 };
  }
  
  // Method to reset usage
  async resetUsage(): Promise<void> {
    await this.ctx.storage.put('total-usage', { inputTokens: 0, outputTokens: 0 });
  }
  
  // Method to clear conversation history (but not framework tables)
  async clearState(): Promise<void> {
    await this.ctx.storage.delete('total-usage');
    
    // Clear conversation history via the framework's SQL
    try {
      this.sql.exec('DELETE FROM cf_agents_state WHERE key LIKE "messages%"');
    } catch (e) {
      // Table might not exist
    }
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
