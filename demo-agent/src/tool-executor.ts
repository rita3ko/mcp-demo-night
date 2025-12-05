import { WorkerEntrypoint } from 'cloudflare:workers';

/**
 * ToolExecutor is a WorkerEntrypoint that the dynamic code executor
 * can call via RPC to execute Fluma MCP tools.
 * 
 * The dynamic worker uses a Proxy to call:
 *   await codemode.create_event({ title: 'Party', ... })
 * 
 * Which translates to:
 *   await env.CodeModeProxy.callFunction({ functionName: 'create_event', args: {...} })
 * 
 * This entrypoint forwards the call to the Fluma MCP server.
 */
export class ToolExecutor extends WorkerEntrypoint<Record<string, unknown>> {
  /**
   * Call a Fluma MCP tool by name with the given arguments.
   * This signature matches the SDK's CodeModeProxy pattern.
   * 
   * @param options - Object containing functionName and args
   * @returns The tool's response (parsed if JSON, otherwise string)
   */
  async callFunction(options: { functionName: string; args: unknown }): Promise<unknown> {
    const { functionName, args } = options;
    const mcpUrl = (this.ctx.props as { mcpUrl: string }).mcpUrl;
    
    console.log(`[ToolExecutor] Calling ${functionName} with args:`, args);
    
    // Make the MCP JSON-RPC call to Fluma
    const response = await fetch(mcpUrl.replace('/sse', '/mcp'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: functionName,
          arguments: args || {},
        },
      }),
    });
    
    const result = await response.json() as {
      error?: { message: string };
      result?: { content?: Array<{ text?: string }> };
    };
    
    if (result.error) {
      throw new Error(result.error.message);
    }
    
    // Extract the text content from the MCP response
    const textContent = result.result?.content?.[0]?.text;
    
    if (textContent) {
      // Try to parse as JSON, otherwise return as string
      try {
        return JSON.parse(textContent);
      } catch {
        return textContent;
      }
    }
    
    return result.result;
  }
}
