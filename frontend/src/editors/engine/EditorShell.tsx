import { useState } from 'react';
import type { MouseEvent as RMouseEvent, PointerEvent, ReactNode } from 'react';
import type { Viewport } from './useViewport';
import { DioschubBadge, EditorAssistant, RailDivider, SelectToggle, Tool, ZoomCluster } from './ui';

export function EditorShell({
  vp,
  tool,
  onTool,
  accent,
  palette,
  onFit,
  onAutoLayout,
  onCanvasPointerDown,
  onCanvasDoubleClick,
  cursor,
  world,
  hud,
  assistantDocName,
}: {
  vp: Viewport;
  tool: Tool;
  onTool: (t: Tool) => void;
  accent: string;
  palette: ReactNode;
  onFit: () => void;
  onAutoLayout?: () => void;
  onCanvasPointerDown?: (e: PointerEvent) => void;
  onCanvasDoubleClick?: (e: RMouseEvent) => void;
  cursor?: string;
  world: ReactNode;
  hud?: ReactNode;
  assistantDocName: string;
}) {
  const [assistant, setAssistant] = useState(true);

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
        <ZoomCluster pct={Math.round(vp.scale * 100)} onIn={() => vp.zoomBy(1.2)} onOut={() => vp.zoomBy(1 / 1.2)} onFit={onFit} onAutoLayout={onAutoLayout} accent={accent} />
        <DioschubBadge />
        {!assistant && (
          <button onClick={() => setAssistant(true)} style={{ position: 'absolute', top: 14, right: 14, background: accent, color: '#fff', border: 'none', borderRadius: 9, padding: '7px 12px', fontSize: 13, fontWeight: 600, zIndex: 20 }}>
            Assistant
          </button>
        )}
      </div>

      {assistant && <EditorAssistant docName={assistantDocName} accent={accent} onClose={() => setAssistant(false)} />}
    </div>
  );
}
