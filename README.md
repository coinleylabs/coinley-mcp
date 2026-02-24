# Coinley MCP Server

An MCP (Model Context Protocol) server that lets AI agents make crypto payments natively — no browser, no wallet UI, no private keys on the server side. The agent calls tools to create a payment, gets a deposit address, sends tokens from its own wallet, then polls for confirmation.

Compatible with Claude Code, Claude Desktop, Cursor, and any MCP-supporting framework.

---

## Installation

### Claude Code (recommended)

```bash
claude mcp add --transport stdio coinley -- npx -y github:coinleylabs/coinley-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "coinley": {
      "command": "npx",
      "args": ["-y", "github:coinleylabs/coinley-mcp"]
    }
  }
}
```

### Team / project-wide (checked into repo)

Add a `.mcp.json` at your repo root:

```json
{
  "mcpServers": {
    "coinley": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:coinleylabs/coinley-mcp"]
    }
  }
}
```

---

## Prerequisites

Before using any tool you need:

| Item | Where to get it |
|------|----------------|
| **API base URL** | Your Coinley server URL, e.g. `https://talented-mercy-production.up.railway.app` |
| **Public key** | Merchant dashboard → API Keys. Format: `pk_live_...` or `pk_test_...` |
| **Funded wallet** | An on-chain wallet the agent controls, holding the token it will send |

> The MCP server itself holds no funds and no private keys. The agent is responsible for signing and broadcasting the on-chain transaction to the deposit address after `create_deposit_payment` returns one.

---

## Tools

### `list_networks`

List all blockchain networks and tokens the merchant accepts.

**Call this first** to know which `network` values are valid before creating a payment.

**Input:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiBaseUrl` | string | ✅ | Coinley API base URL |

**Returns:**

```json
{
  "networks": [
    {
      "name": "Base",
      "shortName": "base",
      "chainId": 8453,
      "tokens": ["USDT", "USDC"]
    },
    {
      "name": "Solana",
      "shortName": "solana",
      "tokens": ["USDT", "USDC"]
    }
  ]
}
```

Use the `shortName` value as the `network` field in `create_deposit_payment`.

---

### `create_deposit_payment`

Create a payment session and receive a unique deposit address. The agent sends the exact token amount to this address to complete the payment.

**Input:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiBaseUrl` | string | ✅ | Coinley API base URL |
| `publicKey` | string | ✅ | Merchant public key (`pk_live_...` or `pk_test_...`) |
| `amount` | number | ✅ | Payment amount in USD |
| `network` | string | ✅ | Network shortname from `list_networks` (e.g. `base`, `polygon`, `solana`) |
| `agentId` | string | ✅ | Stable identifier for this agent instance. Alphanumeric, underscores, hyphens only. Max 100 chars. |
| `agentOwner` | string | ✅ | Human or entity accountable for this agent (e.g. `"acme-corp"`, `"user_123"`). Max 100 chars. |
| `currency` | string | ❌ | `USDT` (default) or `USDC` |
| `metadata` | object | ❌ | Arbitrary key-value pairs attached to the payment record |

**`agentId` rules:**
- Must be alphanumeric with underscores/hyphens only: `^[a-zA-Z0-9_-]+$`
- Max 100 characters
- Should be stable per agent instance — used for per-agent rate limiting (60 requests/minute)
- `agentId` and `agentOwner` must both be provided or both omitted

**Returns:**

```json
{
  "success": true,
  "payment": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "depositAddress": "0xABC123...",
    "amount": "10.00",
    "currency": "USDT",
    "network": "base",
    "expiresAt": "2026-02-24T13:00:00.000Z"
  }
}
```

**After receiving this response:**
1. Save the `id` — you will need it for `get_payment_status`
2. Send exactly `amount` of `currency` on `network` to `depositAddress` from your wallet
3. Do not send to this address after `expiresAt` — the payment will be marked expired

---

### `get_payment_status`

Check the status of a payment. Poll this after sending tokens until `status` is `completed` or `failed`.

**Input:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiBaseUrl` | string | ✅ | Coinley API base URL |
| `paymentId` | string | ✅ | UUID returned from `create_deposit_payment` |

**Returns:**

```json
{
  "success": true,
  "payment": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "completed",
    "confirmations": 5,
    "requiredConfirmations": 5,
    "depositTxHash": "0xabc...",
    "sweepTxHash": "0xdef...",
    "isExpired": false
  }
}
```

**Status values:**

| Status | Meaning |
|--------|---------|
| `pending` | Waiting for the on-chain transaction to appear |
| `confirming` | Transaction detected, accumulating confirmations |
| `completed` | Fully confirmed and swept to merchant — payment done |
| `failed` | Transaction failed or was rejected |
| `expired` | `expiresAt` passed before tokens were received |

**Polling guidance:** Wait 5–15 seconds between polls. Stop polling when `status` is `completed`, `failed`, or `expired`, or when `isExpired` is `true`.

---

### `read_merchant_config`

Fetch a merchant's page and extract the Coinley API URL and public key from its meta tags.
Call this first when the user gives you a merchant URL instead of credentials directly.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pageUrl` | string | ✅ | URL of the merchant page |

**Returns:** `{ apiBaseUrl, publicKey }`

`publicKey` will be `null` if the merchant has not opted in to agent discovery (i.e. `enableAgentDiscovery` is not set on their `CoinleyProvider`). `apiBaseUrl` is always present when Coinley is installed.

---

## Complete Usage Walkthrough

This is the full flow an agent follows to make a payment:

### Step 1 — Discover available networks

```
Tool: list_networks
Input: { "apiBaseUrl": "https://talented-mercy-production.up.railway.app" }
```

Pick a network where the agent holds a sufficient token balance. Prefer networks with fast finality and low fees (e.g. `base`, `polygon`, `solana`).

---

### Step 2 — Create the payment

```
Tool: create_deposit_payment
Input: {
  "apiBaseUrl": "https://talented-mercy-production.up.railway.app",
  "publicKey": "pk_live_abc123",
  "amount": 25.00,
  "network": "base",
  "currency": "USDT",
  "agentId": "my-agent-v1",
  "agentOwner": "acme-corp"
}
```

Save the returned `id` and `depositAddress`.

---

### Step 3 — Send tokens on-chain

Using your wallet/signing library, send exactly `25.00 USDT` on Base to the `depositAddress`.

> This step is outside the MCP server — the agent must sign and broadcast the transaction using its own wallet tooling.

---

### Step 4 — Poll for confirmation

```
Tool: get_payment_status
Input: {
  "apiBaseUrl": "https://talented-mercy-production.up.railway.app",
  "paymentId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

Repeat every 10 seconds until `status === "completed"`.

---

### Step 5 — Done

`sweepTxHash` is your on-chain proof that the merchant received funds.

---

## Rate Limits

| Limit | Value |
|-------|-------|
| Per merchant | Configured per account |
| Per `agentId` | 60 requests / minute |

If you receive a `429` response, back off for 60 seconds before retrying.

---

## Error Handling

All tools return errors in this shape:

```json
{
  "success": false,
  "message": "Human-readable error description"
}
```

Common errors:

| Message | Fix |
|---------|-----|
| `Both agentId and agentOwner must be provided together` | Supply both or neither |
| `agentId contains invalid characters` | Use only `a-z A-Z 0-9 _ -` |
| `Invalid paymentId: must be a valid UUID` | Check the ID from step 2 |
| `Rate limit exceeded for this agent` | Wait 60 seconds |
| `Payment not found` | Wrong `paymentId` or wrong `apiBaseUrl` |

---

## Example Prompts

### With a merchant URL (recommended — no credentials needed)

```
Pay $10 on https://store.example.com. My agent ID is my-agent and owner is acme-corp.
```

Claude will call `read_merchant_config` → `list_networks` → `create_deposit_payment` → `get_payment_status`.

### With explicit credentials (for developers/testing)

```
You have access to the Coinley MCP server. Use it to pay $10 USDT on Base
to merchant public key pk_live_abc123 at https://talented-mercy-production.up.railway.app.
My agent ID is "scheduler-v2" and owner is "acme-corp".
After creating the payment, send the tokens and confirm completion.
```

---

## Repository

- GitHub: https://github.com/coinleylabs/coinley-mcp
- Issues: https://github.com/coinleylabs/coinley-mcp/issues
