import React, { useEffect, useRef } from 'react';
import p5 from 'p5';
import { WindowState, WorldBounds, AppEvent } from '../types';
import { 
  PARTICLE_COUNT, 
  RING_RADIUS_BASE, 
  TRAIL_LENGTH,
  COLOR_PRIMARY_HUE,
  COLOR_SECONDARY_HUE,
  COLOR_ACCENT_HUE
} from '../constants';

// --- SHADERS ---

// Vertex Shader: Passes geometry data to fragment shader
const vertShader = `
  precision highp float;
  attribute vec3 aPosition;
  attribute vec2 aTexCoord;
  attribute vec3 aNormal;

  uniform mat4 uModelViewMatrix;
  uniform mat4 uProjectionMatrix;
  uniform mat3 uNormalMatrix;

  varying vec2 vTexCoord;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vViewPosition;

  void main() {
    vTexCoord = aTexCoord;
    vec4 positionVec4 = vec4(aPosition, 1.0);
    
    // Position in world/view space
    vec4 viewModelPosition = uModelViewMatrix * positionVec4;
    vViewPosition = viewModelPosition.xyz;
    
    // Normal in view space
    vNormal = normalize(uNormalMatrix * aNormal);
    vPosition = aPosition; 

    gl_Position = uProjectionMatrix * viewModelPosition;
  }
`;

// Fragment Shader: LIQUID GLASS PBR + AMBIENT OCCLUSION
const fragShader = `
  precision highp float;
  varying vec2 vTexCoord;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vViewPosition;

  uniform float uTime;
  uniform float uNoiseOffset; 
  uniform vec3 uColorDeep;
  uniform vec3 uColorMid;
  uniform vec3 uColorRim;

  // --- NOISE FUNCTIONS ---
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 = v - i + dot(i, C.xxx) ;
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy; 
    vec3 x3 = x0 - D.yyy;      
    i = mod289(i); 
    vec4 p = permute( permute( permute( 
               i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
             + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
    float n_ = 0.142857142857; 
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z); 
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );   
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
  }

  // Optimized FBM (2 octaves unrolled)
  float fbm(vec3 x) {
      float v = 0.0;
      float a = 0.5;
      vec3 shift = vec3(100.0);
      
      // Octave 1
      v += a * snoise(x);
      x = x * 2.0 + shift;
      a *= 0.5;
      
      // Octave 2
      v += a * snoise(x);
      
      return v;
  }

  void main() {
    vec3 viewDir = normalize(-vViewPosition); 
    vec3 baseNormal = normalize(vNormal);
    
    // --- MICRO-SURFACE & BUMP MAPPING ---
    
    // 1. Macro liquid movement (Large, slow waves)
    vec3 pMacro = vPosition * 0.006 + vec3(uNoiseOffset, uTime * 0.02, uTime * 0.01);
    float nMacro = fbm(pMacro);

    // 2. Micro surface detail (Higher freq, lower amp for glass sheen)
    vec3 pMicro = vPosition * 0.12 + vec3(0.0, uTime * 0.03, 0.0);
    float nMicro = snoise(pMicro) * 0.008; 

    // Calculate bump gradient
    float eps = 0.5;
    // Macro gradient
    float nMX = fbm(pMacro + vec3(eps*0.01, 0.0, 0.0));
    float nMY = fbm(pMacro + vec3(0.0, eps*0.01, 0.0));
    float nMZ = fbm(pMacro + vec3(0.0, 0.0, eps*0.01));
    vec3 gradMacro = vec3(nMX - nMacro, nMY - nMacro, nMZ - nMacro) / (eps*0.01);

    // Micro gradient
    float nmX = snoise(pMicro + vec3(eps*0.1, 0.0, 0.0)) * 0.008;
    float nmY = snoise(pMicro + vec3(0.0, eps*0.1, 0.0)) * 0.008;
    float nmZ = snoise(pMicro + vec3(0.0, 0.0, eps*0.1)) * 0.008;
    vec3 gradMicro = vec3(nmX - nMicro, nmY - nMicro, nmZ - nMicro) / (eps*0.1);

    // Combine normals - SUBTLER BUMP for smoother glass
    vec3 bumpNormal = normalize(baseNormal - (gradMacro * 0.1 + gradMicro * 0.02));

    // --- AMBIENT OCCLUSION (Procedural) ---
    // Calculate occlusion based on height map. Deep valleys (low nMacro) are occluded.
    float aoMacro = smoothstep(-0.6, 0.7, nMacro); // Map noise range to 0-1 for AO
    // Micro details also contribute slightly
    float aoMicro = smoothstep(-0.5, 0.5, nMicro); 
    
    // Combine and clamp
    float ao = clamp(aoMacro * 0.8 + aoMicro * 0.2 + 0.2, 0.0, 1.0);
    ao = pow(ao, 0.7); // Tweak curve to be less harsh

    // --- PBR LIGHTING ---

    // Lighting Vectors
    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.8)); 
    vec3 halfDir = normalize(lightDir + viewDir);
    
    float NdotL = max(dot(bumpNormal, lightDir), 0.0);
    float NdotV = max(dot(bumpNormal, viewDir), 0.0);
    float NdotH = max(dot(bumpNormal, halfDir), 0.0);

    // Roughness - Smoother overall
    float roughness = 0.04 + abs(nMicro) * 0.15; 
    
    // Specular - Sharper/Wetter
    float shininess = 2.0 / (roughness * roughness * roughness * roughness + 0.001) - 2.0;
    shininess = clamp(shininess, 30.0, 600.0);
    
    float specular = pow(NdotH, shininess) * (shininess * 0.004); 

    // Fresnel
    float F0 = 0.04; // Slightly more reflective than standard glass
    float fresnel = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);

    // Environment Reflection
    vec3 reflectDir = reflect(-viewDir, bumpNormal);
    
    float horizRefl = smoothstep(-0.1, 0.2, reflectDir.y);
    float topRefl = smoothstep(0.4, 1.0, reflectDir.y);
    
    vec3 envColor = vec3(0.02, 0.03, 0.04); 
    envColor += vec3(0.5, 0.6, 0.7) * topRefl * 0.4; 
    envColor += vec3(0.1, 0.1, 0.12) * horizRefl * 0.2; 
    
    // Occlude reflections in deep crevices
    envColor *= ao;

    // --- COLOR COMPOSITION ---
    
    float noiseMix = (nMacro + 1.0) * 0.5;
    vec3 baseColor = mix(uColorDeep, uColorMid, noiseMix);

    // Apply AO to base color
    vec3 finalColor = baseColor * 0.6 * ao; 
    
    finalColor += specular * vec3(0.95, 0.95, 0.9); 
    finalColor += envColor * fresnel * 2.5; 
    
    // Rim light also occluded slightly in cracks
    finalColor += uColorRim * pow(1.0 - NdotV, 3.0) * 0.4 * ao; 

    float alpha = 0.4 + 0.6 * fresnel; 
    
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

interface PortalVisualizerProps {
  peersRef: React.MutableRefObject<Map<string, WindowState>>;
  eventQueueRef: React.MutableRefObject<AppEvent[]>;
  getSelfState: () => WindowState;
  broadcastEvent: (event: AppEvent) => void;
}

export const PortalVisualizer: React.FC<PortalVisualizerProps> = ({ 
    peersRef, 
    getSelfState, 
    eventQueueRef, 
    broadcastEvent 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevWinPos = useRef({ x: window.screenX, y: window.screenY });

  useEffect(() => {
    if (!containerRef.current) return;

    const sketch = (p: p5) => {
      interface Point { x: number, y: number, z: number }
      
      interface Particle {
        angle: number;
        radius: number;
        speed: number;
        size: number;
        baseHue: number;
        z: number;
        zSpeed: number;
        history: Point[];
        offset: number;
        inertiaX: number;
        inertiaY: number;
        velX: number;
        velY: number;
      }
      
      interface NodeStar {
        x: number;
        y: number;
        z: number;
        size: number;
        connectedTo: number[]; 
      }

      interface VolumetricRay {
        angle: number;
        speed: number;
        width: number;
        height: number;
      }

      interface CoreBubble {
        orbitOffset: number;
        orbitSpeed: number;
        sizeMult: number;
        yOffset: number;
        noiseOffset: number;
      }

      interface ActiveShockwave {
        x: number;
        y: number;
        startTime: number;
        id: string;
      }

      const particles: Particle[] = [];
      const nodeStars: NodeStar[] = [];
      const rays: VolumetricRay[] = [];
      const coreBubbles: CoreBubble[] = [];
      const cursorTrails = new Map<string, {x: number, y: number, z: number}[]>();
      let activeShockwaves: ActiveShockwave[] = [];
      
      let plasmaShader: p5.Shader;
      let gridTexture: p5.Graphics;
      let isWebGL = true;

      p.setup = () => {
        try {
          p.createCanvas(window.innerWidth, window.innerHeight, p.WEBGL);
          isWebGL = true;
        } catch (e) {
          console.error("WebGL failed, attempting fallback to P2D", e);
          p.createCanvas(window.innerWidth, window.innerHeight, p.P2D);
          isWebGL = false;
        }
        p.setAttributes('alpha', true);
        p.setAttributes('antialias', true);
        p.frameRate(60);
        
        if (isWebGL) {
          plasmaShader = p.createShader(vertShader, fragShader);
        }

        // Procedural Grid Texture
        gridTexture = p.createGraphics(512, 512);
        gridTexture.colorMode(p.HSB, 360, 100, 100);
        gridTexture.noFill();
        gridTexture.stroke(COLOR_PRIMARY_HUE, 15, 50); // Less saturated
        gridTexture.strokeWeight(2);
        const step = 64;
        for(let x=0; x<=512; x+=step) gridTexture.line(x, 0, x, 512);
        for(let y=0; y<=512; y+=step) gridTexture.line(0, y, 512, y);
        gridTexture.loadPixels();
        for(let i=0; i<gridTexture.width; i++) {
           for(let j=0; j<gridTexture.height; j++) {
              const d = p.dist(i, j, 256, 256);
              const alpha = p.map(d, 0, 256, 255, 0, true);
              const idx = (i + j * gridTexture.width) * 4;
              gridTexture.pixels[idx+3] = (gridTexture.pixels[idx+3] * alpha) / 255;
           }
        }
        gridTexture.updatePixels();

        p.colorMode(p.HSB, 360, 100, 100, 100);

        // Particles
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          particles.push({
            angle: p.random(p.TWO_PI),
            radius: p.random(200, 1800), 
            speed: p.random(0.00005, 0.0002) * (Math.random() > 0.5 ? 1 : -1),
            size: p.random(2, 4.5), 
            baseHue: Math.random() > 0.7 ? COLOR_ACCENT_HUE : (Math.random() > 0.5 ? COLOR_PRIMARY_HUE : COLOR_SECONDARY_HUE),
            z: p.random(-250, 250),
            zSpeed: p.random(-0.015, 0.015),
            history: [],
            offset: p.random(100),
            inertiaX: 0,
            inertiaY: 0,
            velX: 0,
            velY: 0
          });
        }

        // Neural Lattice Nodes
        const range = 5000;
        for (let i = 0; i < 80; i++) {
            const node: NodeStar = {
                x: p.random(-range, range),
                y: p.random(-range, range),
                z: p.random(-4000, -1000), 
                size: p.random(4, 10),
                connectedTo: []
            };
            nodeStars.push(node);
        }
        for(let i=0; i<nodeStars.length; i++) {
            for(let j=i+1; j<nodeStars.length; j++) {
                const d = p.dist(nodeStars[i].x, nodeStars[i].y, nodeStars[i].z, nodeStars[j].x, nodeStars[j].y, nodeStars[j].z);
                if(d < 2500) {
                    nodeStars[i].connectedTo.push(j);
                }
            }
        }

        // Volumetric Rays
        for(let i=0; i<6; i++) {
            rays.push({
                angle: p.random(p.TWO_PI),
                speed: p.random(0.0003, 0.0008), 
                width: p.random(400, 1200),
                height: p.random(2000, 4000)
            });
        }

        // Core Bubbles
        for (let i = 0; i < 16; i++) {
            coreBubbles.push({
                orbitOffset: p.random(p.TWO_PI),
                orbitSpeed: p.random(0.2, 0.5) * (Math.random() > 0.5 ? 1 : -1),
                sizeMult: i === 0 ? 1.0 : p.random(0.25, 0.45), 
                yOffset: p.random(-100, 100),
                noiseOffset: p.random(1000)
            });
        }
      };

      p.windowResized = () => {
        p.resizeCanvas(window.innerWidth, window.innerHeight);
      };

      p.mousePressed = () => {
          const self = getSelfState();
          const mx = p.mouseX; 
          const my = p.mouseY;
          const worldX = self.x + mx;
          const worldY = self.y + my;
          
          broadcastEvent({
              type: 'SHOCKWAVE',
              x: worldX,
              y: worldY,
              timestamp: Date.now(),
              originId: self.id
          });
      };

      const calculateWorldBounds = (): WorldBounds => {
        const self = getSelfState();
        const allPeers: WindowState[] = Array.from(peersRef.current.values());
        
        if (allPeers.length === 0) {
          return {
            minX: self.x, maxX: self.x + self.w,
            minY: self.y, maxY: self.y + self.h,
            centerX: self.x + self.w / 2,
            centerY: self.y + self.h / 2,
            width: self.w, height: self.h
          };
        }

        allPeers.push(self);
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        allPeers.forEach(peer => {
          minX = Math.min(minX, peer.x);
          maxX = Math.max(maxX, peer.x + peer.w);
          minY = Math.min(minY, peer.y);
          maxY = Math.max(maxY, peer.y + peer.h);
        });

        return {
          minX, maxX, minY, maxY,
          centerX: (minX + maxX) / 2,
          centerY: (minY + maxY) / 2,
          width: maxX - minX,
          height: maxY - minY
        };
      };

      const drawTexturedGrid = (offsetX: number, offsetY: number, excitement: number) => {
        p.push();
        p.translate(0, 0, -500); 
        p.rotateX(p.PI / 2);
        
        const textureSize = 2000;
        const uOffset = (offsetX * 0.5) % textureSize;
        const vOffset = (offsetY * 0.5) % textureSize;
        
        p.translate(uOffset, vOffset);
        
        p.noStroke();
        p.texture(gridTexture);
        p.tint(255, 10 + excitement * 10); 
        p.plane(6000, 6000); 
        p.pop();
      };

      const drawNeuralFractals = (centerX: number, centerY: number, excitement: number, time: number) => {
        p.push();
        p.translate(centerX, centerY, -1200); 
        p.rotateZ(time * 0.05);
        
        p.rotateX(p.PI / 12); 

        const layers = 3;
        const baseAlpha = 2 + excitement * 3;

        for (let i = 0; i < layers; i++) {
          p.push();
          const dir = i % 2 === 0 ? 1 : -1;
          const layerSpeed = 0.05 * dir * (1 + excitement * 0.2);
          p.rotateZ(time * layerSpeed);

          const radius = 800 + i * 500;
          const breath = p.sin(time * 0.5 + i) * 50;
          const r = radius + breath;

          const segments = 6 + i * 2; 
          const angleStep = p.TWO_PI / segments;

          p.noFill();
          const hue = p.lerp(COLOR_PRIMARY_HUE, COLOR_SECONDARY_HUE, i / (layers - 1));
          p.stroke(hue, 30, 60, baseAlpha);
          p.strokeWeight(1.5);

          p.beginShape();
          for (let j = 0; j <= segments; j++) {
             const theta = j * angleStep;
             const px = p.cos(theta) * r;
             const py = p.sin(theta) * r;
             p.vertex(px, py);
          }
          p.endShape(p.CLOSE);

          for (let j = 0; j < segments; j++) {
             const theta = j * angleStep;
             const px = p.cos(theta) * r;
             const py = p.sin(theta) * r;

             p.push();
             p.translate(px, py, 0);
             p.noStroke();
             p.fill(hue, 30, 80, baseAlpha * 1.5);
             p.sphere(5 + excitement * 2);
             p.pop();

             if (i > 0) {
                 const prevR = 800 + (i - 1) * 500 + breath; 
                 const innerX = p.cos(theta) * prevR;
                 const innerY = p.sin(theta) * prevR;
                 
                 p.stroke(hue, 20, 50, baseAlpha * 0.3); 
                 p.line(px, py, 0, innerX, innerY, 0);
             }
          }
          p.pop();
        }
        p.pop();
      };

      const drawSilkStream = (x1: number, y1: number, x2: number, y2: number, time: number) => {
        const dist = p.dist(x1, y1, x2, y2);
        const segments = Math.floor(dist / 20);
        if (segments < 2) return;

        p.push();
        p.noFill();
        p.blendMode(p.ADD);
        const strands = 3;
        for (let s = 0; s < strands; s++) {
            p.strokeWeight(s === 0 ? 1.5 : 0.5); 
            p.beginShape();
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const lx = p.lerp(x1, x2, t);
                const ly = p.lerp(y1, y2, t);
                const lz = -150 * p.sin(t * p.PI); 
                const wave = p.sin(t * p.PI * 2 + time + s) * 8 * p.sin(t * p.PI); 
                const hue = p.lerp(COLOR_PRIMARY_HUE, COLOR_SECONDARY_HUE, t);
                p.stroke(hue, 30, 80, 15); 
                p.vertex(lx, ly + wave, lz);
            }
            p.endShape();
        }
        p.pop();
      };

      p.draw = () => {
        const time = Date.now() * 0.00018; 
        const nowMs = Date.now();
        const self = getSelfState();
        const bounds = calculateWorldBounds();
        const peers: WindowState[] = Array.from(peersRef.current.values());

        // --- EMBODIED INERTIA PHYSICS ---
        const currentWinX = window.screenX;
        const currentWinY = window.screenY;
        const deltaX = currentWinX - prevWinPos.current.x;
        const deltaY = currentWinY - prevWinPos.current.y;
        prevWinPos.current = { x: currentWinX, y: currentWinY };

        // Process Queue
        while(eventQueueRef.current.length > 0) {
            const ev = eventQueueRef.current.shift();
            if (ev && ev.type === 'SHOCKWAVE') {
                activeShockwaves.push({
                    x: ev.x, y: ev.y, startTime: nowMs, id: ev.originId
                });
            }
        }
        activeShockwaves = activeShockwaves.filter(sw => nowMs - sw.startTime < 3000);

        const localCenterX = bounds.centerX - self.x;
        const localCenterY = bounds.centerY - self.y;
        const myCenterX = self.w / 2;
        const myCenterY = self.h / 2;

        // Collect all interactions (local and remote)
        const interactions = [
            { 
                x: (self.interactionMode === 'WIND' ? (self.faceX || self.x + self.w/2) : self.mouseX) - bounds.centerX,
                y: (self.interactionMode === 'WIND' ? (self.faceY || self.y + self.h/2) : self.mouseY) - bounds.centerY,
                isRemote: false, 
                id: self.id,
                mode: self.interactionMode || 'GRAVITY',
                intensity: self.blowIntensity || 0
            },
            ...peers.map(peer => ({ 
                x: (peer.interactionMode === 'WIND' ? (peer.faceX || peer.x + peer.w/2) : peer.mouseX) - bounds.centerX, 
                y: (peer.interactionMode === 'WIND' ? (peer.faceY || peer.y + peer.h/2) : peer.mouseY) - bounds.centerY, 
                isRemote: true,
                id: peer.id,
                mode: peer.interactionMode || 'GRAVITY',
                intensity: peer.blowIntensity || 0
            }))
        ];

        let closestDist = Infinity;
        peers.forEach(peer => {
            const peerLocalCX = (peer.x + peer.w / 2) - self.x;
            const peerLocalCY = (peer.y + peer.h / 2) - self.y;
            const d = p.dist(myCenterX, myCenterY, peerLocalCX, peerLocalCY);
            if(d < closestDist) closestDist = d;
        });

        const distToSingularity = p.dist(myCenterX, myCenterY, localCenterX, localCenterY);
        const singularityProx = p.map(distToSingularity, 0, 800, 1, 0, true);
        let excitement = p.map(closestDist, 300, 1200, 1, 0, true);
        excitement = Math.max(excitement, singularityProx * 0.8);
        if (peers.length === 0 && distToSingularity > 200) excitement = 0; 
        excitement *= 0.5;

        // Add excitement if anyone is blowing
        const maxBlow = Math.max(...interactions.map(i => i.intensity));
        excitement += maxBlow * 0.5;

        let coreShock = 0;
        activeShockwaves.forEach(sw => {
            const dist = p.dist(sw.x - bounds.centerX, sw.y - bounds.centerY, 0, 0);
            const age = nowMs - sw.startTime;
            const radius = age * 0.8;
            if (Math.abs(dist - radius) < 100) {
                coreShock += 1.0 * (1 - age/3000);
            }
        });

        // --- RENDER SCENE ---
        
        p.background(6, 7, 12); 
        p.ambientLight(30, 35, 45); 
        p.pointLight(200, 10, 70, localCenterX + 300, localCenterY - 300, 400); 
        p.pointLight(30, 15, 60, localCenterX - 300, localCenterY + 100, 200); 
        p.directionalLight(0, 0, 80, 0, 0, -1); 

        p.push();
        p.translate(-p.width / 2, -p.height / 2, 0); 
        const breath = p.sin(time * 0.8) * 15; 
        p.translate(0, 0, breath);
        const driftX = p.sin(time * 0.5) * 4;
        const driftY = p.cos(time * 0.3) * 4;
        p.translate(driftX, driftY, 0);

        // Parallax Tilt based on local interaction source (mouse or face)
        const localInteract = interactions.find(i => !i.isRemote);
        if (localInteract) {
            const tiltX = localInteract.x + bounds.centerX;
            const tiltY = localInteract.y + bounds.centerY;
            p.translate(p.width/2, p.height/2, 0);
            p.rotateY(p.map(tiltX, 0, p.width, -0.01, 0.01)); 
            p.rotateX(p.map(tiltY, 0, p.height, 0.01, -0.01));
            p.translate(-p.width/2, -p.height/2, 0);
        }

        // Draw Interaction Lights
        interactions.forEach(m => {
             const hue = m.isRemote ? COLOR_SECONDARY_HUE : COLOR_ACCENT_HUE;
             // If blowing, pulse the light intensity
             const pulse = m.intensity > 0.1 ? (1 + p.sin(time * 20) * 0.5) : 1;
             p.pointLight(hue, 30 + m.intensity * 50, 70, localCenterX + m.x, localCenterY + m.y, 100 * pulse);
        });

        // Background Architecture
        p.noLights(); 
        p.push();
        p.translate(localCenterX, localCenterY, 0); 
        
        // Aurora
        p.push();
        p.translate(0, -600, -2000); 
        p.rotateX(p.PI / 6); 
        p.blendMode(p.ADD);
        const auroraLayers = 3;
        const auroraWidth = 6000;
        const auroraSegments = 60;
        
        for(let i=0; i<auroraLayers; i++) {
            p.push();
            p.translate(0, 0, -i * 400); 
            p.beginShape(p.TRIANGLE_STRIP);
            p.noStroke();
            for(let j=0; j<=auroraSegments; j++) {
                const t = j / auroraSegments;
                const x = (t - 0.5) * auroraWidth;
                // Add blowing turbulence to aurora
                const turbulence = maxBlow * p.sin(x * 0.01 + time * 10) * 100;
                const noiseVal = p.noise(x * 0.0003, i, time * 0.1); 
                const wave = p.sin(x * 0.001 + time * 0.2 + i) * 400;
                const hue = p.lerp(160, 250, noiseVal); 
                const alphaBase = (0.1 + noiseVal * 0.2) * (1 + excitement * 0.5);
                const fade = p.sin(t * p.PI); 
                const alpha = alphaBase * fade * 20; 
                p.fill(hue, 50, 80, 0);
                p.vertex(x, -800 - noiseVal * 400 + turbulence, wave);
                p.fill(hue, 50, 80, alpha);
                p.vertex(x, 200 + noiseVal * 200 + turbulence, wave);
            }
            p.endShape();
            p.pop();
        }
        p.pop(); 

        drawNeuralFractals(0, 0, excitement, time);

        p.push();
        p.blendMode(p.ADD);
        rays.forEach(ray => {
            p.push();
            p.rotateZ(ray.angle + time * ray.speed + (maxBlow * 0.1)); // Spin rays faster on blow
            p.translate(0, 0, -200);
            p.fill(COLOR_PRIMARY_HUE, 20, 50, 1.5); 
            p.noStroke();
            p.plane(ray.width, ray.height);
            p.pop();
        });
        p.pop(); 

        // Neural Lattice
        p.push();
        p.strokeWeight(1);
        p.noFill();
        nodeStars.forEach(node => {
          p.push();
          p.translate(node.x, node.y, node.z);
          // Jitter nodes if blowing
          if (maxBlow > 0.1) {
             p.translate(p.random(-5, 5) * maxBlow, p.random(-5, 5) * maxBlow, 0);
          }
          const flicker = p.noise(node.x, time * 0.5) * 40 + 60;
          p.fill(210, 10, 90, flicker * 0.25); 
          p.noStroke();
          p.sphere(node.size);
          p.stroke(210, 10, 80, 8); 
          node.connectedTo.forEach(targetIdx => {
             const target = nodeStars[targetIdx];
             p.line(0, 0, 0, target.x - node.x, target.y - node.y, target.z - node.z);
          });
          p.pop();
        });
        p.pop();
        p.pop(); 

        drawTexturedGrid(localCenterX, localCenterY, excitement);

        drawSilkStream(myCenterX, myCenterY, localCenterX, localCenterY, time);
        peers.forEach(peer => {
            const peerLocalCX = (peer.x + peer.w / 2) - self.x;
            const peerLocalCY = (peer.y + peer.h / 2) - self.y;
            drawSilkStream(peerLocalCX, peerLocalCY, localCenterX, localCenterY, time + 20);
        });

        p.ambientLight(230, 15, 20); 

        // SINGULARITY
        p.push();
        p.translate(localCenterX, localCenterY, 0); 
        p.blendMode(p.ADD);
        
        coreBubbles.slice(1).forEach((bubble, i) => {
            p.push();
            const chaos = 1.0 + excitement * 1.5 + coreShock * 6.0; 
            const baseR = RING_RADIUS_BASE * 0.45; 
            const theta = time * bubble.orbitSpeed * chaos + bubble.orbitOffset;
            const phi = time * bubble.orbitSpeed * 0.5 * chaos + bubble.yOffset;
            
            let bx = baseR * p.sin(theta) * p.cos(phi);
            let by = baseR * p.sin(theta) * p.sin(phi);
            let bz = baseR * p.cos(theta);
            
            let swarmX = 0;
            let swarmY = 0;
            let swarmCount = 0;
            let isAffectedByRemote = false;
            let isAffectedByLocal = false;

            interactions.forEach(m => {
                 // Only attract if GRAVITY mode or intensity is low
                 if (m.mode === 'WIND' && m.intensity > 0.3) {
                     // Repel from core if blowing hard near it
                     const dist = p.dist(bx, by, m.x, m.y);
                     if (dist < 400) {
                         // Push core away
                         const push = p.map(dist, 0, 400, 50, 0) * m.intensity;
                         bx -= (m.x - bx) * 0.1 * m.intensity;
                         by -= (m.y - by) * 0.1 * m.intensity;
                     }
                     return;
                 }

                 const dist = p.dist(bx, by, m.x, m.y);
                 if (dist < RING_RADIUS_BASE * 3) {
                     swarmX += m.x; swarmY += m.y; swarmCount++;
                     if (m.isRemote) isAffectedByRemote = true;
                     else isAffectedByLocal = true;
                 }
            });
            
            if (swarmCount > 0) {
                swarmX /= swarmCount; swarmY /= swarmCount;
                const pullStrength = 0.03 + excitement * 0.06; 
                bx = p.lerp(bx, swarmX * 0.8, pullStrength);
                by = p.lerp(by, swarmY * 0.8, pullStrength);
                bz = p.lerp(bz, 150, pullStrength); 
            }
            if (coreShock > 0) {
                bx += p.random(-15, 15) * coreShock;
                by += p.random(-15, 15) * coreShock;
                bz += p.random(-15, 15) * coreShock;
            }
            
            p.translate(bx, by, bz);
            p.rotateY(time * 2.0 + bubble.noiseOffset);
            if (isWebGL) {
              p.shader(plasmaShader);
              plasmaShader.setUniform('uTime', time);
              plasmaShader.setUniform('uNoiseOffset', bubble.noiseOffset + i * 10.0 + (coreShock * 5.0));
              
              if (coreShock > 0.1) {
                  plasmaShader.setUniform('uColorDeep', [0.4, 0.45, 0.5]);
                  plasmaShader.setUniform('uColorMid', [0.7, 0.75, 0.8]);
                  plasmaShader.setUniform('uColorRim', [0.9, 0.9, 0.95]);
              } else if (isAffectedByRemote) {
                  plasmaShader.setUniform('uColorDeep', [0.05, 0.05, 0.1]); 
                  plasmaShader.setUniform('uColorMid', [0.2, 0.2, 0.3]);
                  plasmaShader.setUniform('uColorRim', [0.6, 0.6, 0.7]);
              } else if (isAffectedByLocal) {
                  plasmaShader.setUniform('uColorDeep', [0.1, 0.08, 0.05]); 
                  plasmaShader.setUniform('uColorMid', [0.4, 0.35, 0.25]);
                  plasmaShader.setUniform('uColorRim', [0.8, 0.75, 0.6]);
              } else {
                  if (i % 2 === 0) {
                      plasmaShader.setUniform('uColorDeep', [0.02, 0.05, 0.08]); 
                      plasmaShader.setUniform('uColorMid', [0.15, 0.25, 0.3]);  
                      plasmaShader.setUniform('uColorRim', [0.5, 0.55, 0.6]);
                  } else {
                      plasmaShader.setUniform('uColorDeep', [0.03, 0.04, 0.08]); 
                      plasmaShader.setUniform('uColorMid', [0.2, 0.25, 0.35]);  
                      plasmaShader.setUniform('uColorRim', [0.55, 0.6, 0.65]);
                  }
              }
            } else {
              p.fill(200, 50, 50);
            }
            
            let pulse = 1 + p.sin(time * 6.0 + i) * 0.15 * chaos; 
            const size = RING_RADIUS_BASE * bubble.sizeMult * pulse;
            p.sphere(size, 64, 64);
            if (isWebGL) {
              p.resetShader();
            }
            p.pop();
        });

        // Outer Shell
        const outer = coreBubbles[0];
        p.push();
        p.rotateY(time * 0.15); 
        if (isWebGL) {
          p.shader(plasmaShader);
          plasmaShader.setUniform('uTime', time);
          plasmaShader.setUniform('uNoiseOffset', outer.noiseOffset);
          plasmaShader.setUniform('uColorDeep', [0.01, 0.02, 0.05]); 
          plasmaShader.setUniform('uColorMid', [0.05, 0.1, 0.15]);  
          plasmaShader.setUniform('uColorRim', [0.4, 0.5, 0.6]);
        } else {
          p.fill(50, 50, 200);
        }
        const shellRadius = RING_RADIUS_BASE * 1.3 * (1 + excitement * 0.1 + coreShock * 0.15);
        p.sphere(shellRadius, 128, 128);
        if (isWebGL) {
          p.resetShader();
        }
        p.pop();
        p.blendMode(p.BLEND);
        p.pop(); 

        // PARTICLES
        const activeShockwavesForParticles = activeShockwaves.map(sw => {
            const age = nowMs - sw.startTime;
            const progress = Math.min(1, age / 2800);
            const easeOut = 1 - Math.pow(1 - progress, 3);
            return {
                x: sw.x - bounds.centerX,
                y: sw.y - bounds.centerY,
                currentRadius: easeOut * 2800,
                progress: progress
            };
        });

        p.push();
        p.translate(localCenterX, localCenterY, 0);
        p.specularMaterial(220); 
        p.shininess(30); 
        p.noStroke();

        const inertiaForceX = -deltaX * 0.5; 
        const inertiaForceY = -deltaY * 0.5;

        particles.forEach((pt) => {
            // Apply Inertia
            pt.inertiaX = p.lerp(pt.inertiaX, inertiaForceX, 0.1);
            pt.inertiaY = p.lerp(pt.inertiaY, inertiaForceY, 0.1);
            
            // Decaying velocity for wind
            pt.velX *= 0.95;
            pt.velY *= 0.95;

            const driftX = pt.inertiaX * 2.0;
            const driftY = pt.inertiaY * 2.0;

            pt.angle += pt.speed * (1 + excitement);
            pt.z += pt.zSpeed;
            if(pt.z > 150 || pt.z < -150) pt.zSpeed *= -1;

            if (pt.radius > 80) {
                pt.radius -= 0.05 + excitement * 0.2; 
            } else {
                pt.radius = 1600; 
            }

            const funnelDepth = -150 * (1 - Math.min(1, pt.radius / 1500));
            
            let px = p.cos(pt.angle) * pt.radius;
            let py = p.sin(pt.angle) * pt.radius;
            let pz = pt.z + funnelDepth;

            px += driftX * (pt.radius / 500) + pt.velX; 
            py += driftY * (pt.radius / 500) + pt.velY;

            // Interaction Check (Gravity vs Wind)
            let isAffected = false;
            let isRemoteInteraction = false;
            let hitByShockwave = false;
            let zLift = 0;

            interactions.forEach(m => {
                const isWind = m.mode === 'WIND';
                const dist = p.dist(px, py, m.x, m.y);
                const interactRadius = isWind ? 600 : (m.isRemote ? 450 : 350); 
                
                if (dist < interactRadius) {
                    isAffected = true;
                    if (m.isRemote) isRemoteInteraction = true;

                    if (isWind && m.intensity > 0.15) {
                         // WIND MODE: REPEL / BLOW
                         const blowForce = p.map(dist, 0, interactRadius, 10, 0) * m.intensity * 2.0;
                         const angleFromFace = p.atan2(py - m.y, px - m.x);
                         
                         // Apply impulse to persistent velocity
                         pt.velX += p.cos(angleFromFace) * blowForce;
                         pt.velY += p.sin(angleFromFace) * blowForce;
                         
                         // Turbulence
                         pt.zSpeed += (Math.random() - 0.5) * m.intensity * 2;
                         zLift += p.map(dist, 0, interactRadius, 50, 0) * m.intensity;

                    } else if (!isWind) {
                         // GRAVITY MODE: ATTRACT
                         const force = p.map(dist, 0, interactRadius, 0.04, 0); 
                         px = p.lerp(px, m.x, force);
                         py = p.lerp(py, m.y, force);
                         zLift += p.map(dist, 0, interactRadius, 100, 0);
                    }
                }
            });

            activeShockwavesForParticles.forEach(sw => {
                const d = p.dist(px, py, sw.x, sw.y);
                const waveWidth = 250;
                const distFromWave = d - sw.currentRadius;
                
                if (Math.abs(distFromWave) < waveWidth) { 
                    hitByShockwave = true;
                    const t = distFromWave / waveWidth;
                    zLift += 120 * p.cos(t * p.PI) * (1 - sw.progress); 
                    const pushForce = 40 * p.cos(t * p.PI) * (1 - sw.progress);
                    const angleToParticle = p.atan2(py - sw.y, px - sw.x);
                    px += p.cos(angleToParticle) * pushForce;
                    py += p.sin(angleToParticle) * pushForce;
                }
            });

            const renderZ = pz + zLift;

            if (p.frameCount % 3 === 0) { 
                pt.history.push({ x: px, y: py, z: renderZ });
                if (pt.history.length > TRAIL_LENGTH) pt.history.shift();
            }

            if (pt.history.length > 2) {
                p.push();
                p.noLights(); 
                p.noFill();
                
                let hue = pt.baseHue;
                let strokeAlpha = 8; 
                let strokeW = 0.3;

                if (hitByShockwave) {
                    hue = 0; 
                    strokeAlpha = 60;
                    strokeW = 1.2;
                } else if (isRemoteInteraction) {
                    hue = COLOR_SECONDARY_HUE; 
                    strokeAlpha = 35; 
                    strokeW = 1.0;
                } else if (isAffected) {
                    hue = COLOR_ACCENT_HUE; 
                    strokeAlpha = 40; 
                    strokeW = 1.0;
                }

                p.strokeWeight(strokeW);
                p.stroke(hue, 20, 70, strokeAlpha); 
                p.beginShape();
                pt.history.forEach(h => p.vertex(h.x, h.y, h.z));
                p.vertex(px, py, renderZ);
                p.endShape();
                p.pop();
            }

            p.push();
            p.translate(px, py, renderZ);
            let partHue = pt.baseHue;
            if (hitByShockwave) partHue = 0; 
            else if (isRemoteInteraction) partHue = COLOR_SECONDARY_HUE;
            else if (isAffected) partHue = COLOR_ACCENT_HUE;
            
            p.emissiveMaterial(partHue, 30, 40); 
            
            let size = pt.size;
            if (hitByShockwave) size *= 2.0;
            else if (isRemoteInteraction) size *= 1.4 + p.sin(nowMs * 0.015) * 0.2; 
            else if (isAffected) size *= 1.5;

            p.sphere(size / 2);
            p.pop();
        });
        p.pop(); 

        // SHOCKWAVES
        activeShockwaves.forEach(sw => {
            p.push();
            const localX = sw.x - self.x;
            const localY = sw.y - self.y;
            p.translate(localX, localY, 0); 
            
            const age = nowMs - sw.startTime;
            const duration = 2800;
            const progress = age / duration;
            
            if (progress < 1.0) {
                 const easeOut = 1 - Math.pow(1 - progress, 3); 
                 const radius = easeOut * 2800; 
                 
                 const hue = p.lerp(COLOR_PRIMARY_HUE, COLOR_SECONDARY_HUE, progress);
                 const sat = p.lerp(10, 60, progress); 
                 
                 p.rotateX(p.PI / 2); 
                 p.noStroke();

                 const layers = 6;
                 for(let i=0; i<layers; i++) {
                     const lag = i * 0.08; 
                     const r = radius * (1 - lag * 0.2);
                     if (r <= 0) continue;

                     const layerAlpha = (1.0 - progress) * (1.0 - i/layers) * 0.15; 
                     
                     p.push();
                     const zWave = p.sin(progress * 10 - i) * 60 * (1-progress);
                     p.translate(0, 0, zWave);
                     p.emissiveMaterial(hue, sat, 100, layerAlpha * 255); 
                     p.specularMaterial(255, 20);
                     p.shininess(10);
                     const tubeR = 15 * (1 - progress) * (1 - i/layers) + 1;
                     p.torus(r, tubeR, 100, 8); 
                     p.pop();
                 }
            }
            p.pop();
        });

        // REMOTE CURSORS AND TRAILS
        interactions.forEach(m => {
            if (!cursorTrails.has(m.id)) cursorTrails.set(m.id, []);
            const trail = cursorTrails.get(m.id)!;
            
            trail.push({ x: m.x, y: m.y, z: 80 }); 
            if (trail.length > 20) trail.shift();
            
            // Render Interaction Origin Indicator
            p.push();
            p.translate(m.x, m.y, 80); 
            p.noStroke();
            const baseHue = m.isRemote ? COLOR_SECONDARY_HUE : COLOR_ACCENT_HUE;
            
            // Visual difference for Wind vs Gravity
            if (m.mode === 'WIND') {
                // Spinning fan/turbine graphic for wind source
                const spin = time * 20;
                p.rotateZ(spin);
                p.emissiveMaterial(baseHue, 40, 90);
                // Pulse size based on blow intensity
                const size = 10 + m.intensity * 20;
                p.torus(size, 2, 4, 16); 
                p.sphere(4);
            } else {
                // Standard Orb for Mouse
                p.emissiveMaterial(baseHue, 20, 80); 
                p.sphere(6);
            }
            p.pop();
        });

        // Cleanup stale trails
        const activeIds = new Set(interactions.map(m => m.id));
        for (const id of cursorTrails.keys()) {
            if (!activeIds.has(id)) cursorTrails.delete(id);
        }

        // DRAW CURSOR TRAILS
        p.push();
        p.blendMode(p.ADD);
        p.noFill();
        
        interactions.forEach(m => {
             const trail = cursorTrails.get(m.id);
             if (!trail || trail.length < 2) return;

             const isRemote = m.isRemote;
             const baseHue = isRemote ? COLOR_SECONDARY_HUE : COLOR_ACCENT_HUE;
             
             const last = trail[trail.length-1];
             const prev = trail[trail.length-2];
             const speed = p.dist(last.x, last.y, 0, prev.x, prev.y, 0);
             const speedFactor = Math.min(speed / 50, 1.0); 

             p.beginShape();
             for (let i = 0; i < trail.length; i++) {
                 const progress = i / (trail.length - 1);
                 let alpha = progress * 0.6; 
                 alpha += speedFactor * 0.4 * progress;
                 const sat = p.lerp(60, 0, speedFactor * progress);
                 const bright = p.lerp(80, 100, speedFactor);
                 p.stroke(baseHue, sat, bright, alpha * 255);
                 const weight = (isRemote ? 2 : 1) + speedFactor * 3 * progress;
                 p.strokeWeight(weight);
                 const pos = trail[i];
                 p.vertex(pos.x, pos.y, pos.z);
             }
             p.endShape();
        });
        p.pop();

        p.pop();
      };
    };

    const myP5 = new p5(sketch, containerRef.current);

    return () => {
      myP5.remove();
    };
  }, [getSelfState, peersRef, broadcastEvent, eventQueueRef]);

  return <div ref={containerRef} className="absolute inset-0 z-0" />;
};