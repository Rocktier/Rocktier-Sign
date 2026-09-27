import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t, type Lang } from "../i18n";
import type { CertInfo } from "../types";

interface Props {
  lang: Lang;
}

export default function SignPage({ lang }: Props) {
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [certId, setCertId] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [certs, setCerts] = useState<CertInfo[]>([]);

  const loadCerts = async () => {
    try {
      const list = await invoke<CertInfo[]>("list_certs");
      setCerts(list);
      if (list.length > 0 && !certId) {
        const def = await invoke<string | null>("get_default_cert");
        setCertId(def ?? list[0].name);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => { loadCerts(); }, []);

  const pickPdf = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (typeof selected === "string") {
        setPdfPath(selected);
        const dotIdx = selected.lastIndexOf(".");
        const base = dotIdx > 0 ? selected.slice(0, dotIdx) : selected;
        setOutputPath(`${base}_signed.pdf`);
      }
    } catch { /* cancelled */ }
  };

  const handleSign = async () => {
    if (!pdfPath || !certId) return;
    setBusy(true);
    setResult(null);
    try {
      const out = outputPath ?? (() => {
        const dotIdx = pdfPath.lastIndexOf(".");
        const base = dotIdx > 0 ? pdfPath.slice(0, dotIdx) : pdfPath;
        return `${base}_signed.pdf`;
      })();
      await invoke<string>("sign_pdf", {
        input: pdfPath,
        output: out,
        name: signerName || certId,
        certId,
      });
      setResult({ ok: true, msg: `${t("sign.success", lang)}\n${out}` });
    } catch (e) {
      setResult({ ok: false, msg: `${t("sign.error", lang)}: ${e}` });
    }
    setBusy(false);
  };

  const copyOutput = async () => {
    if (!outputPath) return;
    try {
      await navigator.clipboard.writeText(outputPath);
    } catch { /* ignore */ }
  };

  const resultPath = result?.ok
    ? result.msg.split("\n").find((l) => l.endsWith(".pdf") && l !== result.msg.split("\n")[0])
    : null;

  return (
    <div className="page">
      <h2 className="page-title">{t("sign.heading", lang)}</h2>
      <p className="page-intro">{t("sign.intro", lang)}</p>
      <div className="page-body">
        <div className="form-row">
          <label>{t("sign.selectPdf", lang)}</label>
          <button className="btn-secondary" onClick={pickPdf}>
            {pdfPath ? pdfPath.split(/[\\/]/).pop() : t("common.browse", lang)}
          </button>
        </div>

        <div className="form-row">
          <label>{t("sign.chooseCert", lang)}</label>
          <select
            className="form-select"
            value={certId ?? ""}
            onChange={(e) => setCertId(e.target.value || null)}
            disabled={certs.length === 0}
          >
            {certs.length === 0 && <option value="">{t("cert.empty", lang)}</option>}
            {certs.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
          <p className="form-helper">{t("chooseCert.help", lang)}</p>
        </div>

        <div className="form-row">
          <label>{t("sign.nameLabel", lang)}</label>
          <input
            className="form-input"
            type="text"
            value={signerName}
            placeholder={certId ?? ""}
            onChange={(e) => setSignerName(e.target.value)}
          />
          <p className="form-helper">{t("nameLabel.help", lang)}</p>
        </div>

        <div className="form-row">
          <label>{t("sign.outputLabel", lang)}</label>
          <input
            className="form-input"
            type="text"
            value={outputPath ?? ""}
            placeholder={t("sign.outputHint", lang)}
            onChange={(e) => setOutputPath(e.target.value || null)}
          />
        </div>

        <button
          className="btn-primary"
          onClick={handleSign}
          disabled={!pdfPath || !certId || busy}
        >
          {busy ? t("common.loading", lang) : t("sign.button", lang)}
        </button>

        {result && (
          <div className={`result ${result.ok ? "result-ok" : "result-error"}`}>
            {result.msg.split("\n").map((line, i) => (
              <div key={i} className={line.includes(".pdf") && result.ok ? "result-path" : ""}>
                {line}
              </div>
            ))}
            {resultPath && (
              <button className="btn-small result-copy-btn" onClick={copyOutput}>
                Copy Path
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
