import test from 'node:test';
import assert from 'node:assert/strict';
import { agentStatement } from '../lib/agent-statement.ts';
import { agentPosition } from '../lib/ledger.ts';

const empty=()=>({contacts:[{id:'vendor',name:'Vendor'}],orders:[],orderItems:[],movements:[],applications:[],transfers:[],fxConversions:[]});
const movement=(id,type,amount,currency,date)=>({id,type,amount,currency,date,createdAt:date,payerId:type==='CompanyToAgent'?'company':'agent',payeeId:type==='CompanyToAgent'?'agent':'vendor',note:'Original note',reversed:false,quotedRate:12.5,actualRate:null});
const conversion=(id,funding,spend,fromAmount,toAmount)=>({id,agentId:'agent',fundingMovementId:funding,spendMovementId:spend,fromCurrency:'INR',toCurrency:'RMB',fromAmount,toAmount,reversed:false});

test('the restored columns show actual currencies without converting a quoted rate',()=>{
  const d=empty();d.movements.push(movement('fund','CompanyToAgent',1250,'INR','2026-08-01'),movement('spend','AgentToVendor',100,'RMB','2026-08-02'));
  const rows=agentStatement('agent',d);
  assert.equal(rows[0].rmbAmount,-100);assert.equal(rows[0].balanceRmb,-100);
  assert.equal(rows[1].inrAmount,1250);assert.equal(rows[1].rmbAmount,null);
  assert.deepEqual(rows[0].balances,agentPosition('agent',d));
  assert.equal(rows[0].label,'Paid vendor Vendor');
});

test('all confirmed partial conversions contribute once to the funding row',()=>{
  const d=empty();d.movements.push(movement('fund','CompanyToAgent',2500,'INR','2026-08-01'),movement('spend','AgentToVendor',160,'RMB','2026-08-02'));
  d.fxConversions.push(conversion('fx1','fund','spend',1250,100),conversion('fx2','fund','spend',500,40));
  const rows=agentStatement('agent',d);
  assert.equal(rows[1].rmbAmount,140);assert.equal(rows[1].inrAmount,2500);
  assert.equal(rows[0].balanceRmb,-20);assert.equal(rows[0].balances.INR,750);
  assert.deepEqual(rows[0].balances,agentPosition('agent',d));
  assert.equal(rows[1].note.match(/Confirmed conversion/g).length,2);
});

test('a confirmed funding arriving after the payout settles the latest displayed balance',()=>{
  const d=empty();d.movements.push(movement('spend','AgentToVendor',100,'RMB','2026-08-01'),movement('fund','CompanyToAgent',1250,'INR','2026-08-02'));
  d.fxConversions.push(conversion('fx','fund','spend',1250,100));
  const rows=agentStatement('agent',d);
  assert.equal(rows[0].balanceRmb,0);assert.equal(rows[1].balanceRmb,-100);
  assert.deepEqual(rows[0].balances,agentPosition('agent',d));
  d.fxConversions[0].reversed=true;
  assert.equal(agentStatement('agent',d)[0].balanceRmb,-100);
});

test('returns and additional currencies remain separate and voided movements are omitted',()=>{
  const d=empty();d.movements.push(movement('fund','CompanyToAgent',200,'USD','2026-08-01'),movement('return','AgentToCompany',50,'USD','2026-08-02'),{...movement('void','AgentToVendor',20,'RMB','2026-08-03'),reversed:true});
  const rows=agentStatement('agent',d);
  assert.equal(rows.length,2);assert.equal(rows[0].amount,-50);assert.equal(rows[0].balanceRmb,0);
  assert.equal(rows[0].label,'Returned to Company');
  assert.deepEqual(rows[0].balances,agentPosition('agent',d));
});
