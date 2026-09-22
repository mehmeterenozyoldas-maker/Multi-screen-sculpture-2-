import { useEffect, useRef, useState, useCallback } from 'react';
import { SyncMessage, WindowState, AppEvent, InteractionMode } from '../types';
import { CHANNEL_NAME, HEARTBEAT_INTERVAL, PRUNE_TIMEOUT } from '../constants';

// Declare global types for MediaPipe since they are loaded via script tags
declare const FaceMesh: any;
declare const Camera: any;

export const useWindowSync = () => {
  const [myId] = useState(() => Math.random().toString(36).slice(2, 9));
  const channelRef = useRef<BroadcastChannel | null>(null);
  const peersRef = useRef<Map<string, WindowState>>(new Map());
  const [peerCount, setPeerCount] = useState(1);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('GRAVITY');
  
  // Queue for incoming one-off events
  const eventQueueRef = useRef<AppEvent[]>([]);
  
  // Track mouse position
  const mouseRef = useRef({ x: 0, y: 0 });

  // Track Face/Blow State
  const faceStateRef = useRef({
    blowIntensity: 0,
    faceX: 0,
    faceY: 0,
    isTracking: false
  });
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const faceMeshRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);

  // --- Face Tracking Logic ---
  const onResults = useCallback((results: any) => {
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const landmarks = results.multiFaceLandmarks[0];
      
      // Calculate screen position of face (nose tip - index 1)
      const nose = landmarks[1];
      // Map normalized coordinates (0-1) to screen absolute coordinates
      // We flip x because webcam is mirrored
      const screenX = window.screenX + ((1 - nose.x) * window.innerWidth);
      const screenY = window.screenY + (nose.y * window.innerHeight);

      faceStateRef.current.faceX = screenX;
      faceStateRef.current.faceY = screenY;

      // Calculate Pucker (Blowing)
      // Top Lip Bottom: 13, Bottom Lip Top: 14
      // Mouth Left: 61, Mouth Right: 291
      const topLip = landmarks[13];
      const bottomLip = landmarks[14];
      const leftCorner = landmarks[61];
      const rightCorner = landmarks[291];

      // Distance calculation
      const dx = (p1: any, p2: any) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
      
      const mouthWidth = dx(leftCorner, rightCorner);
      const mouthHeight = dx(topLip, bottomLip);
      
      // Aspect Ratio: Height / Width
      // Normal mouth is wide (low ratio ~ 0.2 - 0.4)
      // Puckered mouth is round (high ratio > 0.6)
      // Open mouth (O-shape) is also high ratio
      const ratio = mouthHeight / (mouthWidth + 0.001); // Avoid div/0

      // Heuristic: If ratio is high and mouth is somewhat open, we are blowing
      let intensity = 0;
      if (ratio > 0.5) { 
        // Map 0.5 - 1.0 to 0 - 1 intensity
        intensity = Math.min(1, (ratio - 0.5) * 2.5);
      }
      
      // Smooth the intensity
      faceStateRef.current.blowIntensity = faceStateRef.current.blowIntensity * 0.7 + intensity * 0.3;
    } else {
      faceStateRef.current.blowIntensity = 0;
    }
  }, []);

  const setupCamera = useCallback(() => {
    if (faceStateRef.current.isTracking) return;
    
    // Create invisible video element
    if (!videoRef.current) {
        const vid = document.createElement('video');
        vid.className = 'input_video';
        vid.style.display = 'none';
        document.body.appendChild(vid);
        videoRef.current = vid;
    }

    try {
        const FM = (window as any).FaceMesh;
        const Cam = (window as any).Camera;

        if (!FM || !Cam) {
            console.warn("MediaPipe not yet loaded. Retrying in 1000ms...");
            setTimeout(setupCamera, 1000);
            return;
        }

        const faceMesh = new FM({locateFile: (file: string) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`;
        }});

        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        faceMesh.onResults(onResults);
        faceMeshRef.current = faceMesh;

        if (videoRef.current) {
            const camera = new Cam(videoRef.current, {
                onFrame: async () => {
                    if (videoRef.current && faceMeshRef.current) {
                        await faceMeshRef.current.send({image: videoRef.current});
                    }
                },
                width: 640,
                height: 480
            });
            camera.start();
            cameraRef.current = camera;
            faceStateRef.current.isTracking = true;
        }
    } catch (e) {
        console.error("Failed to initialize MediaPipe", e);
    }
  }, [onResults]);

  const stopCamera = useCallback(() => {
    if (cameraRef.current) {
        // There isn't a direct 'stop' method on the Camera utils that fully kills stream sometimes, 
        // so we manually stop tracks
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
        }
        cameraRef.current = null;
    }
    faceStateRef.current.isTracking = false;
    faceStateRef.current.blowIntensity = 0;
  }, []);

  // Handle Mode Switching
  useEffect(() => {
    if (interactionMode === 'WIND') {
        setupCamera();
    } else {
        stopCamera();
    }
  }, [interactionMode, setupCamera, stopCamera]);


  const getSelfState = useCallback((): WindowState => {
    return {
      id: myId,
      x: window.screenX,
      y: window.screenY,
      w: window.innerWidth,
      h: window.innerHeight,
      mouseX: window.screenX + mouseRef.current.x,
      mouseY: window.screenY + mouseRef.current.y,
      lastSeen: Date.now(),
      interactionMode: interactionMode,
      blowIntensity: faceStateRef.current.blowIntensity,
      faceX: faceStateRef.current.faceX,
      faceY: faceStateRef.current.faceY
    };
  }, [myId, interactionMode]);

  const broadcast = useCallback((type: 'HELLO' | 'UPDATE' | 'GOODBYE') => {
    if (!channelRef.current) return;
    const state = getSelfState();
    const msg: SyncMessage = { type, ...state };
    channelRef.current.postMessage(msg);
  }, [getSelfState]);

  const broadcastEvent = useCallback((event: AppEvent) => {
    if (!channelRef.current) return;
    eventQueueRef.current.push(event);
    const msg: SyncMessage = { 
        type: 'EVENT', 
        id: myId,
        event 
    };
    channelRef.current.postMessage(msg);
  }, [myId]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', handleMouseMove);

    channelRef.current = new BroadcastChannel(CHANNEL_NAME);

    const handleMessage = (event: MessageEvent<SyncMessage>) => {
      const msg = event.data;
      if (msg.id === myId) return;

      if (msg.type === 'GOODBYE') {
        peersRef.current.delete(msg.id);
      } else if (msg.type === 'EVENT' && msg.event) {
        eventQueueRef.current.push(msg.event);
      } else {
        if (msg.x !== undefined && msg.y !== undefined) {
             peersRef.current.set(msg.id, {
              id: msg.id,
              x: msg.x!,
              y: msg.y!,
              w: msg.w!,
              h: msg.h!,
              mouseX: msg.mouseX || 0,
              mouseY: msg.mouseY || 0,
              lastSeen: Date.now(),
              interactionMode: msg.interactionMode || 'GRAVITY',
              blowIntensity: msg.blowIntensity || 0,
              faceX: msg.faceX || 0,
              faceY: msg.faceY || 0
            });
        }
        if (msg.type === 'HELLO') {
          broadcast('UPDATE');
        }
      }
      setPeerCount(peersRef.current.size + 1);
    };

    channelRef.current.onmessage = handleMessage;
    broadcast('HELLO');

    const intervalId = setInterval(() => {
      broadcast('UPDATE');
      const now = Date.now();
      let changed = false;
      peersRef.current.forEach((peer, id) => {
        if (now - peer.lastSeen > PRUNE_TIMEOUT) {
          peersRef.current.delete(id);
          changed = true;
        }
      });
      if (changed) setPeerCount(peersRef.current.size + 1);
    }, HEARTBEAT_INTERVAL);

    const cleanup = () => {
      broadcast('GOODBYE');
      channelRef.current?.close();
      window.removeEventListener('mousemove', handleMouseMove);
      stopCamera(); // Ensure camera stops on unmount
    };

    window.addEventListener('beforeunload', cleanup);
    
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('beforeunload', cleanup);
      cleanup();
    };
  }, [myId, broadcast, stopCamera]);

  return { 
    myId, 
    peersRef, 
    peerCount, 
    getSelfState, 
    broadcastEvent, 
    eventQueueRef,
    interactionMode,
    setInteractionMode
  };
};