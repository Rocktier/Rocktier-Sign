import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t, type Lang } from "../i18n";
import { isLicenseExpiredError } from "../services/license";
import type { CertInfo } from "../types";

interface Props {
  lang: Lang;
  /** 原生菜单「打开…」请求计数：>0 时触发文件选择（递增即再次触发） */
  openRequest?: number;
  /** 签名被授权闸门拦下（LICENSE_EXPIRED）时打开许可对话框（家族 L6）。 */
  onLicenseExpired?: () => void;
}

export default function SignPage({ lang, openRequest = 0, onLicenseExpired }: Props) {
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [certId, setCertId] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [certs, setCerts] = useState<CertInfo[]>([]);
  const [visualSig, setVisualSig] = useState(true);
  const [sigPosition, setSigPosition] = useState("bottom-right");
  const [sigImagePath, setSigImagePath] = useState<string | null>(null);

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

  // 原生菜单「打开…」→ 复用现有文件选择逻辑。用请求计数做依赖：
  // 页面尚未挂载时菜单先到也没关系（挂载时 openRequest 已 >0，effect 照常跑）。
  useEffect(() => {
    if (openRequest > 0) {
      void pickPdf();
    }
    // pickPdf 每次渲染都是新引用，但内部只调用 setState，无需进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

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

  const pickSigImage = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg"] }],
      });
      if (typeof selected === "string") {
        setSigImagePath(selected);
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
        visualSig,
        imagePath: sigImagePath,
        position: sigPosition,
      });
      setResult({ ok: true, msg: `${t("sign.success", lang)}\n${out}` });
    } catch (e) {
      // 事件链（license-expired）已弹对话框；这里兜错误串，防事件丢失时只剩裸失败。
      // ENFORCE=false 期间闸门不拦，此分支在官网上架可购后（翻 license::ENFORCE）生效。
      if (onLicenseExpired && isLicenseExpiredError(e)) onLicenseExpired();
      else setResult({ ok: false, msg: `${t("sign.error", lang)}: ${e}` });
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

        <div className="form-row">
          <label>{t("sign.visualLabel", lang)}</label>
          <label className="form-toggle">
            <input
              type="checkbox"
              checked={visualSig}
              onChange={(e) => setVisualSig(e.target.checked)}
            />
            <span>{t("sign.visualToggle", lang)}</span>
          </label>
          <p className="form-helper">{t("sign.visualHelp", lang)}</p>
        </div>

        {visualSig && (
          <div className="form-row form-row-visual">
            <label>{t("sign.positionLabel", lang)}</label>
            <div className="sig-position-grid">
              {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  className={`sig-position-btn${sigPosition === pos ? " active" : ""}`}
                  onClick={() => setSigPosition(pos)}
                >
                  {t(`sign.position.${pos}`, lang)}
                </button>
              ))}
            </div>
            <div className="sig-image-row">
              <button type="button" className="btn-secondary btn-small" onClick={pickSigImage}>
                {sigImagePath ? sigImagePath.split(/[\\/]/).pop() : t("sign.uploadSig", lang)}
              </button>
              {sigImagePath && (
                <button type="button" className="btn-link" onClick={() => setSigImagePath(null)}>
                  ✕
                </button>
              )}
            </div>
            <p className="form-helper">{t("sigPosition.help", lang)}</p>
          </div>
        )}

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
