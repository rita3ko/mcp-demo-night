# Fluma - Fake Luma

An MCP-first event management app built on Cloudflare using the Agents SDK.

## Features

- **Event Management**: Create, update, and delete events
- **Role-based Access**: Per-event host/co-host permissions
- **RSVP System**: Attendees can RSVP with going/maybe/not_going
- **Email Notifications**: Automatic notifications via Resend when events are updated
- **GitHub OAuth**: Secure authentication via GitHub

## MCP Tools

### Profile Tools
- `get_profile` - Get your user profile
- `update_profile` - Update your profile (name, email)

### Event Listing
- `list_events` - List events (filter: upcoming, past, hosting, attending, all)
- `get_event` - Get event details including RSVP counts

### Event Host Tools (requires host/co-host role)
- `create_event` - Create a new event
- `update_event` - Update event details (notifies attendees)
- `delete_event` - Delete an event (notifies attendees)
- `list_event_rsvps` - View RSVPs for your event
- `add_cohost` - Add a co-host to your event
- `remove_cohost` - Remove a co-host

### RSVP Tools
- `rsvp` - RSVP to an event
- `update_rsvp` - Update your RSVP status
- `cancel_rsvp` - Cancel your RSVP
- `get_my_rsvps` - List events you've RSVP'd to
- `get_my_events` - List events you're hosting

## Setup

### 1. Create GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App:
   - **Application name**: Fluma (local) or Fluma (production)
   - **Homepage URL**: `http://localhost:8788` or your production URL
   - **Authorization callback URL**: `http://localhost:8788/callback` or production

### 2. Create KV Namespace

```bash
npx wrangler kv namespace create "OAUTH_KV"
```

Update `wrangler.jsonc` with the returned KV ID.

### 3. Set Environment Variables

Copy `.dev.vars.example` to `.dev.vars` and fill in:

```bash
cp .dev.vars.example .dev.vars
```

### 4. Run Locally

```bash
npm install
npm start
```

### 5. Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest
```

Connect to `http://localhost:8788/sse` or `http://localhost:8788/mcp`

## Deployment

### Set Secrets

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put COOKIE_ENCRYPTION_KEY  # openssl rand -hex 32
wrangler secret put RESEND_API_KEY         # optional
```

### Deploy

```bash
npm run deploy
```

## Architecture

- **Runtime**: Cloudflare Workers
- **Database**: Durable Object SQLite
- **Auth**: GitHub OAuth via workers-oauth-provider
- **Protocol**: MCP (Model Context Protocol)
- **Email**: Resend

## License

MIT
