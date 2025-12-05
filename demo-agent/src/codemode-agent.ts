import { AIChatAgent } from 'agents/ai-chat-agent';
import {
  convertToModelMessages,
  streamText,
  generateObject,
  tool,
  stepCountIs,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from 'ai';
import { z } from 'zod';
import { createGatewayModel, createCodeGenModel } from './model';
import { createFlumaTools, getToolDescriptions } from './tools';

type Env = {
  CF_ACCOUNT_ID: string;
  CF_GATEWAY_ID: string;
  CF_AIG_TOKEN: string;
  FLUMA_MCP_URL: string;
  MCP_CHAT_AGENT: DurableObjectNamespace;
  CODEMODE_CHAT_AGENT: DurableObjectNamespace;
  CODE_EXECUTOR: any; // WorkerLoader binding
};

/**
 * Convert a tool name to PascalCase for TypeScript interface naming
 */
function toCamelCase(str: string): string {
  return str
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

/**
 * Get the TypeScript type string for a Zod schema
 */
function getZodTypeString(schema: z.ZodTypeAny): string {
  if (schema instanceof z.ZodString) return 'string';
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodBoolean) return 'boolean';
  if (schema instanceof z.ZodEnum) {
    const opts = (schema as z.ZodEnum<any>).options;
    return opts.map((o: string) => `'${o}'`).join(' | ');
  }
  if (schema instanceof z.ZodOptional) return getZodTypeString(schema.unwrap());
  if (schema instanceof z.ZodArray) return `${getZodTypeString(schema.element)}[]`;
  if (schema instanceof z.ZodObject) return 'object';
  return 'any';
}

/**
 * Generate TypeScript type definitions from the tools.
 * This creates proper interface definitions with JSDoc comments.
 */
function generateTypes(tools: ReturnType<typeof createFlumaTools>): string {
  let availableTools = '';
  let availableTypes = '';

  for (const [toolName, t] of Object.entries(tools)) {
    const toolDef = t as any;
    const inputSchema = toolDef.inputSchema as z.ZodObject<any>;
    const description = toolDef.description || '';
    const shape = inputSchema.shape;

    // Generate input interface
    const inputTypeName = `${toCamelCase(toolName)}Input`;
    const inputFields = Object.entries(shape).map(([key, s]) => {
      const zodSchema = s as z.ZodTypeAny;
      const isOptional = zodSchema.isOptional?.() || zodSchema instanceof z.ZodOptional;
      const fieldType = getZodTypeString(zodSchema);
      const fieldDesc = zodSchema.description;
      let field = '';
      if (fieldDesc) {
        field += `  /** ${fieldDesc} */\n`;
      }
      field += `  ${key}${isOptional ? '?' : ''}: ${fieldType};`;
      return field;
    }).join('\n');

    availableTypes += `\ninterface ${inputTypeName} {\n${inputFields || '  [key: string]: unknown;'}\n}`;

    // Output type is generic since MCP returns dynamic data
    const outputTypeName = `${toCamelCase(toolName)}Output`;
    availableTypes += `\ninterface ${outputTypeName} { [key: string]: any; }`;

    // Add tool to the codemode interface with JSDoc
    availableTools += `\n  /**`;
    availableTools += `\n   * ${description}`;
    availableTools += `\n   */`;
    availableTools += `\n  ${toolName}: (input: ${inputTypeName}) => Promise<${outputTypeName}>;`;
    availableTools += '\n';
  }

  // Wrap tools in the codemode declaration
  availableTools = `\ndeclare const codemode: {${availableTools}};`;

  return `${availableTypes}\n${availableTools}`;
}

// Session ID for the MCP agent DO - must match frontend
const MCP_AGENT_SESSION = 'session-v5';

export class CodemodeChatAgent extends AIChatAgent<Env> {
  /**
   * Get the shared MCP session ID from the MCP agent.
   * This ensures both agents talk to the same Fluma DO.
   */
  private async getSharedSessionId(): Promise<string> {
    const mcpAgentId = this.env.MCP_CHAT_AGENT.idFromName(MCP_AGENT_SESSION);
    const mcpAgentStub = this.env.MCP_CHAT_AGENT.get(mcpAgentId) as any;
    return await mcpAgentStub.getSharedSessionId();
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

    const flumaTools = createFlumaTools(this.env.FLUMA_MCP_URL);
    const toolDescriptions = getToolDescriptions(flumaTools);

    // Generate TypeScript types for the tools
    const generatedTypes = await generateTypes(flumaTools);

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
After the code executes, explain what happened and share relevant results with the user.

IMPORTANT: Always use the codemode tool for any task involving events, RSVPs, or profiles.`;

    const result = streamText({
      model,
      system: systemPrompt,
      messages: convertToModelMessages(this.messages),
      tools: { codemode: codemodeTool },
      stopWhen: stepCountIs(3),
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
