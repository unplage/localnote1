#!/usr/bin/env node
// 零依赖仓库自检：
//   1. 抽取各 HTML 的内联脚本做语法校验
//   2. 校验 manifest.json
//   3. 校验 sw.js 的预缓存清单与磁盘文件一致
//   4. 校验 android/app/src/main/assets 与根目录同步
//
// 用法：node tools/check_syntax.mjs
// 退出码：0 = 全部通过，1 = 有失败项

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const pass = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const fail = (m, d) => {
    failures++;
    console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + String(d).split('\n').join('\n      ') : ''));
};

// ---------- 1. 内联脚本语法 ----------
function checkInlineScripts(relPath) {
    const abs = path.join(ROOT, relPath);
    if (!fs.existsSync(abs)) { fail(relPath + ' 不存在'); return; }
    const html = fs.readFileSync(abs, 'utf8');
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m, i = 0, count = 0;
    while ((m = re.exec(html)) !== null) {
        const code = m[1];
        if (!code.trim()) continue;
        i++; count++;
        const tmp = path.join(os.tmpdir(), `chk_${process.pid}_${i}.js`);
        fs.writeFileSync(tmp, code);
        try {
            execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
        } catch (e) {
            fail(`${relPath} 第 ${i} 个内联脚本语法错误`, e.stderr ? e.stderr.toString() : e.message);
        } finally {
            fs.unlinkSync(tmp);
        }
    }
    if (count) pass(`${relPath} · ${count} 个内联脚本语法正确`);
    else fail(relPath + ' 中未找到内联脚本');
}

console.log('\n[1/4] 内联脚本语法');
['index.html', 'clear.html', 'tools/selftest.html'].forEach(checkInlineScripts);

// sw.js 本身
try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, 'sw.js')], { stdio: 'pipe' });
    pass('sw.js 语法正确');
} catch (e) {
    fail('sw.js 语法错误', e.stderr ? e.stderr.toString() : e.message);
}

// ---------- 2. manifest.json ----------
console.log('\n[2/4] manifest.json');
try {
    const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const required = ['name', 'short_name', 'start_url', 'scope', 'display', 'icons'];
    const missing = required.filter(k => !mf[k]);
    if (missing.length) fail('缺少必需字段: ' + missing.join(', '));
    else pass('必需字段齐全');
    if (!Array.isArray(mf.icons) || mf.icons.length === 0) fail('icons 为空');
    else {
        const badIcons = mf.icons.filter(ic => !fs.existsSync(path.join(ROOT, ic.src)));
        if (badIcons.length) fail('icons 指向不存在的文件: ' + badIcons.map(i => i.src).join(', '));
        else pass(`${mf.icons.length} 个图标文件均存在`);
    }
    const sizes = mf.icons.map(i => i.sizes);
    if (!sizes.includes('192x192') || !sizes.includes('512x512')) fail('缺少 192/512 尺寸图标');
    else pass('包含 192 与 512 尺寸图标');
} catch (e) {
    fail('manifest.json 解析失败', e.message);
}

// ---------- 3. SW 预缓存清单 vs 磁盘 ----------
console.log('\n[3/4] Service Worker 预缓存清单');
try {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const block = sw.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
    if (!block) fail('未找到 PRECACHE_URLS');
    else {
        const rels = [...block[1].matchAll(/`\$\{BASE_PATH\}([^`]+)`/g)].map(m => m[1]);
        if (!rels.length) fail('PRECACHE_URLS 解析为空');
        const missing = rels.filter(r => !fs.existsSync(path.join(ROOT, r)));
        if (missing.length) fail('清单中不存在的文件:\n      ' + missing.join('\n      '));
        else pass(`${rels.length} 个预缓存文件均存在`);

        // 反向检查：关键目录下的资源是否都在清单里
        const onDisk = [];
        for (const dir of ['icons', 'webfonts']) {
            const d = path.join(ROOT, dir);
            if (!fs.existsSync(d)) continue;
            for (const f of fs.readdirSync(d)) onDisk.push(dir + '/' + f);
        }
        const woff2 = onDisk.filter(f => f.endsWith('.woff2'));
        const notCached = woff2.filter(f => !rels.includes(f));
        if (notCached.length) fail('以下 woff2 字体未进入预缓存（离线会缺字）:\n      ' + notCached.join('\n      '));
        else pass(`${woff2.length} 个 woff2 字体均已预缓存`);
    }
    const ver = sw.match(/const CACHE_VERSION = (\d+);/);
    if (ver) pass('CACHE_VERSION = ' + ver[1]);
} catch (e) {
    fail('SW 检查异常', e.message);
}

// ---------- 4. Android assets 同步 ----------
console.log('\n[4/4] Android assets 同步');
const assetDir = path.join(ROOT, 'android/app/src/main/assets');
if (!fs.existsSync(assetDir)) {
    console.log('  \x1b[33m-\x1b[0m 未找到 android/app/src/main/assets，跳过');
} else {
    const pairs = ['index.html', 'sw.js', 'manifest.json', 'clear.html', 'fontawesome.min.css'];
    let diff = 0;
    for (const f of pairs) {
        const a = path.join(ROOT, f);
        const b = path.join(assetDir, f);
        if (!fs.existsSync(a) || !fs.existsSync(b)) { fail(`${f} 缺失（根目录或 assets）`); diff++; continue; }
        if (!fs.readFileSync(a).equals(fs.readFileSync(b))) {
            fail(`${f} 与 android assets 不一致，请执行复制同步`);
            diff++;
        }
    }
    if (!diff) pass(`${pairs.length} 个文件与 android assets 一致`);
}

console.log('');
if (failures) {
    console.log(`\x1b[31m❌ ${failures} 项检查失败\x1b[0m\n`);
    process.exit(1);
} else {
    console.log('\x1b[32m✅ 全部检查通过\x1b[0m\n');
}
