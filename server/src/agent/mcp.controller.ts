import { Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { EXPENSE_CATEGORIES } from '@finance/shared';
import { BearerAuthGuard, AgentUser } from './bearer-auth.guard';
import { McpToolsService } from './mcp-tools.service';

const TRANSACTION_TYPES = [
  'income',
  'expense',
  'commitmentPayment',
  'loanPayment',
  'cardPayment',
  'transfer',
] as const;

const SOURCE_TYPES = ['bankAccount', 'creditCard'] as const;

function toolError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function toolResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

@Controller('mcp')
@UseGuards(BearerAuthGuard)
export class McpController {
  constructor(private tools: McpToolsService) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { userId } = (req as Request & { user: AgentUser }).user;
    const server = new McpServer({ name: 'finance-tracker', version: '1.0.0' });

    server.registerTool(
      'create_transaction',
      {
        description:
          'Record a new transaction (income, expense, transfer, or a payment against a commitment/loan/credit card).',
        inputSchema: {
          type: z.enum(TRANSACTION_TYPES),
          amount: z.number().int().min(1).describe('Integer sen, e.g. RM 12.34 = 1234'),
          date: z.string().datetime({ offset: true }).describe('ISO 8601 date string'),
          category: z
            .enum(EXPENSE_CATEGORIES)
            .optional()
            .describe('Required when type is "expense"'),
          sourceType: z.enum(SOURCE_TYPES),
          sourceId: z.string().describe('Bank account or credit card id'),
          toAccountId: z.string().optional().describe('Required when type is "transfer"'),
          linkedEntityId: z
            .string()
            .optional()
            .describe('Required for commitmentPayment/loanPayment/cardPayment'),
          note: z.string().max(200).optional(),
        },
      },
      async (args) => {
        try {
          const result = await this.tools.createTransaction(userId, args);
          return toolResult(result);
        } catch (err) {
          return toolError(err instanceof Error ? err.message : 'Failed to create transaction.');
        }
      },
    );

    server.registerTool(
      'get_summary',
      {
        description:
          'Get a financial summary: account balances, assets/liabilities/net worth, and bills due in the next 14 days.',
        inputSchema: {},
      },
      async () => {
        try {
          const result = await this.tools.getSummary(userId);
          return toolResult(result);
        } catch (err) {
          return toolError(err instanceof Error ? err.message : 'Failed to get summary.');
        }
      },
    );

    server.registerTool(
      'list_transactions',
      {
        description:
          'List/search recent transactions, optionally filtered by type, category, account, or date range.',
        inputSchema: {
          type: z.enum(TRANSACTION_TYPES).optional(),
          category: z.enum(EXPENSE_CATEGORIES).optional(),
          sourceId: z.string().optional(),
          from: z
            .string()
            .datetime({ offset: true })
            .optional()
            .describe('ISO 8601 date, inclusive lower bound'),
          to: z
            .string()
            .datetime({ offset: true })
            .optional()
            .describe('ISO 8601 date, inclusive upper bound'),
          page: z.string().optional(),
          pageSize: z.string().optional(),
        },
      },
      async (args) => {
        try {
          const result = await this.tools.listTransactions(userId, args);
          return toolResult(result);
        } catch (err) {
          return toolError(err instanceof Error ? err.message : 'Failed to list transactions.');
        }
      },
    );

    server.registerTool(
      'list_accounts',
      {
        description:
          'List all bank accounts, commitments, loans, and credit cards with their current balances/due dates/limits.',
        inputSchema: {},
      },
      async () => {
        try {
          const result = await this.tools.listAccounts(userId);
          return toolResult(result);
        } catch (err) {
          return toolError(err instanceof Error ? err.message : 'Failed to list accounts.');
        }
      },
    );

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      // Stateless mode: each request gets a fresh McpServer/transport pair, so
      // there is no long-lived stream to justify SSE. Returning a single plain
      // JSON response per request keeps the endpoint simple to consume (and to
      // test) instead of the default text/event-stream framing.
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
