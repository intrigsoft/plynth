import type { MouseEvent as RMouseEvent, PointerEvent, ReactNode } from 'react';
import type { Viewport } from './useViewport';
import { DioschubBadge, RailDivider, SelectToggle, Tool, ZoomCluster } from './ui';

export function EditorShell({
  vp,
  tool,
  onTool,
  accent,
  palette,
  onFit,
  onAutoLayout,
  onArrangeComments,
  onCanvasPointerDown,
  onCanvasDoubleClick,
  cursor,
  world,
  hud,
}: {
  vp: Viewport;
  tool: Tool;
  onTool: (t: Tool) => void;
  accent: string;
  palette: ReactNode;
  onFit: () => void;
  onAutoLayout?: () => void;
  onArrangeComments?: () => void;
  onCanvasPointerDown?: (e: PointerEvent) => void;
  onCanvasDoubleClick?: (e: RMouseEvent) => void;
  cursor?: string;
  world: ReactNode;
  hud?: ReactNode;
}) {
  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, background: 'var(--surface)' }}>
      {/* tool rail */}
      <div style={{ width: 66, background: '#fff', borderRight: '1px solid #e4e8ee', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0', gap: 8, zIndex: 30 }}>
        <SelectToggle tool={tool} onTool={onTool} accent={accent} />
        <RailDivider />
        {palette}
      </div>

      {/* canvas */}
      <div
        ref={vp.vpRef}
        onPointerDown={onCanvasPointerDown}
        onDoubleClick={onCanvasDoubleClick}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--surface)',
          backgroundImage: 'radial-gradient(#d3dae3 1.1px, transparent 1.1px)',
          backgroundSize: '24px 24px',
          cursor: cursor ?? (tool === 'pan' ? 'grab' : 'default'),
        }}
      >
        {/* transformed world */}
        <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${vp.tx}px,${vp.ty}px) scale(${vp.scale})`, transformOrigin: '0 0', willChange: 'transform' }}>
          {world}
        </div>
        {/* screen-space overlays */}
        {hud}
        <ZoomCluster pct={Math.round(vp.scale * 100)} onIn={() => vp.zoomBy(1.2)} onOut={() => vp.zoomBy(1 / 1.2)} onFit={onFit} onAutoLayout={onAutoLayout} onArrangeComments={onArrangeComments} accent={accent} />
        <DioschubBadge />
      </div>
    </div>
  );
}
