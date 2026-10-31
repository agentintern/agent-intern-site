import { mint, TEST_DEFAULT_BALANCE, testMode, threshold } from './config';
import type { Env } from './env';
import { HttpError } from './http';
import { setSetting } from './settings';

export interface Balance {
  amount: bigint;
  decimals: number;
  display: string;
  slot: number;
}

const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
const RPC_TIMEOUT_MS = 6000;

export function meetsThreshold(balance: Balance): boolean {
  return balance.amount >= BigInt(threshold()) * 10n ** BigInt(balance.decimals);
}

function formatAmount(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

interface RpcResponse {
  result?: {
    context?: { slot?: number };
    value?: { account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string; decimals?: number } } } } } }[];
  };
  error?: unknown;
}

// One call covers it: filtering by mint finds every account the wallet holds of that mint, under
// the classic program or Token-2022, because the RPC node resolves the program from the mint.
async function readFromRpc(env: Env, wallet: string): Promise<Balance> {
  const response = await fetch(env.RPC_URL || DEFAULT_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [wallet, { mint: mint() }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
    }),
  });
  if (!response.ok) throw new Error(`rpc status ${response.status}`);
  const body = (await response.json()) as RpcResponse;
  if (body.error || !body.result || !Array.isArray(body.result.value)) throw new Error('rpc returned an error');
  const slot = body.result.context?.slot;
  if (typeof slot !== 'number') throw new Error('rpc returned no slot');

  let amount = 0n;
  let decimals = 0;
  for (const entry of body.result.value) {
    const parsed = entry.account?.data?.parsed?.info?.tokenAmount;
    if (typeof parsed?.amount !== 'string' || typeof parsed.decimals !== 'number') {
      throw new Error('rpc returned an unexpected account');
    }
    amount += BigInt(parsed.amount);
    decimals = parsed.decimals;
  }
  return { amount, decimals, display: formatAmount(amount, decimals), slot };
}

async function readTestBalance(env: Env, wallet: string): Promise<Balance> {
  const row = await env.DB.prepare('SELECT balance FROM test_balances WHERE wallet = ?')
    .bind(wallet).first<{ balance: string }>();
  let value = row?.balance;
  if (value === undefined) {
    value = String(TEST_DEFAULT_BALANCE);
    await env.DB.prepare('INSERT OR IGNORE INTO test_balances (wallet, balance) VALUES (?, ?)').bind(wallet, value).run();
  }
  return { amount: BigInt(value), decimals: 0, display: value, slot: Math.floor(Date.now() / 400) };
}

export async function readBalance(env: Env, wallet: string): Promise<Balance> {
  if (testMode()) return readTestBalance(env, wallet);
  try {
    const balance = await readFromRpc(env, wallet);
    await setSetting(env, 'rpc_last_ok', String(Date.now()));
    return balance;
  } catch (cause) {
    await setSetting(env, 'rpc_last_fail', String(Date.now()));
    console.log('rpc failure', cause instanceof Error ? cause.message : 'unknown');
    throw new HttpError(503, "Voting is paused: balances can't be read right now.", 'rpc-down');
  }
}
