import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
// pdf.js worker 走 Vite 资产 URL（Tauri webview 内可直接加载）。
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** 签名框的默认尺寸（PDF 点）——与引擎 positionToCoords 的 220×72 一致。 */
const SIG_W_PT = 220;
const SIG_H_PT = 72;
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
  // ── 签名摆放（D-53 v1）：pdf.js 真实页面预览 + 拖拽 + 落页 ──
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // eslint 提示 any 不安全；pdf.js 的文档对象跨页复用，类型从简。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTaskRef = useRef<any>(null);
  const dragRef = useRef<{ startX: number; startY: number; fxL: number; fyT: number } | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null);
  /** 摆放框左上角的页面占比（0..1）。宽度/高度由默认签名尺寸换算，不单独存。 */
  const [placement, setPlacement] = useState<{ fxL: number; fyT: number } | null>(null);

  // 换文件：重建 pdf.js 文档，页码与摆放归位（渲染 effect 接管）。
  useEffect(() => {
    let cancelled = false;
    if (!pdfPath) {
      docRef.current = null;
      setPageCount(0);
      setPageSize(null);
      setPlacement(null);
      setPreviewPage(1);
      return;
    }
    (async () => {
      try {
        const buf = await invoke<ArrayBuffer>("read_pdf_bytes", { path: pdfPath });
        if (cancelled) return;
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
        if (cancelled) {
          void doc.cleanup();
          return;
        }
        docRef.current = doc;
        setPageCount(doc.numPages);
        setPreviewPage(1);
        setPlacement(null);
      } catch {
        // 打不开（加密/损坏）—— 预览缺席，不影响签署主流程
        docRef.current = null;
        setPageCount(0);
        setPageSize(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfPath]);

  // 渲染当前页到 canvas；scale=1 的视口宽高即 PDF 点尺寸（拖拽换算的基准）。
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || previewPage < 1 || (pageCount > 0 && previewPage > pageCount)) return;
    let dead = false;
    (async () => {
      try {
        const page = await doc.getPage(previewPage);
        if (dead) return;
        const base = page.getViewport({ scale: 1 });
        setPageSize({ w: base.width, h: base.height });
        const scale = Math.min(1.5, 620 / base.width);
        const vp = page.getViewport({ scale });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        renderTaskRef.current?.cancel();
        const task = page.render({ canvas: canvas, viewport: vp });
        renderTaskRef.current = task;
        await task.promise;
      } catch {
        /* 取消或损坏 —— 预览缺席不影响签署 */
      }
    })();
    return () => {
      dead = true;
      try { renderTaskRef.current?.cancel(); } catch { /* already done */ }
    };
  }, [previewPage, pageCount]);

  // 页面尺寸就绪后给摆放框一个默认位置（右下内侧，衔接旧四角习惯）。
  useEffect(() => {
    if (pageSize && placement === null) {
      setPlacement({
        fxL: Math.max(0, 1 - SIG_W_PT / pageSize.w - 0.04),
        fyT: Math.max(0, 1 - SIG_H_PT / pageSize.h - 0.06),
      });
    }
  }, [pageSize, placement]);

  const onBoxPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!placement) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, fxL: placement.fxL, fyT: placement.fyT };
  };
  const onBoxPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const canvas = canvasRef.current;
    if (!d || !canvas) return;
    const cssW = canvas.getBoundingClientRect().width;
    const dxFrac = (e.clientX - d.startX) / cssW;
    const dyFrac = (e.clientY - d.startY) / ((cssW * canvas.height) / canvas.width);
    const fw = SIG_W_PT / (pageSize?.w ?? 595);
    const fh = SIG_H_PT / (pageSize?.h ?? 842);
    setPlacement({
      fxL: Math.min(Math.max(d.fxL + dxFrac, 0), 1 - fw),
      fyT: Math.min(Math.max(d.fyT + dyFrac, 0), 1 - fh),
    });
  };
  const onBoxPointerUp = () => {
    dragRef.current = null;
  };

  /** 摆放框 → 引擎 -rect（PDF 点、左下原点）。 */
  const rectArg = (() => {
    if (!placement || !pageSize) return null;
    const { w, h } = pageSize;
    const fw = SIG_W_PT / w;
    const fh = SIG_H_PT / h;
    const fxL = Math.min(Math.max(placement.fxL, 0), 1 - fw);
    const fyT = Math.min(Math.max(placement.fyT, 0), 1 - fh);
    const llx = fxL * w;
    const urx = (fxL + fw) * w;
    const ury = (1 - fyT) * h;
    const lly = (1 - fyT - fh) * h;
    return [llx, lly, urx, ury].map((v) => v.toFixed(2)).join(",");
  })();

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
        rect: rectArg ?? undefined,
        // 自由摆放时落页随摆放；四角模式维持旧行为（引擎默认第 1 页）。
        page: rectArg ? previewPage : undefined,
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
                  onClick={() => { setSigPosition(pos); setPlacement(null); }}
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

        {/* ── 签名摆放（D-53 v1）：真实页面预览 + 拖拽 + 落页 ── */}
        {pdfPath && pageCount > 0 && pageSize && (
          <div className="form-row form-row-visual">
            <label>{t("sign.placement.title", lang)}</label>
            <div className="sig-placement-toolbar">
              <button
                type="button"
                className="btn-small"
                onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                disabled={previewPage <= 1}
              >
                ‹
              </button>
              <span className="sig-placement-page">
                {t("sign.placement.page", lang, { n: previewPage, total: pageCount })}
              </span>
              <button
                type="button"
                className="btn-small"
                onClick={() => setPreviewPage((p) => Math.min(pageCount, p + 1))}
                disabled={previewPage >= pageCount}
              >
                ›
              </button>
              <button type="button" className="btn-link" onClick={() => setPlacement(null)}>
                {t("sign.placement.reset", lang)}
              </button>
            </div>
            <div style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
              <canvas
                ref={canvasRef}
                style={{
                  maxWidth: "100%",
                  height: "auto",
                  display: "block",
                  border: "1px solid rgba(128,128,128,0.4)",
                }}
              />
              {placement && (
                <div
                  onPointerDown={onBoxPointerDown}
                  onPointerMove={onBoxPointerMove}
                  onPointerUp={onBoxPointerUp}
                  style={{
                    position: "absolute",
                    left: `${placement.fxL * 100}%`,
                    top: `${placement.fyT * 100}%`,
                    width: `${(SIG_W_PT / pageSize.w) * 100}%`,
                    height: `${(SIG_H_PT / pageSize.h) * 100}%`,
                    border: "2px dashed rgba(128,128,128,0.9)",
                    background: "rgba(127,127,127,0.15)",
                    cursor: "move",
                    touchAction: "none",
                    boxSizing: "border-box",
                  }}
                  aria-label={t("sign.placement.title", lang)}
                />
              )}
            </div>
            <p className="form-helper">
              {placement
                ? t("sign.placement.hint", lang)
                : t("sign.placement.hintIdle", lang)}
            </p>
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
