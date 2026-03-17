#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

function getSuggestion(toolName, errorMessage) {
  const msg = errorMessage || '';
  if (msg.includes('agentId') || msg.includes('agentOwner')) {
    return 'Both agentId and agentOwner must be provided together';
  }
  if (/invalid paymentid/i.test(msg)) {
    return 'paymentId must be a UUID returned from create_deposit_payment';
  }
  if (msg.includes('401') || /unauthorized/i.test(msg)) {
    return 'Check that your publicKey is correct and starts with pk_live_ or pk_test_';
  }
  if (msg.includes('404') || /not found/i.test(msg)) {
    return 'Payment not found. Verify the paymentId is correct';
  }
  if (msg.includes('429') || /rate limit/i.test(msg)) {
    return 'Rate limit exceeded. Wait 60 seconds before retrying';
  }
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(msg)) {
    return 'Cannot reach the Coinley API. Check that apiBaseUrl is correct';
  }
  if (/AGENT_CONSTRAINT_VIOLATED/i.test(msg) || /budget exceeded/i.test(msg) || /not allowed.*permitted/i.test(msg) || /per-transaction limit/i.test(msg)) {
    return 'Agent constraint violated. Use get_agent_policy to check your limits before retrying.';
  }
  return null;
}

function makeError(toolName, message, extra = {}) {
  const obj = { error: true, tool: toolName, message, ...extra };
  const suggestion = getSuggestion(toolName, message);
  if (suggestion) obj.suggestion = suggestion;
  return {
    content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
    isError: true,
  };
}

async function checkResponse(res, toolName) {
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    return makeError(toolName, errorBody.message || res.statusText, {
      httpStatus: res.status,
    });
  }
  return null;
}

const server = new Server(
  { name: 'coinley-mcp', version: '0.2.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_networks',
      description: 'List all supported blockchain networks and tokens available for payment',
      inputSchema: {
        type: 'object',
        properties: {
          apiBaseUrl: {
            type: 'string',
            description: 'Coinley API base URL (e.g. https://talented-mercy-production.up.railway.app)',
          },
        },
        required: ['apiBaseUrl'],
      },
    },
    {
      name: 'create_deposit_payment',
      description:
        "Create a crypto payment and get a deposit address. Send tokens to this address to complete the payment. Returns: id (payment ID for status polling), depositAddress (send tokens here), amount, currency, network, expiresAt.",
      inputSchema: {
        type: 'object',
        properties: {
          apiBaseUrl: { type: 'string', description: 'Coinley API base URL' },
          publicKey: {
            type: 'string',
            description: 'Merchant public key (pk_live_... or pk_test_...)',
          },
          amount: { type: 'number', description: 'Payment amount in USD' },
          currency: {
            type: 'string',
            description: 'Token symbol: USDT or USDC',
            default: 'USDT',
          },
          network: {
            type: 'string',
            description: 'Network shortname e.g. ethereum, base, polygon, solana',
          },
          agentId: {
            type: 'string',
            description: 'Unique identifier for this agent instance',
          },
          agentOwner: {
            type: 'string',
            description: 'Human or entity accountable for this agent',
          },
          metadata: {
            type: 'object',
            description: 'Optional additional metadata to attach to the payment',
          },
          idempotencyKey: {
            type: 'string',
            description: 'Optional unique key to prevent duplicate payments. If a payment with this key already exists, the existing payment is returned instead of creating a new one.',
          },
          autonomous: {
            type: 'boolean',
            description: 'Set to true if this payment is being made without human oversight. Requires the merchant to have enabled autonomous mode for this agent via agent policies. Default: false.',
          },
        },
        required: ['apiBaseUrl', 'publicKey', 'amount', 'network', 'agentId', 'agentOwner'],
      },
    },
    {
      name: 'get_agent_policy',
      description: "Check this agent's spending constraints and permissions set by the merchant. Call this before create_deposit_payment to know your limits (max per tx, daily/monthly budgets, allowed networks/tokens, autonomous mode).",
      inputSchema: {
        type: 'object',
        properties: {
          apiBaseUrl: { type: 'string', description: 'Coinley API base URL' },
          publicKey: {
            type: 'string',
            description: 'Merchant public key (pk_live_... or pk_test_...)',
          },
          agentId: {
            type: 'string',
            description: 'Your agent identifier to look up the policy for',
          },
        },
        required: ['apiBaseUrl', 'publicKey', 'agentId'],
      },
    },
    {
      name: 'get_payment_status',
      description:
        "Check the status of a payment. Poll until status is 'completed' or 'failed'. Returns: status, confirmations, requiredConfirmations, depositTxHash (set when tokens detected), sweepTxHash (set when completed), isExpired.",
      inputSchema: {
        type: 'object',
        properties: {
          apiBaseUrl: { type: 'string', description: 'Coinley API base URL' },
          paymentId: {
            type: 'string',
            description: 'Payment ID returned from create_deposit_payment',
          },
        },
        required: ['apiBaseUrl', 'paymentId'],
      },
    },
    {
      name: 'read_merchant_config',
      description: 'Fetch a merchant\'s webpage and extract the Coinley API URL and public key from its meta tags. Use this when the user provides a merchant URL so you can auto-discover credentials without asking them. Look for <meta name="coinley:api"> and <meta name="coinley:public-key">.',
      inputSchema: {
        type: 'object',
        properties: {
          pageUrl: {
            type: 'string',
            description: 'URL of the merchant page to read (e.g. https://store.example.com)',
          },
        },
        required: ['pageUrl'],
      },
    },
    {
      name: 'create_sandbox_payment',
      description: 'Create a test payment in sandbox mode. No real funds needed. Returns a paymentId that can be simulated to completion or failure.',
      inputSchema: {
        type: 'object',
        properties: {
          apiBaseUrl: { type: 'string', description: 'Coinley API base URL' },
          publicKey: {
            type: 'string',
            description: 'Merchant public key (pk_test_... or pk_live_...)',
          },
          amount: { type: 'number', description: 'Payment amount in USD' },
          currency: {
            type: 'string',
            description: 'Token symbol: USDT or USDC',
            default: 'USDT',
          },
          network: {
            type: 'string',
            description: 'Network shortname e.g. ethereum, base, polygon, solana',
          },
          metadata: {
            type: 'object',
            description: 'Optional additional metadata to attach to the payment',
          },
        },
        required: ['apiBaseUrl', 'publicKey', 'amount'],
      },
    },
    {
      name: 'simulate_payment',
      description: 'Simulate a sandbox payment completing or failing. Only works on payments created with create_sandbox_payment.',
      inputSchema: {
        type: 'object',
        properties: {
          apiBaseUrl: { type: 'string', description: 'Coinley API base URL' },
          publicKey: {
            type: 'string',
            description: 'Merchant public key',
          },
          paymentId: {
            type: 'string',
            description: 'Payment ID returned from create_sandbox_payment',
          },
          action: {
            type: 'string',
            enum: ['complete', 'fail'],
            description: "Simulate outcome: 'complete' or 'fail'",
          },
        },
        required: ['apiBaseUrl', 'publicKey', 'paymentId', 'action'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'list_networks') {
      const res = await fetch(`${args.apiBaseUrl}/api/deposits/chains`);
      const httpErr = await checkResponse(res, name);
      if (httpErr) return httpErr;
      const data = await res.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }

    if (name === 'create_deposit_payment') {
      const body = {
        amount: args.amount,
        currency: args.currency || 'USDT',
        network: args.network,
        agentId: args.agentId,
        agentOwner: args.agentOwner,
        metadata: args.metadata,
      };
      if (args.idempotencyKey) body.orderId = args.idempotencyKey;
      if (args.autonomous !== undefined) body.autonomous = args.autonomous;
      const res = await fetch(`${args.apiBaseUrl}/api/deposits/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-public-key': args.publicKey,
        },
        body: JSON.stringify(body),
      });
      const httpErr = await checkResponse(res, name);
      if (httpErr) return httpErr;
      const data = await res.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }

    if (name === 'get_agent_policy') {
      const res = await fetch(
        `${args.apiBaseUrl}/api/merchants/agent-policies/${encodeURIComponent(args.agentId)}`,
        {
          headers: { 'x-public-key': args.publicKey },
        }
      );
      const httpErr = await checkResponse(res, name);
      if (httpErr) return httpErr;
      const data = await res.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }

    if (name === 'get_payment_status') {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(args.paymentId)) {
        return makeError(name, 'Invalid paymentId: must be a valid UUID');
      }
      const res = await fetch(`${args.apiBaseUrl}/api/deposits/status/${args.paymentId}`);
      const httpErr = await checkResponse(res, name);
      if (httpErr) return httpErr;
      const data = await res.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }

    if (name === 'create_sandbox_payment') {
      const res = await fetch(`${args.apiBaseUrl}/api/sandbox/payments/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-public-key': args.publicKey,
        },
        body: JSON.stringify({
          amount: args.amount,
          currency: args.currency || 'USDT',
          network: args.network,
          metadata: args.metadata,
        }),
      });
      const httpErr = await checkResponse(res, name);
      if (httpErr) return httpErr;
      const data = await res.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }

    if (name === 'simulate_payment') {
      const res = await fetch(`${args.apiBaseUrl}/api/sandbox/payments/${args.paymentId}/simulate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-public-key': args.publicKey,
        },
        body: JSON.stringify({ action: args.action }),
      });
      const httpErr = await checkResponse(res, name);
      if (httpErr) return httpErr;
      const data = await res.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }

    if (name === 'read_merchant_config') {
      const res = await fetch(args.pageUrl, {
        headers: { 'User-Agent': 'CoinleyAgent/0.1 (MCP; +https://github.com/coinleylabs/coinley-mcp)' },
      });
      const httpErr = await checkResponse(res, name);
      if (httpErr) return httpErr;
      const html = await res.text();

      const extractMeta = (metaName, html) => {
        const patterns = [
          new RegExp(`<meta[^>]+name=["']${metaName}["'][^>]+content=["']([^"']+)["']`, 'i'),
          new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${metaName}["']`, 'i'),
        ];
        for (const re of patterns) {
          const m = html.match(re);
          if (m) return m[1];
        }
        return null;
      };

      const apiBaseUrl = extractMeta('coinley:api', html);
      const publicKey  = extractMeta('coinley:public-key', html);

      if (!apiBaseUrl && !publicKey) {
        return makeError(name, 'No Coinley meta tags found. The merchant may not have enabled agent discovery (enableAgentDiscovery prop on CoinleyProvider).');
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ apiBaseUrl, publicKey }, null, 2) }],
      };
    }

    return makeError(name, `Unknown tool: ${name}`);
  } catch (err) {
    return makeError(name, err.message);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
