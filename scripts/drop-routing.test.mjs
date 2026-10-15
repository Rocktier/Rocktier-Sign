#!/usr/bin/env node
/* 拖放判定链的可跑检查（零依赖：Node 22 直接剥离 .ts 类型后 import）。
 *
 * 为什么值得单独留一个：这段逻辑跑在 Tauri 的窗口事件里，判错了用户只看到
 * 「拖了没反应」，在 App 内没有任何可观测点。而它对文件扩展名的取舍又必须和
 * 文件选择器一致 —— 这一致性靠人眼维护必然漂移，所以最后一段直接从
 * SignPage.tsx 里把 filters 抠出来比对。
 *
 * 跑法：npm run test:drop
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyDrop, routeDrop } from "../src/services/dropFiles.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

let pass = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; return; }
  failures.push(`${name}${extra ? "  → " + extra : ""}`);
}

/* ── 1. classifyDrop：挑哪一份 ─────────────────────────────────── */
check("空数组 → null", classifyDrop([]) === null);
check("非数组入参 → null（不抛）", classifyDrop(undefined) === null);
check("不认识的后缀 → null", classifyDrop(["a.txt", "b.docx"]) === null);

const p1 = classifyDrop(["C:\\docs\\c.pdf"]);
check("单个 PDF", p1?.kind === "pdf" && p1.path === "C:\\docs\\c.pdf", JSON.stringify(p1));

const p2 = classifyDrop(["C:/a/scan.PDF"]);
check("大写后缀也认", p2?.kind === "pdf", JSON.stringify(p2));

const p3 = classifyDrop(["C:/a/stamp.png"]);
check("PNG → 签章", p3?.kind === "stamp", JSON.stringify(p3));

check("JPG → 签章", classifyDrop(["C:/a/s.JPG"])?.kind === "stamp");
check("JPEG → 签章", classifyDrop(["C:/a/s.jpeg"])?.kind === "stamp");

/* 图片不能比选择器更宽松：webp/gif 不在 pickSigImage 的 filters 里，
   拖进来会被收下、到签名那一刻才报错。 */
check("webp 不收（与选择器一致）", classifyDrop(["C:/a/s.webp"]) === null);
check("gif 不收（与选择器一致）", classifyDrop(["C:/a/s.gif"]) === null);

/* PDF 优先：多选拖入时结果不能取决于目录顺序 */
const p4 = classifyDrop(["C:/a/stamp.png", "C:/a/doc.pdf"]);
check("PDF + 图片 → 取 PDF", p4?.kind === "pdf", JSON.stringify(p4));
const p5 = classifyDrop(["C:/a/doc.pdf", "C:/a/stamp.png"]);
check("顺序反过来仍是 PDF", p5?.kind === "pdf", JSON.stringify(p5));

check("过滤掉非字符串项", classifyDrop([null, 42, "C:/a/x.pdf"])?.kind === "pdf");

/* ── 2. routeDrop：落到哪一页 ─────────────────────────────────── */
check("sign 页 + PDF → sign", routeDrop("sign", ["a.pdf"])?.page === "sign");
check("verify 页 + PDF → verify（不抢走用户当前上下文）",
  routeDrop("verify", ["a.pdf"])?.page === "verify");
check("cert 页 + PDF → sign", routeDrop("cert", ["a.pdf"])?.page === "sign");
check("任何页 + 图片 → sign", routeDrop("cert", ["a.png"])?.page === "sign"
  && routeDrop("verify", ["a.png"])?.kind === "stamp");
check("不认识的文件在任何页都 → null", routeDrop("sign", ["a.zip"]) === null);

/* ── 3. 与文件选择器的一致性（这段才是真正会漂移的地方）───────── */
const page = readFileSync(join(ROOT, "src/pages/SignPage.tsx"), "utf8");
function pickerExts(fnName) {
  const i = page.indexOf(`const ${fnName} = async`);
  check(`SignPage.tsx 能找到 ${fnName}`, i >= 0);
  if (i < 0) return [];
  const m = page.slice(i, i + 500).match(/extensions:\s*\[([^\]]*)\]/);
  check(`${fnName} 有 extensions 列表`, !!m);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "").toLowerCase()).filter(Boolean);
}

const pdfExts = pickerExts("pickPdf");
check("选择器的 PDF filters = [pdf]", JSON.stringify(pdfExts) === JSON.stringify(["pdf"]),
  JSON.stringify(pdfExts));

const imgExts = pickerExts("pickSigImage");
/* dropFiles 里的 STAMP_RE 接受 png/jpg/jpeg —— 与这份列表必须同集合。
   逐个用 classifyDrop 反查，避免把正则字面量抄成第二份真源。 */
for (const ext of imgExts) {
  check(`选择器认的 .${ext} 拖放也认`, classifyDrop([`/x/stamp.${ext}`])?.kind === "stamp");
}
const dropAccepts = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"];
for (const ext of dropAccepts) {
  const dropped = classifyDrop([`/x/stamp.${ext}`])?.kind === "stamp";
  const picked = imgExts.includes(ext);
  check(`.${ext}：拖放与选择器判定一致（拖放=${dropped} 选择器=${picked}）`, dropped === picked);
}

/* ── 汇总 ─────────────────────────────────────────────────────── */
console.log(`PASS ${pass}  FAIL ${failures.length}`);
for (const f of failures) console.log("  FAIL  " + f);
process.exit(failures.length ? 1 : 0);
