import { base58Decode } from './base58';

// Runs in the Worker and in the browser's verify box, so anyone can check a vote themselves.
export async function verifySignature(wallet: string, message: string, signature: string): Promise<boolean> {
  const publicKey = base58Decode(wallet);
  const sig = base58Decode(signature);
  if (!publicKey || !sig || publicKey.length !== 32 || sig.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, new TextEncoder().encode(message));
  } catch {
    return false;
  }
}
