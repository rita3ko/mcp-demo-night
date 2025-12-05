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

You have access to tools for managing events, RSVPs, and user profiles.

Available tools:
- get_profile: Get the current user's profile
- update_profile: Update user profile (first_name, last_name, email)
- list_events: List events (filter by: upcoming, past, hosting, attending, all)
- get_event: Get details of a specific event
- create_event: Create a new event (title, description, location, date)
- update_event: Update an event you host
- delete_event: Delete an event you host
- list_event_rsvps: List RSVPs for an event you host
- add_cohost: Add a co-host to your event
- remove_cohost: Remove a co-host from your event
- rsvp: RSVP to an event (going, maybe, not_going)
- update_rsvp: Update your RSVP status
- cancel_rsvp: Cancel your RSVP
- get_my_rsvps: Get events you've RSVP'd to
- get_my_events: Get events you're hosting

When users ask about events, RSVPs, or their profile, use the appropriate tools.
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
    // Nuclear option - delete all DO storage
    await this.ctx.storage.deleteAll();
    this.mcpSessionId = null;
  }
  
  // Get the MCP session ID (for sharing with codemode agent)
  async getSharedSessionId(): Promise<string> {
    return this.getMcpSessionId();
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
    
    return {
      mcpSessionId: sessionId || null,
      messagesCount: messages.length,
      messageStructure,
      systemPromptLength,
      toolsCount: 15,
      usage,
    };
  }
}
