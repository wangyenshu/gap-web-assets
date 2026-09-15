importScripts("https://cdn.jsdelivr.net/npm/xterm-pty@0.9.4/workerTools.js");
importScripts("https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js");

onmessage = async (msg) => {
  self.Module = self.Module || {};

  const response = await fetch("gap.data.zst");
  if (!response.ok) {
    throw new Error(`Failed to load gap.data.zst: ${response.status}`);
  }

  const compressed = new Uint8Array(await response.arrayBuffer());
  const decompressed = fzstd.decompress(compressed);

  const data = decompressed.buffer.slice(
    decompressed.byteOffset,
    decompressed.byteOffset + decompressed.byteLength
  );

  self.Module.getPreloadedPackage = () => data;

  importScripts("gap.data.js");
  importScripts("gap.js");

  emscriptenHack(new TtyClient(msg.data));
};