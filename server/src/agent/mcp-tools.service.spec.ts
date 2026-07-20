import { McpToolsService } from './mcp-tools.service';

describe('McpToolsService', () => {
  function makeService(overrides: {
    txnCreate?: jest.Mock;
    txnList?: jest.Mock;
    computeSummary?: jest.Mock;
    upcomingBills?: jest.Mock;
    bankList?: jest.Mock;
    commitmentList?: jest.Mock;
    loanList?: jest.Mock;
    cardList?: jest.Mock;
  }) {
    const transactions = { create: overrides.txnCreate ?? jest.fn(), list: overrides.txnList ?? jest.fn() };
    const dashboard = {
      computeSummary: overrides.computeSummary ?? jest.fn(),
      upcomingBills: overrides.upcomingBills ?? jest.fn(),
    };
    const bankAccounts = { list: overrides.bankList ?? jest.fn() };
    const commitments = { list: overrides.commitmentList ?? jest.fn() };
    const loans = { list: overrides.loanList ?? jest.fn() };
    const cards = { list: overrides.cardList ?? jest.fn() };
    const service = new McpToolsService(
      transactions as any,
      dashboard as any,
      bankAccounts as any,
      commitments as any,
      loans as any,
      cards as any,
    );
    return { service, transactions, dashboard, bankAccounts, commitments, loans, cards };
  }

  it('createTransaction delegates to TransactionsService.create with actor "agent"', async () => {
    const txnCreate = jest.fn().mockResolvedValue({ id: 't1' });
    const { service } = makeService({ txnCreate });
    const args = {
      type: 'income' as const,
      amount: 1000,
      date: '2026-07-20T00:00:00.000Z',
      sourceType: 'bankAccount' as const,
      sourceId: 'acc1',
    };
    const result = await service.createTransaction('user1', args);
    expect(txnCreate).toHaveBeenCalledWith('user1', args, 'agent');
    expect(result).toEqual({ id: 't1' });
  });

  it('getSummary combines computeSummary and a 14-day upcomingBills window', async () => {
    const computeSummary = jest.fn().mockResolvedValue({ netWorth: 500 });
    const upcomingBills = jest.fn().mockResolvedValue([{ name: 'Rent' }]);
    const { service } = makeService({ computeSummary, upcomingBills });
    const result = await service.getSummary('user1');
    expect(computeSummary).toHaveBeenCalledWith('user1');
    expect(upcomingBills).toHaveBeenCalledWith('user1', 14);
    expect(result).toEqual({
      summary: { netWorth: 500 },
      upcomingBills: [{ name: 'Rent' }],
    });
  });

  it('listTransactions delegates to TransactionsService.list', async () => {
    const txnList = jest.fn().mockResolvedValue({ items: [], total: 0 });
    const { service } = makeService({ txnList });
    const args = { page: '1', pageSize: '20' };
    const result = await service.listTransactions('user1', args);
    expect(txnList).toHaveBeenCalledWith('user1', args);
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('listAccounts aggregates all four entity lists', async () => {
    const bankList = jest.fn().mockResolvedValue([{ id: 'b1' }]);
    const commitmentList = jest.fn().mockResolvedValue([{ id: 'c1' }]);
    const loanList = jest.fn().mockResolvedValue([{ id: 'l1' }]);
    const cardList = jest.fn().mockResolvedValue([{ id: 'cc1' }]);
    const { service } = makeService({ bankList, commitmentList, loanList, cardList });
    const result = await service.listAccounts('user1');
    expect(result).toEqual({
      bankAccounts: [{ id: 'b1' }],
      commitments: [{ id: 'c1' }],
      loans: [{ id: 'l1' }],
      creditCards: [{ id: 'cc1' }],
    });
  });
});
