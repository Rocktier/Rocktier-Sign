import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LOCALES, buildMenu, t, type Lang } from "./i18n";
import { SignPenIcon, CheckIcon, KeyIcon, SunIcon, MoonIcon } from "./components/Icons";
import { SignBadge } from "./components/Icons";
import { LicenseDialog } from "./components/LicenseDialog";
import { licenseStatus, onLicenseExpired, type LicenseInfo } from "./services/license";
import { routeDrop, type DropRequest } from "./services/dropFiles";
import SignPage from "./pages/SignPage";
import VerifyPage from "./pages/VerifyPage";
import CertPage from "./pages/CertPage";

type Page = "sign" | "verify" | "cert";

const NAV_PAGES: { id: Page; icon: React.ReactNode; labelKey: Parameters<typeof t>[0] }[] = [
  { id: "sign", icon: <SignPenIcon size={18} />, labelKey: "nav.sign" },
  { id: "verify", icon: <CheckIcon size={18} />, labelKey: "nav.verify" },
  { id: "cert", icon: <KeyIcon size={18} />, labelKey: "nav.cert" },
];

/** 三态：auto 跟随系统 → light → dark → auto（家族 §6.5 唯一状态机）。 */
type ThemeMode = "auto" | "light" | "dark";
type Resolved = "light" | "dark";

const THEME_KEY = "rocktier.sign.theme";
const THEME_CYCLE: readonly ThemeMode[] = ["auto", "light", "dark"];
const LANG_KEY = "rocktier.sign.lang";

function App() {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem(LANG_KEY);
    return saved === "zh" || saved === "en" ? saved : "en";
  });
  const [page, setPage] = useState<Page>("sign");
  // 原生菜单「打开…」的请求计数：传给 SignPage，在其 effect 里触发文件选择。
  // 用递增计数而非布尔/事件，保证菜单先于页面挂载发出时也不会丢（挂载时 >0 即触发）。
  const [signOpenRequest, setSignOpenRequest] = useState(0);
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  // 授权（家族 L6）：状态轮询 + 对话框开关。null = 尚未取到（或浏览器 dev）。
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [licenseOpen, setLicenseOpen] = useState(false);
  /* 从系统拖进来的文件。两条独立的通道，而不是一条「当前页」的：
     验证页正在看一份报告时拖入 PDF，不该被顺手切到签名页 ——
     落点由 routeDrop 判定，这里只负责把它交给对的那一页。 */
  const [signDrop, setSignDrop] = useState<DropRequest | null>(null);
  const [verifyDrop, setVerifyDrop] = useState<DropRequest | null>(null);
  /* 拖拽悬停态。只在「这份文件本应用用得上」时才亮 —— 拖一个 .txt 进来
     不该出现任何提示，否则等于骗用户松手。enter 事件带 paths，判定得出来。 */
  const [dragActive, setDragActive] = useState(false);
  const pageRef = useRef<Page>(page);
  const dropSeq = useRef(0);

  useEffect(() => {
    buildMenu(lang).catch(console.error);
  }, [lang]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolveTheme(theme));
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme]);

  // auto 态下系统外观变了要跟着变；light/dark 是用户明确选择，不动。
  useEffect(() => {
    if (theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      document.documentElement.setAttribute("data-theme", systemTheme());
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
  }, [lang]);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  /* ── 窗口级拖放 ──────────────────────────────────────────────────
     用 Tauri 的原生事件而不是 HTML5 的 ondrop：webview 开着原生拖放时，
     文件拖入不会派发 DOM 的 drag/drop 事件，挂在 <div> 上的 onDrop 永远不响。
     事件类型见 @tauri-apps/api/webview 的 DragDropEvent（enter 带 paths，
     over 不带 —— 所以判定只能发生在 enter 上）。 */
  useEffect(() => {
    // 浏览器 dev（无 Tauri）没有这个 API：静默跳过，别在控制台刷错。
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (disposed) return;
        const p = event.payload;
        if (p.type === "enter") {
          // 先判定认不认得：认得才亮提示，松手才有结果，两件事同一个判据。
          setDragActive(routeDrop(pageRef.current, p.paths) !== null);
          return;
        }
        if (p.type === "over") return; // over 不带 paths，不能在此重新判定
        if (p.type === "leave") {
          setDragActive(false);
          return;
        }
        setDragActive(false);
        const routed = routeDrop(pageRef.current, p.paths);
        if (!routed) return;
        const request: DropRequest = { id: ++dropSeq.current, kind: routed.kind, path: routed.path };
        if (routed.page === "verify") setVerifyDrop(request);
        else {
          setPage("sign");
          setSignDrop(request);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Persist language choice (Batch 2 #10 fix)
  useEffect(() => {
    try { localStorage.setItem(LANG_KEY, lang); } catch {}
  }, [lang]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => THEME_CYCLE[(THEME_CYCLE.indexOf(prev) + 1) % THEME_CYCLE.length]);
  }, []);

  // ── License（家族 L6）：读一次试用状态；写操作（sign_pdf）被拦时由 Rust 发
  //    license-expired 事件（命令层统一发），这里弹激活对话框并刷新状态。前端另有
  //    兜底：SignPage 的 invoke 错误串含 LICENSE_EXPIRED 也开对话框（双保险）。──
  const refreshLicense = useCallback(() => {
    // 浏览器 dev（无 Tauri）没有 license_status：静默保持 null，胶囊不显示。
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    licenseStatus()
      .then(setLicense)
      .catch(() => setLicense(null));
  }, []);

  const openLicense = useCallback(() => {
    setLicenseOpen(true);
    refreshLicense();
  }, [refreshLicense]);

  useEffect(() => {
    refreshLicense();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onLicenseExpired(() => {
      setLicenseOpen(true);
      refreshLicense();
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refreshLicense]);

  // 原生菜单事件接线（Rust on_menu_event emit "menu-action"，此前前端无监听，
  // 菜单项点了没反应）。action 名以 lib.rs build_app_menu 实际注册的 id 为准。
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<string>("menu-action", (e) => {
      switch (e.payload) {
        case "open":
          // 打开 PDF：切到签名页并触发其现有文件选择逻辑
          setPage("sign");
          setSignOpenRequest((n) => n + 1);
          break;
        case "toggle-theme":
          toggleTheme();
          break;
        case "license":
          openLicense();
          break;
        case "website":
          void invoke("open_url", { url: "https://rocktier.com/" }).catch(() => {});
          break;
        case "feedback":
          void invoke("open_url", { url: "mailto:hello@rocktier.com" }).catch(() => {});
          break;
        default:
          // 未接线的 action 降级为 no-op，不弹错误
          console.warn("[menu-action] unhandled:", e.payload);
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [toggleTheme, openLicense]);

  return (
    <div className="app-root">
      <nav className="sidebar">
        {/* Overlay+hiddenTitle 标题栏下窗口不可拖动：在此顶栏元素上声明拖动区。
            Tauri 只在属性元素自身被命中时才拖动，brand 图标/文字等子元素交互不受影响。 */}
        <div className="sidebar-header" data-tauri-drag-region>
          <div className="sidebar-brand">
            <SignBadge size={32} />
            <span className="brand-name">{t("app.title", lang)}</span>
            <span className="brand-dot" aria-hidden="true" />
          </div>
        </div>
        <div className="sidebar-nav">
          {NAV_PAGES.map((item) => (
            <button
              key={item.id}
              className={`sidebar-item${page === item.id ? " active" : ""}`}
              onClick={() => setPage(item.id)}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span>{t(item.labelKey, lang)}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          {/* 授权胶囊（家族 L6）：只在直链版且尚未激活时提示 —— 商店版由商店收款，
              已激活时不占侧栏（常驻入口在帮助菜单「许可与激活…」）。Sign 目前无商店包。 */}
          {license && license.channel === "direct" && license.status !== "licensed" && (
            <button
              type="button"
              className={`sidebar-license${license.status === "expired" ? " expired" : ""}`}
              onClick={openLicense}
              title={
                license.status === "expired"
                  ? t("license.expired", lang)
                  : t("license.trialLeft", lang, { days: license.daysLeft })
              }
            >
              {license.status === "expired"
                ? t("license.expiredChip", lang)
                : t("license.trialChip", lang, { days: license.daysLeft })}
            </button>
          )}
          {/* 家族唯一主题按钮：.icon-btn（28×28 + 40×40 命中区）。
              三态 auto → light → dark，data-mode 驱动角标，title/aria-label 说明当前档。 */}
          <button
            className="icon-btn"
            data-mode={theme}
            onClick={toggleTheme}
            title={`${t("nav.theme", lang)} \u00b7 ${t(theme === "auto" ? "nav.theme.auto" : theme === "light" ? "nav.theme.lightMode" : "nav.theme.darkMode", lang)}`}
            aria-label={`${t("nav.theme", lang)}: ${t(theme === "auto" ? "nav.theme.auto" : theme === "light" ? "nav.theme.lightMode" : "nav.theme.darkMode", lang)}`}
          >
            {theme === "auto" ? (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2.5" y="4" width="19" height="13" rx="2" />
                <path d="M8 20.5h8M12 17v3.5" />
              </svg>
            ) : theme === "dark" ? (
              <SunIcon size={16} />
            ) : (
              <MoonIcon size={16} />
            )}
          </button>
          <div className="lang-switch">
            <select
              className="lang-btn"
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              aria-label={t("app.title", lang)}
              title={t("app.title", lang)}
            >
              {LOCALES.map((l) => (
                <option key={l.code} value={l.code}>{l.endonym}</option>
              ))}
            </select>
          </div>
        </div>
      </nav>

      <main className="page-container">
        {page === "sign" && (
          <SignPage lang={lang} openRequest={signOpenRequest} drop={signDrop} onLicenseExpired={openLicense} />
        )}
        {page === "verify" && <VerifyPage lang={lang} drop={verifyDrop} />}
        {page === "cert" && <CertPage lang={lang} />}
      </main>

      {/* 拖拽提示：全窗口覆盖层。pointer-events:none —— 松手由 Tauri 原生处理，
          这层只负责让用户知道「松手会发生什么」。 */}
      {dragActive && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card">
            <div className="drop-title">
              {t(page === "verify" ? "drop.verify" : "drop.sign", lang)}
            </div>
            {page !== "verify" && (
              <div className="drop-sub">{t("drop.sign.sub", lang)}</div>
            )}
          </div>
        </div>
      )}

      {licenseOpen && (
        <LicenseDialog lang={lang} info={license} onRefresh={refreshLicense} onClose={() => setLicenseOpen(false)} />
      )}
    </div>
  );
}

export default App;

/** 读存储。三态引入前只存 dark/light —— 原样保留，老用户偏好不丢。 */
function readTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light" || saved === "auto") return saved;
  } catch {
    /* ignore */
  }
  // 从没手动选过：跟随系统（家族基线）
  return "auto";
}

function systemTheme(): Resolved {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** auto 落成实际生效值 —— data-theme 只接受 light/dark。 */
function resolveTheme(mode: ThemeMode): Resolved {
  return mode === "auto" ? systemTheme() : mode;
}
