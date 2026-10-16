#!/usr/bin/env node
/* Sign 多语言生成器（内联语言对象结构）。
 *
 * ── 家族三种 i18n 形状，各有生成器 ──
 *   PDF    嵌套，每语言一个对象      `DICTS = { en, zh, … }`
 *   CAD    扁平，每语言一个 Record   `const en: Dict = { k: "v" }`
 *   Sign   每个键内联所有语言        `{ "k": { en, zh, … } }`
 * 结构不同 → 生成器分开（共享同一份术语表与同样的两道硬校验）。
 * 塞进一个生成器会让三者都变复杂。
 *
 * ── 输出到哪里 ──
 * Sign 把所有译文内联在 src/i18n.ts 里，所以本脚本生成**整个文件**
 * （en/zh 原样保留 + 新增 6 门），而不是生成旁挂文件。
 *
 * ── 两道硬校验 ──
 * ① 缺键即拒绝生成 —— 不产出「界面一半英文」的包
 * ② 占位符逐字对齐 —— 丢了 {n} 界面上会直接露出来
 *
 * 用法：node scripts/gen-i18n.mjs    （--lang 仅接受 LANGS 里的语言 —— 2026-10-13 收敛后为空）
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.ROCKTIER_ROOT || join(HERE, "..", "..", "..", "..");
const GLOSSARY = join(REPO, "docs", "rocktier", "i18n", "glossary.json");
const SRC = join(HERE, "..", "src", "i18n.ts");
/* 2026-10-13 家族裁定：语言收敛为 en/zh 两门 —— 非中英语种均为未审校机翻基线
   （family.json globalRules.$locales_2026_10_13）。生成器不再产出 6 门译文：
   留着 LANGS 等于留一条复活路径，谁跑一次本脚本，删掉的字典键全部回来。
   scripts/i18n/<lang>.mjs 译文物保留作历史档案，不进构建。 */
const LANGS = [];

const args = process.argv.slice(2);
const only = args.includes("--lang") ? args[args.indexOf("--lang") + 1] : null;

/* --lang 只接受 LANGS 里的语言 —— LANGS 是唯一真源（2026-10-13 收敛裁定后为空）。
   en/zh 由基线数据恒产，不需要指定；基线外语言要重建必须先入 LANGS 并通过审校，
   不能用 --lang 绕过。没有这道守卫时，`--lang ja` 会去读 scripts/i18n/ja.mjs
   归档并罗列「缺 N 条译文、补齐后重跑」—— 那段话等于邀请把已删的机翻基线请回来。 */
if (only && !LANGS.includes(only)) {
  console.error(`  ❌ --lang "${only}"：不在 LANGS（当前为空 —— 2026-10-13 语言收敛裁定）。`);
  console.error(`     en/zh 无需指定；基线外语言须先入 LANGS 并通过审校。`);
  process.exit(2);
}

if (!existsSync(GLOSSARY)) {
  console.error(`  ❌ 找不到家族术语表: ${GLOSSARY}\n     设 ROCKTIER_ROOT 指向家族根`);
  process.exit(2);
}
const G = JSON.parse(readFileSync(GLOSSARY, "utf8"));
const approved = new Map();
for (const [, loc] of Object.entries(G.terms)) {
  const en = loc.en?.value;
  if (!en) continue;
  const pack = {};
  for (const l of LANGS) if (loc[l]?.value) pack[l] = loc[l].value;
  if (Object.keys(pack).length) approved.set(en, pack);
}
console.error(`  术语表: ${approved.size} 条英文有家族批准译法`);

/* 抽出现有文件的 en / zh —— 原样保留，不重新翻译。 */
const src = readFileSync(SRC, "utf8");
const EXISTING = new Map();
{
  const re = /"([^"]+)":\s*\{\s*en:\s*(["'`])((?:\\.|(?!\2)[\s\S])*?)\2\s*,\s*zh:\s*(["'`])((?:\\.|(?!\4)[\s\S])*?)\4\s*,?/g;
  let m;
  while ((m = re.exec(src))) EXISTING.set(m[1], { en: m[3], zh: m[5] });
}
if (!EXISTING.size) {
  console.error("  ❌ 没从 src/i18n.ts 抽到任何 `{ en: …, zh: … }` —— 生成器与源码脱节");
  process.exit(2);
}
console.error(`  src/i18n.ts: ${EXISTING.size} 个键（en/zh 原样保留）`);

let missingTotal = 0;
let built = null;

for (const lang of only ? [only] : LANGS) {
  let ctx = {};
  try {
    ctx = (await import(`./i18n/${lang}.mjs`)).default || {};
  } catch (e) {
    /* 不要静默吞掉：第一次写这个脚本时，空 catch 把「译文表有语法错误」
       伪装成了「缺 58 条译文」，我据此以为是自己漏写，一直找错方向。
       区分「文件不存在」（还没写，正常）与「文件存在但坏了」（必须报）。 */
    if (e && e.code === "ERR_MODULE_NOT_FOUND") {
      console.error(`     (scripts/i18n/${lang}.mjs 尚未创建)`);
    } else {
      console.error(`  ❌ scripts/i18n/${lang}.mjs 存在但无法导入: ${e.message.split("\n")[0]}`);
      missingTotal += 1;
      continue;
    }
  }

  const merged = new Map();
  const missing = [];
  for (const [k, { en, zh }] of EXISTING) {
    const term = approved.get(en)?.[lang];
    const v = term ?? (typeof ctx[k] === "string" ? ctx[k] : null);
    if (v === null) { missing.push(`${k} = ${en.slice(0, 44)}`); continue; }
    const want = [...en.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(",");
    const got = [...v.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(",");
    if (want !== got) { missing.push(`${k} — 占位符不符（源 {${want}} / 译文 {${got}}）`); continue; }
    merged.set(k, { en, zh, [lang]: v });
  }
  if (missing.length) {
    missingTotal += missing.length;
    console.error(`\n  ⚠️ ${lang}: 缺 ${missing.length} 条（不生成）`);
    missing.forEach((m) => console.error(`      ${m}`));
    continue;
  }
  if (!built) {
    /* 只在第一门成功时构造文件（结构与语言无关） */
    built = [...EXISTING.keys()].map((k) => merged.get(k));
  } else {
    for (let i = 0; i < built.length; i++) built[i][lang] = merged.get([...EXISTING.keys()][i])[lang];
  }
  console.error(`  ✅ ${lang}: ${EXISTING.size} 条齐全`);
}

/* 没有要生成的语言时是**正常收工**，不是缺译文 ——
   否则 LANGS 清零后每次跑都红一次，看两次就没人看了。 */
if (!LANGS.length) {
  console.error("\n  ⏭️ 语言已收敛为 en/zh 两门（2026-10-13 家族裁定），无译文可生成。\n");
  process.exit(0);
}

if (missingTotal || !built) {
  console.error(`\n  ❌ 共 ${missingTotal} 条缺译文。补齐 scripts/i18n/<lang>.mjs 后重跑。\n`);
  process.exit(1);
}

/* 组装完整文件：保留原文件的 import / t() 实现，只换 translations 字典与 Lang 类型 */
const head = src.slice(0, src.indexOf("export const translations: Dict = {"));
const tail = src.slice(src.indexOf("\n};", src.indexOf("export const translations")) + 3);

const q = (s) => JSON.stringify(s);
const body = built.map((row) => {
  const parts = Object.entries(row)
    .filter(([l]) => l === "en" || l === "zh" || LANGS.includes(l))
    .map(([l, v]) => `${l}: ${q(v)}`);
  return `  ${q(row.en === row.en ? Object.keys(EXISTING).find((k) => EXISTING.get(k) === built.find((b) => Object.values(b).includes(row.en) && b.en === row.en)) : "")}: {\n    ${parts.join(",\n    ")},\n  },`;
}).join("\n");

/* 键名要按原顺序，用 index 对齐更稳 */
const ordered = [...EXISTING.entries()];
const body2 = ordered.map(([k, row], i) => {
  const full = built[i];
  const parts = ["en", "zh", ...LANGS.filter((l) => full[l])]
    .map((l) => `${l}: ${q(full[l])}`);
  return `  ${q(k)}: {\n    ${parts.join(",\n    ")},\n  },`;
}).join("\n");

const out = head.replace(
  'export type Lang = "en" | "zh";',
  `/* 中英两门（2026-10-13 家族收敛裁定，见 family.json globalRules.$locales_2026_10_13）。\n   由 scripts/gen-i18n.mjs 生成 translations 字典，勿手改。 */\nexport type Lang = "en" | "zh"${LANGS.map((l) => ` | "${l}"`).join("")};`
).replace(
  'type Dict = Record<string, { en: string; zh: string }>;',
  `type Dict = Record<string, { en: string; zh: string${LANGS.map((l) => `; ${l}: string`).join("")} }>;`
) + `\nexport const translations: Dict = {\n${body2}\n};\n` + tail;

writeFileSync(SRC, out);
console.error(`\n  ✅ 已重写 src/i18n.ts（${ordered.length} 键 × 8 语言）\n`);