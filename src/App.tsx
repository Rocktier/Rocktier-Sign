import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { buildMenu, t, type Lang } from "./i18n";
import { SignPenIcon, CheckIcon, KeyIcon, SunIcon, MoonIcon } from "./components/Icons";
import { SignBadge } from "./components/Icons";
import SignPage from "./pages/SignPage";
import VerifyPage from "./pages/VerifyPage";
import CertPage from "./pages/CertPage";

type Page = "sign" | "verify" | "cert";

const NAV_PAGES: { id: Page; icon: React.ReactNode; labelKey: Parameters<typeof t>[0] }[] = [
  { id: "sign", icon: <SignPenIcon size={18} />, labelKey: "nav.sign" },
  { id: "verify", icon: <CheckIcon size={18} />, labelKey: "nav.verify" },
  { id: "cert", icon: <KeyIcon size={18} />, labelKey: "nav.cert" },
];

const THEME_KEY = "rocktier.sign.theme";
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
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem(THEME_KEY) as "dark" | "light") ?? "dark"
  );

  useEffect(() => {
    buildMenu(lang).catch(console.error);
  }, [lang]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
  }, [lang]);

  // Persist language choice (Batch 2 #10 fix)
  useEffect(() => {
    try { localStorage.setItem(LANG_KEY, lang); } catch {}
  }, [lang]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

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
  }, [toggleTheme]);

  return (
    <div className="app-root">
      <nav className="sidebar">
        {/* Overlay+hiddenTitle 标题栏下窗口不可拖动：在此顶栏元素上声明拖动区。
            Tauri 只在属性元素自身被命中时才拖动，brand 图标/文字等子元素交互不受影响。 */}
        <div className="sidebar-header" data-tauri-drag-region>
          <div className="sidebar-brand">
            <SignBadge size={32} />
            <span className="brand-name">{t("app.title", lang)}</span>
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
          <button
            className="sidebar-theme-toggle"
            onClick={toggleTheme}
            title={t(theme === "dark" ? "nav.theme.light" : "nav.theme.dark", lang)}
            aria-label={t(theme === "dark" ? "nav.theme.light" : "nav.theme.dark", lang)}
          >
            {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
          </button>
          <div className="lang-switch">
            <button className={`lang-btn${lang === "en" ? " active" : ""}`} onClick={() => setLang("en")}>EN</button>
            <button className={`lang-btn${lang === "zh" ? " active" : ""}`} onClick={() => setLang("zh")}>中文</button>
          </div>
        </div>
      </nav>

      <main className="page-container">
        {page === "sign" && <SignPage lang={lang} openRequest={signOpenRequest} />}
        {page === "verify" && <VerifyPage lang={lang} />}
        {page === "cert" && <CertPage lang={lang} />}
      </main>
    </div>
  );
}

export default App;
