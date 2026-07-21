import fs from 'node:fs';
import crypto from 'node:crypto';

export interface LineRecord {
  line: number;
  /** Byte offset AFTER this line, i.e. safe resume point. */
  endOffset: number;
  json: unknown;
  rawLength: number;
}

export function sha1(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}

/** Hash of the first 64KB — cheap way to notice a file was rewritten/rotated
 *  rather than appended to, which invalidates a stored byte offset. */
export function headHash(filePath: string): string | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(Math.min(65536, fs.fstatSync(fd).size));
      fs.readSync(fd, buf, 0, buf.length, 0);
      return sha1(buf.toString('utf8'));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * Read an append-only JSONL file starting at `startOffset`.
 *
 * A trailing partial line (writer mid-append) is NOT emitted and NOT counted
 * in the returned offset, so the next scan re-reads it once it is complete.
 * A single corrupt line yields onCorrupt() and is skipped — it never aborts.
 */
export function readJsonlFrom(
  filePath: string,
  startOffset: number,
  startLine: number,
  onRecord: (r: LineRecord) => void,
  onCorrupt: (line: number, err: string) => void,
  isCancelled?: () => boolean,
): { endOffset: number; endLine: number } {
  const stat = fs.statSync(filePath);
  if (startOffset > stat.size) startOffset = 0; // file truncated/rotated
  if (startOffset === stat.size) return { endOffset: startOffset, endLine: startLine };

  const fd = fs.openSync(filePath, 'r');
  let offset = startOffset;
  let lineNo = startLine;
  let carry = Buffer.alloc(0);
  const CHUNK = 1 << 20;

  try {
    const buf = Buffer.alloc(CHUNK);
    let readPos = startOffset;
    while (readPos < stat.size) {
      if (isCancelled?.()) break;
      const n = fs.readSync(fd, buf, 0, CHUNK, readPos);
      if (n <= 0) break;
      readPos += n;
      let data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      let idx: number;
      let consumed = 0;
      while ((idx = data.indexOf(0x0a, consumed)) !== -1) {
        const raw = data.subarray(consumed, idx);
        const byteLen = idx - consumed + 1;
        consumed = idx + 1;
        offset += byteLen;
        lineNo += 1;
        const text = raw.toString('utf8').trim();
        if (!text) continue;
        try {
          onRecord({ line: lineNo, endOffset: offset, json: JSON.parse(text), rawLength: text.length });
        } catch (e) {
          onCorrupt(lineNo, (e as Error).message);
        }
      }
      carry = Buffer.from(data.subarray(consumed));
    }
  } finally {
    fs.closeSync(fd);
  }
  return { endOffset: offset, endLine: lineNo };
}

/** Recursively collect files matching a predicate, with a depth cap. */
export function walk(
  dir: string,
  match: (name: string, full: string) => boolean,
  maxDepth = 8,
): string[] {
  const out: string[] = [];
  const stack: Array<{ d: string; depth: number }> = [{ d: dir, depth: 0 }];
  while (stack.length) {
    const { d, depth } = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue; // permission denied / removed mid-walk
    }
    for (const e of entries) {
      const full = `${d}/${e.name}`;
      if (e.isDirectory()) {
        if (depth < maxDepth) stack.push({ d: full, depth: depth + 1 });
      } else if (e.isFile() && match(e.name, full)) {
        out.push(full);
      }
    }
  }
  return out;
}
