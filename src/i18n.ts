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

  // Sign page
  "sign.heading": { en: "Sign a PDF", zh: "签名 PDF" },
  "sign.selectPdf": { en: "Select PDF file", zh: "选择 PDF 文件" },
  "sign.chooseCert": { en: "Choose certificate", zh: "选择证书" },
  "sign.nameLabel": { en: "Signer name", zh: "签名人" },
  "sign.outputLabel": { en: "Output file", zh: "输出文件" },
  "sign.outputHint": { en: "Will be saved next to the original with _signed suffix", zh: "将保存在原文件旁，添加 _signed 后缀" },
  "sign.button": { en: "Sign Document", zh: "签名文件" },
  "sign.success": { en: "✓ Signed successfully", zh: "✓ 签名成功" },
  "sign.error": { en: "Signing failed", zh: "签名失败" },

  // Verify page
  "verify.heading": { en: "Verify a PDF Signature", zh: "验证 PDF 签名" },
  "verify.selectPdf": { en: "Select signed PDF", zh: "选择已签名的 PDF" },
  "verify.button": { en: "Verify Signature", zh: "验证签名" },
  "verify.result": { en: "Verification result", zh: "验证结果" },
  "verify.error": { en: "Verification failed", zh: "验证失败" },

  // Cert page
  "cert.heading": { en: "Manage Certificates", zh: "管理证书" },
  "cert.nameLabel": { en: "Certificate name", zh: "证书名称" },
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
      text = text.replace(`{${k}}`, String(v));
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
