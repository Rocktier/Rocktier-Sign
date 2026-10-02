import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t, type Lang } from "../i18n";

interface Props {
  lang: Lang;
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

export default function VerifyPage({ lang }: Props) {
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const pickPdf = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (typeof selected === "string") {
        setPdfPath(selected);
        setResult(null);
        setRawError(null);
      }
    } catch { /* cancelled */ }
  };

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
          <button className="btn-secondary" onClick={pickPdf}>
            {pdfPath ? pdfPath.split(/[\\/]/).pop() : t("common.browse", lang)}
          </button>
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
                {copied ? "Copied!" : "Copy"}
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
                <div className="verify-signer-name">{s.name || "(unnamed)"}</div>
                <ul className="verify-checks">
                  <li className={s.valid_signature ? "ok" : "bad"}>
                    Signature integrity: {s.valid_signature ? "valid" : "INVALID — document altered?"}
                  </li>
                  <li className={s.trusted_issuer ? "ok" : "warn"}>
                    Issuer trusted: {s.trusted_issuer ? "yes" : "no (self-signed / untrusted chain)"}
                  </li>
                  <li className={s.ext_key_usage_valid ? "ok" : "warn"}>
                    Key usage valid: {s.ext_key_usage_valid ? "yes" : "no"}
                  </li>
                  <li className={s.revoked ? "bad" : "ok"}>
                    Revoked: {s.revoked ? "YES" : "no"}
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
                {copied ? "Copied!" : "Copy"}
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
