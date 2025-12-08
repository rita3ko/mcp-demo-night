import { AIChatAgent } from 'agents/ai-chat-agent';
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from 'ai';
import { createGatewayModel } from './model';
import { createFlumaTools } from './tools';

type Env = {
  CF_ACCOUNT_ID: string;
  CF_GATEWAY_ID: string;
  CF_AIG_TOKEN: string;
  FLUMA_MCP_URL: string;
  MCP_CHAT_AGENT: DurableObjectNamespace;
  CODEMODE_CHAT_AGENT: DurableObjectNamespace;
};

export class MCPChatAgent extends AIChatAgent<Env> {
  private mcpSessionId: string | null = null;

  /**
   * Get or create a persistent MCP session ID.
   */
  private async getMcpSessionId(): Promise<string> {
    if (this.mcpSessionId) {
      return this.mcpSessionId;
    }

    // Check storage
    const stored = await this.ctx.storage.get<string>('mcp-session-id');
    if (stored) {
      this.mcpSessionId = stored;
      return stored;
    }

    // Initialize new session
    const mcpHttpUrl = this.env.FLUMA_MCP_URL.replace('/sse', '/mcp');
    const response = await fetch(mcpHttpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'mcp-agent', version: '1.0' },
        },
      }),
    });

    const sessionId = response.headers.get('mcp-session-id');
    if (!sessionId) {
      throw new Error('Failed to get MCP session ID');
    }

    this.mcpSessionId = sessionId;
    await this.ctx.storage.put('mcp-session-id', sessionId);
    return sessionId;
  }

  async onChatMessage(onFinish: StreamTextOnFinishCallback<ToolSet>) {
    const model = createGatewayModel({
      CF_ACCOUNT_ID: this.env.CF_ACCOUNT_ID,
      CF_GATEWAY_ID: this.env.CF_GATEWAY_ID,
      CF_AIG_TOKEN: this.env.CF_AIG_TOKEN,
    });

    // Get session and create tools
    const sessionId = await this.getMcpSessionId();
    const tools = createFlumaTools(this.env.FLUMA_MCP_URL, sessionId);

    const systemPrompt = `You are a helpful assistant for Fluma, an event management application.

You have access to tools for managing events, RSVPs, and user profiles. Use the appropriate tools when users ask about events, RSVPs, or their profile.

Be concise and helpful in your responses.`;

    const result = streamText({
      model,
      system: systemPrompt,
      messages: convertToModelMessages(this.messages),
      tools,
      stopWhen: stepCountIs(5), // Allow multiple tool calls
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
  
  // Method to clear all state (conversation history, usage, session)
  async clearState(): Promise<void> {
    // Clear our custom state
    await this.ctx.storage.delete('total-usage');
    await this.ctx.storage.delete('mcp-session-id');
    this.mcpSessionId = null;
    
    // Clear messages from the AIChatAgent framework
    try {
      this.sql`DELETE FROM cf_ai_chat_agent_messages`;
      this.sql`DELETE FROM cf_ai_chat_stream_chunks`;
      this.sql`DELETE FROM cf_ai_chat_stream_metadata`;
    } catch (e) {
      // Tables might not exist yet (first run)
    }
  }
  
  // Get the MCP session ID (for sharing with codemode agent)
  async getSharedSessionId(): Promise<string> {
    return this.getMcpSessionId();
  }

  // List SQL tables for debugging
  async listTables(): Promise<string[]> {
    try {
      const result = this.sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type='table'`;
      return result.map(r => r.name);
    } catch (e) {
      return [];
    }
  }

  // Get debug info for diagnostics
  async getDebugInfo(): Promise<object> {
    const sessionId = await this.ctx.storage.get<string>('mcp-session-id');
    const usage = await this.getUsage();
    
    // Get message structure (role + content length for each)
    const messages = this.messages ?? [];
    const messageStructure = messages.map((msg: any) => ({
      role: msg?.role ?? 'unknown',
      contentLength: typeof msg?.content === 'string' 
        ? msg.content.length 
        : (msg?.content ? JSON.stringify(msg.content).length : 0),
    }));

    // System prompt length (matching the one in onChatMessage)
    const systemPromptLength = 892; // Approximate length of the system prompt
    
    const tables = await this.listTables();
    
    return {
      mcpSessionId: sessionId || null,
      messagesCount: messages.length,
      messageStructure,
      systemPromptLength,
      toolsCount: 15,
      usage,
      tables,
    };
  }
}
