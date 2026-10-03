// 许可与激活对话框（家族 L6，拷自 MD 的 LicenseDialog 并适配 Sign：
// i18n 走 Sign 的 co-located 契约 t(key, lang)，样式用 styles/tokens.css 的既有令牌）。
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t, type Lang } from "../i18n";
import { activate, BUY_URL, type LicenseInfo } from "../services/license";

interface LicenseDialogProps {
  lang: Lang;
  info: LicenseInfo | null;
  onRefresh: () => void;
  onClose: () => void;
}

/** 打开产品页：桌面端走 Rust 白名单入口，浏览器 dev 直接开新窗口。 */
function buy() {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    invoke("open_url", { url: BUY_URL }).catch(() => {});
  } else {
    window.open(BUY_URL, "_blank", "noopener");
  }
}

/**
 * 许可与激活。
 *
 * 三种状态对应三套文案，其中 `store` 渠道**不显示激活码输入框** —— 商店版的付费由
 * 微软代收、授权也由商店判定，在这里再摆一个输入框只会让人以为要在别处再买一次
 * （而且会给商店审核留下"引导外部购买"的口实）。
 */
export function LicenseDialog({ lang, info, onRefresh, onClose }: LicenseDialogProps) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isStore = info?.channel === "store";
  const licensed = info?.status === "licensed";
  /* 没有公钥就没人激活得了。如实说明，而不是让付过钱的用户看到"激活码未被接受"。 */
  const canActivate = info?.activationConfigured !== false;

  const submit = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await activate(code);
      setCode("");
      onRefresh(); // 激活成功立刻刷新 license_status：无需重启即可继续签名
    } catch (e) {
      /* 三种失败要分开说，用户的下一步动作不同：没连上网（重试即可）、码属于别的
         应用（要买对单品或全家桶）、码不对（检查有没有抄错）。 */
      const detail = e instanceof Error ? e.message : String(e);
      if (detail === "offline") setError(t("license.offline", lang));
      else if (detail.includes("WRONG_PRODUCT")) setError(t("license.wrongProduct", lang));
      else if (detail.includes("REFUNDED")) setError(t("license.refunded", lang));
      else setError(t("license.invalid", lang));
    } finally {
      setBusy(false);
    }
  };

  const statusLine = () => {
    if (!info) return t("license.loading", lang);
    if (licensed) {
      return info.product === "FL"
        ? t("license.licensedFamily", lang)
        : t("license.licensed", lang);
    }
    if (info.status === "expired") return t("license.expired", lang);
    return t("license.trialLeft", lang, { days: info.daysLeft });
  };

  return (
    <div className="license-overlay" onMouseDown={onClose} role="presentation">
      <div
        className="license-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("license.title", lang)}
      >
        <div className="license-header">
          <h3>{t("license.title", lang)}</h3>
          <button type="button" className="license-close" onClick={onClose} aria-label={t("license.close", lang)}>
            ×
          </button>
        </div>
        <div className="license-body">
          <p>{statusLine()}</p>

          {licensed ? (
            <p>
              <small>{t("license.licensedNote", lang)}</small>
            </p>
          ) : !canActivate ? (
            /* 这个构建没有验签公钥：任何回执都验不过。与其让买家以为码错了，不如说清。 */
            <p>
              <small>{t("license.notConfigured", lang)}</small>
            </p>
          ) : isStore ? (
            /* 商店版：说明授权由商店负责，并指向商店页面，不提供任何站外购买入口。 */
            <p>
              <small>{t("license.storeNote", lang)}</small>
            </p>
          ) : (
            <>
              <div className="license-field">
                <label htmlFor="license-code">{t("license.codeLabel", lang)}</label>
                <input
                  id="license-code"
                  type="text"
                  value={code}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={t("license.codePlaceholder", lang)}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                  disabled={busy}
                />
              </div>
              {error ? <p className="license-error">{error}</p> : null}
              <p>
                <small>{t("license.whereToFind", lang)}</small>
              </p>
              <p>
                <small>{t("license.privacyNote", lang)}</small>
              </p>
            </>
          )}
        </div>
        <div className="license-footer">
          <button type="button" onClick={onClose}>
            {t("license.close", lang)}
          </button>
          <span className="license-footer-spacer" />
          {!licensed && !isStore ? (
            <button type="button" onClick={buy}>
              {t("license.buy", lang)}
            </button>
          ) : null}
          {!licensed && !isStore && canActivate ? (
            <button
              type="button"
              className="license-activate"
              onClick={() => void submit()}
              disabled={busy || !code.trim()}
            >
              {busy ? t("license.activating", lang) : t("license.activate", lang)}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
