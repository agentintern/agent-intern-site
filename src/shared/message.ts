// The exact text a wallet signs. The browser and the Worker both build it from this one function,
// and the Worker verifies the signature against its own copy, so a message signed for another
// domain, wallet or action simply fails to verify.
export type SignedAction =
  | { action: 'sign-in' }
  | { action: 'propose'; round: number; text: string }
  | { action: 'vote'; round: number; proposal: number }
  | { action: 'rate'; shift: number; stars: number };

export const NOT_A_TRANSACTION = 'This is a plain message. It is not a transaction and it costs nothing.';

export function buildMessage(
  domain: string,
  wallet: string,
  signed: SignedAction,
  nonce: string,
  issuedAt: string,
): string {
  const lines = [`${domain} asks you to sign this message.`, '', `Action: ${signed.action}`, `Wallet: ${wallet}`];
  if (signed.action === 'propose') {
    lines.push(`Round: ${signed.round}`, `Task: ${signed.text}`);
  }
  if (signed.action === 'vote') {
    lines.push(`Round: ${signed.round}`, `Proposal: ${signed.proposal}`);
  }
  if (signed.action === 'rate') {
    lines.push(`Shift: ${signed.shift}`, `Stars: ${signed.stars}`);
  }
  lines.push(`Nonce: ${nonce}`, `Issued At: ${issuedAt}`, '', NOT_A_TRANSACTION);
  return lines.join('\n');
}
