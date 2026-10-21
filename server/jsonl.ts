/// <reference types="node" />
import { open, stat } from "node:fs/promises";

const CHUNK_BYTES = 1 << 20;
const NEWLINE = 0x0a;

export interface ReadResult {
  offset: number;
  size: number;
  mtimeMs: number;
  restarted: boolean;
}

// Reads complete lines appended after `offset`. A trailing partial line stays
// unread so the next call picks it up once the writer finishes it. Lines that
// contain none of `needles` are skipped without decoding.
export async function readAppendedLines(
  path: string,
  offset: number,
  needles: readonly string[],
  onLine: (line: string) => void,
): Promise<ReadResult> {
  const info = await stat(path);
  const restarted = info.size < offset;
  let position = restarted ? 0 : offset;
  let consumed = position;
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let pending: Buffer[] = [];
    while (position < info.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(CHUNK_BYTES, info.size - position),
        position,
      );
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      let start = 0;
      let newline = chunk.indexOf(NEWLINE, start);
      while (newline !== -1) {
        const piece = chunk.subarray(start, newline);
        const line =
          pending.length > 0 ? Buffer.concat([...pending, piece]) : piece;
        pending = [];
        if (needles.some((needle) => line.includes(needle))) {
          onLine(line.toString("utf8"));
        }
        consumed = position + newline + 1;
        start = newline + 1;
        newline = chunk.indexOf(NEWLINE, start);
      }
      if (start < bytesRead) pending.push(Buffer.from(chunk.subarray(start)));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return {
    offset: consumed,
    size: info.size,
    mtimeMs: info.mtimeMs,
    restarted,
  };
}

export async function readFirstLine(
  path: string,
  maxBytes = 8 << 20,
): Promise<string | null> {
  const handle = await open(path, "r");
  try {
    const parts: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(64 << 10);
    let position = 0;
    while (position < maxBytes) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.length,
        position,
      );
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      const newline = chunk.indexOf(NEWLINE);
      if (newline !== -1) {
        parts.push(Buffer.from(chunk.subarray(0, newline)));
        return Buffer.concat(parts).toString("utf8");
      }
      parts.push(Buffer.from(chunk));
      position += bytesRead;
    }
    return parts.length > 0 ? Buffer.concat(parts).toString("utf8") : null;
  } finally {
    await handle.close();
  }
}
