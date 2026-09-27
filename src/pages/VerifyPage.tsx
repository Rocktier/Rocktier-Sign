import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t, type Lang } from "../i18n";

interface Props {
  lang: Lang;
}

export default function VerifyPage({ lang }: Props) {
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
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
      }
    } catch { /* cancelled */ }
  };

  const handleVerify = async () => {
    if (!pdfPath) return;
    setBusy(true);
    setResult(null);
    setCopied(false);
    try {
      const raw = await invoke<string>("verify_pdf", { input: pdfPath });
      setResult(raw);
    } catch (e) {
      setResult(`${t("verify.error", lang)}: ${e}`);
    }
    setBusy(false);
  };

  const copyResult = async () => {
    if (!result) return;
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(result);
    } catch {
      try { await navigator.clipboard.writeText(result); } catch { /* ignore */ }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="page">
      <h2 className="page-title">{t("verify.heading", lang)}</h2>
      <div className="page-body">
        <div className="form-row">
          <label>{t("verify.selectPdf", lang)}</label>
          <button className="btn-secondary" onClick={pickPdf}>
            {pdfPath ? pdfPath.split(/[\\/]/).pop() : t("common.browse", lang)}
          </button>
        </div>

        <button
          className="btn-primary"
          onClick={handleVerify}
          disabled={!pdfPath || busy}
        >
          {busy ? t("common.loading", lang) : t("verify.button", lang)}
        </button>

        {result && (
          <div className="result result-block">
            <div className="result-header">
              <span className="result-label">{t("verify.result", lang)}</span>
              <button className="btn-small" onClick={copyResult}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="result-json">{result}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
