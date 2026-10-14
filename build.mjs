/**
 * 把控制台打包成单个自包含的 HTML 文件：public/console.html
 *
 * 做法：以 public/index.html 为模板，把 app.css 与整个 js/ 模块图
 * （用 esbuild 打成 IIFE，正确处理 app.js ↔ pages 之间的循环引用）
 * 内联进去。产物不含任何外部 js / css 引用。
 *
 * 用法：
 *   node build.mjs          构建一次
 *   node build.mjs --watch  改动源码时自动重建
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const OUTPUT = path.join(PUBLIC_DIR, 'console.html');

const TEMPLATE = path.join(PUBLIC_DIR, 'index.html');
const ENTRY = path.join(PUBLIC_DIR, 'js', 'app.js');
const STYLESHEET = path.join(PUBLIC_DIR, 'css', 'app.css');

/** 单文件版依赖的所有源文件，用于判断是否需要重建 */
function sourceFiles() {
  const files = [TEMPLATE, STYLESHEET];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(path.join(PUBLIC_DIR, 'js'));
  return files;
}

export function isStale() {
  if (!fs.existsSync(OUTPUT)) return true;
  const built = fs.statSync(OUTPUT).mtimeMs;
  return sourceFiles().some((f) => fs.statSync(f).mtimeMs > built);
}

export async function buildConsole({ quiet = false } = {}) {
  const esbuild = await import('esbuild');

  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    platform: 'browser',
    write: false,
    legalComments: 'none',
    charset: 'utf8',
    // 不压缩：本地工具，保持可读，出问题时你还能直接看源码
    minify: false,
  });

  const bundle = result.outputFiles[0].text;
  const css = fs.readFileSync(STYLESHEET, 'utf8');
  let html = fs.readFileSync(TEMPLATE, 'utf8');

  // 内联样式表
  html = html.replace(
    /<link rel="stylesheet" href="\/css\/app\.css" \/>/,
    `<style>\n${css}\n</style>`,
  );

  // 由顶栏那个标识直接生成 favicon，保证两处永远是同一个图形
  const logo = html.match(/<svg[^>]*id="qlink-logo"[^>]*>([\s\S]*?)<\/svg>/);
  if (!logo) throw new Error('找不到 Q-Link 标识，无法生成 favicon');
  const faviconSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<defs><linearGradient id="qlGrad" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#3FC7FF"/><stop offset="1" stop-color="#0084E8"/>' +
    '</linearGradient></defs>' +
    logo[1] +
    '</svg>';
  html = html.replace(
    '<!--FAVICON-->',
    `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(faviconSvg)}" />`,
  );

  // 内联脚本（打成 IIFE，不再需要 type="module"）
  html = html.replace(
    /<script type="module" src="\/js\/app\.js"><\/script>/,
    `<script>\n${bundle}\n</script>`,
  );

  // 注意：esbuild 会在产物里插入 `// public/js/app.js` 之类的来源注释，
  // 所以这里必须匹配真正的标签，而不是裸字符串。
  if (/<script[^>]+src="\/js\//.test(html) || /<link[^>]+href="\/css\//.test(html)) {
    throw new Error('内联失败：模板里仍有未替换的外部引用，请检查 index.html 的写法');
  }

  html = html.replace(
    '<title>Q-Link · QQ 机器人控制台</title>',
    '<title>Q-Link · QQ 机器人控制台</title>\n<!-- 由 build.mjs 生成的自包含单文件版本，源码见 public/index.html、public/css、public/js -->',
  );

  fs.writeFileSync(OUTPUT, html, 'utf8');
  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
  if (!quiet) {
    console.log(`已生成 ${path.relative(ROOT, OUTPUT)}（自包含单文件，${kb} KB）`);
  }
  return { output: OUTPUT, bytes: Buffer.byteLength(html, 'utf8') };
}

/* 直接执行时才跑构建 */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--watch')) {
    await buildConsole();
    console.log('监听源码改动中…（Ctrl+C 退出）');
    let timer = null;
    for (const dir of [path.join(PUBLIC_DIR, 'js'), path.join(PUBLIC_DIR, 'css'), PUBLIC_DIR]) {
      fs.watch(dir, { recursive: false }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          buildConsole().catch((err) => console.error('重建失败：', err.message));
        }, 120);
      });
    }
  } else {
    await buildConsole();
  }
}
