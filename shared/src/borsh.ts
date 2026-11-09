/** Minimal Borsh writer covering the types CapFare signs (see contracts/core/src/encoding.rs). */
export class BorshWriter {
  private parts: number[] = [];

  u8(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`u8 out of range: ${v}`);
    this.parts.push(v);
    return this;
  }

  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }

  u32(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error(`u32 out of range: ${v}`);
    for (let i = 0; i < 4; i++) this.parts.push((v >>> (8 * i)) & 0xff);
    return this;
  }

  u64(v: number | bigint): this {
    let b = BigInt(v);
    if (b < 0n || b >= 1n << 64n) throw new Error(`u64 out of range: ${v}`);
    for (let i = 0; i < 8; i++) {
      this.parts.push(Number(b & 0xffn));
      b >>= 8n;
    }
    return this;
  }

  string(s: string): this {
    const bytes = new TextEncoder().encode(s);
    this.u32(bytes.length);
    for (const x of bytes) this.parts.push(x);
    return this;
  }

  fixed(bytes: Uint8Array, len: number): this {
    if (bytes.length !== len) throw new Error(`expected ${len} bytes, got ${bytes.length}`);
    for (const x of bytes) this.parts.push(x);
    return this;
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) throw new Error("invalid hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
