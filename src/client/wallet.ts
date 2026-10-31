import { base58Encode } from '../shared/base58';

// Connecting a wallet does one thing: asks it to sign a plain message. This file holds no other
// wallet call, and a repo check fails if any transaction method ever appears here.
export interface Signer {
  name: string;
  icon?: string;
  address: string;
  sign(message: string): Promise<string>;
}

export interface WalletOption {
  name: string;
  icon?: string;
  connect(): Promise<Signer>;
}

interface StandardAccount {
  address: string;
}

interface StandardWallet {
  name: string;
  icon?: string;
  accounts: readonly StandardAccount[];
  features: {
    'standard:connect'?: { connect(): Promise<{ accounts: readonly StandardAccount[] }> };
    'solana:signMessage'?: {
      signMessage(input: { account: StandardAccount; message: Uint8Array }): Promise<readonly { signature: Uint8Array }[]>;
    };
  };
}

interface LegacyProvider {
  publicKey?: { toString(): string } | null;
  connect(): Promise<{ publicKey?: { toString(): string } } | void>;
  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array } | Uint8Array>;
}

const standardWallets = new Map<string, StandardWallet>();

function addStandard(wallet: StandardWallet): void {
  if (wallet.features['solana:signMessage'] && wallet.features['standard:connect']) {
    standardWallets.set(wallet.name, wallet);
  }
}

// The Wallet Standard handshake, both directions, without a library.
export function listenForWallets(onChange: () => void): void {
  const api = {
    register: (...wallets: StandardWallet[]) => {
      wallets.forEach(addStandard);
      onChange();
      return () => {};
    },
  };
  window.addEventListener('wallet-standard:register-wallet', (event) => {
    (event as CustomEvent<(a: typeof api) => void>).detail(api);
  });
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
}

function fromStandard(wallet: StandardWallet): WalletOption {
  return {
    name: wallet.name,
    ...(wallet.icon ? { icon: wallet.icon } : {}),
    async connect() {
      const connected = await wallet.features['standard:connect']?.connect();
      const account = connected?.accounts[0] ?? wallet.accounts[0];
      if (!account) throw new Error('The wallet shared no account.');
      return {
        name: wallet.name,
        address: account.address,
        async sign(message) {
          const feature = wallet.features['solana:signMessage'];
          if (!feature) throw new Error('This wallet cannot sign messages.');
          const [result] = await feature.signMessage({ account, message: new TextEncoder().encode(message) });
          if (!result) throw new Error('The wallet returned no signature.');
          return base58Encode(result.signature);
        },
      };
    },
  };
}

function fromLegacy(name: string, provider: LegacyProvider): WalletOption {
  return {
    name,
    async connect() {
      const connected = await provider.connect();
      const key = (connected && connected.publicKey) ?? provider.publicKey;
      if (!key) throw new Error('The wallet shared no account.');
      return {
        name,
        address: key.toString(),
        async sign(message) {
          const result = await provider.signMessage(new TextEncoder().encode(message));
          return base58Encode('signature' in result ? result.signature : result);
        },
      };
    },
  };
}

export function walletOptions(): WalletOption[] {
  const options = [...standardWallets.values()].map(fromStandard);
  const seen = new Set(options.map((o) => o.name.toLowerCase()));
  const legacy = window as unknown as Record<string, unknown>;
  const candidates: [string, unknown][] = [
    ['Phantom', (legacy.phantom as { solana?: unknown } | undefined)?.solana],
    ['Solflare', legacy.solflare],
    ['Backpack', (legacy.backpack as { solana?: unknown } | undefined)?.solana ?? legacy.backpack],
    ['Wallet', legacy.solana],
  ];
  for (const [name, provider] of candidates) {
    if (!provider || typeof (provider as LegacyProvider).signMessage !== 'function') continue;
    if (seen.has(name.toLowerCase())) continue;
    if (name === 'Wallet' && options.length > 0) continue;
    options.push(fromLegacy(name, provider as LegacyProvider));
    seen.add(name.toLowerCase());
  }
  return options;
}

// TEST MODE only: a throwaway key made in this tab, so anyone can try the full flow.
export async function testWallet(): Promise<Signer> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  return {
    name: 'Test wallet',
    address: base58Encode(raw),
    async sign(message) {
      const signature = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(message));
      return base58Encode(new Uint8Array(signature));
    },
  };
}
