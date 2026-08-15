import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
mkdirSync(path.resolve(root, "public"), { recursive: true });
copyFileSync(
  path.resolve(root, "node_modules/@foxglove/wasm-bz2/wasm/module.wasm"),
  path.resolve(root, "public/bz2.wasm"),
);

const alias = {
  "@foxglove/wasm-bz2": path.resolve(root, "src/radar/vendor/wasm-bz2.js"),
  "node:zlib": path.resolve(root, "src/radar/vendor/zlib-browser.js"),
  [path.resolve(root, "node_modules/nexrad-level-2-data/src/decompress.mjs")]:
    path.resolve(root, "src/radar/vendor/l2-decompress.js"),
};

const passthroughDecompress = path.resolve(root, "src/radar/vendor/l2-decompress.js");

function rewriteL2Decompress() {
  return {
    name: "rewrite-l2-decompress",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0].replace(/\\/g, "/");
      if (file.endsWith("nexrad-level-2-data/src/decompress.mjs")) {
        return `export { default } from ${JSON.stringify(passthroughDecompress)};\n`;
      }
      return null;
    },
  };
}

const pagesBase = process.env.GITHUB_ACTIONS ? "/flight-wx/" : "/";

export default defineConfig({
  root: ".",
  base: pagesBase,
  publicDir: "public",
  plugins: [rewriteL2Decompress()],
  resolve: { alias },
  assetsInclude: ["**/*.wasm"],
  build: {
    outDir: "dist",
    sourcemap: true,
    emptyOutDir: true,
    target: "es2022",
  },
  esbuild: {
    target: "es2022",
  },
  optimizeDeps: {
    exclude: ["nexrad-level-2-data", "@foxglove/wasm-bz2"],
    esbuildOptions: { target: "es2022" },
  },
  worker: {
    format: "es",
    plugins: () => [rewriteL2Decompress()],
    resolve: { alias },
  },
  server: {
    port: 8000,
    host: "0.0.0.0",
  },
  preview: {
    port: 8000,
    host: "0.0.0.0",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
    testTimeout: 20000,
  },
});
