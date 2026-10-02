import { invoke } from "@tauri-apps/api/core";

export type Lang = "en" | "zh";

type Dict = Record<string, { en: string; zh: string }>;

export const translations: Dict = {
  "app.title": { en: "Rocktier Sign", zh: "Rocktier Sign" },
  "app.tagline": {
    en: "Sign documents on your machine, not someone else's server.\nBuy once, own forever.",
    zh: "在你的设备上签名文件，而不是别人的服务器。\n一次购买，永久使用。",
  },

  // Sidebar
  "nav.sign": { en: "Sign", zh: "签名" },
  "nav.verify": { en: "Verify", zh: "验证" },
  "nav.cert": { en: "Certificates", zh: "证书" },
  "nav.theme": { en: "Theme", zh: "主题" },
  "nav.theme.light": { en: "Switch to light mode", zh: "切换到浅色模式" },
  "nav.theme.dark": { en: "Switch to dark mode", zh: "切换到深色模式" },

  // Sign page
  "sign.heading": { en: "Sign a PDF", zh: "签名 PDF" },
  "sign.intro": {
    en: "Select a PDF file, choose your certificate, and apply a digital signature. The signed copy is saved next to the original. No data ever leaves your device.",
    zh: "选择 PDF 文件、选定证书，即可添加数字签名。签名后的副本保存在原文件旁。所有数据不会离开你的设备。",
  },
  "sign.selectPdf": { en: "Select PDF file", zh: "选择 PDF 文件" },
  "selectPdf.help": { en: "Choose the PDF you want to digitally sign.", zh: "选择要添加数字签名的 PDF 文件。" },
  "sign.chooseCert": { en: "Choose certificate", zh: "选择证书" },
  "chooseCert.help": { en: "Pick the digital certificate that will be embedded in the signature.", zh: "选择嵌入签名中的数字证书。" },
  "sign.nameLabel": { en: "Signer name", zh: "签名人" },
  "nameLabel.help": { en: "Optional. Defaults to the certificate name if left blank.", zh: "可选。如留空则默认使用证书名称。" },
  "sign.outputLabel": { en: "Output file", zh: "输出文件" },
  "sign.outputHint": { en: "Will be saved next to the original with _signed suffix", zh: "将保存在原文件旁，添加 _signed 后缀" },
  "sign.visualLabel": { en: "Visual signature", zh: "可视化签名" },
  "sign.visualToggle": { en: "Show signature on document", zh: "在文档上显示签名" },
  "sign.visualHelp": { en: "Adds a visible signature block to the PDF. Always also includes a hidden cryptographic signature.", zh: "在 PDF 上添加可视签名块。始终同时包含隐藏的数字签名。" },
  "sign.positionLabel": { en: "Signature position", zh: "签名位置" },
  "position.top-left": { en: "Top-left", zh: "左上" },
  "position.top-right": { en: "Top-right", zh: "右上" },
  "position.bottom-left": { en: "Bottom-left", zh: "左下" },
  "position.bottom-right": { en: "Bottom-right", zh: "右下" },
  "sigPosition.help": { en: "Where to place the signature block on the page. Upload a custom stamp image below or use the default appearance.", zh: "选择签名块在页面上的位置。可上传自定义签章图片或使用默认外观。" },
  "sign.uploadSig": { en: "Upload stamp (optional)", zh: "上传签章（可选）" },
  "sign.button": { en: "Sign Document", zh: "签名文件" },
  "sign.success": { en: "✓ Signed successfully", zh: "✓ 签名成功" },
  "sign.error": { en: "Signing failed", zh: "签名失败" },

  // Verify page
  "verify.heading": { en: "Verify a PDF Signature", zh: "验证 PDF 签名" },
  "verify.intro": {
    en: "Select a PDF that was previously signed with this tool. Verification checks whether the document has been altered since it was signed.",
    zh: "选择此前用本工具签名过的 PDF。验证功能会检查文件自签名以来是否被篡改。",
  },
  "verify.selectPdf": { en: "Select signed PDF", zh: "选择已签名的 PDF" },
  "verify.selectPdf.help": { en: "Pick the signed PDF you want to check.", zh: "选择要核验的已签名 PDF。" },
  "verify.button": { en: "Verify Signature", zh: "验证签名" },
  "verify.result": { en: "Verification result", zh: "验证结果" },
  "verify.error": { en: "Verification failed", zh: "验证失败" },
  "verify.verdict.valid": { en: "Valid — signature verified", zh: "有效 — 签名已验证" },
  "verify.verdict.untrusted": { en: "Valid but untrusted (self-signed)", zh: "有效但不可信（自签名）" },
  "verify.verdict.invalid": { en: "Invalid — signature does not match", zh: "无效 — 签名不匹配" },
  "verify.verdict.none": { en: "No digital signature found", zh: "未发现数字签名" },

  // Cert page
  "cert.heading": { en: "Manage Certificates", zh: "管理证书" },
  "cert.intro": {
    en: "A certificate is a digital identity used to sign PDF documents. Generate one here and it will be stored locally. You can create multiple certificates for different purposes and set one as the default for new signatures.",
    zh: "证书是用于签署 PDF 文件的数字身份。在此生成后将本地存储。你可以创建多个用途不同的证书，并指定其中一个作为新签名的默认证书。",
  },
  "cert.nameLabel": { en: "Certificate name", zh: "证书名称" },
  "cert.namePlaceholder": { en: "e.g. Personal, Work, Client A", zh: "如：个人、工作、客户 A" },
  "cert.generate": { en: "Generate New", zh: "生成新证书" },
  "cert.empty": { en: "No certificates yet. Generate one above.", zh: "暂无证书，请在上方生成。" },
  "cert.default": { en: "Default", zh: "默认" },
  "cert.setDefault": { en: "Set as default", zh: "设为默认" },
  "cert.created": { en: "Created", zh: "创建时间" },
  "cert.signCount": { en: "{n} signatures", zh: "已签 {n} 份" },

  // Common
  "common.cancel": { en: "Cancel", zh: "取消" },
  "common.browse": { en: "Browse…", zh: "浏览…" },
  "common.loading": { en: "Working…", zh: "处理中…" },
  "common.noFile": { en: "No file selected", zh: "未选择文件" },
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

/// Trigger the native updater check.
export async function checkForUpdates(): Promise<void> {
  await invoke("check_updates").catch(() => {});
}
