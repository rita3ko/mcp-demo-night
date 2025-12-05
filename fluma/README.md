# Fluma - Event Management MCP Server

An MCP (Model Context Protocol) server for event management, built on Cloudflare Workers with Durable Objects.

## Overview

Fluma provides a complete event management API exposed via MCP, allowing AI agents to create events, manage RSVPs, and handle user profiles. It uses SQLite (via Durable Objects) for persistence.

For this demo, Fluma runs in **stateless mode** - all MCP sessions route to the same Durable Object, ensuring all agents see the same data.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Fluma Worker                              │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Request Handler                          │   │
│  │                                                       │   │
│  │  All requests → Same session ID → Same DO instance   │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              FlumaMCP Durable Object                  │   │
│  │                                                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │   │
│  │  │   Users     │  │   Events    │  │   RSVPs     │   │   │
│  │  │   Table     │  │   Table     │  │   Table     │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘   │   │
│  │                                                       │   │
│  │                    SQLite DB                          │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## MCP Tools

### Profile Tools
| Tool | Description |
|------|-------------|
| `get_profile` | Get current user's profile |
| `update_profile` | Update profile (first_name, last_name, email) |

### Event Listing
| Tool | Description |
|------|-------------|
| `list_events` | List events with filters (upcoming, past, hosting, attending, all) |
| `get_event` | Get event details including RSVP counts and co-hosts |

### Event Host Tools
| Tool | Description |
|------|-------------|
| `create_event` | Create a new event (you become the host) |
| `update_event` | Update event details (notifies attendees) |
| `delete_event` | Delete an event (notifies attendees) |
| `list_event_rsvps` | View RSVPs for events you host |
| `add_cohost` | Add a co-host to your event |
| `remove_cohost` | Remove a co-host |

### RSVP Tools
| Tool | Description |
|------|-------------|
| `rsvp` | RSVP to an event (going, maybe, not_going) |
| `update_rsvp` | Update your RSVP status |
| `cancel_rsvp` | Cancel your RSVP |
| `get_my_rsvps` | List events you've RSVP'd to |
| `get_my_events` | List events you're hosting |

## MCP Transports

Fluma supports two MCP transport methods:

### HTTP Streamable (Recommended)
```
POST /mcp
Headers:
  Content-Type: application/json
  Accept: application/json, text/event-stream
  mcp-session-id: <session-id>  (after initialization)
```

### Server-Sent Events (Legacy)
```
GET /sse
Headers:
  Accept: text/event-stream
  mcp-session-id: <session-id>
```

## Database Schema

```sql
-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  github_id TEXT UNIQUE,
  github_username TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Events
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT NOT NULL,
  date TEXT NOT NULL,
  host_id TEXT NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Event Co-hosts
CREATE TABLE event_hosts (
  event_id TEXT REFERENCES events(id),
  user_id TEXT REFERENCES users(id),
  PRIMARY KEY (event_id, user_id)
);

-- RSVPs
CREATE TABLE rsvps (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id),
  user_id TEXT REFERENCES users(id),
  status TEXT CHECK(status IN ('going', 'maybe', 'not_going')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, user_id)
);
```

## Local Development

```bash
# Install dependencies
npm install

# Create environment file (optional - for email notifications)
cp .dev.vars.example .dev.vars

# Start development server
npm run dev
```

The server runs at `http://localhost:8788`.

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest
```

Connect to `http://localhost:8788/mcp` (HTTP Streamable) or `http://localhost:8788/sse` (SSE).

## Deployment

```bash
# Set secrets (optional - for email notifications)
wrangler secret put RESEND_API_KEY

# Deploy
npm run deploy
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RESEND_API_KEY` | No | Resend API key for email notifications |

### Wrangler Configuration

The `wrangler.jsonc` configures:
- Durable Object binding (`MCP_OBJECT`)
- SQLite migrations for the DO

## Stateless Mode

For the MCP Night demo, Fluma operates in stateless mode:

```typescript
const SHARED_SESSION_ID = "fluma-shared";

// All requests use the same session ID
// This routes all MCP sessions to the same Durable Object
```

This ensures that events created by one agent are visible to all other agents, enabling the side-by-side comparison demo.

## License

MIT
