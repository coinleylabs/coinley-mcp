# @coinley/mcp-server

An MCP (Model Context Protocol) server that exposes Coinley's crypto payment flow as tools AI agents can call natively. Compatible with Claude, Cursor, and any MCP-supporting framework.

## Installation

```bash
npm install
node src/index.js
```

## Tools

### `list_networks`
List all supported blockchain networks and tokens.

**Input:** `apiBaseUrl` — Coinley API base URL

**Returns:** Available chains and tokens the merchant accepts.

---

### `create_deposit_payment`
Create a payment and receive a deposit address. The agent sends tokens to this address to complete payment.

**Input:**
| Field | Required | Description |
|---|---|---|
| `apiBaseUrl` | Yes | Coinley API base URL |
| `publicKey` | Yes | Merchant public key (`pk_live_...` or `pk_test_...`) |
| `amount` | Yes | Payment amount in USD |
| `network` | Yes | Network shortname: `ethereum`, `base`, `polygon`, `solana`, etc. |
| `agentId` | Yes | Unique identifier for this agent instance |
| `agentOwner` | Yes | Human or entity accountable for this agent |
| `currency` | No | `USDT` (default) or `USDC` |
| `metadata` | No | Additional key-value metadata |

**Returns:** Payment details including `depositAddress`, `amount`, `currency`, `network`, and payment `id`.

---

### `get_payment_status`
Check the status of a payment. Poll until `status` is `completed` or `failed`.

**Input:** `apiBaseUrl`, `paymentId`

**Returns:** `status`, `confirmations`, `requiredConfirmations`, `depositTxHash`, `sweepTxHash`

---

## Agent Payment Flow

```
1. list_networks          → pick optimal chain + token
2. create_deposit_payment → receive unique deposit address
3. [agent sends tokens to deposit address from its own wallet]
4. get_payment_status     → poll until status = "completed"
5. Done — merchant receives funds, agent has txHash as proof
```

No browser, no wallet UI, no private keys on the server.

---

## Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "coinley": {
      "command": "node",
      "args": ["/path/to/coinley-mcp/src/index.js"]
    }
  }
}
```
