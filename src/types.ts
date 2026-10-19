/** 证书元数据 sidecar（inspect-cert 产出，{name}.meta.json）。
 *  字段名与 Rust CertMeta 的 serde 序列化保持 snake_case（同 CertInfo 惯例）。 */
export interface CertMeta {
  subject: string;
  cn: string;
  issuer: string;
  not_before: string;
  not_after: string;
  key_type: string;
  chain_len: number;
  expired: boolean;
  /** 用户在证书页对已过期证书点过「仍要使用」后为 true（签署硬确认的手势记忆）。 */
  allow_expired: boolean;
}

export interface CertInfo {
  name: string;
  created: string;
  path: string;
  /** 生成/旧证书可能没有 sidecar —— Rust 侧 None 序列化时省略。 */
  meta?: CertMeta;
}
