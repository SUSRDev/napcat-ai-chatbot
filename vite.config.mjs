/**
 * NapCat 热重载开发配置
 * 前置：NapCat 安装并启用 napcat-plugin-debug（默认 ws://127.0.0.1:8998）
 *
 *   pnpm install
 *   pnpm run push    # 首次部署 + 重载
 *   pnpm run dev     # watch 构建，保存即部署 + 热重载
 *
 * 远程 NapCat：SSH 隧道转发 8998，或设置 NAPCAT_DEBUG_WS / napcatHmrPlugin({ wsUrl })
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { defineConfig } from 'vite';
import { napcatHmrPlugin } from 'napcat-plugin-debug-cli/vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', '.update-tmp', '.update-backup',
  'scripts', '.cache', '.idea', '.vscode'
]);
const SKIP_FILES = new Set([
  'config.json', 'vite.config.mjs', 'release.py', '.release-local.json'
]);

function copyFiltered(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src, { withFileTypes: true })) {
    if (name.isDirectory()) {
      if (SKIP_DIRS.has(name.name)) continue;
      copyFiltered(resolve(src, name.name), resolve(dest, name.name));
      continue;
    }
    if (SKIP_FILES.has(name.name)) continue;
    if (name.name.endsWith('.zip') || name.name.endsWith('.log')) continue;
    fs.copyFileSync(resolve(src, name.name), resolve(dest, name.name));
  }
}

function napcatCopyPlugin() {
  return {
    name: 'napcat-copy-plugin',
    writeBundle() {
      const distDir = resolve(__dirname, 'dist');
      const staging = resolve(__dirname, '.hmr-staging');
      fs.rmSync(staging, { recursive: true, force: true });
      copyFiltered(__dirname, staging);
      fs.rmSync(distDir, { recursive: true, force: true });
      copyFiltered(staging, distDir);
      fs.rmSync(staging, { recursive: true, force: true });
      try { fs.unlinkSync(resolve(distDir, '.hmr-stub.mjs')); } catch (_) {}
      console.log('[napcat-copy] 已复制插件文件到 dist/');
    }
  };
}

const debugWs = process.env.NAPCAT_DEBUG_WS || 'ws://127.0.0.1:8998';
const debugToken = process.env.NAPCAT_DEBUG_TOKEN || '';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'scripts/hmr-stub.mjs'),
      formats: ['es'],
      fileName: () => '.hmr-stub.mjs'
    },
    rollupOptions: {
      output: { inlineDynamicImports: true }
    }
  },
  plugins: [
    napcatCopyPlugin(),
    napcatHmrPlugin({
      wsUrl: debugWs,
      token: debugToken || undefined,
      enabled: process.env.NAPCAT_HMR !== '0'
    })
  ]
});
