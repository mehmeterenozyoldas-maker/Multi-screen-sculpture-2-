import React, { useMemo, useState, useEffect } from 'react';
import { WindowState, InteractionMode } from '../types';

interface UIOverlayProps {
  myId: string;
  peerCount: number;
  peers: Map<string, WindowState>;
  interactionMode: InteractionMode;
  setInteractionMode: (mode: InteractionMode) => void;
}

export const UIOverlay: React.FC<UIOverlayProps> = ({ 
    myId, 
    peerCount, 
    peers, 
    interactionMode, 
    setInteractionMode 
}) => {
  const [currentWin, setCurrentWin] = useState({
      x: window.screenX ?? 0,
      y: window.screenY ?? 0,
      w: window.innerWidth,
      h: window.innerHeight
  });

  // Update local window tracking for the map more frequently than React renders if needed
  useEffect(() => {
      const interval = setInterval(() => {
          const x = window.screenX ?? (window as any).screenLeft ?? 0;
          const y = window.screenY ?? (window as any).screenTop ?? 0;
          if (x !== currentWin.x || y !== currentWin.y || window.innerWidth !== currentWin.w || window.innerHeight !== currentWin.h) {
              setCurrentWin({ x, y, w: window.innerWidth, h: window.innerHeight });
          }
      }, 200);
      return () => clearInterval(interval);
  }, [currentWin]);

  const openNewWindow = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const w = 600;
    const h = 600;
    
    // Cross-browser screen position
    const screenLeft = window.screenX ?? (window as any).screenLeft ?? 0;
    const screenTop = window.screenY ?? (window as any).screenTop ?? 0;
    const screenWidth = window.screen.availWidth || window.innerWidth;
    
    // Default to opening to the right of the current window
    let left = screenLeft + (window.outerWidth || window.innerWidth) + 10;
    let top = screenTop;

    if (left + w > screenLeft + screenWidth) {
        // Fallback: Cascade diagonally
        left = screenLeft + 40;
        top = screenTop + 40;
    }

    const features = `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`;
    
    try {
      const newWin = window.open(window.location.href, '_blank', features);
      if (!newWin) {
        alert("Window blocked! Please allow pop-ups for this site to enable the multi-window experience.");
      }
    } catch (err) {
      console.error("Failed to open window:", err);
      alert("Error opening window. Check console for details.");
    }
  };

  // MiniMap Calculations
  const { mapItems, viewBox } = useMemo(() => {
    const list: WindowState[] = Array.from(peers.values());
    list.push({
        id: myId,
        x: currentWin.x,
        y: currentWin.y,
        w: currentWin.w,
        h: currentWin.h,
        mouseX: 0, mouseY: 0, lastSeen: Date.now(),
        interactionMode: interactionMode,
        blowIntensity: 0,
        faceX: 0, faceY: 0
    });

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    list.forEach(w => {
        minX = Math.min(minX, w.x);
        maxX = Math.max(maxX, w.x + w.w);
        minY = Math.min(minY, w.y);
        maxY = Math.max(maxY, w.y + w.h);
    });

    // Padding relative to coordinate space
    const padding = 200;
    minX -= padding;
    minY -= padding;
    const width = (maxX + padding) - minX;
    const height = (maxY + padding) - minY;

    return {
        mapItems: list,
        viewBox: `${minX} ${minY} ${width} ${height}`
    };
  }, [peers, peerCount, myId, currentWin, interactionMode]);

  return (
    <div className="fixed top-4 left-4 z-50 flex flex-col gap-4 pointer-events-none">
      {/* Status Card */}
      <div className="bg-slate-900/80 backdrop-blur-md border border-cyan-500/30 p-4 rounded-lg shadow-[0_0_15px_rgba(0,255,255,0.1)] max-w-xs pointer-events-auto transition-all hover:border-cyan-500/50">
        <h1 className="text-cyan-400 font-bold text-lg tracking-wider uppercase mb-1">
          Neural Sync
        </h1>
        <div className="space-y-1 text-xs text-slate-300 font-mono">
          <div className="flex justify-between">
            <span>NODE_ID:</span>
            <span className="text-cyan-200">{myId}</span>
          </div>
          <div className="flex justify-between">
            <span>ACTIVE_NODES:</span>
            <span className="text-white font-bold">{peerCount}</span>
          </div>
        </div>
        
        {/* Interaction Mode Toggle */}
        <div className="mt-3 pt-3 border-t border-cyan-500/20">
           <div className="flex justify-between items-center mb-2">
               <span className="text-[10px] text-cyan-500/70 uppercase tracking-widest">Interaction Source</span>
           </div>
           <div className="flex bg-slate-950/50 rounded-md p-1 border border-cyan-500/20">
               <button 
                  onClick={() => setInteractionMode('GRAVITY')}
                  className={`flex-1 py-1 text-[10px] font-bold tracking-wide rounded transition-all ${
                      interactionMode === 'GRAVITY' 
                      ? 'bg-cyan-500/20 text-cyan-200 shadow-[0_0_10px_rgba(6,182,212,0.2)]' 
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
               >
                   GRAVITY
               </button>
               <button 
                  onClick={() => setInteractionMode('WIND')}
                  className={`flex-1 py-1 text-[10px] font-bold tracking-wide rounded transition-all flex items-center justify-center gap-1 ${
                      interactionMode === 'WIND' 
                      ? 'bg-purple-500/20 text-purple-200 shadow-[0_0_10px_rgba(168,85,247,0.2)]' 
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
               >
                   <span>WIND</span>
                   {interactionMode === 'WIND' && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" title="Camera Active"></span>}
               </button>
           </div>
           {interactionMode === 'WIND' && (
               <div className="text-[9px] text-purple-400/60 mt-1 text-center">
                   Allow Camera • Blow to push particles
               </div>
           )}
        </div>
      </div>

      {/* MiniMap */}
      <div className="bg-slate-900/90 backdrop-blur-sm border border-cyan-500/20 rounded-lg p-2 w-[180px] h-[120px] pointer-events-auto shadow-lg relative overflow-hidden group">
         <div className="absolute top-1 left-2 text-[10px] text-cyan-500/50 font-mono uppercase tracking-widest">Topology</div>
         <svg viewBox={viewBox} className="w-full h-full opacity-80" preserveAspectRatio="xMidYMid meet">
            {/* Connections */}
            {mapItems.map((w1, i) => 
                 mapItems.slice(i + 1).map(w2 => (
                    <line 
                        key={`${w1.id}-${w2.id}`}
                        x1={w1.x + w1.w/2} 
                        y1={w1.y + w1.h/2} 
                        x2={w2.x + w2.w/2} 
                        y2={w2.y + w2.h/2} 
                        stroke="rgba(6,182,212,0.3)" 
                        strokeWidth="20"
                    />
                 ))
            )}
            
            {/* Windows */}
            {mapItems.map(w => {
                const isMe = w.id === myId;
                return (
                    <g key={w.id}>
                        <rect 
                            x={w.x} 
                            y={w.y} 
                            width={w.w} 
                            height={w.h} 
                            fill={isMe ? "rgba(6,182,212,0.6)" : "rgba(148,163,184,0.3)"}
                            stroke={isMe ? "#22d3ee" : "#94a3b8"}
                            strokeWidth="10"
                            rx="20"
                        />
                        {isMe && (
                             <circle cx={w.x + w.w/2} cy={w.y + w.h/2} r={Math.min(w.w, w.h) * 0.15} fill="#ffffff" fillOpacity="0.8" className="animate-pulse"/>
                        )}
                    </g>
                );
            })}
         </svg>
      </div>

      {/* Action Button */}
      <button
        type="button"
        onClick={openNewWindow}
        className="pointer-events-auto bg-cyan-950/80 hover:bg-cyan-800/80 text-cyan-100 border border-cyan-500/50 px-5 py-3 rounded-full 
        font-semibold text-sm tracking-wide transition-all shadow-[0_0_20px_rgba(6,182,212,0.2)] hover:shadow-[0_0_30px_rgba(6,182,212,0.4)] hover:scale-105 active:scale-95 flex items-center gap-2 group cursor-pointer w-max"
      >
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
        INITIATE NEW NODE
      </button>
      
      <div className="text-[10px] text-cyan-600/60 max-w-[200px] pointer-events-auto">
        If pop-up is blocked, check your browser address bar settings.
      </div>
    </div>
  );
};