// One strict ZIP reader for everything this server accepts as an archive: a .paper.zip bundle and the source archive of a handoff.
// It reads the central directory and every entry IN MEMORY to prove the archive is what it says (sizes, CRC, layout); it never writes an entry to disk,
// never follows a name anywhere and runs nothing. Policy (which names, how large) is the caller's; the structure rules are here and the same for both.
import {inflateRawSync} from 'node:zlib';

const table = Uint32Array.from({length: 256}, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export const crc32 = bytes => { let n = 0xffffffff; for (const b of bytes) n = table[(n ^ b) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; };
function extras(bytes, check) {
  for (let p = 0; p < bytes.length;) {
    check(p + 4 <= bytes.length, 'malformed ZIP extra field'); const id = bytes.readUInt16LE(p), n = bytes.readUInt16LE(p + 2);
    check(id !== 1 && p + 4 + n <= bytes.length, 'ZIP64 or malformed extra field'); p += 4 + n;
  }
}
// policy: {check(ok, message) throws, maxArchive, maxEntries, maxTotal, isDirectory(name), nameOk(name), limit(name) -> bytes allowed for that file (or throws)}
// Returns a Map of file name to its bytes (directories are checked and dropped).
export function parseZip(bytes, policy) {
  const {check, maxArchive, maxEntries, maxTotal, isDirectory, nameOk, limit} = policy;
  check(bytes.length >= 22 && bytes.length <= maxArchive, `archive must fit within ${Math.round(maxArchive / 1048576)} MiB`);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) if (bytes.readUInt32LE(p) === 0x06054b50 && p + 22 + bytes.readUInt16LE(p + 20) === bytes.length) { end = p; break; }
  check(end >= 0, 'missing ZIP directory');
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  check(bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0 && bytes.readUInt16LE(end + 8) === count, 'multi-disk ZIP is unsupported');
  check(count > 0 && count <= maxEntries && start + size === end, 'invalid directory bounds or entry count');
  const entries = new Map(), names = new Set(); let p = start, next = 0, total = 0;
  for (let i = 0; i < count; i++) {
    check(p + 46 <= end && bytes.readUInt32LE(p) === 0x02014b50, 'malformed directory entry');
    const flags = bytes.readUInt16LE(p + 8), method = bytes.readUInt16LE(p + 10), crc = bytes.readUInt32LE(p + 16);
    const compressed = bytes.readUInt32LE(p + 20), expanded = bytes.readUInt32LE(p + 24), nl = bytes.readUInt16LE(p + 28), el = bytes.readUInt16LE(p + 30), cl = bytes.readUInt16LE(p + 32);
    const attr = bytes.readUInt32LE(p + 38), offset = bytes.readUInt32LE(p + 42), type = (attr >>> 16) & 0xf000;
    check(p + 46 + nl + el + cl <= end && nl > 0 && nl <= 180, 'invalid entry name bounds');
    const name = bytes.toString('utf8', p + 46, p + 46 + nl), directory = isDirectory(name);
    check(Buffer.from(name).equals(bytes.subarray(p + 46, p + 46 + nl)) && nameOk(name), 'invalid filename encoding');
    check(!names.has(name.toLowerCase()), 'duplicate filename'); names.add(name.toLowerCase());
    check(bytes.readUInt16LE(p + 34) === 0 && (!type || type === (directory ? 0x4000 : 0x8000)) && (!(attr & 16) || directory), 'symlink or special file entry');
    check([0, 8].includes(method) && !(flags & ~0x80e) && (method === 8 || !(flags & 6)), 'encrypted or unsupported ZIP entry');
    check(expanded <= (directory ? 0 : limit(name)) && (total += expanded) <= maxTotal, 'expanded file limit exceeded');
    extras(bytes.subarray(p + 46 + nl, p + 46 + nl + el), check);
    check(offset === next && offset + 30 <= start && bytes.readUInt32LE(offset) === 0x04034b50, 'overlapping, reordered or malformed local entry');
    const ln = bytes.readUInt16LE(offset + 26), le = bytes.readUInt16LE(offset + 28), data = offset + 30 + ln + le;
    check(data + compressed <= start && ln === nl && bytes.subarray(offset + 30, offset + 30 + ln).equals(bytes.subarray(p + 46, p + 46 + nl)), 'local entry name or bounds mismatch');
    check(bytes.readUInt16LE(offset + 6) === flags && bytes.readUInt16LE(offset + 8) === method, 'local entry method mismatch');
    extras(bytes.subarray(offset + 30 + ln, data), check);
    next = data + compressed;
    if (flags & 8) {
      if (next + 4 <= start && bytes.readUInt32LE(next) === 0x08074b50) next += 4;
      check(next + 12 <= start && bytes.readUInt32LE(next) === crc && bytes.readUInt32LE(next + 4) === compressed && bytes.readUInt32LE(next + 8) === expanded, 'bad data descriptor'); next += 12;
    } else check(bytes.readUInt32LE(offset + 14) === crc && bytes.readUInt32LE(offset + 18) === compressed && bytes.readUInt32LE(offset + 22) === expanded, 'local entry size or CRC mismatch');
    let body = bytes.subarray(data, data + compressed);
    if (method === 8) {
      const decoded = inflateRawSync(body, {maxOutputLength: Math.max(1, expanded), info: true});
      check(decoded.engine.bytesWritten === compressed, 'trailing deflate data'); body = decoded.buffer;
    }
    check(body.length === expanded && crc32(body) === crc, 'corrupt entry');
    if (!directory) entries.set(name, body);
    p += 46 + nl + el + cl;
  }
  check(p === end && next === start, 'missing files or unexplained ZIP data');
  return entries;
}
