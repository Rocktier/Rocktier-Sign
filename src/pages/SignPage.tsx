import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { localizeError } from "../services/errorText";
import { t, type Lang } from "../i18n";
import { isLicenseExpiredError } from "../services/license";
import type { DropRequest } from "../services/dropFiles";
import type { CertInfo } from "../types";

interface Props {
  lang: Lang;
  /** 原生菜单「打开…」请求计数：>0 时触发文件选择（递增即再次触发） */
  openRequest?: number;
  /** 窗口拖放落点（PDF → 待签文件；stamp → 签章图片）。id 递增即再触发一次。 */
  drop?: DropRequest | null;
  /** 签名被授权闸门拦下（LICENSE_EXPIRED）时打开许可对话框（家族 L6）。 */
  onLicenseExpired?: () => void;
}

export default function SignPage({ lang, openRequest = 0, drop = null, onLicenseExpired }: Props) {
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
  const [copied, setCopied] = useState(false);

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

  // 拖放落点。和「打开…」一样用 id 递增触发，同一份文件连拖两次各算一次。
  useEffect(() => {
    if (!drop) return;
    if (drop.kind === "pdf") toPdf(drop.path);
    else toStamp(drop.path);
    // toPdf / toStamp 只调 setState，无需进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop?.id]);

  /** 选定待签 PDF：输出路径跟着走，同时作废上一次的签名结果 ——
      留着上一个文件的「✓ 签名成功 D:\a_signed.pdf」会让用户以为刚拖进来的
      这份也签好了。 */
  const toPdf = (path: string) => {
    setPdfPath(path);
    const dotIdx = path.lastIndexOf(".");
    const base = dotIdx > 0 ? path.slice(0, dotIdx) : path;
    setOutputPath(`${base}_signed.pdf`);
    setResult(null);
  };

  /** 选定签章图片。顺手打开「可视化签名」开关：关着的时候这张图根本不会
      被用到，收下它却什么都不发生，等于骗用户「上传成功了」。 */
  const toStamp = (path: string) => {
    setSigImagePath(path);
    setVisualSig(true);
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
    setOutputPath(null);
    setResult(null);
  };

  const pickSigImage = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg"] }],
      });
      if (typeof selected === "string") {
        toStamp(selected);
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
      else setResult({ ok: false, msg: `${t("sign.error", lang)}: ${localizeError(String(e), lang)}` });
    }
    setBusy(false);
  };

  const copyOutput = async () => {
    if (!outputPath) return;
    try {
      await navigator.clipboard.writeText(outputPath);
      // 剪贴板写入没有任何可见反馈，用户没法确认按下去有没有生效。
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
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
          {/* form-row 提供 display:flex，form-row-inline 只负责改成横向 —— 缺一不可 */}
          <div className="form-row form-row-inline">
            <button className="btn-secondary" onClick={pickPdf} title={pdfPath ?? undefined}>
              {pdfPath ? pdfPath.split(/[\\/]/).pop() : t("common.browse", lang)}
            </button>
            {pdfPath && (
              <button
                className="btn-secondary btn-small"
                onClick={clearPdf}
                title={t("sign.clearPdf", lang)}
                aria-label={t("sign.clearPdf", lang)}
              >
                {t("common.clear", lang)}
              </button>
            )}
          </div>
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
              <button type="button" className="btn-secondary btn-small" onClick={pickSigImage} title={sigImagePath ?? undefined}>
                {sigImagePath ? sigImagePath.split(/[\\/]/).pop() : t("sign.uploadSig", lang)}
              </button>
              {sigImagePath && (
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setSigImagePath(null)}
                  title={t("sign.removeStamp", lang)}
                  aria-label={t("sign.removeStamp", lang)}
                >
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
                {copied ? t("common.copied", lang) : t("sign.copyPath", lang)}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
