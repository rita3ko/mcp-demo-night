import { z } from "zod";

/**
 * Tool schemas for Fluma MCP server.
 * Defined separately to enable type generation for codemode agent.
 */

// ==================== PROFILE TOOLS ====================

export const getProfileSchema = z.object({});

export const updateProfileSchema = z.object({
  first_name: z.string().optional().describe("Your first name"),
  last_name: z.string().optional().describe("Your last name"),
  email: z.string().email().optional().describe("Your email address"),
});

// ==================== EVENT LISTING TOOLS ====================

export const listEventsSchema = z.object({
  filter: z.enum(["upcoming", "past", "hosting", "attending", "all"]).optional()
    .describe("Filter events: upcoming (default), past, hosting (events you host), attending (events you RSVP'd to), all"),
});

export const getEventSchema = z.object({
  event_id: z.string().describe("The event ID"),
});

// ==================== EVENT HOST TOOLS ====================

export const createEventSchema = z.object({
  title: z.string().describe("Event title"),
  description: z.string().optional().describe("Event description"),
  location: z.string().describe("Event location"),
  date: z.string().describe("Event date and time (ISO 8601 format, e.g., 2024-12-25T18:00:00Z)"),
});

export const updateEventSchema = z.object({
  event_id: z.string().describe("The event ID"),
  title: z.string().optional().describe("New event title"),
  description: z.string().optional().describe("New event description"),
  location: z.string().optional().describe("New event location"),
  date: z.string().optional().describe("New event date (ISO 8601 format)"),
});

export const deleteEventSchema = z.object({
  event_id: z.string().describe("The event ID"),
});

export const listEventRsvpsSchema = z.object({
  event_id: z.string().describe("The event ID"),
  status: z.enum(["going", "maybe", "not_going", "all"]).optional()
    .describe("Filter by RSVP status (default: all)"),
});

export const addCohostSchema = z.object({
  event_id: z.string().describe("The event ID"),
  user_email: z.string().email().describe("Email of the user to add as co-host"),
});

export const removeCohostSchema = z.object({
  event_id: z.string().describe("The event ID"),
  user_email: z.string().email().describe("Email of the co-host to remove"),
});

// ==================== RSVP TOOLS ====================

export const rsvpSchema = z.object({
  event_id: z.string().describe("The event ID"),
  status: z.enum(["going", "maybe", "not_going"]).describe("Your RSVP status"),
});

export const updateRsvpSchema = z.object({
  event_id: z.string().describe("The event ID"),
  status: z.enum(["going", "maybe", "not_going"]).describe("Your new RSVP status"),
});

export const cancelRsvpSchema = z.object({
  event_id: z.string().describe("The event ID"),
});

export const getMyRsvpsSchema = z.object({});

export const getMyEventsSchema = z.object({});

// ==================== TOOL DEFINITIONS ====================

/**
 * Complete tool definitions with name, description, and schema.
 * Used for both MCP server registration and type generation.
 */
export const toolDefinitions = {
  // Profile tools
  get_profile: {
    description: "Get your user profile",
    schema: getProfileSchema,
  },
  update_profile: {
    description: "Update your user profile",
    schema: updateProfileSchema,
  },
  
  // Event listing tools
  list_events: {
    description: "List all events with optional filtering",
    schema: listEventsSchema,
  },
  get_event: {
    description: "Get details of a specific event",
    schema: getEventSchema,
  },
  
  // Event host tools
  create_event: {
    description: "Create a new event (you will be the host)",
    schema: createEventSchema,
  },
  update_event: {
    description: "Update an event you host (will notify attendees)",
    schema: updateEventSchema,
  },
  delete_event: {
    description: "Delete an event you host (will notify attendees)",
    schema: deleteEventSchema,
  },
  list_event_rsvps: {
    description: "List all RSVPs for an event you host",
    schema: listEventRsvpsSchema,
  },
  add_cohost: {
    description: "Add a co-host to your event",
    schema: addCohostSchema,
  },
  remove_cohost: {
    description: "Remove a co-host from your event",
    schema: removeCohostSchema,
  },
  
  // RSVP tools
  rsvp: {
    description: "RSVP to an event",
    schema: rsvpSchema,
  },
  update_rsvp: {
    description: "Update your RSVP status for an event",
    schema: updateRsvpSchema,
  },
  cancel_rsvp: {
    description: "Cancel your RSVP for an event",
    schema: cancelRsvpSchema,
  },
  get_my_rsvps: {
    description: "Get all events you've RSVP'd to",
    schema: getMyRsvpsSchema,
  },
  get_my_events: {
    description: "Get all events you're hosting",
    schema: getMyEventsSchema,
  },
} as const;

export type ToolName = keyof typeof toolDefinitions;
