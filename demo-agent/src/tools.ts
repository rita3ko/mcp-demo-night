import { tool } from 'ai';
import { z } from 'zod';

// Helper to parse SSE response and extract JSON-RPC result
function parseSSEResponse(text: string): any {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      return JSON.parse(line.slice(6));
    }
  }
  throw new Error('No data in SSE response');
}

// Helper to call Fluma MCP server using HTTP Streamable transport
async function callFlumaTool(
  toolName: string, 
  args: Record<string, unknown>,
  mcpUrl: string,
  sessionId: string
): Promise<string> {
  try {
    const httpUrl = mcpUrl.replace('/sse', '/mcp');
    
    const response = await fetch(httpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      }),
    });
    
    if (!response.ok) {
      return JSON.stringify({
        success: false,
        error: `HTTP error: ${response.status} ${response.statusText}`,
      });
    }
    
    const responseText = await response.text();
    const result = parseSSEResponse(responseText);
    
    if (result.error) {
      return JSON.stringify({
        success: false,
        error: result.error.message || 'Unknown MCP error',
      });
    }
    
    const content = result.result?.content?.[0]?.text || JSON.stringify(result.result);
    return JSON.stringify({
      success: true,
      data: content,
    });
  } catch (error: any) {
    return JSON.stringify({
      success: false,
      error: error.message || 'Network error occurred',
    });
  }
}

// Create all Fluma tools in AI SDK format
export function createFlumaTools(mcpUrl: string, sessionId: string = '') {
  return {
    // ==================== PROFILE TOOLS ====================
    get_profile: tool({
      description: 'Get your user profile',
      inputSchema: z.object({}),
      execute: async () => {
        return await callFlumaTool('get_profile', {}, mcpUrl, sessionId);
      },
    }),

    update_profile: tool({
      description: 'Update your user profile',
      inputSchema: z.object({
        first_name: z.string().optional().describe('Your first name'),
        last_name: z.string().optional().describe('Your last name'),
        email: z.string().email().optional().describe('Your email address'),
      }),
      execute: async (args) => {
        return await callFlumaTool('update_profile', args, mcpUrl, sessionId);
      },
    }),

    // ==================== EVENT LISTING TOOLS ====================
    list_events: tool({
      description: 'List all events with optional filtering',
      inputSchema: z.object({
        filter: z.enum(['upcoming', 'past', 'hosting', 'attending', 'all']).optional()
          .describe('Filter events: upcoming (default), past, hosting, attending, all'),
      }),
      execute: async (args) => {
        return await callFlumaTool('list_events', args, mcpUrl, sessionId);
      },
    }),

    get_event: tool({
      description: 'Get details of a specific event',
      inputSchema: z.object({
        event_id: z.string().describe('The event ID'),
      }),
      execute: async (args) => {
        return await callFlumaTool('get_event', args, mcpUrl, sessionId);
      },
    }),

    // ==================== EVENT HOST TOOLS ====================
    create_event: tool({
      description: 'Create a new event (you will be the host)',
      inputSchema: z.object({
        title: z.string().describe('Event title'),
        description: z.string().optional().describe('Event description'),
        location: z.string().describe('Event location'),
        date: z.string().describe('Event date and time (ISO 8601 format)'),
      }),
      execute: async (args) => {
        return await callFlumaTool('create_event', args, mcpUrl, sessionId);
      },
    }),

    update_event: tool({
      description: 'Update an event you host (will notify attendees)',
      inputSchema: z.object({
        event_id: z.string().describe('The event ID'),
        title: z.string().optional().describe('New event title'),
        description: z.string().optional().describe('New event description'),
        location: z.string().optional().describe('New event location'),
        date: z.string().optional().describe('New event date (ISO 8601 format)'),
      }),
      execute: async (args) => {
        return await callFlumaTool('update_event', args, mcpUrl, sessionId);
      },
    }),

    delete_event: tool({
      description: 'Delete an event you host (will notify attendees)',
      inputSchema: z.object({
        event_id: z.string().describe('The event ID'),
      }),
      execute: async (args) => {
        return await callFlumaTool('delete_event', args, mcpUrl, sessionId);
      },
    }),

    list_event_rsvps: tool({
      description: 'List all RSVPs for an event you host',
      inputSchema: z.object({
        event_id: z.string().describe('The event ID'),
        status: z.enum(['going', 'maybe', 'not_going', 'all']).optional()
          .describe('Filter by RSVP status (default: all)'),
      }),
      execute: async (args) => {
        return await callFlumaTool('list_event_rsvps', args, mcpUrl, sessionId);
      },
    }),

    add_cohost: tool({
      description: 'Add a co-host to your event',
      inputSchema: z.object({
        event_id: z.string().describe('The event ID'),
        user_email: z.string().email().describe('Email of the user to add as co-host'),
      }),
      execute: async (args) => {
        return await callFlumaTool('add_cohost', args, mcpUrl, sessionId);
      },
    }),

    remove_cohost: tool({
      description: 'Remove a co-host from your event',
      inputSchema: z.object({
        event_id: z.string().describe('The event ID'),
        user_email: z.string().email().describe('Email of the co-host to remove'),
      }),
      execute: async (args) => {
        return await callFlumaTool('remove_cohost', args, mcpUrl, sessionId);
      },
    }),

    // ==================== RSVP TOOLS ====================
    rsvp: tool({
      description: 'RSVP to an event',
      inputSchema: z.object({
        event_id: z.string().describe('The event ID'),
        status: z.enum(['going', 'maybe', 'not_going']).describe('Your RSVP status'),
      }),
      execute: async (args) => {
        return await callFlumaTool('rsvp', args, mcpUrl, sessionId);
      },
    }),

    update_rsvp: tool({
      description: 'Update your RSVP status for an event',
      inputSchema: z.object({
        event_id: z.string().describe('The event ID'),
        status: z.enum(['going', 'maybe', 'not_going']).describe('Your new RSVP status'),
      }),
      execute: async (args) => {
        return await callFlumaTool('update_rsvp', args, mcpUrl, sessionId);
      },
    }),

    cancel_rsvp: tool({
      description: 'Cancel your RSVP for an event',
      inputSchema: z.object({
        event_id: z.string().describe('The event ID'),
      }),
      execute: async (args) => {
        return await callFlumaTool('cancel_rsvp', args, mcpUrl, sessionId);
      },
    }),

    get_my_rsvps: tool({
      description: "Get all events you've RSVP'd to",
      inputSchema: z.object({}),
      execute: async () => {
        return await callFlumaTool('get_my_rsvps', {}, mcpUrl, sessionId);
      },
    }),

    get_my_events: tool({
      description: "Get all events you're hosting",
      inputSchema: z.object({}),
      execute: async () => {
        return await callFlumaTool('get_my_events', {}, mcpUrl, sessionId);
      },
    }),
  };
}


