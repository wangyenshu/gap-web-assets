importScripts("https://cdn.jsdelivr.net/npm/xterm-pty@0.9.4/workerTools.js");

const MOUNT_POINT = "/gap";

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

function gapRoot(metadata) {
  const init = metadata.files.find((f) => f.filename.endsWith("/lib/init.g"));
  if (!init) throw new Error("lib/init.g is not in the package");
  const mounted = MOUNT_POINT + "/" + init.filename.replace(/^\//, "");
  return mounted.slice(0, -"lib/init.g".length);
}

function patchEmscriptenInternals() {
  self.asmLibraryArg ||= self.wasmImports;

  if (typeof self.SYSCALLS.get !== "function") {
    self.SYSCALLS.get =
      self.syscallGetVarargI ??
      (() => {
        const ret = self.HEAP32[self.SYSCALLS.varargs >> 2];
        self.SYSCALLS.varargs += 4;
        return ret;
      });
  }
}

onmessage = async (msg) => {
  try {
    const [data, meta] = await Promise.all([
      get("gap.data.gz"),
      get("gap.data.js.metadata"),
    ]);

    const metadata = await meta.json();
    const blob = await new Response(
      data.body.pipeThrough(new DecompressionStream("gzip"))
    ).blob();

    self.Module = {
      arguments: ["-l", gapRoot(metadata)],
      preRun: [
        () => {
          FS.mkdir(MOUNT_POINT);
          FS.mount(WORKERFS, { packages: [{ metadata, blob }] }, MOUNT_POINT);
        },
      ],
    };

    importScripts("gap.js");

    patchEmscriptenInternals();

    emscriptenHack(new TtyClient(msg.data));
  } catch (e) {
    console.error("[gap]", e.stack || e);
    throw e;
  }
};
