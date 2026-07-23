import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const zipModuleUrl = pathToFileURL(resolve("base44/functions/participant-photos/zip.ts")).href;

interface ZipModule {
  updateCrc32(crc: number, chunk: Uint8Array): number;
  zipChunks(entries: AsyncIterable<{ name: string; data: AsyncIterable<Uint8Array> }>): AsyncGenerator<Uint8Array>;
}

async function* singleChunk(text: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(text);
}

async function* entriesOf(entries: Array<{ name: string; text: string }>) {
  for (const { name, text } of entries) {
    yield { name, data: singleChunk(text) };
  }
}

async function collect(chunks: AsyncGenerator<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

test("computes the standard CRC-32 checksum", async () => {
  const { updateCrc32 } = await import(zipModuleUrl) as ZipModule;
  const crc = (updateCrc32(0xffffffff, new TextEncoder().encode("hello")) ^ 0xffffffff) >>> 0;
  assert.equal(crc, 0x3610a686);
});

test("produces a well-formed store-only archive with data descriptors", async () => {
  const { zipChunks } = await import(zipModuleUrl) as ZipModule;
  const bytes = await collect(zipChunks(entriesOf([
    { name: "one.jpg", text: "first-photo" },
    { name: "two.jpg", text: "second-photo" },
  ])));

  assert.equal(readUint32(bytes, 0), 0x04034b50);
  const endOffset = bytes.length - 22;
  assert.equal(readUint32(bytes, endOffset), 0x06054b50);
  const entryCount = bytes[endOffset + 10]!;
  assert.equal(entryCount, 2);
  const centralSize = readUint32(bytes, endOffset + 12);
  const centralOffset = readUint32(bytes, endOffset + 16);
  assert.equal(centralOffset + centralSize, endOffset);
  assert.equal(readUint32(bytes, centralOffset), 0x02014b50);
  const firstEntrySize = readUint32(bytes, centralOffset + 24);
  assert.equal(firstEntrySize, "first-photo".length);
});
