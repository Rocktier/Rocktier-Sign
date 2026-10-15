import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t, type Lang } from "../i18n";
import type { DropRequest } from "../services/dropFiles";

interface Props {
  lang: Lang;
  /** 窗口拖放落点：验证页只接 PDF，图片在 App 层就改道去了签名页。 */
  drop?: DropRequest | null;
}

interface SignerInfo {
  name: string;
  valid_signature: boolean;
  trusted_issuer: boolean;
  ext_key_usage_valid: boolean;
  revoked: boolean;
  status: string;
}

interface VerifyResult {
  verdict: "VALID" | "UNTRUSTED" | "INVALID" | "NO_SIGNATURES";
  exit_code: number;
  summary: string;
  signers: SignerInfo[];
}

function asString(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

export default function VerifyPage({ lang, drop = null }: Props) {
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  /** 选定待验证文件，并作废上一份报告 —— 换文件却留着上一份的判决，
      是这类工具最容易误导人的状态残留。 */
  const toPdf = (path: string) => {
    setPdfPath(path);
    setResult(null);
    setRawError(null);
  };

  const pickPdf = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (typeof selected === "string") {
        toPdf(selected);
      }
    } catch { /* cancelled */ }
  };

  const clearPdf = () => {
    setPdfPath(null);
    setResult(null);
    setRawError(null);
  };

  useEffect(() => {
    if (drop?.kind === "pdf") toPdf(drop.path);
    // toPdf 只调 setState，无需进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop?.id]);

  const handleVerify = async () => {
    if (!pdfPath) return;
    setBusy(true);
    setResult(null);
    setRawError(null);
    setCopied(false);
    try {
      const raw = await invoke<string>("verify_pdf", { input: pdfPath });
      setResult(JSON.parse(raw) as VerifyResult);
    } catch (e) {
      const msg = asString(e);
      // The engine returns its verdict (UNTRUSTED / INVALID) as JSON even on a
      // non-zero exit, so a tampered file is never shown as a success (P0-14).
      try {
        const parsed = JSON.parse(msg) as VerifyResult;
        if (parsed && parsed.verdict) {
          setResult(parsed);
          setRawError(null);
          setBusy(false);
          return;
        }
      } catch { /* not JSON — a plain error */ }
      setRawError(msg);
    }
    setBusy(false);
  };

  const copyResult = async () => {
    const text = result ? JSON.stringify(result, null, 2) : rawError ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const banner = (r: VerifyResult) => {
    switch (r.verdict) {
      case "VALID":
        return { cls: "verify-banner-valid", icon: "✓", text: t("verify.verdict.valid", lang) };
      case "UNTRUSTED":
        return { cls: "verify-banner-untrusted", icon: "⚠", text: t("verify.verdict.untrusted", lang) };
      case "INVALID":
        return { cls: "verify-banner-invalid", icon: "✕", text: t("verify.verdict.invalid", lang) };
      default:
        return { cls: "verify-banner-untrusted", icon: "•", text: t("verify.verdict.none", lang) };
    }
  };

  return (
    <div className="page">
      <h2 className="page-title">{t("verify.heading", lang)}</h2>
      <p className="page-intro">{t("verify.intro", lang)}</p>
      <div className="page-body">
        <div className="form-row">
          <label>{t("verify.selectPdf", lang)}</label>
          {/* form-row 提供 display:flex，form-row-inline 只负责改成横向 —— 缺一不可 */}
          <div className="form-row form-row-inline">
            <button className="btn-secondary" onClick={pickPdf} title={pdfPath ?? undefined}>
              {pdfPath ? pdfPath.split(/[\\/]/).pop() : t("common.browse", lang)}
            </button>
            {pdfPath && (
              <button
                className="btn-secondary btn-small"
                onClick={clearPdf}
                title={t("verify.clearPdf", lang)}
                aria-label={t("verify.clearPdf", lang)}
              >
                {t("common.clear", lang)}
              </button>
            )}
          </div>
          <p className="form-helper">{t("verify.selectPdf.help", lang)}</p>
        </div>

        <button
          className="btn-primary"
          onClick={handleVerify}
          disabled={!pdfPath || busy}
        >
          {busy ? t("common.loading", lang) : t("verify.button", lang)}
        </button>

        {result && (
          <div className={`result result-block verify-${result.verdict.toLowerCase()}`}>
            <div className="result-header">
              <span className="result-label">{t("verify.result", lang)}</span>
              <button className="btn-small" onClick={copyResult}>
                {copied ? t("common.copied", lang) : t("common.copy", lang)}
              </button>
            </div>
            {(() => {
              const b = banner(result);
              return (
                <div className={`verify-banner ${b.cls}`}>
                  <span aria-hidden>{b.icon}</span>
                  <span>{b.text}</span>
                </div>
              );
            })()}
            <p className="verify-summary">{result.summary}</p>
            {result.signers?.map((s, i) => (
              <div key={i} className="verify-signer">
                <div className="verify-signer-name">{s.name || t("verify.signer.unnamed", lang)}</div>
                <ul className="verify-checks">
                  <li className={s.valid_signature ? "ok" : "bad"}>
                    {t("verify.check.integrity", lang)}: {t(s.valid_signature ? "verify.val.valid" : "verify.val.invalid", lang)}
                  </li>
                  <li className={s.trusted_issuer ? "ok" : "warn"}>
                    {t("verify.check.issuer", lang)}: {t(s.trusted_issuer ? "verify.val.yes" : "verify.val.untrusted", lang)}
                  </li>
                  <li className={s.ext_key_usage_valid ? "ok" : "warn"}>
                    {t("verify.check.keyUsage", lang)}: {t(s.ext_key_usage_valid ? "verify.val.yes" : "verify.val.no", lang)}
                  </li>
                  <li className={s.revoked ? "bad" : "ok"}>
                    {t("verify.check.revoked", lang)}: {t(s.revoked ? "verify.val.yes" : "verify.val.no", lang)}
                  </li>
                </ul>
              </div>
            ))}
          </div>
        )}

        {rawError && (
          <div className="result result-block verify-error">
            <div className="result-header">
              <span className="result-label">{t("verify.result", lang)}</span>
              <button className="btn-small" onClick={copyResult}>
                {copied ? t("common.copied", lang) : t("common.copy", lang)}
              </button>
            </div>
            <div className="verify-banner verify-banner-invalid">
              <span aria-hidden>✕</span>
              <span>{t("verify.error", lang)}</span>
            </div>
            <p className="verify-summary">{rawError}</p>
          </div>
        )}
      </div>
    </div>
  );
}
