import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

// 1) lockfile + 精确版本 + 安装版本
const locks = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'npm-shrinkwrap.json'];
if (!locks.some((f) => existsSync(f))) {
  throw new Error('缺少 lockfile；请先锁定依赖（npm/pnpm/yarn/bun 任一）');
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const declared = pkg.dependencies?.three ?? pkg.devDependencies?.three;
if (!declared || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(declared)) {
  throw new Error('three 版本必须写成精确版本号（如 0.161.0），不得用 ^ / ~ / latest；请填写后重试');
}
let installed;
try {
  installed = JSON.parse(readFileSync('node_modules/three/package.json', 'utf8')).version;
} catch {
  throw new Error('node_modules/three 不存在；请先安装锁定版本');
}
if (installed !== declared) {
  throw new Error(`three 安装版本 ${installed} 与 package.json 的 ${declared} 不一致；请重新安装`);
}

// 2) 当前版本是否包含模板用到的全部 addon
const required = [
  'three/addons/controls/OrbitControls.js',
  'three/addons/geometries/RoundedBoxGeometry.js',
  'three/addons/environments/RoomEnvironment.js',
  'three/addons/utils/BufferGeometryUtils.js',
  'three/addons/postprocessing/EffectComposer.js',
  'three/addons/postprocessing/RenderPass.js',
  'three/addons/postprocessing/ShaderPass.js',
  'three/addons/postprocessing/UnrealBloomPass.js',
  'three/addons/postprocessing/SMAAPass.js',
  'three/addons/postprocessing/OutputPass.js',
  'three/addons/postprocessing/OutlinePass.js',
  'three/addons/shaders/FXAAShader.js',
];
for (const m of required) {
  try { require.resolve(m); }
  catch { throw new Error(`无法解析 ${m}；若 node_modules/three/examples/jsm 下存在该文件，检查该版本 package.json 是否提供 exports["./addons/*"]，否则请升级或改用等价 API`); }
}

// 3) 打包库体（永不进入模型输出）
const vendor = await esbuild.build({
  entryPoints: ['src/vendor.js'],
  bundle: true, minify: true, format: 'iife', target: ['es2020'],
  write: false, logLevel: 'warning',
});
const vendorJs = vendor.outputFiles[0].text;
const css = readFileSync('src/style.css', 'utf8');
let app = readFileSync('src/app.js', 'utf8');

// 3.5) 内联天体贴图（NASA 公有领域；运行时不发外部请求）
for (const [file, ph] of [['assets/earth.jpg', '__EARTH_TEX_B64__'], ['assets/moon.jpg', '__MOON_TEX_B64__']]) {
  if (!existsSync(file)) throw new Error(`缺少贴图 ${file}`);
  if (!app.includes(ph)) throw new Error(`app.js 缺少贴图占位符 ${ph}`);
  app = app.replace(ph, 'data:image/jpeg;base64,' + readFileSync(file).toString('base64'));
}

// 4) 内联前转义闭合标签，避免提前截断
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
const escCss = (s) => s.replace(/<\/style/gi, '<\\/style');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stanford Torus</title>
<style>${escCss(css)}</style></head><body>
<script>
/* 加载期错误兜底：单文件交付没有构建服务，出错时把原因直接显示在页面上，不用开 DevTools */
addEventListener('error', function (e) {
  var d = document.createElement('pre');
  d.style.cssText = 'position:fixed;left:0;top:0;right:0;z-index:99999;margin:0;padding:10px 12px;background:#3a0d12;color:#ffb4b4;font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;border-bottom:1px solid #a33';
  d.textContent = '[加载错误] ' + (e.message || e.error) + '\n' + (e.filename || '') + ':' + (e.lineno || '');
  document.body.appendChild(d);
}, true);
</script>
<script>${esc(vendorJs)}</script>
<script>${esc(app)}</script>
</body></html>`;

// 5) 产物自检：不得残留模块语法 / 外部请求
if (/\bimport\s/.test(html) || /\bimport\s*\(/.test(html)) {
  throw new Error('产物内残留 import，构建失败');
}
if (/(?:src|href)\s*=\s*["']https?:/i.test(html)) {
  throw new Error('产物含外部脚本/链接，构建失败');
}
if (/@import/i.test(css) || /url\(\s*['"]?https?:/i.test(css)) {
  throw new Error('CSS 含外部 import/url，构建失败');
}

writeFileSync('index.html', html);
console.log('index.html', (statSync('index.html').size / 1024).toFixed(0), 'KB',
            '| vendored', (vendorJs.length / 1024).toFixed(0), 'KB');
