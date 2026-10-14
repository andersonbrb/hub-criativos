import "server-only";

// ZIP sem compressão (vídeo e áudio já vêm comprimidos), montado em streaming: o download começa na hora
// e nada vai inteiro para a memória. Cada arquivo leva o CRC e o tamanho no "data descriptor" do fim.

export type ZipEntry = { name: string; open: () => Promise<ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>> };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(crc: number, buf: Uint8Array) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// Nomes repetidos ganham " (2)", " (3)"…
export function uniqueNames(names: string[]) {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const key = n.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 1) return n;
    const dot = n.lastIndexOf(".");
    return dot > 0 ? `${n.slice(0, dot)} (${count})${n.slice(dot)}` : `${n} (${count})`;
  });
}

export function zipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  const { time, date } = dosTime(new Date());
  const central: Uint8Array[] = [];
  let offset = 0;

  async function* generate() {
    for (const entry of entries) {
      const name = new TextEncoder().encode(entry.name);
      const start = offset;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0808, true); // bit 3: tamanhos no fim · bit 11: nome em UTF-8
      local.setUint16(8, 0, true); // sem compressão
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint16(26, name.length, true);
      yield new Uint8Array(local.buffer);
      yield name;
      offset += 30 + name.length;

      let crc = 0;
      let size = 0;
      for await (const chunk of (await entry.open()) as AsyncIterable<Uint8Array>) {
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        crc = crc32(crc, bytes);
        size += bytes.length;
        yield bytes;
      }
      offset += size;
      if (offset > 0xffffffff) throw new Error("O pacote passou de 4 GB; baixe em partes.");

      const desc = new DataView(new ArrayBuffer(16));
      desc.setUint32(0, 0x08074b50, true);
      desc.setUint32(4, crc, true);
      desc.setUint32(8, size, true);
      desc.setUint32(12, size, true);
      yield new Uint8Array(desc.buffer);
      offset += 16;

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0808, true);
      cd.setUint16(12, time, true);
      cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, size, true);
      cd.setUint32(24, size, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, start, true);
      central.push(new Uint8Array(cd.buffer), name);
    }

    const cdStart = offset;
    let cdSize = 0;
    for (const part of central) {
      cdSize += part.length;
      yield part;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, cdStart, true);
    yield new Uint8Array(end.buffer);
  }

  const it = generate();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await it.return(undefined);
    },
  });
}
