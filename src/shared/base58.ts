const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const INDEX: Record<string, number> = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));

export function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += (digits[i] as number) * 256;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i] as number];
  return out;
}

export function base58Decode(text: string): Uint8Array<ArrayBuffer> | null {
  const bytes: number[] = [];
  for (const char of text) {
    const value = INDEX[char];
    if (value === undefined) return null;
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += (bytes[i] as number) * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of text) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}
