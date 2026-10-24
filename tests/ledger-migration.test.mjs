import test from 'node:test';
import assert from 'node:assert/strict';
import { orderSummary, vendorHeld, vendorOpenReceipts, movementRemaining, agentPosition, drawFifo, fundingAutoConversion, isValidMoneyAmount } from '../lib/ledger.ts';
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

test('opening balance funds orders without inventing an agent or company payment', () => {
  const d = empty();
  d.movements.push({ ...receipt('opening', 'vendor', 120, 'OpeningBalance'), payerId: '', method: '', reference: '', date: '2026-04-01' });
  d.orders.push({ id: 'invoice', vendorId: 'vendor', currency: 'RMB', shippingFee: 0, adjustment: 0, legacyTotal: 90 });
  d.applications.push({ id: 'use-opening', movementId: 'opening', orderId: 'invoice', amount: 90, active: true, date: '2026-04-08', createdAt: '2026-04-08' });
  assert.equal(vendorHeld('vendor', 'RMB', d), 30);
  assert.equal(movementRemaining('opening', d), 30);
  assert.equal(orderSummary(d.orders[0], d).due, 0);
  assert.deepEqual(agentPosition('company', d), {});
  assert.equal(vendorAccount('vendor', d).events.find(e => e.id === 'opening').label, 'Opening balance carried forward');
  d.movements[0].reversed = true;
  d.applications[0].active = false;
  assert.equal(vendorHeld('vendor', 'RMB', d), 0);
  assert.equal(orderSummary(d.orders[0], d).due, 90);
});

test('general vendor credit funds real orders once without changing their invoice values', () => {
  const d = empty();
  d.orders.push({ id: 'invoice', vendorId: 'vendor', currency: 'RMB', shippingFee: 0, adjustment: 0, legacyTotal: 50 });
  d.creditNotes.push({ id: 'credit', orderId: '', vendorId: 'vendor', currency: 'RMB', amount: 80, date: '2026-08-01', createdAt: '2026-08-01', reversed: false, reason: 'Historical credit reference' });
  assert.equal(vendorHeld('vendor', 'RMB', d), 80);
  assert.equal(orderSummary(d.orders[0], d).netCost, 50);
  assert.equal(orderSummary(d.orders[0], d).due, 50);
  assert.equal(vendorAccount('vendor', d).events[0].label, 'Vendor credit on account');
  d.applications.push({ id: 'apply-credit', movementId: 'credit', orderId: 'invoice', amount: 50, active: true, date: '2026-08-02', createdAt: '2026-08-02' });
  assert.equal(vendorHeld('vendor', 'RMB', d), 30);
  assert.equal(movementRemaining('credit', d), 30);
  assert.equal(orderSummary(d.orders[0], d).due, 0);
  assert.equal(orderSummary(d.orders[0], d).creditNotes, 0);
  assert.equal(vendorAccount('vendor', d).events[0].balance, 30);
  assert.deepEqual(agentPosition('agent', d), {});
});

test('direct company payment credits the vendor once and leaves agent funding unchanged', () => {
  const d = empty();
  d.contacts.push({ id: 'company', name: 'Company', roles: ['Company'] });
  d.movements.push(receipt('direct', 'vendor', 120, 'CompanyToVendor'));
  assert.equal(vendorHeld('vendor', 'RMB', d), 120);
  assert.equal(movementRemaining('direct', d), 120);
  assert.equal(vendorHeld('vendor', 'USD', d), 0);
  assert.deepEqual(agentPosition('agent', d), {});
  assert.equal(vendorAccount('vendor', d).events[0].label, 'Received from Company');
  d.orders.push({ id: 'invoice', vendorId: 'vendor', currency: 'RMB', shippingFee: 0, adjustment: 0, legacyTotal: 90 });
  d.applications.push({ id: 'apply-direct', movementId: 'direct', orderId: 'invoice', amount: 90, active: true, date: '2026-08-02', createdAt: '2026-08-02' });
  assert.equal(orderSummary(d.orders[0], d).due, 0);
  assert.equal(vendorHeld('vendor', 'RMB', d), 30);
  assert.equal(movementRemaining('direct', d), 30);
  d.movements[0].reversed = true;
  d.applications[0].active = false;
  assert.equal(vendorHeld('vendor', 'RMB', d), 0);
  assert.equal(orderSummary(d.orders[0], d).due, 90);
});

test('an incidental rate on a movement never converts display without the vendor opting in (the Hao Hao regression)', () => {
  const d = empty();
  // Rate/rateCurrency present on the movement, but this vendor never opted into a display
  // currency -- this is exactly the data shape that corrupted a real vendor's balance once
  // before a vendor-level opt-in was added. Must stay untouched.
  d.movements.push({ ...receipt('old', 'vendor', 8180, 'CompanyToVendor', 'RMB'), quotedRate: 15, rateCurrency: 'INR' });
  assert.equal(vendorHeld('vendor', 'RMB', d), 8180);
  const held = vendorAccount('vendor', d).events[0];
  assert.equal(held.currency, 'RMB');
  assert.equal(held.credited, 8180);
});

test('opting a vendor into a display currency converts only entries with a matching saved rate', () => {
  const d = empty();
  d.contacts.push({ id: 'vendor', name: 'V', roles: ['Vendor'], displayCurrency: 'USD' });
  // Has a rate into USD -- converts for display.
  d.movements.push({ ...receipt('with-rate', 'vendor', 8180, 'CompanyToVendor', 'RMB'), quotedRate: 7.1, rateCurrency: 'USD' });
  // Same vendor, no rate at all -- must stay RMB, not be guessed or dropped.
  d.movements.push(receipt('no-rate', 'vendor', 500, 'CompanyToVendor', 'RMB'));
  // Has a rate, but into a DIFFERENT currency than the vendor's chosen display -- must stay RMB too.
  d.movements.push({ ...receipt('wrong-target', 'vendor', 200, 'CompanyToVendor', 'RMB'), quotedRate: 15, rateCurrency: 'INR' });
  const events = vendorAccount('vendor', d).events;
  const withRate = events.find(e => e.id === 'with-rate');
  const noRate = events.find(e => e.id === 'no-rate');
  const wrongTarget = events.find(e => e.id === 'wrong-target');
  assert.equal(withRate.currency, 'USD');
  assert.equal(Math.round(withRate.credited * 100) / 100, 1152.11); // 8180 / 7.1, same convention as convertByRate
  assert.equal(noRate.currency, 'RMB');
  assert.equal(noRate.credited, 500);
  assert.equal(wrongTarget.currency, 'RMB');
  assert.equal(wrongTarget.credited, 200);
  // Display conversion never touches the real spendable balance.
  assert.equal(vendorHeld('vendor', 'RMB', d), 8880);
  assert.equal(vendorHeld('vendor', 'USD', d), 0);
});

test('a vendor-to-vendor transfer with a saved rate converts for display the same way', () => {
  const d = empty();
  d.contacts.push({ id: 'b', name: 'B', roles: ['Vendor'], displayCurrency: 'USD' });
  d.movements.push(receipt('fund', 'a', 1000));
  d.transfers.push({ ...transfer('a-to-b', 'a', 'b', 710), sourceMovementId: 'fund', rate: 7.1, rateCurrency: 'USD' });
  const event = vendorAccount('b', d).events[0];
  assert.equal(event.currency, 'USD');
  assert.equal(Math.round(event.credited * 100) / 100, 100); // 710 RMB / 7.1
  // Real balance stays RMB -- this is a display conversion only.
  assert.equal(vendorHeld('b', 'RMB', d), 710);
});

test('drawFifo draws oldest-first, rounds to cents, and throws when sources fall short', () => {
  const sources = [
    { movement: { id: 'old' }, remaining: 30 },
    { movement: { id: 'mid' }, remaining: 100.005 },
    { movement: { id: 'new' }, remaining: 50 },
  ];
  const draws = drawFifo(sources, 70.01);
  assert.deepEqual(draws.map(d => [d.source.movement.id, d.used]), [['old', 30], ['mid', 40.01]]);
  assert.throws(() => drawFifo(sources, 1000), /did not cover/);
  assert.deepEqual(drawFifo(sources, 0.001), []); // rounds down to nothing, draws nothing
});

test('fundingAutoConversion only applies to CompanyToAgent fundings with a real rate into a different currency', () => {
  const base = { id: 'm', date: '2026-01-01', payerId: 'c', payeeId: 'a', amount: 1000, currency: 'INR', actualRate: null, quotedRate: null, agentFee: null, rateCurrency: '', paymentUse: '', method: '', reference: '', proofUrl: '', note: '', reversed: false, reversedReason: '', idempotencyKey: '', createdAt: '', createdBy: '' };
  assert.equal(fundingAutoConversion({ ...base, type: 'AgentToVendor', quotedRate: 83, rateCurrency: 'USD' }), null); // wrong type
  assert.equal(fundingAutoConversion({ ...base, type: 'CompanyToAgent', currency: 'USD', quotedRate: 83, rateCurrency: 'USD' }), null); // already that currency
  assert.equal(fundingAutoConversion({ ...base, type: 'CompanyToAgent', rateCurrency: 'USD' }), null); // no rate saved
  const conv = fundingAutoConversion({ ...base, type: 'CompanyToAgent', quotedRate: 83, rateCurrency: 'USD' });
  assert.equal(conv.target, 'USD');
  assert.equal(Math.round(conv.amount * 100) / 100, 12.05); // 1000 INR / 83
});

test('isValidMoneyAmount enforces positive, at-most-two-decimal amounts', () => {
  assert.equal(isValidMoneyAmount(100), true);
  assert.equal(isValidMoneyAmount(100.5), true);
  assert.equal(isValidMoneyAmount(8187.1341), false); // real conversion math, not float noise -- still rejected
  assert.equal(isValidMoneyAmount(0), false);
  assert.equal(isValidMoneyAmount(-5), false);
  assert.equal(isValidMoneyAmount(NaN), false);
});
