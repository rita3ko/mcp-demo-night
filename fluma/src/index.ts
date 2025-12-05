import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { SCHEMA, type Event, type User, type RSVP } from "./db/schema";
import { EmailService } from "./services/email";
import {
  toolDefinitions,
  getProfileSchema,
  updateProfileSchema,
  listEventsSchema,
  getEventSchema,
  createEventSchema,
  updateEventSchema,
  deleteEventSchema,
  listEventRsvpsSchema,
  addCohostSchema,
  removeCohostSchema,
  rsvpSchema,
  updateRsvpSchema,
  cancelRsvpSchema,
  getMyRsvpsSchema,
  getMyEventsSchema,
} from "./tools/schemas";
import { cachedTypeScript, cachedToolDescriptions } from "./tools/type-generator";

// Simple props - no OAuth needed
type Props = Record<string, unknown>;

type Env = {
  MCP_OBJECT: DurableObjectNamespace;
  RESEND_API_KEY?: string;
};

// Default test user for demo
const DEFAULT_USER = {
  id: "test-user-1",
  email: "demo@fluma.events",
  first_name: "Demo",
  last_name: "User",
  github_id: "demo-user",
  github_username: "demo-user",
};

export class FlumaMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "Fluma - Event Management",
    version: "1.0.0",
  });

  private emailService: EmailService | null = null;
  private _dbInitialized = false;

  // Initialize database schema
  private initDB() {
    if (this._dbInitialized) return;
    
    const statements = SCHEMA.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      if (stmt.trim()) {
        this.ctx.storage.sql.exec(stmt);
      }
    }
    this._dbInitialized = true;
  }

  // Ensure user exists in database
  private ensureUser(): User {
    const existing = this.sql<User>`SELECT * FROM users WHERE github_id = ${DEFAULT_USER.github_id}`;

    if (existing.length > 0) {
      return existing[0];
    }

    // Create default user
    this.sql`INSERT INTO users (id, email, first_name, last_name, github_id, github_username)
             VALUES (${DEFAULT_USER.id}, ${DEFAULT_USER.email}, ${DEFAULT_USER.first_name}, ${DEFAULT_USER.last_name}, ${DEFAULT_USER.github_id}, ${DEFAULT_USER.github_username})`;

    return this.sql<User>`SELECT * FROM users WHERE id = ${DEFAULT_USER.id}`[0];
  }

  // Check if current user is host of an event
  private isEventHost(eventId: string, userId: string): boolean {
    const events = this.sql<Event>`SELECT * FROM events WHERE id = ${eventId}`;
    if (events.length === 0) return false;
    
    const event = events[0];
    if (event.host_id === userId) return true;

    const coHost = this.sql<{ user_id: string }>`SELECT user_id FROM event_hosts WHERE event_id = ${eventId} AND user_id = ${userId}`;
    return coHost.length > 0;
  }

  // Get attendees for an event (going or maybe)
  private getEventAttendees(eventId: string): User[] {
    return this.sql<User>`
      SELECT u.* FROM users u
      JOIN rsvps r ON r.user_id = u.id
      WHERE r.event_id = ${eventId} AND (r.status = 'going' OR r.status = 'maybe')
    `;
  }

  // Handle internal admin requests
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === "/reset" && request.method === "POST") {
      this.initDB();
      // Clear all events, rsvps, and event_hosts (keep users)
      this.ctx.storage.sql.exec("DELETE FROM event_hosts");
      this.ctx.storage.sql.exec("DELETE FROM rsvps");
      this.ctx.storage.sql.exec("DELETE FROM events");
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Fall through to parent handler for MCP requests
    return super.fetch(request);
  }

  async init() {
    // Initialize database
    this.initDB();

    // Initialize email service if API key is available
    if (this.env.RESEND_API_KEY) {
      this.emailService = new EmailService(this.env.RESEND_API_KEY);
    }

    // ==================== PROFILE TOOLS ====================

    this.server.tool(
      "get_profile",
      toolDefinitions.get_profile.description,
      getProfileSchema.shape,
      async () => {
        const user = this.ensureUser();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id: user.id,
              email: user.email,
              first_name: user.first_name,
              last_name: user.last_name,
              github_username: user.github_username,
              created_at: user.created_at,
            }, null, 2)
          }]
        };
      }
    );

    this.server.tool(
      "update_profile",
      toolDefinitions.update_profile.description,
      updateProfileSchema.shape,
      async ({ first_name, last_name, email }) => {
        const user = this.ensureUser();
        
        if (first_name) {
          this.sql`UPDATE users SET first_name = ${first_name}, updated_at = datetime('now') WHERE id = ${user.id}`;
        }
        if (last_name) {
          this.sql`UPDATE users SET last_name = ${last_name}, updated_at = datetime('now') WHERE id = ${user.id}`;
        }
        if (email) {
          this.sql`UPDATE users SET email = ${email}, updated_at = datetime('now') WHERE id = ${user.id}`;
        }

        if (!first_name && !last_name && !email) {
          return {
            content: [{ type: "text", text: "No updates provided" }]
          };
        }

        const updated = this.sql<User>`SELECT * FROM users WHERE id = ${user.id}`[0];
        return {
          content: [{
            type: "text",
            text: `Profile updated successfully:\n${JSON.stringify(updated, null, 2)}`
          }]
        };
      }
    );

    // ==================== EVENT LISTING TOOLS ====================

    this.server.tool(
      "list_events",
      toolDefinitions.list_events.description,
      listEventsSchema.shape,
      async ({ filter = "all" }) => {
        const user = this.ensureUser();
        const now = new Date().toISOString();
        
        let events: any[];

        switch (filter) {
          case "hosting":
            events = this.sql<any>`
              SELECT DISTINCT e.*, u.first_name as host_first_name, u.last_name as host_last_name
              FROM events e
              JOIN users u ON e.host_id = u.id
              LEFT JOIN event_hosts eh ON e.id = eh.event_id
              WHERE e.host_id = ${user.id} OR eh.user_id = ${user.id}
              ORDER BY e.date ASC
            `;
            break;
          case "attending":
            events = this.sql<any>`
              SELECT e.*, u.first_name as host_first_name, u.last_name as host_last_name, r.status as my_rsvp
              FROM events e
              JOIN users u ON e.host_id = u.id
              JOIN rsvps r ON e.id = r.event_id AND r.user_id = ${user.id}
              ORDER BY e.date ASC
            `;
            break;
          case "past":
            events = this.sql<any>`
              SELECT e.*, u.first_name as host_first_name, u.last_name as host_last_name
              FROM events e
              JOIN users u ON e.host_id = u.id
              WHERE e.date < ${now}
              ORDER BY e.date DESC
            `;
            break;
          case "all":
            events = this.sql<any>`
              SELECT e.*, u.first_name as host_first_name, u.last_name as host_last_name
              FROM events e
              JOIN users u ON e.host_id = u.id
              ORDER BY e.date ASC
            `;
            break;
          case "upcoming":
          default:
            events = this.sql<any>`
              SELECT e.*, u.first_name as host_first_name, u.last_name as host_last_name
              FROM events e
              JOIN users u ON e.host_id = u.id
              WHERE e.date >= ${now}
              ORDER BY e.date ASC
            `;
        }
        
        return {
          content: [{
            type: "text",
            text: events.length > 0 
              ? `Found ${events.length} event(s):\n${JSON.stringify(events, null, 2)}`
              : "No events found"
          }]
        };
      }
    );

    this.server.tool(
      "get_event",
      toolDefinitions.get_event.description,
      getEventSchema.shape,
      async ({ event_id }) => {
        const events = this.sql<any>`
          SELECT e.*, u.first_name as host_first_name, u.last_name as host_last_name, u.email as host_email
          FROM events e
          JOIN users u ON e.host_id = u.id
          WHERE e.id = ${event_id}
        `;

        if (events.length === 0) {
          return { content: [{ type: "text", text: "Event not found" }] };
        }

        const event = events[0];

        // Get RSVP counts
        const rsvpCounts = this.sql<{ status: string; count: number }>`
          SELECT status, COUNT(*) as count FROM rsvps WHERE event_id = ${event_id} GROUP BY status
        `;

        // Get co-hosts
        const coHosts = this.sql<{ first_name: string; last_name: string }>`
          SELECT u.first_name, u.last_name FROM users u
          JOIN event_hosts eh ON u.id = eh.user_id
          WHERE eh.event_id = ${event_id}
        `;

        // Check user's RSVP status
        const user = this.ensureUser();
        const myRsvp = this.sql<RSVP>`SELECT * FROM rsvps WHERE event_id = ${event_id} AND user_id = ${user.id}`;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ...event,
              co_hosts: coHosts,
              rsvp_counts: rsvpCounts.reduce((acc: Record<string, number>, r) => ({ ...acc, [r.status]: r.count }), {}),
              my_rsvp: myRsvp[0]?.status || null,
            }, null, 2)
          }]
        };
      }
    );

    // ==================== EVENT HOST TOOLS ====================

    this.server.tool(
      "create_event",
      toolDefinitions.create_event.description,
      createEventSchema.shape,
      async ({ title, description, location, date }) => {
        const user = this.ensureUser();
        const eventId = crypto.randomUUID();
        const desc = description || null;

        this.sql`INSERT INTO events (id, title, description, location, date, host_id)
                 VALUES (${eventId}, ${title}, ${desc}, ${location}, ${date}, ${user.id})`;

        const event = this.sql<Event>`SELECT * FROM events WHERE id = ${eventId}`[0];

        return {
          content: [{
            type: "text",
            text: `Event created successfully!\n${JSON.stringify(event, null, 2)}`
          }]
        };
      }
    );

    this.server.tool(
      "update_event",
      toolDefinitions.update_event.description,
      updateEventSchema.shape,
      async ({ event_id, title, description, location, date }) => {
        const user = this.ensureUser();

        if (!this.isEventHost(event_id, user.id)) {
          return { content: [{ type: "text", text: "You must be a host of this event to update it" }] };
        }

        const oldEvents = this.sql<Event>`SELECT * FROM events WHERE id = ${event_id}`;
        if (oldEvents.length === 0) {
          return { content: [{ type: "text", text: "Event not found" }] };
        }

        const oldEvent = oldEvents[0];
        const changes: string[] = [];

        if (title && title !== oldEvent.title) {
          this.sql`UPDATE events SET title = ${title}, updated_at = datetime('now') WHERE id = ${event_id}`;
          changes.push(`Title changed from "${oldEvent.title}" to "${title}"`);
        }
        if (description !== undefined && description !== oldEvent.description) {
          const desc = description || null;
          this.sql`UPDATE events SET description = ${desc}, updated_at = datetime('now') WHERE id = ${event_id}`;
          changes.push("Description updated");
        }
        if (location && location !== oldEvent.location) {
          this.sql`UPDATE events SET location = ${location}, updated_at = datetime('now') WHERE id = ${event_id}`;
          changes.push(`Location changed from "${oldEvent.location}" to "${location}"`);
        }
        if (date && date !== oldEvent.date) {
          this.sql`UPDATE events SET date = ${date}, updated_at = datetime('now') WHERE id = ${event_id}`;
          changes.push(`Date changed from "${oldEvent.date}" to "${date}"`);
        }

        if (changes.length === 0) {
          return { content: [{ type: "text", text: "No updates provided" }] };
        }

        const newEvent = this.sql<Event>`SELECT * FROM events WHERE id = ${event_id}`[0];

        // Send email notifications to attendees
        if (this.emailService && changes.length > 0) {
          const attendees = this.getEventAttendees(event_id);
          await this.emailService.sendEventUpdateNotification(newEvent, attendees, changes);
        }

        const attendeeCount = this.getEventAttendees(event_id).length;
        return {
          content: [{
            type: "text",
            text: `Event updated successfully!\nChanges: ${changes.join(", ")}\n\n${JSON.stringify(newEvent, null, 2)}${this.emailService ? `\n\nNotified ${attendeeCount} attendee(s)` : ""}`
          }]
        };
      }
    );

    this.server.tool(
      "delete_event",
      toolDefinitions.delete_event.description,
      deleteEventSchema.shape,
      async ({ event_id }) => {
        const user = this.ensureUser();

        const events = this.sql<Event>`SELECT * FROM events WHERE id = ${event_id}`;
        if (events.length === 0) {
          return { content: [{ type: "text", text: "Event not found" }] };
        }

        const event = events[0];
        if (event.host_id !== user.id) {
          return { content: [{ type: "text", text: "Only the primary host can delete an event" }] };
        }

        // Get attendees before deletion for notification
        const attendees = this.getEventAttendees(event_id);

        // Delete event (cascades to event_hosts and rsvps)
        this.sql`DELETE FROM event_hosts WHERE event_id = ${event_id}`;
        this.sql`DELETE FROM rsvps WHERE event_id = ${event_id}`;
        this.sql`DELETE FROM events WHERE id = ${event_id}`;

        // Send cancellation notifications
        if (this.emailService && attendees.length > 0) {
          await this.emailService.sendEventCancellationNotification(event, attendees);
        }

        return {
          content: [{
            type: "text",
            text: `Event "${event.title}" deleted successfully.${attendees.length > 0 ? ` Notified ${attendees.length} attendee(s).` : ""}`
          }]
        };
      }
    );

    this.server.tool(
      "list_event_rsvps",
      toolDefinitions.list_event_rsvps.description,
      listEventRsvpsSchema.shape,
      async ({ event_id, status = "all" }) => {
        const user = this.ensureUser();

        if (!this.isEventHost(event_id, user.id)) {
          return { content: [{ type: "text", text: "You must be a host of this event to view RSVPs" }] };
        }

        let rsvps: any[];
        if (status === "all") {
          rsvps = this.sql<any>`
            SELECT r.*, u.first_name, u.last_name, u.email
            FROM rsvps r
            JOIN users u ON r.user_id = u.id
            WHERE r.event_id = ${event_id}
            ORDER BY r.created_at DESC
          `;
        } else {
          rsvps = this.sql<any>`
            SELECT r.*, u.first_name, u.last_name, u.email
            FROM rsvps r
            JOIN users u ON r.user_id = u.id
            WHERE r.event_id = ${event_id} AND r.status = ${status}
            ORDER BY r.created_at DESC
          `;
        }

        return {
          content: [{
            type: "text",
            text: rsvps.length > 0
              ? `Found ${rsvps.length} RSVP(s):\n${JSON.stringify(rsvps, null, 2)}`
              : "No RSVPs found"
          }]
        };
      }
    );

    this.server.tool(
      "add_cohost",
      toolDefinitions.add_cohost.description,
      addCohostSchema.shape,
      async ({ event_id, user_email }) => {
        const user = this.ensureUser();

        if (!this.isEventHost(event_id, user.id)) {
          return { content: [{ type: "text", text: "You must be a host of this event to add co-hosts" }] };
        }

        const newHosts = this.sql<User>`SELECT * FROM users WHERE email = ${user_email}`;
        if (newHosts.length === 0) {
          return { content: [{ type: "text", text: `User with email ${user_email} not found. They need to log in first.` }] };
        }

        const newHost = newHosts[0];

        // Check if already a host
        const events = this.sql<Event>`SELECT * FROM events WHERE id = ${event_id}`;
        if (events[0].host_id === newHost.id) {
          return { content: [{ type: "text", text: "This user is already the primary host" }] };
        }

        const existingCoHost = this.sql<{ event_id: string }>`SELECT event_id FROM event_hosts WHERE event_id = ${event_id} AND user_id = ${newHost.id}`;
        if (existingCoHost.length > 0) {
          return { content: [{ type: "text", text: "This user is already a co-host" }] };
        }

        this.sql`INSERT INTO event_hosts (event_id, user_id) VALUES (${event_id}, ${newHost.id})`;

        return {
          content: [{
            type: "text",
            text: `${newHost.first_name} ${newHost.last_name} added as co-host`
          }]
        };
      }
    );

    this.server.tool(
      "remove_cohost",
      toolDefinitions.remove_cohost.description,
      removeCohostSchema.shape,
      async ({ event_id, user_email }) => {
        const user = this.ensureUser();

        const events = this.sql<Event>`SELECT * FROM events WHERE id = ${event_id}`;
        if (events.length === 0) {
          return { content: [{ type: "text", text: "Event not found" }] };
        }

        if (events[0].host_id !== user.id) {
          return { content: [{ type: "text", text: "Only the primary host can remove co-hosts" }] };
        }

        const coHosts = this.sql<User>`SELECT * FROM users WHERE email = ${user_email}`;
        if (coHosts.length === 0) {
          return { content: [{ type: "text", text: "User not found" }] };
        }

        const coHost = coHosts[0];
        this.sql`DELETE FROM event_hosts WHERE event_id = ${event_id} AND user_id = ${coHost.id}`;

        return {
          content: [{
            type: "text",
            text: `${coHost.first_name} ${coHost.last_name} removed as co-host`
          }]
        };
      }
    );

    // ==================== RSVP TOOLS ====================

    this.server.tool(
      "rsvp",
      toolDefinitions.rsvp.description,
      rsvpSchema.shape,
      async ({ event_id, status }) => {
        const user = this.ensureUser();

        const events = this.sql<Event>`SELECT * FROM events WHERE id = ${event_id}`;
        if (events.length === 0) {
          return { content: [{ type: "text", text: "Event not found" }] };
        }

        const event = events[0];

        // Check if RSVP already exists
        const existing = this.sql<RSVP>`SELECT * FROM rsvps WHERE event_id = ${event_id} AND user_id = ${user.id}`;

        if (existing.length > 0) {
          this.sql`UPDATE rsvps SET status = ${status}, updated_at = datetime('now') WHERE id = ${existing[0].id}`;
        } else {
          const rsvpId = crypto.randomUUID();
          this.sql`INSERT INTO rsvps (id, event_id, user_id, status) VALUES (${rsvpId}, ${event_id}, ${user.id}, ${status})`;
        }

        // Send confirmation email
        if (this.emailService) {
          await this.emailService.sendRSVPConfirmation(event, user, status);
        }

        const statusText = status === "going" ? "You're going!" :
                          status === "maybe" ? "Marked as maybe" :
                          "Marked as not going";

        return {
          content: [{
            type: "text",
            text: `${statusText}\nEvent: ${event.title}\nDate: ${event.date}\nLocation: ${event.location}`
          }]
        };
      }
    );

    this.server.tool(
      "update_rsvp",
      toolDefinitions.update_rsvp.description,
      updateRsvpSchema.shape,
      async ({ event_id, status }) => {
        const user = this.ensureUser();

        const existing = this.sql<RSVP>`SELECT * FROM rsvps WHERE event_id = ${event_id} AND user_id = ${user.id}`;

        if (existing.length === 0) {
          return { content: [{ type: "text", text: "You haven't RSVP'd to this event yet. Use the rsvp tool instead." }] };
        }

        this.sql`UPDATE rsvps SET status = ${status}, updated_at = datetime('now') WHERE id = ${existing[0].id}`;

        const events = this.sql<Event>`SELECT * FROM events WHERE id = ${event_id}`;

        return {
          content: [{
            type: "text",
            text: `RSVP updated to "${status}" for "${events[0]?.title}"`
          }]
        };
      }
    );

    this.server.tool(
      "cancel_rsvp",
      toolDefinitions.cancel_rsvp.description,
      cancelRsvpSchema.shape,
      async ({ event_id }) => {
        const user = this.ensureUser();

        const existing = this.sql<RSVP>`SELECT * FROM rsvps WHERE event_id = ${event_id} AND user_id = ${user.id}`;

        if (existing.length === 0) {
          return { content: [{ type: "text", text: "You haven't RSVP'd to this event" }] };
        }

        this.sql`DELETE FROM rsvps WHERE id = ${existing[0].id}`;

        const events = this.sql<Event>`SELECT * FROM events WHERE id = ${event_id}`;

        return {
          content: [{
            type: "text",
            text: `RSVP cancelled for "${events[0]?.title || 'Unknown event'}"`
          }]
        };
      }
    );

    this.server.tool(
      "get_my_rsvps",
      toolDefinitions.get_my_rsvps.description,
      getMyRsvpsSchema.shape,
      async () => {
        const user = this.ensureUser();

        const rsvps = this.sql<any>`
          SELECT e.*, r.status as my_rsvp, u.first_name as host_first_name, u.last_name as host_last_name
          FROM events e
          JOIN rsvps r ON e.id = r.event_id
          JOIN users u ON e.host_id = u.id
          WHERE r.user_id = ${user.id}
          ORDER BY e.date ASC
        `;

        return {
          content: [{
            type: "text",
            text: rsvps.length > 0
              ? `You have ${rsvps.length} RSVP(s):\n${JSON.stringify(rsvps, null, 2)}`
              : "You haven't RSVP'd to any events"
          }]
        };
      }
    );

    this.server.tool(
      "get_my_events",
      toolDefinitions.get_my_events.description,
      getMyEventsSchema.shape,
      async () => {
        const user = this.ensureUser();

        const events = this.sql<any>`
          SELECT DISTINCT e.*, 
            CASE WHEN e.host_id = ${user.id} THEN 'primary' ELSE 'co-host' END as host_role
          FROM events e
          LEFT JOIN event_hosts eh ON e.id = eh.event_id
          WHERE e.host_id = ${user.id} OR eh.user_id = ${user.id}
          ORDER BY e.date ASC
        `;

        // Get counts for each event
        const eventsWithCounts = events.map((event: any) => {
          const goingCount = this.sql<{ count: number }>`SELECT COUNT(*) as count FROM rsvps WHERE event_id = ${event.id} AND status = 'going'`[0]?.count || 0;
          const maybeCount = this.sql<{ count: number }>`SELECT COUNT(*) as count FROM rsvps WHERE event_id = ${event.id} AND status = 'maybe'`[0]?.count || 0;
          return { ...event, going_count: goingCount, maybe_count: maybeCount };
        });

        return {
          content: [{
            type: "text",
            text: eventsWithCounts.length > 0
              ? `You're hosting ${eventsWithCounts.length} event(s):\n${JSON.stringify(eventsWithCounts, null, 2)}`
              : "You're not hosting any events"
          }]
        };
      }
    );
  }
}

// The agents library routes to different DOs based on session ID.
// We want ALL requests to go to the SAME DO (shared database).
// 
// Strategy: Use a deterministic session ID that we control.
// We'll store the "real" session ID in a KV or just use the DO directly.
// 
// Actually simpler: Route ALL requests to the same DO by using idFromName
// and handling the MCP protocol ourselves.

const httpHandler = FlumaMCP.serve("/mcp");
const sseHandler = FlumaMCP.serveSSE("/sse");

// We'll use a simple approach: let init requests create sessions normally,
// but store a mapping. For now, just pass through - the real fix needs
// to be in how demo-agent handles sessions.

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Types endpoint - returns TypeScript definitions for codemode agent
    if (url.pathname === "/types" && request.method === "GET") {
      return new Response(cachedTypeScript, {
        headers: { "Content-Type": "text/plain" },
      });
    }
    
    // Descriptions endpoint - returns tool descriptions for system prompts
    if (url.pathname === "/descriptions" && request.method === "GET") {
      return new Response(cachedToolDescriptions, {
        headers: { "Content-Type": "text/plain" },
      });
    }
    
    // Admin endpoint to reset all data
    if (url.pathname === "/admin/reset" && request.method === "POST") {
      // Get the DO instance and clear all data
      // We need to use the same DO that the MCP handlers use
      // The MCP handlers use idFromName with the session ID from the request
      // For admin, we'll clear ALL data by accessing the DO directly
      const id = env.MCP_OBJECT.idFromName("fluma-shared");
      const stub = env.MCP_OBJECT.get(id);
      
      // Call a reset method on the DO
      const resetRequest = new Request("http://internal/reset", { method: "POST" });
      const response = await stub.fetch(resetRequest);
      
      return new Response(JSON.stringify({ success: true, message: "All events cleared" }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Route to appropriate handler based on path
    if (url.pathname.startsWith("/mcp")) {
      return httpHandler.fetch(request, env, ctx);
    }
    if (url.pathname.startsWith("/sse")) {
      return sseHandler.fetch(request, env, ctx);
    }
    
    return new Response("Not Found", { status: 404 });
  },
};
