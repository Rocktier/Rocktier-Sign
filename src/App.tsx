import { useEffect, useState, useCallback } from "react";
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

  return (
    <div className="app-root">
      <nav className="sidebar">
        <div className="sidebar-header">
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
        {page === "sign" && <SignPage lang={lang} />}
        {page === "verify" && <VerifyPage lang={lang} />}
        {page === "cert" && <CertPage lang={lang} />}
      </main>
    </div>
  );
}

export default App;
