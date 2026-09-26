import { useEffect, useState } from "react";
import { buildMenu } from "./i18n";

function App() {
  const [lang, setLang] = useState<"en" | "zh">("en");

  useEffect(() => {
    buildMenu(lang).catch(console.error);
  }, [lang]);

  const t = (en: string, zh: string) => (lang === "zh" ? zh : en);

  return (
    <div style={{
      width: "100vw",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--bg-primary)",
      color: "var(--text-primary)",
      fontFamily: "var(--font)",
    }}>
      <div style={{
        position: "absolute",
        top: 16,
        right: 16,
        display: "flex",
        gap: 8,
      }}>
        <button
          onClick={() => setLang("en")}
          style={{
            padding: "4px 12px",
            borderRadius: "var(--radius-sm)",
            border: `1px solid ${lang === "en" ? "var(--accent)" : "var(--border)"}`,
            background: lang === "en" ? "var(--bg-card-hover)" : "var(--bg-card)",
            color: "var(--text-primary)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >EN</button>
        <button
          onClick={() => setLang("zh")}
          style={{
            padding: "4px 12px",
            borderRadius: "var(--radius-sm)",
            border: `1px solid ${lang === "zh" ? "var(--accent)" : "var(--border)"}`,
            background: lang === "zh" ? "var(--bg-card-hover)" : "var(--bg-card)",
            color: "var(--text-primary)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >中文</button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <div style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: "var(--red)",
          animation: "dotpulse 3s ease-in-out infinite",
        }} />
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Rocktier Sign</h1>
      </div>
      <p style={{
        fontSize: 13,
        color: "var(--text-secondary)",
        marginBottom: 32,
        textAlign: "center",
        maxWidth: 400,
        lineHeight: 1.6,
      }}>
        {t(
          "Sign documents on your machine, not someone else's server.\nBuy once, own forever.",
          "在你的设备上签名文件，而不是别人的服务器。\n一次购买，永久使用。"
        )}
      </p>
    </div>
  );
}

export default App;
