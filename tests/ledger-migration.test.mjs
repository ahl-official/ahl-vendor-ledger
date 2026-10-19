import test from 'node:test';
import assert from 'node:assert/strict';
import { orderSummary, vendorHeld, vendorOpenReceipts, movementRemaining, agentPosition } from '../lib/ledger.ts';
import { vendorAccount } from '../lib/accounts.ts';

const empty = () => ({ contacts: [], orders: [], orderItems: [], movements: [], applications: [], transfers: [], fxConversions: [], creditNotes: [], legacyRecords: [] });
const receipt = (id, payeeId, amount, type = 'AgentToVendor', currency = 'RMB') => ({ id, payeeId, payerId: 'company', amount, type, currency, date: '2026-08-01', createdAt: '2026-08-01', reversed: false, note: '', proofUrl: '' });
const transfer = (id, fromVendorId, toContactId, amount, receivingOrderId = '') => ({ id, sourceMovementId: '', fromVendorId, toContactId, amount, currency: 'RMB', purpose: 'Transfer', receivingOrderId, reversed: false, date: '2026-08-02', createdAt: '2026-08-02', note: '', proofUrl: '' });

test('legacy receipts preserve actual payer and pooled transfers reserve the correct spendable amount', () => {
  const d = empty();
  d.movements.push(receipt('old-1', 'holder', 1000, 'LegacyCompanyToVendor'), receipt('old-2', 'holder', 500, 'LegacyCompanyToVendor'));
  d.transfers.push(transfer('paid', 'holder', 'other', 1200));
  assert.equal(vendorHeld('holder', 'RMB', d), 300);
  assert.equal(movementRemaining('old-1', d), 0);
  assert.equal(movementRemaining('old-2', d), 300);
  assert.equal(vendorOpenReceipts('holder', d).reduce((s, r) => s + r.remaining, 0), 300);
});

test('incoming transfer can pay a later order without inventing a second receipt', () => {
  const d = empty();
  d.movements.push(receipt('fund', 'a', 100));
  d.transfers.push({ ...transfer('a-to-b', 'a', 'b', 60), sourceMovementId: 'fund' });
  d.orders.push({ id: 'order', vendorId: 'b', currency: 'RMB', shippingFee: 0, adjustment: 0, legacyTotal: 50, date: '2026-08-03' });
  d.applications.push({ id: 'use', movementId: 'a-to-b', orderId: 'order', amount: 50, active: true, date: '2026-08-03', createdAt: '2026-08-03' });
  assert.equal(vendorHeld('a', 'RMB', d), 40);
  assert.equal(vendorHeld('b', 'RMB', d), 10);
  assert.equal(movementRemaining('a-to-b', d), 10);
  assert.equal(orderSummary(d.orders[0], d).paid, 50);
  assert.equal(vendorAccount('b', d).events[0].balance, 10);
  assert.equal(d.movements.length, 1);
});

test('transfer applied on arrival is paid to the order, with no extra held balance', () => {
  const d = empty(); d.transfers.push(transfer('direct-to-order', 'a', 'b', 70, 'order'));
  d.orders.push({ id: 'order', vendorId: 'b', currency: 'RMB', shippingFee: 0, adjustment: 0, legacyTotal: 100 });
  assert.equal(vendorHeld('b', 'RMB', d), 0);
  assert.equal(orderSummary(d.orders[0], d).due, 30);
  assert.equal(vendorOpenReceipts('b', d).length, 0);
  assert.equal(vendorAccount('b', d).events[0].balance, 0);
});

test('an unknown order total remains unknown with real payments retained', () => {
  const d = empty(); d.orders.push({ id: 'unknown', vendorId: 'b', currency: 'RMB', totalKnown: false, shippingFee: 0, adjustment: 0 });
  d.transfers.push(transfer('paid', 'a', 'b', 3000, 'unknown'));
  const result = orderSummary(d.orders[0], d);
  assert.equal(result.totalKnown, false); assert.equal(result.paid, 3000);
  assert.equal(vendorAccount('b', d).balances[0].unknownOrders, 1);
});

test('currencies remain separate and an explicitly linked fee-inclusive route settles once', () => {
  const d = empty();
  d.movements.push({ ...receipt('fund', 'agent', 1250, 'CompanyToAgent', 'INR'), agentFee: 50 }, { ...receipt('spend', 'vendor', 100), payerId: 'agent' });
  assert.deepEqual(agentPosition('agent', d), { INR: 1250, RMB: -100 });
  d.fxConversions.push({ id: 'fx', agentId: 'agent', fundingMovementId: 'fund', spendMovementId: 'spend', fromCurrency: 'INR', fromAmount: 1250, toCurrency: 'RMB', toAmount: 100, reversed: false });
  assert.deepEqual(agentPosition('agent', d), { INR: 0, RMB: 0 });
  assert.equal(vendorHeld('vendor', 'INR', d), 0); assert.equal(vendorHeld('vendor', 'RMB', d), 100);
});

test('pending requests and open expenses are shown without becoming cash transactions', () => {
  const d = empty(); d.movements.push(receipt('receipt', 'vendor', 100));
  d.legacyRecords.push({ id: 'request', kind: 'TransferRequest', vendorId: 'vendor', currency: 'RMB', amount: 40, status: 'Pending' }, { id: 'expense', kind: 'Expense', vendorId: 'vendor', currency: 'RMB', amount: 15, status: 'Open' });
  const b = vendorAccount('vendor', d).balances[0];
  assert.equal(b.held, 100); assert.equal(b.expenses, 15); assert.equal(b.afterCommitments, 85);
});

test('a spent credit-note source has its own remaining amount', () => {
  const d = empty(); d.creditNotes.push({ id: 'credit', vendorId: 'vendor', currency: 'RMB', amount: 80, date: '2026-08-01', createdAt: '2026-08-01', reversed: false, reason: '' });
  d.applications.push({ id: 'apply', movementId: 'credit', orderId: 'next', amount: 50, active: true, date: '2026-08-02', createdAt: '2026-08-02' });
  assert.equal(vendorHeld('vendor', 'RMB', d), 30); assert.equal(movementRemaining('credit', d), 30);
});
