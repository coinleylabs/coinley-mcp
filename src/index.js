#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'coinley-mcp', version: '0.1.1' },
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

    if (name === 'read_merchant_config') {
      const res = await fetch(args.pageUrl, {
        headers: { 'User-Agent': 'CoinleyAgent/0.1 (MCP; +https://github.com/coinleylabs/coinley-mcp)' },
      });
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
        return {
          content: [{ type: 'text', text: 'No Coinley meta tags found. The merchant may not have enabled agent discovery (enableAgentDiscovery prop on CoinleyProvider).' }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ apiBaseUrl, publicKey }, null, 2) }],
      };
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
