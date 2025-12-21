import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { DESCENDERS, BASE_GRID } from './constants';
import { resolveGlyphMatrix } from './text-engine';
import { PixelMatrix, PixelFont } from './types';
import { Play, Square, RotateCcw, Mic, MicOff, Palette, Sliders, X, Layers, Circle as CircleIcon, Check, Disc, Volume2, Maximize, Minimize, Star, Type, Layout, AlignLeft, AlignCenter, AlignRight, Film, Plus, Trash2, Repeat, ArrowRightToLine, ArrowLeftRight, ArrowUp, ArrowDown, Copy, ArrowUpToLine, ArrowDownToLine, FoldVertical, Grid3x3, Hand, Users, User, Sparkles, Cpu, ChevronsDown, Folder, Download, Upload, FileType, MousePointer2, Move, BoxSelect } from 'lucide-react';

// --- Configuration Constants ---
const SHAPES = {
  Circle: { radius: '50%', clip: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)' }, 
  Square: { radius: '0%', clip: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)' },
  Diamond: { radius: '0', clip: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' },
  Star: { radius: '0', clip: 'polygon(50% 0%, 61% 29%, 90% 10%, 75% 40%, 100% 50%, 75% 60%, 90% 90%, 61% 71%, 50% 100%, 39% 71%, 10% 90%, 25% 60%, 0% 50%, 25% 40%, 10% 10%, 39% 29%)' }
};

const ARTBOARDS = {
    'none': { label: 'Infinite', ratio: null, width: '100%', height: '100%' },
    'A4': { label: 'A4 (Portrait)', ratio: 210/297, width: 'min(500px, 80vw)', height: 'auto' },
    'A4-L': { label: 'A4 (Landscape)', ratio: 297/210, width: 'min(700px, 85vw)', height: 'auto' },
    '9:16': { label: 'Story (9:16)', ratio: 9/16, width: 'min(360px, 80vw)', height: 'auto' },
    '1:1': { label: 'Square (1:1)', ratio: 1/1, width: 'min(500px, 80vw)', height: 'auto' },
};

// --- Animation Easing Functions ---
type EasingType = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'elastic';
type SequenceMode = 'loop' | 'once' | 'pingpong';

const EASINGS: Record<EasingType, (t: number) => number> = {
  linear: t => t,
  easeIn: t => t * t * t,
  easeOut: t => 1 - Math.pow(1 - t, 3),
  easeInOut: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  elastic: t => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
  }
};

type ShapeKey = keyof typeof SHAPES;
type ArtboardKey = keyof typeof ARTBOARDS;
type BlendMode = 'normal' | 'difference' | 'screen' | 'multiply';
// Updated Menu Types to reflect grouping
type MenuType = 'none' | 'color' | 'mic' | 'swirl' | 'interaction' | 'text' | 'tools' | 'layout' | 'states' | 'project';
type TextAlign = 'left' | 'center' | 'right';
type VerticalAlign = 'top' | 'center' | 'bottom';
type InteractionMode = 'organic' | 'matrix';
type ToolMode = 'selection' | 'drag' | 'extrude';

// Physics Particle Interface
interface Particle {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  color: string;
  isReturning: boolean;
  isDragging: boolean;
  shapeKey: ShapeKey;
}

// Interface for cached static pixel data for Swirl effect
interface StaticPixelCache {
  el: HTMLElement;
  baseX: number;
  baseY: number;
}

// Interface for Saved States
interface TextStateSnapshot {
    id: string;
    timestamp: number;
    text: string;
    weight: number;
    height: number;
    size: number;
    lineSpacing: number;
    align: TextAlign;
    verticalAlign: VerticalAlign;
    charOverrides: Record<number, { w?: number, h?: number, customMatrix?: number[][], valign?: VerticalAlign }>;
    charPositions: Record<number, { x: number, y: number }>;
}

// Custom Spiral Icon Component
const SpiralIcon = ({ size = 24, className = "" }: { size?: number, className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M14 11a2 2 0 1 1-2-2 4 4 0 0 1 4 4 6 6 0 0 1-6 6 8 8 0 0 1-8-8 10 10 0 0 1 10-10 12 12 0 0 1 12 12" />
  </svg>
);

// Helper to create a synthetic reverb impulse
const createReverbImpulse = (ctx: AudioContext, duration: number = 2.0, decay: number = 2.0) => {
  const rate = ctx.sampleRate;
  const length = rate * duration;
  const impulse = ctx.createBuffer(2, length, rate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const n = i / length;
    const power = Math.pow(1 - n, decay); 
    left[i] = (Math.random() * 2 - 1) * power;
    right[i] = (Math.random() * 2 - 1) * power;
  }
  return impulse;
};

// --- Extracted ParticleLayer Component ---
interface ParticleLayerProps {
  particlesRef: React.MutableRefObject<Particle[]>;
  isRainbow: boolean;
  hoverColor: string;
  mouseRef: React.MutableRefObject<{ x: number; y: number; isDown: boolean }>;
  blendMode: BlendMode;
  resetTrigger: number;
}

const ParticleLayer: React.FC<ParticleLayerProps> = ({ particlesRef, isRainbow, hoverColor, mouseRef, blendMode, resetTrigger }) => {
  const [items, setItems] = useState<Particle[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (particlesRef.current.length !== items.length) {
        setItems([...particlesRef.current]);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [items.length, particlesRef]);

  useEffect(() => {
      setItems([]);
  }, [resetTrigger]);

  return (
    <>
      {items.map(p => (
        <div
          key={p.id}
          id={p.id}
          className={`floating-particle`}
          onMouseDown={(e) => { 
            e.preventDefault();
            p.isDragging = true; 
            mouseRef.current.isDown = true; 
          }}
          style={{
            width: p.width,
            height: p.height,
            backgroundColor: hoverColor,
            borderRadius: SHAPES[p.shapeKey].radius,
            clipPath: SHAPES[p.shapeKey].clip,
            left: 0,
            top: 0,
            mixBlendMode: blendMode
          }}
        />
      ))}
    </>
  );
};

const App: React.FC = () => {
  // --- State ---
  const [inputText, setInputText] = useState<string>('HELLO');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);
  const [isSequencing, setIsSequencing] = useState<boolean>(false);
  
  // Visual Configuration
  const [userPixelSize, setUserPixelSize] = useState<number>(16); 
  const [effectivePixelSize, setEffectivePixelSize] = useState<number>(16); 
  
  // Font Source Control
  const [useCustomFont, setUseCustomFont] = useState<boolean>(true);

  // Font Variability State
  const [globalWeight, setGlobalWeight] = useState<number>(0); 
  const [globalHeight, setGlobalHeight] = useState<number>(0);
  
  // Per-character overrides
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [charOverrides, setCharOverrides] = useState<Record<number, { w?: number, h?: number, customMatrix?: number[][], valign?: VerticalAlign }>>({});
  const [charPositions, setCharPositions] = useState<Record<number, { x: number, y: number }>>({});
  
  const [lineSpacingScale, setLineSpacingScale] = useState<number>(0.5);
  const [textAlign, setTextAlign] = useState<TextAlign>('center');
  const [verticalAlign, setVerticalAlign] = useState<VerticalAlign>('center');

  // Edit Mode: Global vs Selection
  const [editMode, setEditMode] = useState<'global' | 'selection'>('global');

  // Interaction Mode
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('organic');

  // Tool State (Replaces individual tool booleans)
  const [toolMode, setToolMode] = useState<ToolMode>('selection');
  const [showGrid, setShowGrid] = useState(false);
  
  // Refs for Drag Logic
  const draggingCharRef = useRef<{ 
      index: number, 
      startX: number, 
      startY: number, 
      startRelX: number,
      startRelY: number,
      layoutRelX: number,
      layoutRelY: number
  } | null>(null);

  // Ref for Extrude Logic
  const extrudeDragRef = useRef<{
      charIndex: number,
      startX: number,
      startY: number,
      accumulatedX: number,
      accumulatedY: number
  } | null>(null);
  
  const charRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Animation States / Sequence
  const [savedStates, setSavedStates] = useState<TextStateSnapshot[]>([]);
  const [transitionDuration, setTransitionDuration] = useState<number>(1.0);
  const [holdDuration, setHoldDuration] = useState<number>(1.0);
  const [transitionEasing, setTransitionEasing] = useState<EasingType>('easeInOut');
  const [sequenceMode, setSequenceMode] = useState<SequenceMode>('loop');
  
  const transitionRef = useRef<number>(0); 
  const sequenceTimeoutRef = useRef<number | null>(null); 
  const currentSequenceIndex = useRef<number>(0);
  const sequenceDirectionRef = useRef<number>(1);
  
  const transitionDurationRef = useRef(transitionDuration);
  const holdDurationRef = useRef(holdDuration);
  const transitionEasingRef = useRef(transitionEasing);
  const sequenceModeRef = useRef(sequenceMode);

  // Refs for File Import
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { transitionDurationRef.current = transitionDuration; }, [transitionDuration]);
  useEffect(() => { holdDurationRef.current = holdDuration; }, [holdDuration]);
  useEffect(() => { transitionEasingRef.current = transitionEasing; }, [transitionEasing]);
  useEffect(() => { sequenceModeRef.current = sequenceMode; }, [sequenceMode]);

  // Artboard State
  const [artboardMode, setArtboardMode] = useState<ArtboardKey>('none');
  const [artboardSettings, setArtboardSettings] = useState({
      bgColor: '#000000',
      borderColor: '#ffffff'
  });
  
  // Interaction Config
  const [hoverColor, setHoverColor] = useState<string>('#0015FF');
  const [hoverShape, setHoverShape] = useState<ShapeKey>('Circle');
  const [hoverScale, setHoverScale] = useState<number>(1.1);
  const [blendMode, setBlendMode] = useState<BlendMode>('normal');
  const [resetTrigger, setResetTrigger] = useState<number>(0);

  // Canvas Colors
  const [canvasColors, setCanvasColors] = useState({
      bg: '#000000',
      text: '#ffffff'
  });

  // Physics Configuration
  const [physicsConfig, setPhysicsConfig] = useState({
    friction: 0.98,
    restitution: 0.8,
    dragStiffness: 0.2,
    gravity: 0.0
  });

  // Swirl Configuration
  const [swirlConfig, setSwirlConfig] = useState({
    baseRadius: 200,
    rotationalForce: 2.0, // Replaces baseForce, supports negative for CCW
    attractionStrength: 0.0, // New: 0 = none, >0 attract, <0 repel
    noiseIntensity: 0.0, // New: Jitter amount
    audioRadiusScale: 0.8,
    audioForceScale: 3.0
  });

  // Swarm / Audio Config
  const [swarmConfig, setSwarmConfig] = useState({
    pitchScatter: 1.5,
    reverbMix: 0.5
  });

  // Menu State
  const [activeMenu, setActiveMenu] = useState<MenuType>('none');

  const toggleMenu = (menu: MenuType) => {
    setActiveMenu(prev => prev === menu ? 'none' : menu);
  };

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (!target.closest('.menu-content') && !target.closest('.menu-toggle') && !target.closest('.debug-menu')) {
            setActiveMenu(prev => (prev !== 'none' ? 'none' : prev));
        }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // GLOBAL KEY LISTENER FOR TYPING (Affects input at all times unless playing)
  useEffect(() => {
      const handleGlobalKeyDown = (e: KeyboardEvent) => {
          // If in Play Mode, disable typing modification
          if (isPlaying) return;
          
          // If the user is typing in the actual textarea, let native behavior happen
          if (document.activeElement === inputRef.current) return;

          // Ignore shortcuts/modifiers
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          if (e.key === 'F' || e.key === 'f') return; // Debug menu shortcut

          // Handle Backspace/Delete (Always active in edit mode)
          if (e.key === 'Backspace' || e.key === 'Delete') {
              setInputText(prev => prev.slice(0, -1));
              setCharPositions({}); // Reset alignment on change
              return;
          }

          // Handle Standard Characters
          if (e.key.length === 1) {
              setInputText(prev => prev + e.key);
              setCharPositions({}); // Reset alignment on change
              return;
          }
          
          // Handle Enter -> Paragraph Glyph
          if (e.key === 'Enter') {
              setInputText(prev => prev + '¶');
              setCharPositions({}); // Reset alignment on change
              return;
          }
      };

      window.addEventListener('keydown', handleGlobalKeyDown);
      return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isPlaying]);

  // Modes
  const [isRainbow, setIsRainbow] = useState(false);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [isSwirlMode, setIsSwirlMode] = useState(false);
  
  // Audio State
  const [isMicActive, setIsMicActive] = useState(false);
  const [micSensitivity, setMicSensitivity] = useState(1.0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudioBuffer, setRecordedAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isSwarmPlaying, setIsSwarmPlaying] = useState(false);
  const [swarmVolume, setSwarmVolume] = useState<number>(0.5);

  // --- Debug / Theme State ---
  const [isDebugMenuOpen, setIsDebugMenuOpen] = useState(false);
  const [uiTheme, setUiTheme] = useState({
    bgColor: '#000000',
    textColor: '#ffffff',
    borderColor: '#ffffff',
    borderWidth: 1,
    buttonBgColor: '#000000',
    fontSizeScale: 1.0,
    iconStrokeWidth: 1.5,
    iconColor: '#ffffff',
    buttonHoverBgColor: '#222222',
    buttonSelectedBgColor: '#ffffff',
    buttonSelectedTextColor: '#000000',
  });

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const artboardRef = useRef<HTMLDivElement>(null);
  const textContainerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const staticPixelsCacheRef = useRef<StaticPixelCache[]>([]);
  const requestRef = useRef<number>(0);
  const mouseRef = useRef({ x: 0, y: 0, isDown: false });
  
  // New Refs for Shift+Drag Interaction
  const weightDragAccumulator = useRef<number>(0);
  const heightDragAccumulator = useRef<number>(0);
  const prevMouseXRef = useRef<number>(0);
  const prevMouseYRef = useRef<number>(0);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const swarmSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const swarmGainNodesRef = useRef<GainNode[]>([]);
  const reverbNodeRef = useRef<ConvolverNode | null>(null);

  const physicsConfigRef = useRef(physicsConfig);
  const swirlConfigRef = useRef(swirlConfig);
  const micSensitivityRef = useRef(micSensitivity);
  const isSwarmPlayingRef = useRef(isSwarmPlaying);
  const swarmConfigRef = useRef(swarmConfig);

  // Debug Drag Logic
  const debugMenuRef = useRef<HTMLDivElement>(null);
  const debugOffset = useRef({ x: 0, y: 0 });

  const handleDebugDragStart = (e: React.MouseEvent) => {
    if (!debugMenuRef.current) return;
    const rect = debugMenuRef.current.getBoundingClientRect();
    debugOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
       if (!debugMenuRef.current) return;
       debugMenuRef.current.style.left = `${moveEvent.clientX - debugOffset.current.x}px`;
       debugMenuRef.current.style.top = `${moveEvent.clientY - debugOffset.current.y}px`;
    };
    
    const handleMouseUp = () => {
       window.removeEventListener('mousemove', handleMouseMove);
       window.removeEventListener('mouseup', handleMouseUp);
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => { physicsConfigRef.current = physicsConfig; }, [physicsConfig]);
  useEffect(() => { swirlConfigRef.current = swirlConfig; }, [swirlConfig]);
  useEffect(() => { micSensitivityRef.current = micSensitivity; }, [micSensitivity]);
  useEffect(() => { isSwarmPlayingRef.current = isSwarmPlaying; }, [isSwarmPlaying]);
  useEffect(() => { swarmConfigRef.current = swarmConfig; }, [swarmConfig]);

  useEffect(() => {
    staticPixelsCacheRef.current = [];
    if (!isSwirlMode) {
       const els = document.querySelectorAll('.pixel-interactive') as NodeListOf<HTMLElement>;
       els.forEach(el => {
          el.style.removeProperty('--tx');
          el.style.removeProperty('--ty');
          el.style.removeProperty('--tr');
       });
    }
  }, [inputText, effectivePixelSize, globalWeight, globalHeight, charOverrides, isSwirlMode, lineSpacingScale, isPlaying, artboardMode, textAlign, verticalAlign, useCustomFont]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'f') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        setIsDebugMenuOpen(prev => !prev);
      }
    };
    const handleFullScreenChange = () => setIsFullScreen(!!document.fullscreenElement);
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('fullscreenchange', handleFullScreenChange);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('fullscreenchange', handleFullScreenChange);
    };
  }, []);

  // --- Play Mode Effect ---
  // When switching to Play Mode, clear selections and STOP SEQUENCING (Exclusive mode)
  useEffect(() => {
    if (isPlaying) {
      setSelectedIndices(new Set());
      setIsSequencing(false);
    }
  }, [isPlaying]);

  // --- Export / Import Logic ---
  const handleExportProject = () => {
    const projectData = {
      meta: {
        version: "1.0",
        timestamp: Date.now(),
        generator: "PixelTypoApp"
      },
      content: {
        inputText,
        userPixelSize,
        globalWeight,
        globalHeight,
        charOverrides, // includes customMatrix (extrusions)
        charPositions,
        lineSpacingScale,
        textAlign,
        verticalAlign,
        artboardMode,
        artboardSettings,
        hoverColor,
        hoverShape,
        canvasColors,
        physicsConfig,
        swirlConfig,
        swarmConfig,
        useCustomFont
      }
    };

    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pixel-composition-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toggleMenu('none');
  };

  const handleImportClick = () => {
    if (fileInputRef.current) {
        fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const json = JSON.parse(ev.target?.result as string);
            if (json.meta && json.content) {
                const c = json.content;
                
                // Batch updates to restore state
                setInputText(c.inputText || '');
                setUserPixelSize(c.userPixelSize || 16);
                setGlobalWeight(c.globalWeight || 0);
                setGlobalHeight(c.globalHeight || 0);
                setCharOverrides(c.charOverrides || {});
                setCharPositions(c.charPositions || {});
                setLineSpacingScale(c.lineSpacingScale ?? 0.5);
                setTextAlign(c.textAlign || 'center');
                setVerticalAlign(c.verticalAlign || 'center');
                setArtboardMode(c.artboardMode || 'none');
                setArtboardSettings(c.artboardSettings || { bgColor: '#000000', borderColor: '#ffffff' });
                setHoverColor(c.hoverColor || '#0015FF');
                setHoverShape(c.hoverShape || 'Circle');
                setCanvasColors(c.canvasColors || { bg: '#000000', text: '#ffffff' });
                if (c.physicsConfig) setPhysicsConfig(c.physicsConfig);
                if (c.swirlConfig) setSwirlConfig(c.swirlConfig);
                if (c.swarmConfig) setSwarmConfig(c.swarmConfig);
                if (c.useCustomFont !== undefined) setUseCustomFont(c.useCustomFont);

                // Reset Playback/Selection
                setIsPlaying(false);
                setIsSequencing(false);
                setSelectedIndices(new Set());
                setResetTrigger(prev => prev + 1);
                toggleMenu('none');
                
                alert("Project loaded successfully!");
            } else {
                alert("Invalid project file.");
            }
        } catch (err) {
            console.error("Failed to parse JSON", err);
            alert("Error reading file.");
        }
    };
    reader.readAsText(file);
    // Reset input so same file can be selected again
    e.target.value = '';
  };


  // --- State Transition Logic ---
  const saveCurrentState = () => {
      const snapshot: TextStateSnapshot = {
          id: Date.now().toString(),
          timestamp: Date.now(),
          text: inputText,
          weight: globalWeight,
          height: globalHeight,
          size: userPixelSize,
          lineSpacing: lineSpacingScale,
          align: textAlign,
          verticalAlign: verticalAlign,
          charOverrides: JSON.parse(JSON.stringify(charOverrides)), // Deep copy required for nested rowStretch
          charPositions: charPositions
      };
      setSavedStates(prev => [...prev, snapshot]);
  };

  const deleteState = (id: string) => {
      setSavedStates(prev => prev.filter(s => s.id !== id));
  };

  const moveState = (index: number, direction: -1 | 1) => {
      if (direction === -1 && index === 0) return;
      if (direction === 1 && index === savedStates.length - 1) return;
      
      setSavedStates(prev => {
          const newStates = [...prev];
          const temp = newStates[index];
          newStates[index] = newStates[index + direction];
          newStates[index + direction] = temp;
          return newStates;
      });
  };

  const duplicateState = (index: number) => {
      setSavedStates(prev => {
          const stateToCopy = prev[index];
          const newSnapshot: TextStateSnapshot = {
              ...stateToCopy,
              id: Date.now().toString(), // Ensure unique ID
              timestamp: Date.now()
          };
          const newStates = [...prev];
          newStates.splice(index + 1, 0, newSnapshot);
          return newStates;
      });
  };

  const restoreState = (state: TextStateSnapshot) => {
      // Cancel any ongoing transition
      if (transitionRef.current) cancelAnimationFrame(transitionRef.current);

      // Start Transition
      const startWeight = globalWeight;
      const startHeight = globalHeight;
      const startSize = userPixelSize;
      const startSpacing = lineSpacingScale;
      
      const startTime = performance.now();
      const durationMs = transitionDurationRef.current * 1000;
      
      // Immediate changes for non-interpolatable values
      setInputText(state.text);
      setTextAlign(state.align);
      setVerticalAlign(state.verticalAlign || 'center'); // Default to center for old saves
      
      // Restore character overrides and positions
      // Deep copy to prevent ref issues
      setCharOverrides(JSON.parse(JSON.stringify(state.charOverrides || {}))); 
      setCharPositions(state.charPositions || {});
      setSelectedIndices(new Set());

      const animateTransition = (now: number) => {
          const elapsed = now - startTime;
          const progress = Math.min(1, elapsed / durationMs);
          const eased = EASINGS[transitionEasingRef.current](progress);

          // Interpolate
          const currentWeight = startWeight + (state.weight - startWeight) * eased;
          const currentHeight = startHeight + (state.height - startHeight) * eased;
          const currentSize = startSize + (state.size - startSize) * eased;
          const currentSpacing = startSpacing + (state.lineSpacing - startSpacing) * eased;

          setGlobalWeight(currentWeight);
          setGlobalHeight(currentHeight);
          setUserPixelSize(currentSize); // Note: this might trigger recalculation of effectivePixelSize in layout effect
          setLineSpacingScale(currentSpacing);

          if (progress < 1) {
              transitionRef.current = requestAnimationFrame(animateTransition);
          }
      };

      transitionRef.current = requestAnimationFrame(animateTransition);
  };

  // --- Auto-Sequence Logic ---
  useEffect(() => {
    // Only sequence if enabled and NOT in Play mode (Play mode is interactive only)
    if (isSequencing && !isPlaying && savedStates.length > 0) {
        // Init sequence
        currentSequenceIndex.current = 0;
        sequenceDirectionRef.current = 1;
        
        // Start from first state immediately
        restoreState(savedStates[0]);

        const scheduleNext = () => {
             // Total delay = Transition time + Hold time
             const delay = (transitionDurationRef.current * 1000) + (holdDurationRef.current * 1000);
             
             // @ts-ignore - setTimeout returns number in browser
             sequenceTimeoutRef.current = setTimeout(() => {
                 const len = savedStates.length;
                 if (len <= 1) return; 

                 let next = currentSequenceIndex.current;
                 const mode = sequenceModeRef.current;
                 const dir = sequenceDirectionRef.current;

                 if (mode === 'loop') {
                     next = (next + 1) % len;
                 } else if (mode === 'once') {
                     next = next + 1;
                     if (next >= len) {
                         // End of sequence
                         setIsSequencing(false);
                         return; 
                     }
                 } else if (mode === 'pingpong') {
                     // Robust PingPong Logic
                     
                     // First ensure we are in bounds (in case list shrunk)
                     if (next >= len) next = len - 1;
                     
                     let tentative = next + dir;
                     
                     if (tentative >= len) {
                         // Hit end, reverse
                         sequenceDirectionRef.current = -1;
                         tentative = Math.max(0, len - 2);
                     } else if (tentative < 0) {
                         // Hit start, forward
                         sequenceDirectionRef.current = 1;
                         tentative = Math.min(len - 1, 1);
                     }
                     next = tentative;
                 }
                 
                 // Safety clamp
                 if (next < 0) next = 0;
                 if (next >= len) next = 0;

                 currentSequenceIndex.current = next;
                 restoreState(savedStates[next]);
                 scheduleNext(); // Recursive schedule
             }, delay);
        };

        scheduleNext();
    } else {
        // Cleanup when stopping or playing
        if (sequenceTimeoutRef.current) {
            clearTimeout(sequenceTimeoutRef.current as any);
            sequenceTimeoutRef.current = null;
        }
        if (transitionRef.current) {
            cancelAnimationFrame(transitionRef.current);
        }
    }

    return () => {
        if (sequenceTimeoutRef.current) clearTimeout(sequenceTimeoutRef.current as any);
    };
  }, [isSequencing, isPlaying, savedStates]); 

  const getAudioContext = () => {
    if (!audioContextRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      audioContextRef.current = ctx;
      reverbNodeRef.current = ctx.createConvolver();
      reverbNodeRef.current.buffer = createReverbImpulse(ctx, 2.5, 3.0);
      reverbNodeRef.current.connect(ctx.destination);
    }
    return audioContextRef.current;
  };

  const toggleMic = async () => {
    if (isMicActive) {
      setIsMicActive(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = getAudioContext();
        const analyser = ctx.createAnalyser();
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 64; 
        analyserRef.current = analyser;
        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
        setIsMicActive(true);
      } catch (err) {
        console.error("Mic Error:", err);
        alert("Could not access microphone.");
      }
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (event) => { audioChunksRef.current.push(event.data); };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const arrayBuffer = await audioBlob.arrayBuffer();
        const ctx = getAudioContext();
        try {
            const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
            setRecordedAudioBuffer(decodedBuffer);
        } catch (e) { console.error("Error decoding audio", e); }
      };
      mediaRecorder.start();
      setIsRecording(true);
      setIsSwarmPlaying(false);
      stopSwarmSound();
    } catch (err) { console.error("Recording setup error", err); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const playSwarmSound = () => {
    if (!recordedAudioBuffer || particlesRef.current.length === 0) return;
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    setIsSwarmPlaying(true);
    swarmGainNodesRef.current = [];
    const maxVoices = 40; 
    const particlesToPlay = particlesRef.current.slice(0, maxVoices);
    const screenWidth = window.innerWidth;
    const normalizationFactor = 0.5;
    const voiceCount = Math.max(1, particlesToPlay.length);
    const gainValue = (normalizationFactor * swarmVolume) / voiceCount;

    const { pitchScatter, reverbMix } = swarmConfigRef.current;

    particlesToPlay.forEach(p => {
        const source = ctx.createBufferSource();
        source.buffer = recordedAudioBuffer;
        
        // Pitch/Speed logic using pitchScatter
        const speedVar = (Math.random() - 0.5) * pitchScatter;
        source.playbackRate.value = Math.max(0.1, 1.0 + speedVar);

        source.loop = true;
        source.loopStart = Math.random() * (recordedAudioBuffer.duration * 0.5);
        source.loopEnd = recordedAudioBuffer.duration;
        
        const panner = ctx.createStereoPanner();
        const pan = (p.x / screenWidth) * 2 - 1;
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        
        const gain = ctx.createGain();
        gain.gain.value = gainValue; 
        swarmGainNodesRef.current.push(gain);
        
        const dryGain = ctx.createGain();
        const wetGain = ctx.createGain();
        
        // Use reverbMix config
        dryGain.gain.value = 1 - reverbMix;
        wetGain.gain.value = reverbMix;

        source.connect(panner);
        panner.connect(gain);
        gain.connect(dryGain);
        dryGain.connect(ctx.destination);
        gain.connect(wetGain);
        if (reverbNodeRef.current) wetGain.connect(reverbNodeRef.current);
        
        source.start(0, Math.random() * recordedAudioBuffer.duration);
        swarmSourcesRef.current.push(source);
    });
  };

  const stopSwarmSound = () => {
    swarmSourcesRef.current.forEach(node => { try { node.stop(); } catch(e){} });
    swarmSourcesRef.current = [];
    swarmGainNodesRef.current = [];
    setIsSwarmPlaying(false);
  };

  const toggleSwarmSound = () => { isSwarmPlaying ? stopSwarmSound() : playSwarmSound(); };

  useEffect(() => {
    if (isSwarmPlaying && swarmGainNodesRef.current.length > 0) {
        const ctx = getAudioContext();
        const normalizationFactor = 0.5;
        const voiceCount = Math.max(1, swarmGainNodesRef.current.length);
        const newGain = (normalizationFactor * swarmVolume) / voiceCount;
        swarmGainNodesRef.current.forEach(g => { g.gain.setTargetAtTime(newGain, ctx.currentTime, 0.1); });
    }
  }, [swarmVolume, isSwarmPlaying]);

  const setBlendModeHandler = (mode: BlendMode) => { setBlendMode(mode); }; // Simplified handler
  
  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch((e) => {
            console.error("Fullscreen denied:", e);
            setIsFullScreen(true);
        });
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
    }
  };

  // Weight/Height Setter Logic (Handling Selections)
  const updateWeight = (newVal: number) => {
      // Logic split based on Edit Mode
      if (editMode === 'selection') {
          if (selectedIndices.size > 0) {
              setCharOverrides(prev => {
                  const next = { ...prev };
                  selectedIndices.forEach(idx => {
                      // Remove customMatrix to unbake extrusion
                      const existing = next[idx] || {};
                      const { customMatrix, ...rest } = existing; 
                      next[idx] = { ...rest, w: newVal };
                  });
                  return next;
              });
          }
      } else {
          // Global mode
          setGlobalWeight(newVal);
      }
  };

  const updateHeight = (newVal: number) => {
      if (editMode === 'selection') {
          if (selectedIndices.size > 0) {
              setCharOverrides(prev => {
                  const next = { ...prev };
                  selectedIndices.forEach(idx => {
                      // Remove customMatrix to unbake extrusion
                      const existing = next[idx] || {};
                      const { customMatrix, ...rest } = existing;
                      next[idx] = { ...rest, h: newVal };
                  });
                  return next;
              });
          }
      } else {
          // Global mode
          setGlobalHeight(newVal);
      }
  };

  const handleVerticalAlign = (align: VerticalAlign) => {
      if (editMode === 'selection' && selectedIndices.size > 0) {
          setCharOverrides(prev => {
              const next = { ...prev };
              selectedIndices.forEach(idx => {
                  next[idx] = { ...next[idx], valign: align };
              });
              return next;
          });
      } else {
          setVerticalAlign(align);
      }
  };
  
  // Selection Handling
  const handleCharClick = (e: React.MouseEvent, index: number) => {
      if (toolMode !== 'selection') return; // Only select in Selection Mode
      if (isPlaying) return; // Disable selection in Play mode
      e.stopPropagation();
      
      setSelectedIndices(prev => {
          const next = new Set(prev);
          if (next.has(index)) {
              next.delete(index);
          } else {
              next.add(index);
          }
          return next;
      });
  };

  const handleCharMouseDown = (e: React.MouseEvent, index: number) => {
      if (toolMode !== 'drag') return;
      
      e.preventDefault();
      e.stopPropagation();

      const el = charRefs.current.get(index);
      const artboard = artboardRef.current;
      
      if (el && artboard) {
          const elRect = el.getBoundingClientRect();
          const artRect = artboard.getBoundingClientRect();
          
          // Correct: Use padding box origin (clientLeft/Top handles border width)
          const artBorderLeft = artboard.clientLeft; 
          const artBorderTop = artboard.clientTop;

          const startRelX = elRect.left - (artRect.left + artBorderLeft);
          const startRelY = elRect.top - (artRect.top + artBorderTop);
          
          const curX = charPositions[index]?.x || 0;
          const curY = charPositions[index]?.y || 0;
          
          const layoutRelX = startRelX - (curX * effectivePixelSize);
          const layoutRelY = startRelY - (curY * effectivePixelSize);

          draggingCharRef.current = {
              index,
              startX: e.clientX,
              startY: e.clientY,
              startRelX,
              startRelY,
              layoutRelX,
              layoutRelY
          };
      }
  };

  const clearSelection = () => {
      if (!isPlaying && toolMode === 'selection') setSelectedIndices(new Set());
  };

  useLayoutEffect(() => {
    const calculateSize = () => {
      // Logic for pixel size calculation
      // Formerly calculated available width and max possible size, 
      // but current design enforces User Pixel Size preference directly.
      if (!containerRef.current) return;
      if (artboardMode !== 'none' && !artboardRef.current) return;

      const charCount = inputText.length;
      if (charCount === 0) return;
      
      // Update effective size based on User Input
      setEffectivePixelSize(userPixelSize);
    };
    calculateSize();
    if (textContainerRef.current && textContainerRef.current.children.length > 0) {
       const children = Array.from(textContainerRef.current.children);
       const tops = children.map(c => (c as HTMLElement).getBoundingClientRect().top);
       const minTop = Math.min(...tops);
       const maxTop = Math.max(...tops);
       const threshold = Math.max(2, effectivePixelSize * 5); 
       setIsMultiLine((maxTop - minTop) > threshold);
    } else {
       setIsMultiLine(false);
    }
    window.addEventListener('resize', calculateSize);
    return () => window.removeEventListener('resize', calculateSize);
  }, [inputText, userPixelSize, globalWeight, globalHeight, charOverrides, isSwirlMode, lineSpacingScale, isPlaying, artboardMode, textAlign, verticalAlign, useCustomFont]);

  const animate = () => {
    let volume = 0;
    if (isMicActive && analyserRef.current && dataArrayRef.current) {
      analyserRef.current.getByteFrequencyData(dataArrayRef.current);
      let sum = 0;
      for (let i = 0; i < dataArrayRef.current.length; i++) sum += dataArrayRef.current[i];
      volume = sum / dataArrayRef.current.length;
      volume = (volume / 128.0) * micSensitivityRef.current; 
    }

    const { baseRadius, rotationalForce, attractionStrength, noiseIntensity, audioRadiusScale, audioForceScale } = swirlConfigRef.current;
    let swirlRadius = baseRadius;
    let currentRotationalForce = rotationalForce;

    if (isMicActive && isSwirlMode) {
      const maxDim = Math.max(window.innerWidth, window.innerHeight);
      swirlRadius = baseRadius + (volume * maxDim * audioRadiusScale);
      currentRotationalForce = rotationalForce + (volume * audioForceScale);
    }

    // --- SWIRL MODE FIX: ROBUST CACHE CHECK ---
    if (isSwirlMode) {
      const isCacheInvalid = staticPixelsCacheRef.current.length === 0 || 
                             (staticPixelsCacheRef.current.length > 0 && !staticPixelsCacheRef.current[0].el.isConnected);
      
      if (isCacheInvalid) {
        staticPixelsCacheRef.current = [];
        const els = document.querySelectorAll('.pixel-interactive') as NodeListOf<HTMLElement>;
        els.forEach(el => {
          const rect = el.getBoundingClientRect();
          staticPixelsCacheRef.current.push({ el, baseX: rect.left + rect.width / 2, baseY: rect.top + rect.height / 2 });
        });
      }

      staticPixelsCacheRef.current.forEach(item => {
        if (!item.el.isConnected) return;

        const dx = mouseRef.current.x - item.baseX;
        const dy = mouseRef.current.y - item.baseY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < swirlRadius) {
          const angle = Math.atan2(dy, dx);
          const swirlFactor = (1 - dist / swirlRadius); 
          
          // 1. Rotation logic (Directional)
          const newAngle = angle + swirlFactor * currentRotationalForce;
          
          // 2. Attraction / Repulsion Logic
          // attractionStrength: Positive = pull towards mouse, Negative = push away
          // We calculate the new distance based on strength
          // The closer to the center (higher swirlFactor), the stronger the pull/push
          const radialMove = swirlFactor * attractionStrength * 100; // Scale factor 100px max displacement
          let newDist = dist - radialMove;
          // Prevent crossing the center point too wildly if attracted
          if (attractionStrength > 0 && newDist < 0) newDist = 0; 

          // Calculate new position relative to mouse center
          const relX = Math.cos(newAngle) * newDist;
          const relY = Math.sin(newAngle) * newDist;
          
          let newX = mouseRef.current.x - relX;
          let newY = mouseRef.current.y - relY;
          
          // 3. Chaos / Noise Logic
          if (noiseIntensity > 0) {
              newX += (Math.random() - 0.5) * noiseIntensity * swirlFactor * 50;
              newY += (Math.random() - 0.5) * noiseIntensity * swirlFactor * 50;
          }

          let tx = newX - item.baseX;
          let ty = newY - item.baseY;
          let tr = swirlFactor * 360; 

          // --- MATRIX MODE SWIRL ---
          if (interactionMode === 'matrix') {
             tx = Math.round(tx / effectivePixelSize) * effectivePixelSize;
             ty = Math.round(ty / effectivePixelSize) * effectivePixelSize;
             tr = 0; // No rotation in matrix mode
          }

          item.el.style.setProperty('--tx', `${-tx}px`);
          item.el.style.setProperty('--ty', `${-ty}px`);
          item.el.style.setProperty('--tr', `${tr}deg`);
        } else {
          item.el.style.setProperty('--tx', '0px');
          item.el.style.setProperty('--ty', '0px');
          item.el.style.setProperty('--tr', '0deg');
        }
      });
    }

    const particles = particlesRef.current;
    const { friction, restitution, dragStiffness, gravity } = physicsConfigRef.current;
    const isSwarm = isSwarmPlayingRef.current;
    
    const activeParticles = particles.filter(p => !!p);

    activeParticles.forEach((p, i) => {
      if (p.isReturning) {
        if (interactionMode === 'matrix') {
            // Robotic Return: Manhattan movement (X then Y) + Constant Speed
            const speed = Math.max(2, effectivePixelSize * 0.5);
            const dx = p.originX - p.x;
            const dy = p.originY - p.y;

            if (Math.abs(dx) > 1) {
                // Move X first
                p.x += Math.sign(dx) * Math.min(Math.abs(dx), speed);
            } else {
                p.x = p.originX; // Snap X
                // Then Move Y
                if (Math.abs(dy) > 1) {
                    p.y += Math.sign(dy) * Math.min(Math.abs(dy), speed);
                } else {
                    p.y = p.originY; // Snap Y
                }
            }
            p.vx = 0; p.vy = 0; // Kill velocity
        } else {
            // Organic Return (Existing)
            const dx = p.originX - p.x;
            const dy = p.originY - p.y;
            p.x += dx * 0.1;
            p.y += dy * 0.1;
            p.vx *= 0.8;
            p.vy *= 0.8;

            if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
              p.x = p.originX;
              p.y = p.originY;
            }
        }
      } else if (p.isDragging) {
        const dx = mouseRef.current.x - (p.x + p.width/2);
        const dy = mouseRef.current.y - (p.y + p.height/2);
        p.vx = dx * dragStiffness;
        p.vy = dy * dragStiffness;
        p.x += p.vx;
        p.y += p.vy;
      } else {
        p.vy += gravity;

        if (volume > 0.1) {
           p.vx += (Math.random() - 0.5) * volume * 5; 
           p.vy += (Math.random() - 0.5) * volume * 5; 
        }

        if (isSwirlMode) {
          const dx = (p.x + p.width/2) - mouseRef.current.x;
          const dy = (p.y + p.height/2) - mouseRef.current.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          
          if (dist < swirlRadius) {
             const force = (1 - dist/swirlRadius) * currentRotationalForce; // Use currentRotationalForce
             
             if (interactionMode === 'matrix') {
                 // Matrix Mode: Burst Straight (Cardinal directions only)
                 const absX = Math.abs(dx);
                 const absY = Math.abs(dy);
                 // Only apply force on the dominant axis to effectively "burst straight"
                 // Direction should be opposite to dx/dy (away from mouse)
                 if (absX > absY) {
                     p.vx += (dx > 0 ? -1 : 1) * force; 
                 } else {
                     p.vy += (dy > 0 ? -1 : 1) * force;
                 }
             } else {
                 // Organic Mode: Radial Burst
                 const angle = Math.atan2(dy, dx);
                 p.vx += Math.cos(angle) * force;
                 p.vy += Math.sin(angle) * force;
             }
          }
        }

        p.vx *= friction; 
        p.vy *= friction;
        p.x += p.vx;
        p.y += p.vy;

        const maxY = window.innerHeight - p.height;
        const maxX = window.innerWidth - p.width;

        if (p.y > maxY) {
          p.y = maxY;
          p.vy *= -restitution;
        }
        if (p.y < 0) {
          p.y = 0;
          p.vy *= -restitution;
        }
        if (p.x > maxX) {
          p.x = maxX;
          p.vx *= -restitution;
        }
        if (p.x < 0) {
          p.x = 0;
          p.vx *= -restitution;
        }

        for (let j = i + 1; j < activeParticles.length; j++) {
           const other = activeParticles[j];
           if (other.isReturning || other.isDragging) continue;

           const dx = (p.x + p.width/2) - (other.x + other.width/2);
           const dy = (p.y + p.height/2) - (other.y + other.height/2);
           const distance = Math.sqrt(dx*dx + dy*dy);
           const minDist = (p.width + other.width) / 2;

           if (distance < minDist) {
             const angle = Math.atan2(dy, dx);
             const force = 0.5;
             const pushX = Math.cos(angle) * force;
             const pushY = Math.sin(angle) * force;
             
             p.vx += pushX;
             p.vy += pushY;
             other.vx -= pushX;
             other.vy -= pushY;
           }
        }
      }
    });

    particlesRef.current.forEach(p => {
       const el = document.getElementById(p.id);
       if (el) {
         if (p.isReturning) {
            const isAtHome = Math.abs(p.x - p.originX) < 0.5 && Math.abs(p.y - p.originY) < 0.5;
            if (isAtHome) {
              el.classList.add('returning');
              el.style.setProperty('--return-color', canvasColors.text);
            } else {
              el.classList.remove('returning');
              el.style.removeProperty('--return-color');
            }
         } else {
            el.classList.remove('returning');
            el.style.removeProperty('--return-color');
         }

         let currentScale = 1;
         if (isMicActive) {
            currentScale += volume;
         }
         if (isSwarm) {
             const pulse = Math.sin(Date.now() * 0.03 + (p.x * 0.1)) * 0.2;
             currentScale += pulse;
         }
         currentScale = Math.max(0.1, currentScale);

         // --- MATRIX MODE PARTICLES ---
         let renderX = p.x;
         let renderY = p.y;
         let renderRot = p.vx * 2;

         if (interactionMode === 'matrix') {
             renderX = Math.round(p.x / effectivePixelSize) * effectivePixelSize;
             renderY = Math.round(p.y / effectivePixelSize) * effectivePixelSize;
             renderRot = 0; // No rotation in matrix mode
         }

         el.style.transform = `translate(${renderX}px, ${renderY}px) rotate(${renderRot}deg) scale(${currentScale})`;
         
         if (!p.isReturning) {
            if (isRainbow) {
                const timeFactor = Date.now() * 0.2;
                const spatialFactor = (p.x + p.y) * 0.5;
                const hue = (timeFactor + spatialFactor) % 360;
                el.style.backgroundColor = `hsl(${hue}, 100%, 50%)`;
            } else {
                el.style.backgroundColor = hoverColor;
            }
         }
       }
    });

    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, [isMicActive, isRainbow, hoverColor, isSwirlMode, canvasColors, interactionMode, effectivePixelSize]); 


  // --- Event Handlers ---
  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    let clientX, clientY;
    if ('touches' in e) {
       clientX = e.touches[0].clientX;
       clientY = e.touches[0].clientY;
    } else {
       clientX = (e as React.MouseEvent).clientX;
       clientY = (e as React.MouseEvent).clientY;
    }
    
    // Drag Letter Logic (Strict Snap-to-Grid)
    if (toolMode === 'drag' && draggingCharRef.current) {
        const { index, startX, startY, startRelX, startRelY, layoutRelX, layoutRelY } = draggingCharRef.current;
        const deltaX = clientX - startX;
        const deltaY = clientY - startY;
        
        const rawTargetX = startRelX + deltaX;
        const rawTargetY = startRelY + deltaY;

        const snappedTargetX = Math.round(rawTargetX / effectivePixelSize) * effectivePixelSize;
        const snappedTargetY = Math.round(rawTargetY / effectivePixelSize) * effectivePixelSize;

        const newTransformX = snappedTargetX - layoutRelX;
        const newTransformY = snappedTargetY - layoutRelY;

        const newUnitX = newTransformX / effectivePixelSize;
        const newUnitY = newTransformY / effectivePixelSize;

        setCharPositions(prev => ({
            ...prev,
            [index]: {
                x: newUnitX,
                y: newUnitY
            }
        }));
        return;
    }

    // --- Extrude Tool Drag Logic (Matrix Manipulation) ---
    if (toolMode === 'extrude' && extrudeDragRef.current && !('touches' in e)) {
        const { charIndex, startX, startY, accumulatedX, accumulatedY } = extrudeDragRef.current;
        
        // Calculate raw deltas
        const diffX = clientX - startX;
        const diffY = clientY - startY;
        
        // Accumulate deltas to handle sensitivity
        const totalX = accumulatedX + diffX;
        const totalY = accumulatedY + diffY;
        
        // Threshold for activation (1 effective pixel size)
        const threshold = effectivePixelSize;
        
        if (Math.abs(totalX) < threshold && Math.abs(totalY) < threshold) {
            // Update ref accumulation but don't commit state yet
            extrudeDragRef.current = { ...extrudeDragRef.current, accumulatedX: totalX, accumulatedY: totalY, startX: clientX, startY: clientY };
            return;
        }

        // Determine Direction Dominance
        const isHorizontal = Math.abs(totalX) > Math.abs(totalY);
        
        setCharOverrides(prev => {
            const charData = prev[charIndex] || {};
            // Ensure we have a custom matrix to work on. 
            // If dragging started, customMatrix MUST exist (created in onMouseDown).
            let matrix = charData.customMatrix ? charData.customMatrix.map(row => [...row]) : []; 
            if (matrix.length === 0) return prev; // Safety check

            // Original clicked coords (mapped to current matrix dimensions if needed, 
            // but simplified: we track the *insertion point* relative to the drag start)
            // Actually, we need to know WHERE the drag started relative to the character.
            // But we don't have the initial col/row index here easily without passing it.
            // Let's rely on the extrudeDragRef holding the target index?
            // Refinement: Store targetRow/Col in Ref.
            const targetRow = (extrudeDragRef.current as any).targetRow;
            const targetCol = (extrudeDragRef.current as any).targetCol;

            if (isHorizontal) {
                // Horizontal Action
                if (totalX > 0) {
                    // Drag Right -> Insert Column
                    // Insert a column at targetCol + 1 containing copy of targetCol
                    const colToCopy = Math.min(matrix[0].length - 1, Math.max(0, targetCol));
                    
                    // Insert into every row
                    for (let r = 0; r < matrix.length; r++) {
                        matrix[r].splice(colToCopy + 1, 0, matrix[r][colToCopy]);
                    }
                } else {
                    // Drag Left -> Delete Column
                    if (matrix[0].length > 1) {
                         const colToDelete = Math.min(matrix[0].length - 1, Math.max(0, targetCol));
                         for (let r = 0; r < matrix.length; r++) {
                            matrix[r].splice(colToDelete, 1);
                        }
                    }
                }
            } else {
                // Vertical Action
                if (totalY > 0) {
                    // Drag Down -> Insert Row (SEGMENTED)
                    // We want to extend only the connected segment of 1s.
                    const rowToCopyIndex = Math.min(matrix.length - 1, Math.max(0, targetRow));
                    const sourceRow = matrix[rowToCopyIndex];
                    
                    // Logic: Copy only the connected group of 1s around targetCol
                    const newRow = new Array(sourceRow.length).fill(0);
                    
                    if (sourceRow[targetCol] === 1) {
                        // Find connected segment
                        let left = targetCol;
                        while(left >= 0 && sourceRow[left] === 1) {
                            newRow[left] = 1;
                            left--;
                        }
                        let right = targetCol + 1;
                        while(right < sourceRow.length && sourceRow[right] === 1) {
                            newRow[right] = 1;
                            right++;
                        }
                    } else {
                        // Clicking on empty space usually shouldn't extrude, but let's just copy 0s (empty row)
                        // Or maybe copy the whole row if it's all empty? 
                        // Let's stick to: if 0, add empty row.
                    }

                    matrix.splice(rowToCopyIndex + 1, 0, newRow);

                } else {
                    // Drag Up -> Delete Row
                    if (matrix.length > 1) {
                        const rowToDelete = Math.min(matrix.length - 1, Math.max(0, targetRow));
                        matrix.splice(rowToDelete, 1);
                    }
                }
            }

            return {
                ...prev,
                [charIndex]: {
                    ...charData,
                    customMatrix: matrix
                }
            };
        });

        // Reset accumulation after action, but keep start pos for next tick
        // Actually, we act on steps. Reset accumulated.
        extrudeDragRef.current = { 
            ...extrudeDragRef.current, 
            accumulatedX: 0, 
            accumulatedY: 0, 
            startX: clientX, 
            startY: clientY 
        };
        return; 
    }

    // Weight & Height Drag Logic (Shift + Move in Play Mode)
    if (isPlaying && !('touches' in e)) {
        const mouseEvent = e as React.MouseEvent;
        if (mouseEvent.shiftKey) {
             const deltaX = clientX - prevMouseXRef.current;
             const deltaY = clientY - prevMouseYRef.current;

             if (prevMouseXRef.current !== 0 && prevMouseYRef.current !== 0) {
                 // Horizontal -> Weight
                 weightDragAccumulator.current += deltaX;
                 const WEIGHT_THRESHOLD = 30; 
                 if (Math.abs(weightDragAccumulator.current) >= WEIGHT_THRESHOLD) {
                     const direction = Math.sign(weightDragAccumulator.current);
                     updateWeight(Math.max(-2, Math.min(12, globalWeight + direction)));
                     weightDragAccumulator.current -= (direction * WEIGHT_THRESHOLD);
                 }

                 // Vertical -> Height
                 heightDragAccumulator.current += deltaY;
                 const HEIGHT_THRESHOLD = 30; 
                 if (Math.abs(heightDragAccumulator.current) >= HEIGHT_THRESHOLD) {
                     const direction = Math.sign(heightDragAccumulator.current);
                     updateHeight(Math.max(-6, Math.min(22, globalHeight + direction)));
                     heightDragAccumulator.current -= (direction * HEIGHT_THRESHOLD);
                 }
             }
        } else {
            weightDragAccumulator.current = 0;
            heightDragAccumulator.current = 0;
        }
    }

    prevMouseXRef.current = clientX;
    prevMouseYRef.current = clientY;
    mouseRef.current.x = clientX;
    mouseRef.current.y = clientY;
  };

  const handleMouseUp = () => {
    // End Drag
    if (toolMode === 'drag' && draggingCharRef.current) {
        draggingCharRef.current = null;
    }
    
    // End Extrude
    if (toolMode === 'extrude' && extrudeDragRef.current) {
        extrudeDragRef.current = null;
    }

    mouseRef.current.isDown = false;
    particlesRef.current.forEach(p => p.isDragging = false);
  };

  const handleReset = () => {
    stopSwarmSound();
    clearSelection();
    setCharOverrides({});
    setCharPositions({}); // Reset positions on clear
    particlesRef.current.forEach(p => {
      p.isReturning = true;
    });
    setTimeout(() => {
      particlesRef.current = [];
      setResetTrigger(prev => prev + 1);
    }, 1500);
  };

  // --- Render Helpers ---
  const isParticleActive = (id: string) => {
    return particlesRef.current.some(p => p.id === id); 
  };
  
  const activateParticle = (id: string, rect: DOMRect) => {
    if (isParticleActive(id)) return;
    const newParticle: Particle = {
      id,
      x: rect.left, y: rect.top, originX: rect.left, originY: rect.top,
      vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
      width: rect.width, height: rect.height,
      color: hoverColor, isReturning: false, isDragging: true, shapeKey: hoverShape
    };
    particlesRef.current.push(newParticle);
    mouseRef.current.isDown = true;
  };

  // Handles start of Extrude Drag
  const handleExtrudeStart = (charIndex: number, rowIndex: number, colIndex: number, e: React.MouseEvent) => {
      // 1. Freeze current generation into customMatrix if it doesn't exist
      if (!charOverrides[charIndex]?.customMatrix) {
          const char = inputText[charIndex];
          // Use the engine to get the current state
          const generated = resolveGlyphMatrix({
            char,
            index: charIndex,
            useCustomFont,
            globalWeight,
            globalHeight,
            charOverrides
          });
          
          if (generated) {
              setCharOverrides(prev => ({
                  ...prev,
                  [charIndex]: {
                      ...prev[charIndex],
                      customMatrix: generated // Freeze it
                  }
              }));
          }
      }

      extrudeDragRef.current = {
          charIndex,
          startX: e.clientX,
          startY: e.clientY,
          accumulatedX: 0,
          accumulatedY: 0,
          // Store the logical row/col we clicked on
          // @ts-ignore
          targetRow: rowIndex,
          // @ts-ignore
          targetCol: colIndex
      };
  };

  const PixelCell: React.FC<{ active: boolean; rowIndex: number; colIndex: number; charIndex: number; resetTrigger: number; hoverShape: ShapeKey; isSelected: boolean; isExtrudeMode: boolean; onExtrudeStart: (charIndex: number, rowIndex: number, colIndex: number, e: React.MouseEvent) => void }> = ({ active, rowIndex, colIndex, charIndex, resetTrigger, hoverShape, isSelected, isExtrudeMode, onExtrudeStart }) => {
    const id = `px-${charIndex}-${rowIndex}-${colIndex}`;
    const [isHidden, setIsHidden] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const isPhysics = isParticleActive(id);
    
    useEffect(() => { setIsHidden(false); }, [resetTrigger]);

    const handleMouseDown = (e: React.MouseEvent) => {
      if (isExtrudeMode) {
          e.preventDefault();
          e.stopPropagation();
          onExtrudeStart(charIndex, rowIndex, colIndex, e);
          return;
      }

      if (!isPlaying || !active || isPhysics) return;
      e.preventDefault(); 
      if (ref.current) {
        const rect = ref.current.getBoundingClientRect();
        activateParticle(id, rect);
        setIsHidden(true);
      }
    };

    const cellSize = effectivePixelSize;

    if (!active) return <div style={{ width: cellSize, height: cellSize }} />;

    // Selection Style: Outline only (Transparent bg, Border colored)
    const style: React.CSSProperties = {
      width: '100%', height: '100%',
      backgroundColor: isSelected ? 'transparent' : canvasColors.text,
      border: isSelected ? `1px solid ${canvasColors.text}` : 'none',
      boxSizing: 'border-box',
      '--pixel-color': canvasColors.text, 
      cursor: isExtrudeMode ? 'crosshair' : (isPlaying ? 'pointer' : 'default')
    } as React.CSSProperties;

    const shapeClass = hoverShape === 'Star' ? 'shape-star' : '';
    // Disable hover effects in Extrude Mode
    const interactiveClass = isExtrudeMode ? '' : `pixel-interactive ${shapeClass}`;

    return (
      <div style={{ width: cellSize, height: cellSize }} className="relative flex-shrink-0">
        {!isHidden && !isPhysics && (
           <div ref={ref} onMouseDown={handleMouseDown} className={`w-full h-full ${isPlaying ? interactiveClass : 'pixel-base'}`} style={style} />
        )}
      </div>
    );
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newVal = e.target.value;
      setInputText(newVal);
      
      // Requirement: When text is entered (changed), it aligns directly to grid (reset drag positions)
      setCharPositions({});

      // Requirement: Clearing text completely resets all typography settings
      if (newVal.length === 0) {
          setGlobalWeight(0);
          setGlobalHeight(0);
          setCharOverrides({});
          setTextAlign('center'); // Default back to center alignment
          setLineSpacingScale(0.5); // Default spacing
          setSelectedIndices(new Set());
      }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter') {
          e.preventDefault();
          // Insert the paragraph glyph directly into the text instead of a newline
          const cursorPosition = e.currentTarget.selectionStart;
          const textBefore = inputText.substring(0, cursorPosition);
          const textAfter = inputText.substring(e.currentTarget.selectionEnd);
          const newText = textBefore + '¶' + textAfter;
          
          setInputText(newText);
          setCharPositions({}); // Reset alignment on typing
      }
  };

  // --- Main Render & Styles ---
  
  const themeStyles = {
    '--ui-bg': uiTheme.bgColor,
    '--ui-text': uiTheme.textColor,
    '--ui-border': uiTheme.borderColor,
    '--ui-border-width': `${uiTheme.borderWidth}px`,
    '--ui-btn-bg': uiTheme.buttonBgColor,
    '--ui-font-scale': uiTheme.fontSizeScale,
    // Advanced Button Customization Variables
    '--ui-icon-stroke': uiTheme.iconStrokeWidth,
    '--ui-icon-color': uiTheme.iconColor,
    '--ui-btn-hover-bg': uiTheme.buttonHoverBgColor,
    '--ui-btn-selected-bg': uiTheme.buttonSelectedBgColor,
    '--ui-btn-selected-text': uiTheme.buttonSelectedTextColor,
  } as React.CSSProperties;

  const containerStyle = {
    '--hover-color': isRainbow ? 'transparent' : hoverColor, 
    '--hover-scale': hoverScale,
    '--hover-radius': SHAPES[hoverShape].radius,
    '--hover-clip': SHAPES[hoverShape].clip,
    ...themeStyles
  } as React.CSSProperties;

  const GRID_COLS = BASE_GRID.cols; 
  const GRID_ROWS = BASE_GRID.rows;

  const ButtonClass = `
    p-2 border rounded transition-colors flex items-center justify-center menu-toggle
    bg-[var(--ui-btn-bg)] text-[var(--ui-icon-color)] border-[var(--ui-border)] border-[length:var(--ui-border-width)]
    hover:bg-[var(--ui-btn-hover-bg)]
  `;

  // Standard selected state class
  const selectedBtnClass = `bg-[var(--ui-btn-selected-bg)] !text-[var(--ui-btn-selected-text)] border-[var(--ui-btn-selected-bg)]`;

  
  const MenuClass = `
    absolute bg-[var(--ui-bg)] border border-[var(--ui-border)] border-[length:var(--ui-border-width)] 
    p-4 shadow-2xl z-50 flex flex-col gap-4 text-[var(--ui-text)] rounded-lg menu-content min-w-[200px] max-w-[90vw]
  `;

  const renderMicMenu = (className: string) => (
    <div className={`${MenuClass} w-64 ${className}`} onClick={(e) => e.stopPropagation()}>
       <div className="flex justify-between items-center mb-2">
            <span className="text-xs uppercase font-bold tracking-widest">Audio / Swarm</span>
            <X size={14} className="cursor-pointer" onClick={() => toggleMenu('none')} />
        </div>

        {/* Mic Toggle */}
        <div className="flex justify-between items-center border-b border-gray-700 pb-2 mb-2">
            <span className="text-[10px] uppercase flex items-center gap-2">Microphone</span>
            <button 
                onClick={toggleMic} 
                className={`px-2 py-1 text-[9px] font-bold uppercase rounded ${isMicActive ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400'}`}
            >
                {isMicActive ? 'ON' : 'OFF'}
            </button>
        </div>

        {isMicActive && (
            <div className="flex flex-col gap-1 mb-3">
                <label className="text-[10px] uppercase opacity-70 flex justify-between">Sensitivity <span>{micSensitivity.toFixed(1)}</span></label>
                <input type="range" min="0.1" max="5.0" step="0.1" value={micSensitivity} onChange={(e) => setMicSensitivity(Number(e.target.value))} className="custom-slider"/>
            </div>
        )}

        {/* Recording Controls */}
        <div className="flex flex-col gap-2 border-b border-gray-700 pb-2 mb-2">
            <label className="text-[10px] uppercase opacity-70">Voice Recording</label>
            <div className="flex bg-gray-900 rounded p-1 gap-1">
                 <button onClick={startRecording} disabled={isRecording} className={`flex-1 p-1 rounded flex justify-center items-center gap-1 text-[10px] uppercase ${isRecording ? 'bg-red-600 text-white animate-pulse' : 'text-gray-400 hover:text-white'}`}>Record</button>
                 <button onClick={stopRecording} disabled={!isRecording} className="flex-1 p-1 rounded flex justify-center items-center gap-1 text-[10px] uppercase text-gray-400 hover:text-white">Stop</button>
            </div>
        </div>

        {/* Swarm Controls */}
        <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
                 <span className="text-[10px] uppercase opacity-70">Particle Swarm</span>
                 <button 
                    onClick={toggleSwarmSound} 
                    disabled={!recordedAudioBuffer}
                    className={`px-2 py-1 text-[9px] font-bold uppercase rounded ${isSwarmPlaying ? 'bg-green-500 text-black' : 'bg-gray-700 text-gray-400'}`}
                >
                    {isSwarmPlaying ? 'PLAY' : 'STOP'}
                </button>
            </div>
            {!recordedAudioBuffer && <span className="text-[9px] text-yellow-500 italic">Record audio first to use Swarm</span>}
            
            <div className={`flex flex-col gap-2 transition-opacity ${!recordedAudioBuffer ? 'opacity-50 pointer-events-none' : ''}`}>
                 <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase opacity-70 flex justify-between">Volume <span>{Math.round(swarmVolume * 100)}%</span></label>
                    <input type="range" min="0" max="1" step="0.05" value={swarmVolume} onChange={(e) => setSwarmVolume(Number(e.target.value))} className="custom-slider"/>
                </div>
                 <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase opacity-70 flex justify-between">Pitch Scatter <span>{swarmConfig.pitchScatter}</span></label>
                    <input type="range" min="0" max="2" step="0.1" value={swarmConfig.pitchScatter} onChange={(e) => setSwarmConfig(p => ({...p, pitchScatter: Number(e.target.value)}))} className="custom-slider"/>
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase opacity-70 flex justify-between">Reverb Mix <span>{swarmConfig.reverbMix}</span></label>
                    <input type="range" min="0" max="1" step="0.1" value={swarmConfig.reverbMix} onChange={(e) => setSwarmConfig(p => ({...p, reverbMix: Number(e.target.value)}))} className="custom-slider"/>
                </div>
            </div>
        </div>
    </div>
  );

  const renderSwirlMenu = (className: string) => (
      <div className={`${MenuClass} w-64 ${className}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-2">
            <span className="text-xs uppercase font-bold tracking-widest">Swirl Effect</span>
            <X size={14} className="cursor-pointer" onClick={() => toggleMenu('none')} />
        </div>
        
        {/* Toggle inside menu as well (optional, since button toggles menu, but maybe useful to see state) */}
        <div className="flex justify-between items-center border-b border-gray-700 pb-2 mb-2">
            <span className="text-[10px] uppercase flex items-center gap-2">Enable Swirl</span>
            <button 
                onClick={() => setIsSwirlMode(!isSwirlMode)} 
                className={`px-2 py-1 text-[9px] font-bold uppercase rounded ${isSwirlMode ? 'bg-white text-black' : 'bg-gray-700 text-gray-400'}`}
            >
                {isSwirlMode ? 'ON' : 'OFF'}
            </button>
        </div>

        <div className={`flex flex-col gap-3 transition-opacity ${!isSwirlMode ? 'opacity-50 pointer-events-none' : ''}`}>
             <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase opacity-70 flex justify-between">Radius <span>{swirlConfig.baseRadius}</span></label>
                <input type="range" min="50" max="500" step="10" value={swirlConfig.baseRadius} onChange={(e) => setSwirlConfig(p => ({...p, baseRadius: Number(e.target.value)}))} className="custom-slider"/>
            </div>
            <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase opacity-70 flex justify-between">Rotation Speed <span>{swirlConfig.rotationalForce.toFixed(1)}</span></label>
                <input type="range" min="-5.0" max="5.0" step="0.1" value={swirlConfig.rotationalForce} onChange={(e) => setSwirlConfig(p => ({...p, rotationalForce: Number(e.target.value)}))} className="custom-slider"/>
            </div>
            
            <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase opacity-70 flex justify-between">
                    <span>{swirlConfig.attractionStrength < 0 ? 'Repel' : (swirlConfig.attractionStrength > 0 ? 'Attract' : 'Gravity')}</span>
                    <span>{swirlConfig.attractionStrength.toFixed(1)}</span>
                </label>
                <div className="flex justify-between items-center gap-2">
                    <span className="text-[8px] opacity-50">Push</span>
                    <input type="range" min="-1.0" max="1.0" step="0.1" value={swirlConfig.attractionStrength} onChange={(e) => setSwirlConfig(p => ({...p, attractionStrength: Number(e.target.value)}))} className="custom-slider flex-1"/>
                    <span className="text-[8px] opacity-50">Pull</span>
                </div>
            </div>

            <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase opacity-70 flex justify-between">Chaos / Noise <span>{swirlConfig.noiseIntensity.toFixed(1)}</span></label>
                <input type="range" min="0.0" max="2.0" step="0.1" value={swirlConfig.noiseIntensity} onChange={(e) => setSwirlConfig(p => ({...p, noiseIntensity: Number(e.target.value)}))} className="custom-slider"/>
            </div>
            
            <div className="border-t border-gray-700 pt-2 mt-1">
                <label className="text-[10px] uppercase opacity-70 mb-2 block text-gray-400">Audio Reactivity</label>
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase opacity-70 flex justify-between">Radius React <span>{swirlConfig.audioRadiusScale}</span></label>
                        <input type="range" min="0" max="2" step="0.1" value={swirlConfig.audioRadiusScale} onChange={(e) => setSwirlConfig(p => ({...p, audioRadiusScale: Number(e.target.value)}))} className="custom-slider"/>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase opacity-70 flex justify-between">Force React <span>{swirlConfig.audioForceScale}</span></label>
                        <input type="range" min="0" max="10" step="0.5" value={swirlConfig.audioForceScale} onChange={(e) => setSwirlConfig(p => ({...p, audioForceScale: Number(e.target.value)}))} className="custom-slider"/>
                    </div>
                </div>
            </div>
        </div>
      </div>
  );

  return (
    <div 
      className={`flex flex-col h-full font-mono select-none ${isSwirlMode ? 'swirl-mode' : ''}`}
      style={containerStyle}
      onMouseMove={handleMouseMove}
      onTouchMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchEnd={handleMouseUp}
      onClick={clearSelection}
    >
      {/* Global Style Injection for Icon Controls */}
      <style>{`
        button svg, .menu-toggle svg {
           stroke-width: var(--ui-icon-stroke) !important;
        }
      `}</style>
      
      {/* Hidden File Input for Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: 'none' }}
        accept=".json"
      />

      {/* Physics Layer */}
      <ParticleLayer 
        particlesRef={particlesRef} isRainbow={isRainbow} hoverColor={hoverColor} mouseRef={mouseRef} blendMode={blendMode} resetTrigger={resetTrigger}
      />

      {/* Header - Single Line Layout - Vertical Bottom Alignment */}
      {!isFullScreen && (
      <header className="flex-none px-4 py-2 md:py-0 min-h-[5rem] flex items-center border-b z-20 relative shadow-xl bg-[var(--ui-bg)] border-gray-500 text-[var(--ui-text)] transition-colors duration-300 border-b-[length:var(--ui-border-width)]">
        <div className="w-full flex flex-wrap md:flex-nowrap items-center md:items-end gap-4 md:gap-6 justify-between relative" style={{ fontSize: `calc(1rem * var(--ui-font-scale))` }}>
          
          {/* LEFT: Input Text with Persistent Blinking Cursor */}
          <div className={`flex-auto md:flex-none w-full md:w-1/4 max-w-xs relative mb-1 md:mb-[5px] order-1 group ${isPlaying ? 'opacity-30 pointer-events-none' : ''}`}>
             <div className="relative w-full grid place-items-start">
                  {/* Native textarea - transparent caret, text visible */}
                  <textarea
                    ref={inputRef}
                    value={inputText}
                    onChange={handleTextChange}
                    onKeyDown={handleInputKeyDown}
                    placeholder="Type here..."
                    rows={1}
                    className="col-start-1 col-end-2 row-start-1 row-end-2 w-full text-sm font-normal bg-transparent border-b focus:outline-none placeholder:text-gray-600 font-mono rounded-none py-1 border-[var(--ui-border)] text-[var(--ui-text)] resize-none overflow-hidden relative z-10 leading-none whitespace-nowrap"
                    style={{ caretColor: 'transparent' }} 
                  />
                  
                  {/* Fake Cursor Layer - Perfectly aligned via Grid */}
                  <div 
                     className="col-start-1 col-end-2 row-start-1 row-end-2 pointer-events-none w-full py-1 text-sm font-mono leading-none flex items-center z-20 overflow-hidden"
                     aria-hidden="true"
                  >
                     {/* Invisible text to push cursor */}
                     <span className="opacity-0 whitespace-pre">{inputText}</span>
                     {/* The Block Cursor */}
                     <span className={`w-[2px] h-[1em] bg-[var(--ui-text)] -ml-[1px] ${isPlaying ? 'opacity-0' : 'cursor-blink'}`}></span>
                  </div>
              </div>
          </div>

          {/* RIGHT: Play/Reset - Repositioned for Mobile (Order 2) */}
          <div className="flex gap-2 flex-none w-auto md:w-48 justify-end items-end order-2 md:order-3 ml-auto md:ml-0">
            {isPlaying && (
                <>
                <button
                  onClick={handleReset}
                  className={`flex-none flex items-center justify-center p-2 rounded border-[length:var(--ui-border-width)] bg-[var(--ui-btn-bg)] text-[var(--ui-icon-color)] border-[var(--ui-border)] hover:bg-[var(--ui-btn-hover-bg)]`}
                  title="Reset"
                >
                  <RotateCcw size={16} />
                </button>
                <button
                    onClick={toggleFullScreen}
                    className={`flex-none flex items-center justify-center p-2 rounded border-[length:var(--ui-border-width)] bg-[var(--ui-btn-bg)] text-[var(--ui-icon-color)] border-[var(--ui-border)] hover:bg-[var(--ui-btn-hover-bg)]`}
                    title="Full Screen"
                >
                    <Maximize size={16} />
                </button>
                </>
            )}

            <button
                onClick={(e) => { e.stopPropagation(); setIsPlaying(!isPlaying); }}
                className={`
                  flex-none flex items-center justify-center gap-2 px-6 py-2 font-bold transition-all uppercase tracking-widest text-sm rounded border-[length:var(--ui-border-width)] border-[var(--ui-border)]
                  ${isPlaying 
                    ? selectedBtnClass
                    : 'bg-[var(--ui-btn-bg)] text-[var(--ui-icon-color)] hover:bg-[var(--ui-btn-hover-bg)]'}
                `}
            >
                {isPlaying ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                <span>{isPlaying ? 'Stop' : 'Play'}</span>
            </button>
          </div>

          {/* CENTER: Controls & Sliders - Wrapped on Mobile (Order 3) */}
          <div className="flex flex-row items-center md:items-end gap-2 justify-center w-full md:w-auto md:flex-1 order-3 md:order-2 pb-1 md:pb-0">
             
             {/* Action Buttons Group - Always Active - Aligned to bottom via items-end */}
             <div className="flex gap-2 items-end flex-wrap justify-center">
                 
                 {/* 1. Tools Menu (Selection/Drag/Extrude) */}
                 <div className={`relative ${isPlaying ? 'opacity-30 pointer-events-none' : ''}`}>
                    <button onClick={(e) => { e.stopPropagation(); toggleMenu('tools'); }} className={`${ButtonClass} ${activeMenu === 'tools' ? selectedBtnClass : ''}`} title="Tools">
                        <MousePointer2 size={16}/>
                    </button>
                    {activeMenu === 'tools' && (
                        <div className={`${MenuClass} w-48 top-full left-0 mt-2`} onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-xs uppercase font-bold tracking-widest">Tools</span>
                                <X size={14} className="cursor-pointer" onClick={() => toggleMenu('none')} />
                            </div>
                            <div className="flex flex-col gap-1">
                                <button onClick={() => { setToolMode('selection'); clearSelection(); }} className={`text-[10px] uppercase text-left p-2 rounded flex justify-between items-center ${toolMode === 'selection' ? 'bg-white text-black' : 'hover:bg-gray-800'}`}>
                                    <span className="flex items-center gap-2"><BoxSelect size={12}/> Selection</span>
                                    {toolMode === 'selection' && <Check size={12}/>}
                                </button>
                                <button onClick={() => { setToolMode('drag'); clearSelection(); }} className={`text-[10px] uppercase text-left p-2 rounded flex justify-between items-center ${toolMode === 'drag' ? 'bg-white text-black' : 'hover:bg-gray-800'}`}>
                                    <span className="flex items-center gap-2"><Move size={12}/> Drag</span>
                                    {toolMode === 'drag' && <Check size={12}/>}
                                </button>
                                <button onClick={() => { setToolMode('extrude'); clearSelection(); }} className={`text-[10px] uppercase text-left p-2 rounded flex justify-between items-center ${toolMode === 'extrude' ? 'bg-white text-black' : 'hover:bg-gray-800'}`}>
                                    <span className="flex items-center gap-2"><ChevronsDown size={12}/> Extrude</span>
                                    {toolMode === 'extrude' && <Check size={12}/>}
                                </button>
                            </div>
                        </div>
                    )}
                 </div>

                 {/* 2. Typography Settings Menu */}
                 <div className={`relative ${isPlaying ? 'opacity-30 pointer-events-none' : ''}`}>
                    <button onClick={(e) => { e.stopPropagation(); toggleMenu('text'); }} className={`${ButtonClass} ${activeMenu === 'text' ? selectedBtnClass : ''}`} title="Typography Settings">
                        <Type size={16}/>
                    </button>
                    {activeMenu === 'text' && (
                        <div className={`${MenuClass} w-64 top-full left-0 mt-2`} onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-xs uppercase font-bold tracking-widest">Typography</span>
                                <X size={14} className="cursor-pointer" onClick={() => toggleMenu('none')} />
                            </div>
                            <div className="flex flex-col gap-2 border-b border-gray-700 pb-2 mb-2">
                                <label className="text-[10px] uppercase opacity-70">Font Source</label>
                                <div className="flex bg-gray-900 rounded p-1 gap-1">
                                    <button onClick={() => setUseCustomFont(true)} className={`flex-1 p-1 rounded flex justify-center items-center gap-1 text-[10px] uppercase ${useCustomFont ? 'bg-white text-black font-bold' : 'text-gray-500 hover:text-white'}`}><FileType size={12}/> Custom</button>
                                     <button onClick={() => setUseCustomFont(false)} className={`flex-1 p-1 rounded flex justify-center items-center gap-1 text-[10px] uppercase ${!useCustomFont ? 'bg-white text-black font-bold' : 'text-gray-500 hover:text-white'}`}><Cpu size={12}/> Procedural</button>
                                </div>
                            </div>
                            <div className="flex p-1 bg-gray-900 rounded mb-3 border border-gray-700">
                                <button onClick={() => setEditMode('global')} className={`flex-1 text-[9px] uppercase py-1 rounded flex items-center justify-center gap-1 ${editMode === 'global' ? 'bg-white text-black font-bold' : 'text-gray-400 hover:text-white'}`}><Users size={10} /> All</button>
                                <button onClick={() => setEditMode('selection')} className={`flex-1 text-[9px] uppercase py-1 rounded flex items-center justify-center gap-1 ${editMode === 'selection' ? 'bg-white text-black font-bold' : 'text-gray-400 hover:text-white'}`}><User size={10} /> Selected</button>
                            </div>
                            {editMode === 'selection' && selectedIndices.size === 0 && <div className="text-[9px] text-yellow-500 mb-2 italic text-center">Select characters on canvas to edit.</div>}
                            {editMode === 'selection' && selectedIndices.size > 0 && <div className="text-[9px] text-green-500 mb-2 text-center">Editing {selectedIndices.size} character{selectedIndices.size > 1 ? 's' : ''}</div>}
                            <div className="flex flex-col gap-2 mb-2 border-b border-gray-700 pb-2">
                                <label className="text-[10px] uppercase opacity-70">Alignment</label>
                                <div className="flex flex-col gap-2">
                                    <div className="flex gap-1">
                                        {(['left', 'center', 'right'] as const).map(align => (
                                            <button key={align} onClick={() => setTextAlign(align)} className={`flex-1 p-2 rounded border flex items-center justify-center ${textAlign === align ? 'bg-white text-black' : 'border-gray-600 text-gray-400 hover:text-white'}`}>
                                                {align === 'left' && <AlignLeft size={14} />} {align === 'center' && <AlignCenter size={14} />} {align === 'right' && <AlignRight size={14} />}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex gap-1">
                                        {(['top', 'center', 'bottom'] as const).map(align => (
                                            <button key={align} onClick={() => handleVerticalAlign(align)} className={`flex-1 p-2 rounded border flex items-center justify-center ${verticalAlign === align ? 'bg-white text-black' : 'border-gray-600 text-gray-400 hover:text-white'}`}>
                                                {align === 'top' && <ArrowUpToLine size={14} />} {align === 'center' && <FoldVertical size={14} />} {align === 'bottom' && <ArrowDownToLine size={14} />}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div className="flex flex-col gap-3">
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] uppercase opacity-70 flex justify-between">Size <span>{userPixelSize}px</span></label>
                                    <input type="range" min="4" max="64" value={userPixelSize} onChange={(e) => setUserPixelSize(Number(e.target.value))} className="custom-slider"/>
                                </div>
                                <div className={`flex flex-col gap-1 transition-opacity ${editMode === 'selection' && selectedIndices.size === 0 ? 'opacity-50 pointer-events-none' : ''} ${useCustomFont && editMode !== 'selection' ? 'opacity-50 pointer-events-none' : ''}`}>
                                    <label className="text-[10px] uppercase opacity-70 flex justify-between">Weight <span>{editMode === 'selection' && selectedIndices.size > 0 ? 'VAR' : globalWeight}</span></label>
                                    <input type="range" min="-2" max="12" step="1" value={editMode === 'selection' && selectedIndices.size > 0 ? (charOverrides[Array.from(selectedIndices)[0]]?.w ?? globalWeight) : globalWeight} onChange={(e) => updateWeight(Number(e.target.value))} className="custom-slider"/>
                                </div>
                                <div className={`flex flex-col gap-1 transition-opacity ${editMode === 'selection' && selectedIndices.size === 0 ? 'opacity-50 pointer-events-none' : ''} ${useCustomFont && editMode !== 'selection' ? 'opacity-50 pointer-events-none' : ''}`}>
                                    <label className="text-[10px] uppercase opacity-70 flex justify-between">Height <span>{editMode === 'selection' && selectedIndices.size > 0 ? 'VAR' : globalHeight}</span></label>
                                    <input type="range" min="-6" max="22" step="1" value={editMode === 'selection' && selectedIndices.size > 0 ? (charOverrides[Array.from(selectedIndices)[0]]?.h ?? globalHeight) : globalHeight} onChange={(e) => updateHeight(Number(e.target.value))} className="custom-slider"/>
                                </div>
                                <div className={`flex flex-col gap-1 transition-opacity duration-300 ${!isMultiLine ? 'opacity-30 pointer-events-none' : ''}`}>
                                    <label className="text-[10px] uppercase opacity-70 flex justify-between">Line Space <span>{lineSpacingScale}</span></label>
                                    <input type="range" min="0.0" max="2.0" step="0.1" value={lineSpacingScale} onChange={(e) => setLineSpacingScale(Number(e.target.value))} className="custom-slider"/>
                                </div>
                            </div>
                        </div>
                    )}
                 </div>

                 {/* 3. Layout Menu (Grid/Artboard) */}
                 <div className={`relative ${isPlaying ? 'opacity-30 pointer-events-none' : ''}`}>
                    <button onClick={(e) => { e.stopPropagation(); toggleMenu('layout'); }} className={`${ButtonClass} ${activeMenu === 'layout' ? selectedBtnClass : ''}`} title="Layout">
                        <Layout size={16}/>
                    </button>
                    {activeMenu === 'layout' && (
                        <div className={`${MenuClass} w-56 top-full left-0 mt-2`} onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-xs uppercase font-bold tracking-widest">Layout</span>
                                <X size={14} className="cursor-pointer" onClick={() => toggleMenu('none')} />
                            </div>
                            {/* Grid Toggle */}
                            <div className="flex justify-between items-center border-b border-gray-700 pb-2 mb-2">
                                <span className="text-[10px] uppercase flex items-center gap-2"><Grid3x3 size={12}/> Grid</span>
                                <button 
                                    onClick={() => setShowGrid(!showGrid)} 
                                    className={`px-2 py-1 text-[9px] font-bold uppercase rounded ${showGrid ? 'bg-white text-black' : 'bg-gray-700 text-gray-400'}`}
                                >
                                    {showGrid ? 'ON' : 'OFF'}
                                </button>
                            </div>
                            
                            {/* Artboard Selection */}
                            <label className="text-[9px] uppercase opacity-70 mb-1 block">Canvas Preset</label>
                            <div className="flex flex-col gap-1">
                                {(Object.entries(ARTBOARDS) as [ArtboardKey, typeof ARTBOARDS[ArtboardKey]][]).map(([key, config]) => (
                                    <button 
                                        key={key}
                                        onClick={() => setArtboardMode(key)}
                                        className={`text-[10px] uppercase text-left p-2 rounded flex justify-between items-center ${artboardMode === key ? 'bg-white text-black' : 'hover:bg-gray-800'}`}
                                    >
                                        {config.label}
                                        {artboardMode === key && <Check size={12}/>}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                 </div>

                 {/* 4. States / Sequencer Menu */}
                 <div className={`relative ${isPlaying ? 'opacity-30 pointer-events-none' : ''}`}>
                    <button onClick={(e) => { e.stopPropagation(); toggleMenu('states'); }} className={`${ButtonClass} ${activeMenu === 'states' ? selectedBtnClass : ''}`} title="Animation Sequencer">
                        <Film size={16}/>
                    </button>
                    {activeMenu === 'states' && (
                        <div className={`${MenuClass} w-64 top-full left-0 mt-2`} onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-xs uppercase font-bold tracking-widest">Sequencer</span>
                                <X size={14} className="cursor-pointer" onClick={() => toggleMenu('none')} />
                            </div>

                            {/* Start/Stop Sequencer Toggle */}
                            <div className="flex justify-between items-center border-b border-gray-700 pb-2 mb-2">
                                <span className="text-[10px] uppercase flex items-center gap-2">Playback</span>
                                <button 
                                    onClick={() => setIsSequencing(!isSequencing)} 
                                    className={`px-3 py-1 text-[9px] font-bold uppercase rounded ${isSequencing ? 'bg-green-500 text-black' : 'bg-gray-700 text-gray-400'}`}
                                >
                                    {isSequencing ? 'STOP' : 'START'}
                                </button>
                            </div>

                            <div className="flex flex-col gap-3 border-b border-gray-700 pb-3 mb-2">
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] uppercase opacity-70">Playback Mode</label>
                                    <div className="flex bg-gray-900 rounded p-1 gap-1">
                                        <button onClick={() => setSequenceMode('loop')} className={`flex-1 p-1 rounded flex justify-center ${sequenceMode === 'loop' ? 'bg-white text-black' : 'text-gray-500 hover:text-white'}`}><Repeat size={14}/></button>
                                         <button onClick={() => setSequenceMode('pingpong')} className={`flex-1 p-1 rounded flex justify-center ${sequenceMode === 'pingpong' ? 'bg-white text-black' : 'text-gray-500 hover:text-white'}`}><ArrowLeftRight size={14}/></button>
                                        <button onClick={() => setSequenceMode('once')} className={`flex-1 p-1 rounded flex justify-center ${sequenceMode === 'once' ? 'bg-white text-black' : 'text-gray-500 hover:text-white'}`}><ArrowRightToLine size={14}/></button>
                                    </div>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] uppercase opacity-70 flex justify-between">Transition Time <span>{transitionDuration}s</span></label>
                                    <input type="range" min="0.1" max="5.0" step="0.1" value={transitionDuration} onChange={(e) => setTransitionDuration(Number(e.target.value))} className="custom-slider"/>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] uppercase opacity-70 flex justify-between">Hold Time <span>{holdDuration}s</span></label>
                                    <input type="range" min="0.0" max="10.0" step="0.5" value={holdDuration} onChange={(e) => setHoldDuration(Number(e.target.value))} className="custom-slider"/>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] uppercase opacity-70">Easing Curve</label>
                                    <div className="grid grid-cols-2 gap-1">
                                        {(Object.keys(EASINGS) as EasingType[]).map(key => (
                                            <button key={key} onClick={() => setTransitionEasing(key)} className={`text-[9px] uppercase px-1 py-1 rounded border ${transitionEasing === key ? 'bg-white text-black border-white' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>{key}</button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div className="max-h-[150px] overflow-y-auto flex flex-col gap-2">
                                {savedStates.length === 0 && <span className="text-[9px] italic opacity-50 text-center py-2">No saved states</span>}
                                {savedStates.map((state, idx) => (
                                    <div key={state.id} className="flex items-center justify-between bg-gray-900 border border-gray-700 p-2 rounded gap-2 group">
                                        <div onClick={() => restoreState(state)} className="flex flex-col overflow-hidden flex-1 cursor-pointer hover:text-white text-gray-300 transition-colors" title="Click to restore this state">
                                            <span className="text-[10px] font-bold truncate">#{idx + 1} {state.text}</span>
                                            <span className="text-[8px] opacity-60">W:{state.weight} H:{state.height}</span>
                                        </div>
                                        <div className="flex gap-1 shrink-0 opacity-100 md:opacity-50 md:group-hover:opacity-100 transition-opacity">
                                            <button onClick={(e) => { e.stopPropagation(); moveState(idx, -1); }} disabled={idx === 0} className="p-1 hover:text-blue-400 disabled:opacity-20" title="Move Up"><ArrowUp size={12}/></button>
                                            <button onClick={(e) => { e.stopPropagation(); moveState(idx, 1); }} disabled={idx === savedStates.length - 1} className="p-1 hover:text-blue-400 disabled:opacity-20" title="Move Down"><ArrowDown size={12}/></button>
                                            <button onClick={(e) => { e.stopPropagation(); duplicateState(idx); }} className="p-1 hover:text-yellow-400" title="Duplicate"><Copy size={12}/></button>
                                            <button onClick={(e) => { e.stopPropagation(); deleteState(state.id); }} className="p-1 hover:text-red-400" title="Delete"><Trash2 size={12}/></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <button onClick={saveCurrentState} className="mt-2 w-full flex items-center justify-center gap-2 p-2 border border-gray-600 rounded hover:bg-white hover:text-black transition-colors text-[10px] uppercase"><Plus size={12}/> Capture State</button>
                        </div>
                    )}
                 </div>

                 {/* 5. Project / Export Menu */}
                 <div className={`relative ${isPlaying ? 'opacity-30 pointer-events-none' : ''}`}>
                    <button onClick={(e) => { e.stopPropagation(); toggleMenu('project'); }} className={`${ButtonClass} ${activeMenu === 'project' ? selectedBtnClass : ''}`} title="Project (Import/Export)">
                        <Folder size={16}/>
                    </button>
                    {activeMenu === 'project' && (
                        <div className={`${MenuClass} w-48 top-full left-0 mt-2`} onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-xs uppercase font-bold tracking-widest">Project</span>
                                <X size={14} className="cursor-pointer" onClick={() => toggleMenu('none')} />
                            </div>
                            
                            <div className="flex flex-col gap-2">
                                <button onClick={handleExportProject} className="flex items-center gap-2 p-2 rounded border border-gray-600 hover:bg-white hover:text-black transition-colors text-[10px] uppercase"><Download size={14}/> Export JSON</button>
                                <button onClick={handleImportClick} className="flex items-center gap-2 p-2 rounded border border-gray-600 hover:bg-white hover:text-black transition-colors text-[10px] uppercase"><Upload size={14}/> Import JSON</button>
                            </div>
                        </div>
                    )}
                 </div>

                 {/* 6. Color Menu */}
                 <div className="relative">
                   <button onClick={(e) => { e.stopPropagation(); toggleMenu('color'); }} className={`${ButtonClass} ${activeMenu === 'color' ? selectedBtnClass : ''}`} title="Color Settings">
                     <Palette size={16}/>
                   </button>
                   {activeMenu === 'color' && (
                      <div className={`${MenuClass} w-56 top-full left-0 mt-2`} onClick={(e) => e.stopPropagation()}>
                         <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] uppercase font-bold tracking-widest">Colors</span>
                            <X size={12} className="cursor-pointer" onClick={() => toggleMenu('none')} />
                         </div>
                         <div className="flex flex-col gap-2 mt-2">
                             <div className="flex flex-col gap-1">
                                <label className="text-[9px] uppercase text-gray-400">Hover/Particle Color</label>
                                <div className="flex gap-2">
                                    <input type="color" value={hoverColor} onChange={(e) => { setHoverColor(e.target.value); setIsRainbow(false); }} className="w-8 h-8 bg-transparent border border-white cursor-pointer p-0"/>
                                    <button onClick={() => setIsRainbow(!isRainbow)} className={`flex-1 flex items-center justify-center gap-1 text-[9px] uppercase border p-1 rounded ${isRainbow ? 'bg-white text-black' : 'text-[var(--ui-text)] border-gray-600'}`}>
                                        <span>Rainbow {isRainbow ? 'ON' : 'OFF'}</span>
                                    </button>
                                </div>
                             </div>
                             
                             <div className="flex flex-col gap-1 pt-2 border-t border-gray-700">
                                <label className="text-[9px] uppercase text-gray-400">Text Color</label>
                                <input type="color" value={canvasColors.text} onChange={(e) => setCanvasColors(p => ({...p, text: e.target.value}))} className="w-full h-6 bg-transparent border border-white cursor-pointer p-0"/>
                             </div>

                             <div className="flex flex-col gap-1">
                                <label className="text-[9px] uppercase text-gray-400">Background Color</label>
                                <input type="color" value={canvasColors.bg} onChange={(e) => setCanvasColors(p => ({...p, bg: e.target.value}))} className="w-full h-6 bg-transparent border border-white cursor-pointer p-0"/>
                             </div>

                             {/* Artboard Colors - Only active if not infinite */}
                             {artboardMode !== 'none' && (
                                <div className="flex flex-col gap-1 pt-2 border-t border-gray-700">
                                    <label className="text-[9px] uppercase text-gray-400">Canvas Style</label>
                                    <div className="flex flex-col gap-1">
                                        <div className="flex justify-between items-center text-[9px] text-gray-400">
                                            <span>Canvas Fill</span>
                                            <input type="color" value={artboardSettings.bgColor} onChange={(e) => setArtboardSettings(p => ({...p, bgColor: e.target.value}))} className="w-4 h-4 bg-transparent border border-white cursor-pointer p-0 rounded-sm"/>
                                        </div>
                                        <div className="flex justify-between items-center text-[9px] text-gray-400">
                                            <span>Border</span>
                                            <input type="color" value={artboardSettings.borderColor} onChange={(e) => setArtboardSettings(p => ({...p, borderColor: e.target.value}))} className="w-4 h-4 bg-transparent border border-white cursor-pointer p-0 rounded-sm"/>
                                        </div>
                                    </div>
                                </div>
                            )}
                         </div>
                      </div>
                   )}
                 </div>

                 {/* 7. Interaction Menu (Physics, Hover, Blend) */}
                 <div className={`relative ${!isPlaying ? 'opacity-30 pointer-events-none' : ''}`}>
                    <button onClick={(e) => { e.stopPropagation(); toggleMenu('interaction'); }} className={`${ButtonClass} ${activeMenu === 'interaction' ? selectedBtnClass : ''}`} title="Interaction Settings">
                        <Sparkles size={16}/>
                    </button>
                    {activeMenu === 'interaction' && (
                        <div className={`${MenuClass} w-64 top-full left-0 mt-2`} onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-xs uppercase font-bold tracking-widest">Interaction</span>
                                <X size={14} className="cursor-pointer" onClick={() => toggleMenu('none')} />
                            </div>

                            {/* Interaction Mode */}
                            <div className="flex flex-col gap-2 border-b border-gray-700 pb-2 mb-2">
                                <label className="text-[10px] uppercase opacity-70">Physics Mode</label>
                                <div className="flex bg-gray-900 rounded p-1 gap-1">
                                    <button onClick={() => setInteractionMode('organic')} className={`flex-1 p-1 rounded flex justify-center items-center gap-1 text-[10px] uppercase ${interactionMode === 'organic' ? 'bg-white text-black font-bold' : 'text-gray-500 hover:text-white'}`}><Sparkles size={12}/> Organic</button>
                                     <button onClick={() => setInteractionMode('matrix')} className={`flex-1 p-1 rounded flex justify-center items-center gap-1 text-[10px] uppercase ${interactionMode === 'matrix' ? 'bg-white text-black font-bold' : 'text-gray-500 hover:text-white'}`}><Cpu size={12}/> Matrix</button>
                                </div>
                            </div>

                            {/* Hover Settings */}
                            <div className="flex flex-col gap-2 border-b border-gray-700 pb-2 mb-2">
                                <label className="text-[10px] uppercase opacity-70">Hover Style</label>
                                <div className="flex gap-1 mb-1">
                                    {['Circle', 'Square', 'Diamond', 'Star'].map(shape => (
                                        <button key={shape} onClick={() => setHoverShape(shape as ShapeKey)} className={`flex-1 p-2 rounded border flex items-center justify-center ${hoverShape === shape ? 'bg-white text-black' : 'border-gray-600 text-gray-400 hover:text-white'}`} title={shape}>
                                            {shape === 'Circle' && <CircleIcon size={14} className={hoverShape === shape ? "fill-current" : ""}/>}
                                            {shape === 'Square' && <Square size={14} className={hoverShape === shape ? "fill-current" : ""}/>}
                                            {shape === 'Diamond' && <Square size={14} className={`rotate-45 transform scale-75 ${hoverShape === shape ? "fill-current" : ""}`}/>}
                                            {shape === 'Star' && <Star size={14} className={hoverShape === shape ? "fill-current" : ""}/>}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[9px] uppercase opacity-70 flex justify-between">Scale <span>{hoverScale}x</span></label>
                                    <input type="range" min="1.0" max="3.0" step="0.1" value={hoverScale} onChange={(e) => setHoverScale(Number(e.target.value))} className="custom-slider"/>
                                </div>
                            </div>

                            {/* Blend Mode */}
                            <div className="flex flex-col gap-2 border-b border-gray-700 pb-2 mb-2">
                                <label className="text-[10px] uppercase opacity-70">Blend Mode</label>
                                <div className="grid grid-cols-2 gap-1">
                                    {(['normal', 'multiply', 'screen', 'difference'] as BlendMode[]).map((mode) => (
                                        <button key={mode} onClick={() => setBlendModeHandler(mode)} className={`text-[9px] uppercase px-1 py-1 rounded border ${blendMode === mode ? 'bg-white text-black border-white' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>
                                            {mode}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Physics Sliders */}
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] uppercase opacity-70 flex justify-between">Gravity <span>{physicsConfig.gravity.toFixed(2)}</span></label>
                                <input type="range" min="-0.5" max="0.5" step="0.05" value={physicsConfig.gravity} onChange={(e) => setPhysicsConfig(prev => ({...prev, gravity: Number(e.target.value)}))} className="custom-slider"/>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] uppercase opacity-70 flex justify-between">Friction <span>{physicsConfig.friction}</span></label>
                                <input type="range" min="0.90" max="0.999" step="0.001" value={physicsConfig.friction} onChange={(e) => setPhysicsConfig(prev => ({...prev, friction: Number(e.target.value)}))} className="custom-slider"/>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] uppercase opacity-70 flex justify-between">Bounciness <span>{physicsConfig.restitution}</span></label>
                                <input type="range" min="0.1" max="1.5" step="0.1" value={physicsConfig.restitution} onChange={(e) => setPhysicsConfig(prev => ({...prev, restitution: Number(e.target.value)}))} className="custom-slider"/>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] uppercase opacity-70 flex justify-between">Drag Stiffness <span>{physicsConfig.dragStiffness}</span></label>
                                <input type="range" min="0.05" max="0.5" step="0.01" value={physicsConfig.dragStiffness} onChange={(e) => setPhysicsConfig(prev => ({...prev, dragStiffness: Number(e.target.value)}))} className="custom-slider"/>
                            </div>
                        </div>
                    )}
                 </div>

                 {/* 8. Swirl Menu */}
                 <div className={`relative ${!isPlaying ? 'opacity-30 pointer-events-none' : ''}`}>
                   <button 
                     onClick={(e) => { e.stopPropagation(); toggleMenu('swirl'); }}
                     className={`p-2 border rounded hover:opacity-80 flex items-center justify-center border-[length:var(--ui-border-width)] menu-toggle ${isSwirlMode ? selectedBtnClass : `bg-[var(--ui-btn-bg)] text-[var(--ui-icon-color)] border-[var(--ui-border)] hover:bg-[var(--ui-btn-hover-bg)]`}`}
                     title="Swirl Mode"
                   >
                     <SpiralIcon size={16}/>
                   </button>
                   {activeMenu === 'swirl' && renderSwirlMenu("top-full left-0 mt-2")}
                 </div>

                 {/* 9. Audio / Mic Menu */}
                 <div className={`relative ${!isPlaying ? 'opacity-30 pointer-events-none' : ''}`}>
                    <button 
                        onClick={(e) => { e.stopPropagation(); toggleMenu('mic'); }}
                        className={`p-2 border rounded hover:opacity-80 flex items-center justify-center border-[length:var(--ui-border-width)] menu-toggle ${isMicActive || isSwarmPlaying ? 'bg-red-600 text-white border-red-600' : (activeMenu === 'mic' ? selectedBtnClass : `bg-[var(--ui-btn-bg)] text-[var(--ui-icon-color)] border-[var(--ui-border)] hover:bg-[var(--ui-btn-hover-bg)]`)}`}
                        title="Audio Settings"
                    >
                        {isMicActive ? <Mic size={16}/> : (isSwarmPlaying ? <Volume2 size={16}/> : <MicOff size={16}/>)}
                    </button>
                    {activeMenu === 'mic' && renderMicMenu("top-full left-0 mt-2")}
                 </div>

             </div>
          </div>
        </div>
      </header>
      )}

      {/* Main Display Area */}
      <main 
        ref={containerRef}
        className={`flex-1 overflow-auto p-8 flex items-center justify-center relative transition-colors duration-500`}
        style={{
            backgroundColor: canvasColors.bg,
            color: canvasColors.text
        }}
      >
        {/* ... Canvas Wrapper Logic ... */}
        <div 
            ref={artboardRef}
            className={`transition-all duration-500 relative flex ${verticalAlign === 'top' ? 'items-start' : verticalAlign === 'bottom' ? 'items-end' : 'items-center'} ${artboardMode !== 'none' ? 'shadow-2xl' : ''}`}
            style={{
                width: ARTBOARDS[artboardMode].width,
                aspectRatio: ARTBOARDS[artboardMode].ratio ? `${ARTBOARDS[artboardMode].ratio}` : 'auto',
                padding: artboardMode !== 'none' ? '40px' : '0',
                backgroundColor: artboardMode !== 'none' ? artboardSettings.bgColor : 'transparent',
                boxShadow: artboardMode !== 'none' ? '0 0 50px rgba(0,0,0,0.5)' : 'none',
                minHeight: artboardMode === 'none' ? '100%' : 'auto',
                border: artboardMode !== 'none' ? `1px solid ${artboardSettings.borderColor}` : 'none',
                backgroundImage: showGrid ? `linear-gradient(to right, #333333 1px, transparent 1px), linear-gradient(to bottom, #333333 1px, transparent 1px)` : 'none',
                backgroundSize: `${effectivePixelSize}px ${effectivePixelSize}px`
            }}
        >

            <div 
            ref={textContainerRef}
            className={`flex flex-wrap items-start relative z-10 transition-all duration-300 ease-out`}
            style={{ 
                columnGap: `${effectivePixelSize}px`,
                rowGap: `${effectivePixelSize * lineSpacingScale}px`,
                width: '100%',
                justifyContent: textAlign === 'left' ? 'flex-start' : textAlign === 'right' ? 'flex-end' : 'center',
                textAlign: textAlign // also useful for inline block behavior
            }}
            >
            {inputText.split('').map((char, charIndex) => {
                // Handle the special paragraph glyph as a newline
                if (char === '\n' || char === '¶') {
                    return <div key={charIndex} className="w-full h-0 basis-full"></div>;
                }

                const matrix = resolveGlyphMatrix({
                  char, 
                  index: charIndex,
                  useCustomFont,
                  globalWeight,
                  globalHeight,
                  charOverrides
                });
                
                // If char is space, render empty space
                if (char === ' ') return <div key={charIndex} style={{ width: effectivePixelSize * 3 }} />;
                
                // Fallback for missing characters
                if (!matrix) {
                    return (
                    <div key={charIndex} style={{ width: effectivePixelSize * GRID_COLS, height: effectivePixelSize * GRID_ROWS }} className="flex items-center justify-center border border-dashed border-gray-500 opacity-50">
                        ?
                    </div>
                    )
                }
                
                const currentCols = matrix && matrix.length > 0 ? matrix[0].length : GRID_COLS;
                
                const isDescender = DESCENDERS.includes(char);
                const verticalOffset = isDescender ? 5 * effectivePixelSize : 0;
                
                const isSelected = selectedIndices.has(charIndex);
                const override = charOverrides[charIndex];
                const charValign = override?.valign;
                const charPos = charPositions[charIndex] || { x: 0, y: 0 };

                // Apply tool-specific styles
                const isDragActive = toolMode === 'drag';
                const isExtrudeActive = toolMode === 'extrude';

                return (
                <div 
                    key={charIndex}
                    ref={(el) => { if (el) charRefs.current.set(charIndex, el); else charRefs.current.delete(charIndex); }}
                    onMouseDown={(e) => handleCharMouseDown(e, charIndex)}
                    onClick={(e) => handleCharClick(e, charIndex)}
                    className={`grid gap-0 relative group/char ${!isPlaying && toolMode === 'selection' ? 'cursor-pointer' : ''} ${isDragActive ? 'cursor-grab active:cursor-grabbing' : ''} ${isExtrudeActive ? 'cursor-crosshair' : ''}`}
                    style={{
                        gridTemplateColumns: `repeat(${currentCols}, min-content)`,
                        marginTop: `${verticalOffset}px`,
                        // Visual feedback for selection
                        outline: 'none', 
                        padding: '0px',
                        alignSelf: charValign === 'top' ? 'flex-start' : charValign === 'bottom' ? 'flex-end' : charValign === 'center' ? 'center' : 'auto',
                        transform: `translate(${charPos.x * effectivePixelSize}px, ${charPos.y * effectivePixelSize}px)`,
                        transition: isDragActive && draggingCharRef.current?.index === charIndex ? 'none' : 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)'
                    }}
                >
                    {/* Hover indicator in Selection mode */}
                    {!isPlaying && !isSelected && toolMode === 'selection' && (
                        <div className="absolute inset-0 border border-dashed border-gray-500 opacity-0 group-hover/char:opacity-50 pointer-events-none rounded transition-opacity" />
                    )}

                    {matrix!.map((row, rowIndex) => (
                    <React.Fragment key={rowIndex}>
                        {row.map((val, colIndex) => (
                        <PixelCell 
                            key={`${rowIndex}-${colIndex}`} 
                            active={val === 1} 
                            rowIndex={rowIndex}
                            colIndex={colIndex}
                            charIndex={charIndex}
                            resetTrigger={resetTrigger}
                            hoverShape={hoverShape}
                            isSelected={isSelected}
                            isExtrudeMode={isExtrudeActive}
                            onExtrudeStart={handleExtrudeStart}
                        />
                        ))}
                    </React.Fragment>
                    ))}
                </div>
                );
            })}
            </div>
        </div>
      </main>
      
      {!isFullScreen && (
      <footer className="p-4 flex justify-between items-center text-[10px] text-gray-500 border-t z-20 bg-[var(--ui-bg)] border-gray-500 border-t-[length:var(--ui-border-width)]">
        <span className="">
            typeface design & vibe coding by <a href="https://www.florazogaj.com" target="_blank" rel="noopener noreferrer" className="font-bold hover:text-[var(--ui-text)] transition-colors normal-case">Flora Zogaj</a>.
        </span>
        <div className="flex gap-4">
            {selectedIndices.size > 0 && <span className="uppercase text-[var(--ui-text)] animate-pulse">Selection Active</span>}
            {toolMode === 'drag' && !isPlaying && <span className="uppercase text-yellow-500 animate-pulse">DRAG MODE ACTIVE</span>}
            {toolMode === 'extrude' && !isPlaying && <span className="uppercase text-green-500 animate-pulse">EXTRUDE MODE ACTIVE</span>}
            <span className="uppercase tracking-wider">{isPlaying ? 'Interactive Mode' : 'Edit Mode'}</span>
        </div>
      </footer>
      )}
    </div>
  );
};

export default App;