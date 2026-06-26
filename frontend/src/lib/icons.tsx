import type { CSSProperties } from 'react';
import type { DiagramType } from '@plynth/shared';

interface IProps {
  size?: number;
  stroke?: number;
  color?: string;
  style?: CSSProperties;
}

function svg(paths: JSX.Element, { size = 18, stroke = 1.9, color = 'currentColor', style }: IProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {paths}
    </svg>
  );
}

export const Logo = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 27 27" fill="none" aria-hidden>
    <rect x="3" y="3" width="13" height="13" rx="3.5" fill="#7e93ff" />
    <rect x="11" y="11" width="13" height="13" rx="3.5" fill="#3a5bff" />
  </svg>
);

export const Plus = (p: IProps) => svg(<path d="M12 5v14M5 12h14" />, p);
export const ChevronRight = (p: IProps) => svg(<path d="M9 6l6 6-6 6" />, p);
export const ChevronDown = (p: IProps) => svg(<path d="M6 9l6 6 6-6" />, p);
export const Dots = (p: IProps) =>
  svg(<><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></>, p);
export const Folder = (p: IProps) =>
  svg(<path d="M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />, p);
export const Sparkle = (p: IProps) =>
  svg(<path d="M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8z" />, p);
export const Trash = (p: IProps) =>
  svg(<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />, p);
export const Check = (p: IProps) => svg(<path d="M5 13l4 4L19 7" />, p);
export const ArrowRight = (p: IProps) => svg(<path d="M5 12h14M13 6l6 6-6 6" />, p);
export const Shield = (p: IProps) =>
  svg(<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4" />, p);
export const Close = (p: IProps) => svg(<path d="M6 6l12 12M18 6L6 18" />, p);
export const Menu = (p: IProps) => svg(<path d="M4 7h16M4 12h16M4 17h16" />, p);
export const Pencil = (p: IProps) =>
  svg(<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />, p);
export const Warn = (p: IProps) =>
  svg(<><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>, p);
export const Save = (p: IProps) =>
  svg(<path d="M12 4v10m0 0l-4-4m4 4l4-4M5 19h14" />, p);
export const Back = (p: IProps) => svg(<path d="M15 6l-6 6 6 6" />, p);

/* ---- diagram-type glyphs (d1 + d2 stroke paths from the prototype) ------ */
const TYPE_PATHS: Record<DiagramType, [string, string]> = {
  class: ['M4 3H20V21H4Z', 'M4 9H20M4 14H20'],
  sequence: ['M6 4V20M18 4V20', 'M6 9H18M18 15H6'],
  erd: ['M3 5H11V11H3ZM13 13H21V19H13Z', 'M11 8H14V13'],
  deployment: ['M3 4H15V13H3ZM9 11H21V20H9Z', 'M3 4H15V13H3Z'],
  component: ['M8 4H20V20H8Z', 'M4 8H10V11H4ZM4 13H10V16H4Z'],
  flowchart: ['M5 3H13V8H5Z M11 16H19V21H11Z', 'M9 8V12H11M15 12V16'],
  usecase: ['M8 4.6a2 2 0 1 0 .01 0M8 7v5M4.5 9h7M8 12l-3 4M8 12l3 4', 'M12 15.5a4.4 2.8 0 1 0 8.8 0a4.4 2.8 0 1 0-8.8 0'],
};

export function TypeIcon({ type, size = 18, color = 'currentColor', stroke = 1.8 }: { type: DiagramType } & IProps) {
  const [d1, d2] = TYPE_PATHS[type];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d={d1} />
      <path d={d2} />
    </svg>
  );
}

export function Avatar({ user, size = 28 }: { user: { initials: string; color: string }; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: user.color,
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.38,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {user.initials}
    </span>
  );
}
