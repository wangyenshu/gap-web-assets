importScripts("https://cdn.jsdelivr.net/npm/xterm-pty@0.9.4/workerTools.js");
importScripts("https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js");

const CHUNK_LIMIT = 64 * 1024 * 1024;

async function fetchDataBlob() {
  const res = await fetch("gap.data.zst");
  if (!res.ok) throw new Error(`gap.data.zst: ${res.status}`);

  const blobParts = [];
  let pending = [];
  let pendingBytes = 0;

  const flush = () => {
    if (!pending.length) return;
    blobParts.push(new Blob(pending));
    pending = [];
    pendingBytes = 0;
  };

  const dec = new fzstd.Decompress((chunk) => {
    pending.push(chunk);
    pendingBytes += chunk.byteLength;
    if (pendingBytes >= CHUNK_LIMIT) flush();
  });

  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    dec.push(value, false);
  }
  dec.push(new Uint8Array(0), true);
  flush();

  return new Blob(blobParts, { type: "application/octet-stream" });
}

onmessage = async (msg) => {
  try {
    const [blob, metadata] = await Promise.all([
      fetchDataBlob(),
      fetch("gap.data.js.metadata").then((r) => r.json()),
    ]);

    self.Module = self.Module || {};
    self.Module.preRun = [
      () => {
        FS.mkdir("/gap");
        FS.mount(WORKERFS, { packages: [{ metadata, blob }] }, "/gap");
      },
    ];

    importScripts("gap.js");
    emscriptenHack(new TtyClient(msg.data));
  } catch (e) {
    console.error(e.stack || e);
    throw e;
  }
};
