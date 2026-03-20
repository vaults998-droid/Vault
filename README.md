# Vault

Monorepo containing the Vault backend bots and web frontend.

## Projects

- **vault-bots** - Backend services (Discord bot, Telegram bot, Express API)
- **vault-web** - React + Vite frontend application

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm

### Installation

```bash
# Install all dependencies
cd vault-bots && npm install
cd vault-web && npm install
```

### Running the Applications

```bash
# Start the web frontend (port 5173)
cd vault-web && npm run dev

# Start the bots (requires .env configuration)
cd vault-bots && node index.js
```

### Environment Variables

- `vault-bots/.env` - Bot tokens, Supabase credentials, API keys
- `vault-web/.env.local` - Frontend environment variables

## Tech Stack

- **Backend**: Express, Discord.js, Telegraf, Supabase
- **Frontend**: React 19, Vite, Tailwind CSS, Lucide Icons