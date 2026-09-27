/**
 * Stroke-only SVG icons — black/white via currentColor.
 * Family DNA: no color, no fill, just 1.5px strokes.
 */

interface IconProps {
  size?: number;
  className?: string;
}

export function SignPenIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  );
}

export function CheckIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export function KeyIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9" />
      <path d="M18 6l3 3" />
      <path d="M15 9l3 3" />
    </svg>
  );
}

export function SunIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

export function MoonIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function CopyIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}

/**
 * Rocktier family badge — full brand mark.
 * Mirrors icon-family.svg: dark rounded-square + checkmark badge + red dot + "SG" monogram.
 * Use for sidebar brand, About hero, anywhere the family mark is needed.
 */
export function SignBadge({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" fill="none">
      {/* Rounded-square background */}
      <rect x="32" y="32" width="960" height="960" rx="200" ry="200" fill="#0A0A0A" />
      <rect x="32" y="32" width="960" height="960" rx="200" ry="200" fill="none" stroke="#333333" strokeWidth="6" />
      {/* Top-left: checkmark in circle (brand badge) */}
      <g transform="translate(128,128) scale(0.85)">
        <circle cx="180" cy="180" r="160" fill="none" stroke="#FFFFFF" strokeWidth="24" strokeLinecap="round" />
        <polyline points="120,185 165,230 245,130" fill="none" stroke="#FFFFFF" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* Red dot */}
      <circle cx="860" cy="164" r="36" fill="#FF4A3D" />
      {/* Product monogram */}
      <text x="512" y="640" fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif" fontWeight="650" fontSize="360" fill="#FFFFFF" textAnchor="middle" dominantBaseline="central" letterSpacing="-20">SG</text>
    </svg>
  );
}
