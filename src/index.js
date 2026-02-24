#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'coinley-mcp', version: '0.1.0' },
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
        },
        required: ['apiBaseUrl', 'publicKey', 'amount', 'network', 'agentId', 'agentOwner'],
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
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'list_networks') {
      const res = await fetch(`${args.apiBaseUrl}/api/deposits/chains`);
      const data = await res.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }

    if (name === 'create_deposit_payment') {
      const res = await fetch(`${args.apiBaseUrl}/api/deposits/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-public-key': args.publicKey,
        },
        body: JSON.stringify({
          amount: args.amount,
          currency: args.currency || 'USDT',
          network: args.network,
          agentId: args.agentId,
          agentOwner: args.agentOwner,
          metadata: args.metadata,
        }),
      });
      const data = await res.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }

    if (name === 'get_payment_status') {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(args.paymentId)) {
        return {
          content: [{ type: 'text', text: 'Invalid paymentId: must be a valid UUID' }],
          isError: true,
        };
      }
      const res = await fetch(`${args.apiBaseUrl}/api/deposits/status/${args.paymentId}`);
      const data = await res.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error calling ${name}: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
