export interface ZipEntrySource {
  name: string;
  data: AsyncIterable<Uint8Array>;
}

const crcTable = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let byte = 0; byte < 256; byte++) {
    let value = byte;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[byte] = value;
  }
  return table;
}

export function updateCrc32(crc: number, chunk: Uint8Array): number {
  let value = crc;
  for (const byte of chunk) {
    value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }
  return value;
}

function dosDateTime(date: Date): { dosDate: number; dosTime: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
  };
}

class ByteWriter {
  private readonly bytes: Uint8Array;
  private position = 0;

  constructor(length: number) {
    this.bytes = new Uint8Array(length);
  }

  uint16(value: number): this {
    this.bytes[this.position++] = value & 0xff;
    this.bytes[this.position++] = (value >>> 8) & 0xff;
    return this;
  }

  uint32(value: number): this {
    return this.uint16(value & 0xffff).uint16(value >>> 16);
  }

  raw(chunk: Uint8Array): this {
    this.bytes.set(chunk, this.position);
    this.position += chunk.length;
    return this;
  }

  done(): Uint8Array {
    return this.bytes;
  }
}

// Streaming store-only zip (photos are already compressed). Sizes and CRCs are
// unknown until each entry is streamed, so headers use the data-descriptor flag.
// No zip64 support: archives must stay under 4 GB and 65k entries.
export async function* zipChunks(entries: AsyncIterable<ZipEntrySource>): AsyncGenerator<Uint8Array> {
  const { dosDate, dosTime } = dosDateTime(new Date());
  const centralRecords: Uint8Array[] = [];
  let offset = 0;

  for await (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const headerOffset = offset;
    const localHeader = new ByteWriter(30 + name.length)
      .uint32(0x04034b50)
      .uint16(20)
      .uint16(0x0808)
      .uint16(0)
      .uint16(dosTime)
      .uint16(dosDate)
      .uint32(0)
      .uint32(0)
      .uint32(0)
      .uint16(name.length)
      .uint16(0)
      .raw(name)
      .done();
    yield localHeader;
    offset += localHeader.length;

    let crc = 0xffffffff;
    let size = 0;
    for await (const chunk of entry.data) {
      if (!chunk.length) continue;
      crc = updateCrc32(crc, chunk);
      size += chunk.length;
      yield chunk;
      offset += chunk.length;
    }
    crc = (crc ^ 0xffffffff) >>> 0;

    const descriptor = new ByteWriter(16)
      .uint32(0x08074b50)
      .uint32(crc)
      .uint32(size)
      .uint32(size)
      .done();
    yield descriptor;
    offset += descriptor.length;

    centralRecords.push(new ByteWriter(46 + name.length)
      .uint32(0x02014b50)
      .uint16(20)
      .uint16(20)
      .uint16(0x0808)
      .uint16(0)
      .uint16(dosTime)
      .uint16(dosDate)
      .uint32(crc)
      .uint32(size)
      .uint32(size)
      .uint16(name.length)
      .uint16(0)
      .uint16(0)
      .uint16(0)
      .uint16(0)
      .uint32(0)
      .uint32(headerOffset)
      .raw(name)
      .done());
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const record of centralRecords) {
    yield record;
    centralSize += record.length;
  }
  yield new ByteWriter(22)
    .uint32(0x06054b50)
    .uint16(0)
    .uint16(0)
    .uint16(centralRecords.length)
    .uint16(centralRecords.length)
    .uint32(centralSize)
    .uint32(centralOffset)
    .uint16(0)
    .done();
}

export function zipStream(entries: AsyncIterable<ZipEntrySource>): ReadableStream<Uint8Array> {
  const chunks = zipChunks(entries);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await chunks.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}
