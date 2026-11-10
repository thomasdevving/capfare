/**
 * Packs extension/build into a zip for "Load unpacked" (no zip tool needed: deflate + CRC-32
 * from node:zlib). Used by the hosted demo so visitors can download a ready build:
 *   tsx scripts/zip.ts ../web/public/capfare-extension.zip
 */
import { crc32, deflateRawSync } from "node:zlib";
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "build");
const out = resolve(process.argv[2] ?? join(root, "capfare-extension.zip"));
const top = "capfare-extension/";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const local: Buffer[] = [];
const central: Buffer[] = [];
let offset = 0;
// DOS date/time of 2026-01-01 00:00 for reproducible archives.
const dosTime = 0, dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
for (const f of files(src).sort()) {
  const name = Buffer.from(top + relative(src, f).split("\\").join("/"));
  const data = readFileSync(f);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
  h.writeUInt16LE(dosTime, 10); h.writeUInt16LE(dosDate, 12); h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
  local.push(h, name, packed);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
  c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20);
  c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += h.length + name.length + packed.length;
}
const cd = Buffer.concat(central);
const n = central.length / 2;
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10);
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([...local, cd, end]));
console.log(`zipped ${n} files -> ${out}`);
