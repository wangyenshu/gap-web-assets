importScripts("https://cdn.jsdelivr.net/npm/xterm-pty@0.9.4/workerTools.js");
importScripts("https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js");

const MOUNT_POINT = "/gap";
const CHUNK_LIMIT = 64 * 1024 * 1024;

async function fetchDataBlob() {
  const res = await fetch("gap.data.zst");
  if (!res.ok) throw new Error(`gap.data.zst: HTTP ${res.status}`);

  const parts = [];
  let pending = [];
  let pendingBytes = 0;

  const flush = () => {
    if (pending.length) {
      parts.push(new Blob(pending));
      pending = [];
      pendingBytes = 0;
    }
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

  return new Blob(parts, { type: "application/octet-stream" });
}

async function fetchMetadata() {
  const res = await fetch("gap.data.js.metadata");
  if (!res.ok) throw new Error(`gap.data.js.metadata: HTTP ${res.status}`);
  return res.json();
}

function resolveGapRoot(metadata) {
  const init = (metadata.files || []).find((f) =>
    f.filename.endsWith("/lib/init.g")
  );
  if (!init) throw new Error("lib/init.g is not in the package");
  const mounted = MOUNT_POINT + "/" + init.filename.replace(/^\//, "");
  return mounted.slice(0, -"lib/init.g".length);
}

function patchEmscriptenInternals() {
  if (!self.asmLibraryArg) {
    if (!self.wasmImports) {
      throw new Error("no syscall import table (asmLibraryArg/wasmImports)");
    }
    self.asmLibraryArg = self.wasmImports;
  }

  if (self.SYSCALLS && typeof self.SYSCALLS.get !== "function") {
    if (typeof self.syscallGetVarargI === "function") {
      self.SYSCALLS.get = self.syscallGetVarargI;
    } else if (self.SYSCALLS.varargs !== undefined) {
      self.SYSCALLS.get = () => {
        const ret = self.HEAP32[self.SYSCALLS.varargs >> 2];
        self.SYSCALLS.varargs += 4;
        return ret;
      };
    } else {
      throw new Error("cannot reconstruct SYSCALLS.get for this Emscripten");
    }
  }
}

onmessage = async (msg) => {
  try {
    const [blob, metadata] = await Promise.all([
      fetchDataBlob(),
      fetchMetadata(),
    ]);

    if (
      metadata.remote_package_size !== undefined &&
      metadata.remote_package_size !== blob.size
    ) {
      throw new Error(
        `package size mismatch: ${blob.size} != ${metadata.remote_package_size}`
      );
    }

    const gaproot = resolveGapRoot(metadata);

    self.Module = self.Module || {};

    self.Module.arguments = ["-l", gaproot];

    self.Module.preRun = [
      () => {
        FS.mkdir(MOUNT_POINT);
        FS.mount(WORKERFS, { packages: [{ metadata, blob }] }, MOUNT_POINT);
      },
    ];

    importScripts("gap.js");

    patchEmscriptenInternals();

    emscriptenHack(new TtyClient(msg.data));
  } catch (e) {
    console.error("[gap]", e && e.stack ? e.stack : e);
    throw e;
  }
};
