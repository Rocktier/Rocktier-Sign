import { invoke } from "@tauri-apps/api/core";

/* 中英两门（2026-10-13 家族收敛裁定，见 family.json globalRules.$locales_2026_10_13）。
   en/zh 直接维护在本文件；scripts/gen-i18n.mjs 只在重开其他语言时才跑。 */
/* 家族标准语言表 —— 单一真源，与 PDF / CAD 同构。 */
export const LOCALES = [
  { code: "en", endonym: "English" },
    { code: "zh", endonym: "中文" }
] as const;

export type Lang = "en" | "zh";

type Dict = Record<string, { en: string; zh: string }>;



export const translations: Dict = {
  "app.title": {
    en: "Rocktier Sign",
    zh: "Rocktier Sign",
  },
  "nav.sign": {
    en: "Sign",
    zh: "签名",
  },
  "nav.verify": {
    en: "Verify",
    zh: "验证",
  },
  "nav.cert": {
    en: "Certificates",
    zh: "证书",
  },
  "nav.theme": {
    en: "Theme",
    zh: "主题",
  },
  "nav.theme.light": {
    en: "Switch to light mode",
    zh: "切换到浅色模式",
  },
  "nav.theme.dark": {
    en: "Switch to dark mode",
    zh: "切换到深色模式",
  },
  "nav.theme.auto": {
    en: "Follow system",
    zh: "跟随系统",
  },
  "nav.theme.lightMode": {
    en: "Light",
    zh: "浅色",
  },
  "nav.theme.darkMode": {
    en: "Dark",
    zh: "深色",
  },
  "sign.heading": {
    en: "Sign a PDF",
    zh: "签名 PDF",
  },
  "sign.intro": {
    en: "Select a PDF file, choose your certificate, and apply a digital signature. The signed copy is saved next to the original. No data ever leaves your device.",
    zh: "选择 PDF 文件、选定证书，即可添加数字签名。签名后的副本保存在原文件旁。所有数据不会离开你的设备。",
  },
  "sign.selectPdf": {
    en: "Select PDF file",
    zh: "选择 PDF 文件",
  },
  "sign.clearPdf": {
    en: "Clear the selected PDF",
    zh: "清除已选的 PDF",
  },
  "sign.removeStamp": {
    en: "Remove the stamp image",
    zh: "移除签章图片",
  },
  "sign.copyPath": {
    en: "Copy path",
    zh: "复制路径",
  },
  "sign.chooseCert": {
    en: "Choose certificate",
    zh: "选择证书",
  },
  "chooseCert.help": {
    en: "Pick the digital certificate that will be embedded in the signature.",
    zh: "选择嵌入签名中的数字证书。",
  },
  "sign.nameLabel": {
    en: "Signer name",
    zh: "签名人",
  },
  "nameLabel.help": {
    en: "Optional. Defaults to the certificate name if left blank.",
    zh: "可选。如留空则默认使用证书名称。",
  },
  "sign.outputLabel": {
    en: "Output file",
    zh: "输出文件",
  },
  "sign.outputHint": {
    en: "Will be saved next to the original with _signed suffix",
    zh: "将保存在原文件旁，添加 _signed 后缀",
  },
  "sign.visualLabel": {
    en: "Visual signature",
    zh: "可视化签名",
  },
  "sign.visualToggle": {
    en: "Show signature on document",
    zh: "在文档上显示签名",
  },
  "sign.visualHelp": {
    en: "Adds a visible signature block to the PDF. Always also includes a hidden cryptographic signature.",
    zh: "在 PDF 上添加可视签名块。始终同时包含隐藏的数字签名。",
  },
  "sign.positionLabel": {
    en: "Signature position",
    zh: "签名位置",
  },
  "sign.position.top-left": {
    en: "Top-left",
    zh: "左上",
  },
  "sign.position.top-right": {
    en: "Top-right",
    zh: "右上",
  },
  "sign.position.bottom-left": {
    en: "Bottom-left",
    zh: "左下",
  },
  "sign.position.bottom-right": {
    en: "Bottom-right",
    zh: "右下",
  },
  "sigPosition.help": {
    en: "Where to place the signature block on the page. Upload a custom stamp image below or use the default appearance.",
    zh: "选择签名块在页面上的位置。可上传自定义签章图片或使用默认外观。",
  },
  "sign.placement.title": {
    en: "Signature placement",
    zh: "签名摆放",
  },
  "sign.placement.page": {
    en: "Page {n} / {total}",
    zh: "第 {n} / {total} 页",
  },
  "sign.placement.hint": {
    en: "Drag the dashed box to adjust the signature position and page.",
    zh: "拖动虚线框调整签名位置与落页。",
  },
  "sign.placement.hintIdle": {
    en: "Pick a PDF to see the page preview.",
    zh: "选择 PDF 后可预览页面。",
  },
  "sign.placement.reset": {
    en: "Reset",
    zh: "重置",
  },
  "sign.uploadSig": {
    en: "Upload stamp (optional)",
    zh: "上传签章（可选）",
  },
  "sign.button": {
    en: "Sign Document",
    zh: "签名文件",
  },
  "sign.success": {
    en: "✓ Signed successfully",
    zh: "✓ 签名成功",
  },
  "sign.error": {
    en: "Signing failed",
    zh: "签名失败",
  },
  "verify.heading": {
    en: "Verify a PDF Signature",
    zh: "验证 PDF 签名",
  },
  "verify.intro": {
    en: "Select a PDF that was previously signed with this tool. Verification checks whether the document has been altered since it was signed.",
    zh: "选择此前用本工具签名过的 PDF。验证功能会检查文件自签名以来是否被篡改。",
  },
  "verify.selectPdf": {
    en: "Select signed PDF",
    zh: "选择已签名的 PDF",
  },
  "verify.clearPdf": {
    en: "Clear the selected PDF",
    zh: "清除已选的 PDF",
  },
  /* 验证报告里的每一行都必须是用户母语 —— 这是「验证」这件事的全部产出，
     此前整份报告是硬编码英文（Copy / Issuer trusted / INVALID …），
     中文用户看到的是中英混排的判决书。 */
  "verify.check.integrity": {
    en: "Signature integrity",
    zh: "签名完整性",
  },
  "verify.check.issuer": {
    en: "Issuer trusted",
    zh: "签发者受信",
  },
  "verify.check.keyUsage": {
    en: "Key usage valid",
    zh: "密钥用法有效",
  },
  "verify.check.revoked": {
    en: "Revoked",
    zh: "已被吊销",
  },
  "verify.val.yes": { en: "yes", zh: "是" },
  "verify.val.no": { en: "no", zh: "否" },
  "verify.val.valid": { en: "valid", zh: "有效" },
  "verify.val.invalid": {
    en: "INVALID — document altered?",
    zh: "无效 —— 文档可能已被篡改",
  },
  "verify.val.untrusted": {
    en: "no (self-signed / untrusted chain)",
    zh: "否（自签名 / 证书链不受信）",
  },
  "verify.signer.unnamed": {
    en: "(unnamed)",
    zh: "（未署名）",
  },
  "verify.selectPdf.help": {
    en: "Pick the signed PDF you want to check.",
    zh: "选择要核验的已签名 PDF。",
  },
  "verify.button": {
    en: "Verify Signature",
    zh: "验证签名",
  },
  "verify.result": {
    en: "Verification result",
    zh: "验证结果",
  },
  "verify.error": {
    en: "Verification failed",
    zh: "验证失败",
  },
  "verify.verdict.valid": {
    en: "Valid — signature verified",
    zh: "有效 — 签名已验证",
  },
  "verify.verdict.untrusted": {
    en: "Valid but untrusted (self-signed)",
    zh: "有效但不可信（自签名）",
  },
  "verify.verdict.invalid": {
    en: "Invalid — signature does not match",
    zh: "无效 — 签名不匹配",
  },
  "verify.verdict.none": {
    en: "No digital signature found",
    zh: "未发现数字签名",
  },
  "cert.heading": {
    en: "Manage Certificates",
    zh: "管理证书",
  },
  "cert.intro": {
    en: "A certificate is a digital identity used to sign PDF documents. Generate one here and it will be stored locally. You can create multiple certificates for different purposes and set one as the default for new signatures.",
    zh: "证书是用于签署 PDF 文件的数字身份。在此生成后将本地存储。你可以创建多个用途不同的证书，并指定其中一个作为新签名的默认证书。",
  },
  "cert.namePlaceholder": {
    en: "e.g. Personal, Work, Client A",
    zh: "如：个人、工作、客户 A",
  },
  "cert.generate": {
    en: "Generate New",
    zh: "生成新证书",
  },
  "cert.empty": {
    en: "No certificates yet. Generate one above.",
    zh: "暂无证书，请在上方生成。",
  },
  "cert.default": {
    en: "Default",
    zh: "默认",
  },
  "cert.setDefault": {
    en: "Set as default",
    zh: "设为默认",
  },
  "cert.created": {
    en: "Created",
    zh: "创建时间",
  },
  "cert.error": {
    en: "Certificate generation failed",
    zh: "证书生成失败",
  },
  "cert.errorNameTaken": {
    en: "A certificate with this name already exists. Pick another name to keep the existing key.",
    zh: "已存在同名证书。换一个名字，以免覆盖现有的密钥。",
  },
  "cert.import.keyFile": {
    en: "Private key (.pem / .key / .p12 / .pfx / .der)",
    zh: "私钥文件（.pem / .key / .p12 / .pfx / .der）",
  },
  "cert.import.certFile": {
    en: "Certificate (.crt / .pem / .cer) — optional for .p12",
    zh: "证书文件（.crt / .pem / .cer；.p12 可留空）",
  },
  "cert.import.password": {
    en: "Key passphrase (only for encrypted files)",
    zh: "私钥口令（加密文件才需要）",
  },
  "cert.import.preview": {
    en: "Inspect",
    zh: "检查并预览",
  },
  "cert.import.do": {
    en: "Import",
    zh: "导入",
  },
  "cert.import.subject": {
    en: "Subject",
    zh: "主体",
  },
  "cert.import.issuer": {
    en: "Issuer",
    zh: "签发者",
  },
  "cert.import.validUntil": {
    en: "Valid until",
    zh: "有效期至",
  },
  "cert.import.keyType": {
    en: "Key",
    zh: "密钥",
  },
  "cert.import.chain": {
    en: "Chain",
    zh: "证书链",
  },
  "cert.import.passwordRequired": {
    en: "This file is encrypted. Enter the passphrase and inspect again.",
    zh: "该文件已加密，请输入口令后重新检查。",
  },
  "cert.import.keyMismatch": {
    en: "The private key does not match this certificate — check the selected files.",
    zh: "私钥与证书不配对——请检查是否选错了文件。",
  },
  "cert.expired": {
    en: "Expired",
    zh: "已过期",
  },
  "cert.expiredConfirm": {
    en: "This certificate expired on {date}. Open the Certificates page, pick it and press \"Still use\" to confirm, then sign again.",
    zh: "此证书已于 {date} 过期。请在「证书」页选中它并点「仍要使用」确认，再重新签署。",
  },
  "cert.allowExpired": {
    en: "Still use (won't ask again for signing)",
    zh: "仍要使用（签署时不再询问）",
  },
  "common.browse": {
    en: "Browse…",
    zh: "浏览…",
  },
  "common.loading": {
    en: "Working…",
    zh: "处理中…",
  },
  "common.copy": { en: "Copy", zh: "复制" },
  "common.copied": { en: "Copied", zh: "已复制" },
  "common.clear": { en: "Clear", zh: "清除" },
  /* 窗口级拖放提示。文案要写成「松手会发生什么」，不是「支持拖放」——
     用户此刻手还按着鼠标，需要确认的是后果，不是功能。 */
  "drop.sign": {
    en: "Drop to sign this PDF",
    zh: "松开即签名这份 PDF",
  },
  "drop.sign.sub": {
    en: "A PNG or JPG becomes the stamp image",
    zh: "拖入 PNG 或 JPG 则作为签章图片",
  },
  "drop.verify": {
    en: "Drop to verify this PDF",
    zh: "松开即验证这份 PDF",
  },
  "license.title": {
    en: "License",
    zh: "许可与激活",
  },
  "license.loading": {
    en: "Checking…",
    zh: "正在检查…",
  },
  "license.trialLeft": {
    en: "Free trial — {days} day(s) left.",
    zh: "免费试用中 —— 还剩 {days} 天。",
  },
  "license.trialChip": {
    en: "Trial · {days}d",
    zh: "试用 {days} 天",
  },
  "license.expiredChip": {
    en: "Not activated",
    zh: "未激活",
  },
  "license.expired": {
    en: "Your trial has ended. Verifying PDFs and managing certificates still work; signing needs a license.",
    zh: "试用已结束。验证 PDF 与管理证书仍可用；签名需要许可。",
  },
  "license.licensed": {
    en: "Licensed. Thank you.",
    zh: "已激活。谢谢。",
  },
  "license.licensedFamily": {
    en: "Licensed — family bundle. Every Rocktier app is unlocked.",
    zh: "已激活 —— 全家桶，所有 Rocktier 应用均已解锁。",
  },
  "license.licensedNote": {
    en: "This copy is activated. No further checks, and no network access.",
    zh: "此副本已激活。此后不再有任何校验，也不联网。",
  },
  "license.storeNote": {
    en: "This copy came from the Microsoft Store, so the Store handles the license for it.",
    zh: "此副本购自微软商店，许可由商店负责。",
  },
  "license.notConfigured": {
    en: "This build cannot activate a code yet — it carries no verification key. Please write to hello@rocktier.com.",
    zh: "此构建尚未配置验签公钥，暂时无法激活。请写信到 hello@rocktier.com。",
  },
  "license.codeLabel": {
    en: "Activation code",
    zh: "激活码",
  },
  "license.codePlaceholder": {
    en: "RKT-…",
    zh: "RKT-…",
  },
  "license.activate": {
    en: "Activate",
    zh: "激活",
  },
  "license.activating": {
    en: "Activating…",
    zh: "正在激活…",
  },
  "license.buy": {
    en: "Buy",
    zh: "购买",
  },
  "license.close": {
    en: "Close",
    zh: "关闭",
  },
  "license.invalid": {
    en: "That code was not accepted. Check it for a typo — the code is not case-sensitive.",
    zh: "该激活码未被接受。请检查是否输错（不区分大小写）。",
  },
  "license.wrongProduct": {
    en: "That code belongs to a different Rocktier app. Each app has its own code — or the family bundle, which unlocks all of them.",
    zh: "这个激活码属于另一个 Rocktier 应用。每个应用各有自己的码，或者用全家桶（可解锁全部）。",
  },
  "license.refunded": {
    en: "That code was refunded, so it no longer unlocks anything. If this is a mistake, write to hello@rocktier.com with your order number.",
    zh: "这个激活码对应的购买已退款，因此不能再解锁。如属误判，请把订单号发到 hello@rocktier.com。",
  },
  "license.offline": {
    en: "Could not reach rocktier.com. Activating needs one connection; after that the app stays offline.",
    zh: "连不上 rocktier.com。激活需要一次联网，之后便不再联网。",
  },
  "license.whereToFind": {
    en: "Your code was shown on the page right after payment, and is in the purchase email too.",
    zh: "付款后页面上会显示激活码，购买确认邮件里也有一份。",
  },
  "license.privacyNote": {
    en: "Activating sends the code to rocktier.com once and stores the signed reply locally. Nothing else is sent.",
    zh: "激活会把激活码发送到 rocktier.com 一次，并把签名回执保存在本机。除此之外不传输任何内容。",
  },

  // ── 更新检查 ────────────────────────────────────────────────────
  // 措辞要与 privacy.html 的 Update checks 一节一致：应用不主动联网，
  // 只有点「检查更新」才发一次请求，且请求里不含任何标识信息。
  "update.check": {
    en: "Check for updates",
    zh: "检查更新",
  },
  "update.checking": {
    en: "Checking…",
    zh: "正在检查…",
  },
  "update.upToDate": {
    en: "You have the latest version.",
    zh: "已是最新版本。",
  },
  "update.available": {
    en: "Version {v} is available.",
    zh: "发现新版本 {v}。",
  },
  "update.failed": {
    en: "Could not check right now.",
    zh: "暂时无法检查。",
  },
  "update.lastChecked": {
    en: "Checked {d}",
    zh: "上次检查 {d}",
  },
  "update.never": {
    en: "never",
    zh: "从未",
  },
  "update.download": {
    en: "Get {v}",
    zh: "获取 {v}",
  },
  "update.privacyNote": {
    en: "Checking sends one request to GitHub for the latest version number. It carries no license code and nothing about your files.",
    zh: "检查会向 GitHub 发一次请求获取最新版本号。请求不含许可证码，也不含与你的文件有关的任何信息。",
  },
};



export function t(key: string, lang: Lang, vars?: Record<string, string | number>): string {
  const entry = translations[key];
  if (!entry) return key;
  let text = entry[lang];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      // 必须替换全部出现：字符串 replace 只替换首个匹配，
      // 译者写 "{n} times / {n} files" 时第二个占位符会以字面量出现在用户屏幕上。
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return text;
}

/// Build the native menu in the given UI language.
export async function buildMenu(lang: Lang): Promise<void> {
  await invoke("build_menu", { lang });
}
