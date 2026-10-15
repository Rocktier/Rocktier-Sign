/* 窗口级拖放：把「拖进来的是什么文件」翻译成「哪个页面该干什么」。
 *
 * 抽成纯函数是为了能脱离 Tauri 单独跑（scripts/drop-routing.test.mjs）——
 * 拖放这条链上最容易出错的恰恰是这段判定，而它一旦判错，用户看到的是
 * 「拖了没反应」，在 App 里根本没法排查。
 *
 * 另一条不变量：这里接受的扩展名必须与文件选择器**逐字一致**
 * （pickPdf / pickSigImage 的 filters）。拖放比选择器宽松，等于放进来一份
 * 后半程必然报错的文件——错误要发生在用户看得懂的时机，不是签名那一刻。
 */

export type DropKind = "pdf" | "stamp";

/** 一次拖放请求。id 递增：同一条路径连拖两次也要各触发一次。 */
export interface DropRequest {
  id: number;
  kind: DropKind;
  path: string;
}

export type PageId = "sign" | "verify" | "cert";

export interface DropRoute {
  /** 该去哪一页处理 */
  page: "sign" | "verify";
  kind: DropKind;
  path: string;
}

const PDF_RE = /\.pdf$/i;
/** 与 SignPage.pickSigImage 的 filters 保持一致（png / jpg / jpeg）。 */
const STAMP_RE = /\.(png|jpe?g)$/i;

/**
 * 从拖入的路径里挑出「本应用认得的」那一份。
 * 优先 PDF：一次拖多个文件时要有确定的结果，不能取决于目录顺序。
 */
export function classifyDrop(paths: readonly string[]): { kind: DropKind; path: string } | null {
  const list = Array.isArray(paths) ? paths : [];
  const pdf = list.find((p) => typeof p === "string" && PDF_RE.test(p));
  if (pdf) return { kind: "pdf", path: pdf };
  const stamp = list.find((p) => typeof p === "string" && STAMP_RE.test(p));
  if (stamp) return { kind: "stamp", path: stamp };
  return null;
}

/**
 * 判定落点。规则只有两条：
 *   · 签章图片只对「签名」页有意义 → 一律送签名页（并切过去）。
 *   · PDF 在「验证」页表示「验证这份」，在其余任何页面都表示「签名这份」。
 * 判不出结果就返回 null：拖进来一个 .txt 不该有任何反应，更不该切页。
 */
export function routeDrop(page: PageId, paths: readonly string[]): DropRoute | null {
  const picked = classifyDrop(paths);
  if (!picked) return null;
  if (picked.kind === "stamp") return { page: "sign", kind: "stamp", path: picked.path };
  return { page: page === "verify" ? "verify" : "sign", kind: "pdf", path: picked.path };
}
