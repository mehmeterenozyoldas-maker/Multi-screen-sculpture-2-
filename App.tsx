import React from 'react';
import { useWindowSync } from './hooks/useWindowSync';
import { PortalVisualizer } from './components/PortalVisualizer';
import { UIOverlay } from './components/UIOverlay';

const App: React.FC = () => {
  const { 
    myId, 
    peersRef, 
    peerCount, 
    getSelfState, 
    broadcastEvent, 
    eventQueueRef,
    interactionMode,
    setInteractionMode
  } = useWindowSync();

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black text-white select-none">
      {/* Background Canvas Layer */}
      <PortalVisualizer 
        peersRef={peersRef} 
        getSelfState={getSelfState} 
        broadcastEvent={broadcastEvent}
        eventQueueRef={eventQueueRef}
      />

      {/* Foreground UI Layer */}
      <UIOverlay 
        myId={myId} 
        peerCount={peerCount} 
        peers={peersRef.current}
        interactionMode={interactionMode}
        setInteractionMode={setInteractionMode}
      />
    </div>
  );
};

export default App;