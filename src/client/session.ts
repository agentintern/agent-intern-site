import { buildMessage, type SignedAction } from '../shared/message';
import { post } from './dom';
import { testWallet, walletOptions, type Signer } from './wallet';

export const domain = location.host;
export const testMode = (): boolean => document.body.dataset.testMode === '1';

export async function signedBody(signer: Signer, signed: SignedAction): Promise<{ wallet: string; nonce: string; signature: string }> {
  const { nonce, issuedAt } = await post<{ nonce: string; issuedAt: string }>('/api/auth/nonce', { wallet: signer.address });
  return { wallet: signer.address, nonce, signature: await signer.sign(buildMessage(domain, signer.address, signed, nonce, issuedAt)) };
}

export async function anySigner(): Promise<Signer> {
  const [option] = walletOptions();
  if (option) return option.connect();
  if (testMode()) return testWallet();
  throw new Error('No Solana wallet found in this browser.');
}
