import { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet,
  Dimensions, StatusBar, Animated, Image, Easing, PanResponder,
} from "react-native";
import { Asset } from "expo-asset";
import { AudioContext } from "react-native-audio-api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useKeepAwake } from "expo-keep-awake";
import { createSequencer } from "./sequencer";

const TOKENS = {
  BD: require("./assets/BD.png"),
  HH: require("./assets/HH.png"),
  SN: require("./assets/SN.png"),
};
const NOTES = {
  "8th":  require("./assets/NOTE8.png"),
  "16th": require("./assets/NOTE16.png"),
};
const METRO_ICON = require("./assets/METRO.png");
const SAMPLE_FILES = {
  BD: require("./assets/BD.wav"),
  HH: require("./assets/HH.wav"),
  SN: require("./assets/SN.wav"),
};

const INSTRUMENTS = [
  { key: "HH", label: "Charleston",    color: "#1A7FAA" },
  { key: "SN", label: "Caisse Claire", color: "#CC4400" },
  { key: "BD", label: "Grosse Caisse", color: "#AA8800" },
];
const LABELS_8  = ["1","+","2","+","3","+","4","+"];
const LABELS_16 = ["1","e","+","a","2","e","+","a","3","e","+","a","4","e","+","a"];

const makeEmpty = (n) =>
  Object.fromEntries(INSTRUMENTS.map((i) => [i.key, Array(n).fill(0)]));

const convertPattern = (pat, fromSteps, toSteps) => {
  const result = {};
  INSTRUMENTS.forEach(({ key }) => {
    const src = pat[key] || [];
    if (toSteps > fromSteps) {
      const row = [];
      src.forEach((v) => { row.push(v); row.push(0); });
      result[key] = row;
    } else {
      result[key] = src.filter((_, i) => i % 2 === 0);
    }
  });
  return result;
};

// ── Écran de chargement ───────────────────────────────────────────────────────
function LoadingScreen({ progress, introMuted, onToggleMute }) {
  const { width: W, height: H } = Dimensions.get("window");
  const bounceHH = useRef(new Animated.Value(0)).current;
  const bounceSN = useRef(new Animated.Value(0)).current;
  const bounceBD = useRef(new Animated.Value(0)).current;
  const fadeIn   = useRef(new Animated.Value(0)).current;
  const rotate   = useRef(new Animated.Value(0)).current;

  const makeBounce = (anim, delay) =>
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.spring(anim, { toValue:-28, friction:3, tension:120, useNativeDriver:true }),
        Animated.spring(anim, { toValue:0,   friction:4, tension:80,  useNativeDriver:true }),
        Animated.delay(600),
      ])
    );

  useEffect(() => {
    Animated.timing(fadeIn, { toValue:1, duration:600, useNativeDriver:true }).start();
    makeBounce(bounceHH, 0).start();
    makeBounce(bounceSN, 200).start();
    makeBounce(bounceBD, 400).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(rotate, { toValue:1, duration:3000, easing:Easing.inOut(Easing.sin), useNativeDriver:true }),
        Animated.timing(rotate, { toValue:0, duration:3000, easing:Easing.inOut(Easing.sin), useNativeDriver:true }),
      ])
    ).start();
  }, []);

  const rotateInterp = rotate.interpolate({ inputRange:[0,1], outputRange:["-2deg","2deg"] });
  const tokenSize = Math.min(W * 0.12, 70);
  const pct = Math.round(progress * 100);

  return (
    <Animated.View style={[S.loadScreen, { opacity:fadeIn }]}>
      <Animated.Text style={[S.loadLogo, { fontSize:Math.min(W*0.08,48), transform:[{rotate:rotateInterp}] }]}>
        Magnedrum
      </Animated.Text>
      <View style={[S.tokensRow, { marginTop:H*0.07 }]}>
        {[
          { key:"HH", anim:bounceHH, label:"Charleston" },
          { key:"SN", anim:bounceSN, label:"Caisse Claire" },
          { key:"BD", anim:bounceBD, label:"Grosse Caisse" },
        ].map(({ key, anim, label }) => (
          <View key={key} style={S.tokenCol}>
            <Animated.View style={{ width:tokenSize, height:tokenSize, transform:[{translateY:anim}],
              shadowColor:"#000", shadowOffset:{width:0,height:6}, shadowOpacity:0.4, shadowRadius:6, elevation:8 }}>
              <Image source={TOKENS[key]} style={{ width:tokenSize, height:tokenSize, borderRadius:tokenSize/2 }} />
              <View style={[S.tokenGloss, { borderRadius:tokenSize/2, width:tokenSize*0.4, height:tokenSize*0.3 }]} />
            </Animated.View>
            <View style={[S.tokenShadow, { width:tokenSize*0.7 }]} />
            <Text style={[S.tokenLabel, { fontSize:Math.min(W*0.022,10) }]}>{label}</Text>
          </View>
        ))}
      </View>
      <View style={[S.progressBarOuter, { width:W*0.6, marginTop:H*0.07 }]}>
        <View style={[S.progressBarInner, { width:`${pct}%` }]} />
      </View>
      <Text style={[S.progressText, { fontSize:Math.min(W*0.05,26) }]}>{pct} %</Text>
      <Text style={[S.loadHint, { fontSize:Math.min(W*0.022,11) }]}>Chargement des sons...</Text>
      <TouchableOpacity onPress={onToggleMute} style={{ marginTop: 24, paddingHorizontal:20, paddingVertical:10, borderRadius:20, backgroundColor:"#ffffff22" }}>
        <Text style={{ color:"#fff", fontSize:Math.min(W*0.04,18) }}>{introMuted ? "🔇 Son coupé" : "🔊 Couper le son"}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── App principale ─────────────────────────────────────────────────────────────
export default function App() {
  useKeepAwake();
  const [dims, setDims] = useState(Dimensions.get("window"));
  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => setDims(window));
    return () => sub?.remove();
  }, []);

  const W = dims.width;
  const H = dims.height;

  const TOOLBAR_H = Math.min(H * 0.29, 120);
  const MARGIN    = 8;
  const PAD       = 8;
  const BORDER    = 5;
  const BOARD_W   = W - MARGIN * 2;
  const INNER_W   = BOARD_W - (PAD + BORDER) * 2;
  const INSTR_W   = Math.floor(INNER_W * 0.065);
  const GAP       = 3;

  const [gridMode, setGridMode] = useState("8th");
  const steps  = gridMode === "8th" ? 8 : 16;
  const labels = gridMode === "8th" ? LABELS_8 : LABELS_16;

  const cellW = (INNER_W - INSTR_W - GAP * (steps - 1)) / steps;

  const GROOVE_BAR_H = 46;
  const BOARD_H = H - TOOLBAR_H - GROOVE_BAR_H - MARGIN * 3 - 4;
  const cellH   = Math.floor((BOARD_H - 56 - 18) / 3);
  const tokenSz = Math.floor(Math.min(cellW, cellH) * 0.82);

  const [pattern8,  setPattern8]  = useState(makeEmpty(8));
  const [pattern16, setPattern16] = useState(makeEmpty(16));
  const pattern    = gridMode === "8th" ? pattern8  : pattern16;
  const setPattern = gridMode === "8th" ? setPattern8 : setPattern16;

  const [bpm, setBpm]               = useState(80);
  const [isPlaying, setIsPlaying]   = useState(false);
  const [isInCountdown, setIsInCountdown] = useState(false);
  const [countdown, setCountdown]   = useState(null);
  const [swing, setSwing]                 = useState(0);
  const [withCountdown, setWithCountdown] = useState(true);
  const [autoAccel, setAutoAccel]         = useState(false);
  const [accelFlash, setAccelFlash]       = useState(null);
  const accelFlashAnim = useRef(new Animated.Value(0)).current;
  const [metronomeActive, setMetronomeActive] = useState(false);
  const [instrVolumes,  setInstrVolumes]  = useState({ HH: 0.6, SN: 1, BD: 1, METRO: 0.8 });
  const [mutedInstrs,   setMutedInstrs]   = useState({ HH: false, SN: false, BD: false, METRO: false });
  const [masterVolume,  setMasterVolume]  = useState(1);
  const [activeVolumeInstr, setActiveVolumeInstr] = useState(null);
  const [grooves, setGrooves] = useState({
    "8th":  Array(8).fill(null),
    "16th": Array(8).fill(null),
  });
  const [loadProgress, setLoadProgress] = useState(0);
  const [soundsLoaded, setSoundsLoaded] = useState(false);
  const [introMuted,   setIntroMuted]   = useState(false);
  const [allMutedMsg,  setAllMutedMsg]  = useState(false);

  const appFade        = useRef(new Animated.Value(0)).current;
  const [barLeftPx, setBarLeftPx] = useState(null);
  const rafRef    = useRef(null);
  const cellWRef  = useRef(cellW);
  const instrWRef = useRef(INSTR_W);

  const seqRef            = useRef(null);
  const isPlayingRef      = useRef(false);
  const currentStepRef    = useRef(0);
  const nextStepTimeRef   = useRef(0);
  const playStartTimeRef  = useRef(0);
  const bpmRef            = useRef(80);
  const stepsRef          = useRef(8);
  const patternRef        = useRef(pattern);
  const schedulerRef      = useRef(null);
  const scheduledStartRef  = useRef(null);
  const swingRef           = useRef(0);
  const swingSliderRef     = useRef(null);
  const swingPageXRef      = useRef(0);
  const swingWidthRef      = useRef(100);
  const countdownTimers    = useRef([]);
  const dragPaintRef       = useRef(null);
  const cellsContainerRefs = useRef({});
  const cellsPageXRef      = useRef({});
  const countdownNodes     = useRef([]);
  const groovesRef         = useRef({ "8th": Array(8).fill(null), "16th": Array(8).fill(null) });
  const groovePressAnims   = useRef(Array(8).fill(null).map(() => new Animated.Value(0))).current;
  const groovePressTimers  = useRef({});
  const autoAccelRef         = useRef(false);
  const cycleCountRef        = useRef(0);
  const startBarRef          = useRef(null);
  const autoAccelBarFlag     = useRef(false);
  const metronomeActiveRef   = useRef(false);
  const instrVolumesRef      = useRef({ HH: 0.6, SN: 1, BD: 1, METRO: 0.8 });
  const masterVolumeRef      = useRef(1);
  const activeVolumeInstrRef = useRef(null);
  const gainNodesRef         = useRef({ HH: null, SN: null, BD: null, METRO: null });
  const masterGainRef        = useRef(null);
  const volumeDragStart      = useRef(1);

  const volumePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !!activeVolumeInstrRef.current,
      onMoveShouldSetPanResponder:  () => !!activeVolumeInstrRef.current,
      onPanResponderGrant: () => {
        const key = activeVolumeInstrRef.current;
        volumeDragStart.current = key === 'MASTER'
          ? masterVolumeRef.current
          : (instrVolumesRef.current[key] ?? 1);
      },
      onPanResponderMove: (_, gs) => {
        const key = activeVolumeInstrRef.current;
        if (!key) return;
        const newVol = Math.max(0, Math.min(1, volumeDragStart.current - gs.dy / 180));
        if (key === 'MASTER') {
          masterVolumeRef.current = newVol;
          setMasterVolume(newVol);
          if (masterGainRef.current) masterGainRef.current.gain.value = newVol;
        } else {
          instrVolumesRef.current = { ...instrVolumesRef.current, [key]: newVol };
          setInstrVolumes(prev => ({ ...prev, [key]: newVol }));
          if (gainNodesRef.current[key] && !mutedInstrs[key]) gainNodesRef.current[key].gain.value = newVol;
        }
      },
      onPanResponderRelease: () => {
        setActiveVolumeInstr(null);
        activeVolumeInstrRef.current = null;
      },
    })
  ).current;

  useEffect(() => {
    const seq = createSequencer({ bpm: bpmRef.current });
    seqRef.current = seq;
    return () => { seq.dispose?.(); };
  }, []);

  useEffect(() => { autoAccelRef.current = autoAccel; }, [autoAccel]);
  useEffect(() => { swingRef.current = swing; }, [swing]);

  useEffect(() => { patternRef.current          = pattern;          }, [pattern]);
  useEffect(() => { stepsRef.current            = steps;            }, [steps]);
  useEffect(() => { bpmRef.current              = bpm;              }, [bpm]);
  useEffect(() => { metronomeActiveRef.current  = metronomeActive;  }, [metronomeActive]);
  useEffect(() => { activeVolumeInstrRef.current = activeVolumeInstr; }, [activeVolumeInstr]);
  useEffect(() => {
    instrVolumesRef.current = instrVolumes;
    INSTRUMENTS.forEach(({ key }) => {
      if (gainNodesRef.current[key]) gainNodesRef.current[key].gain.value = instrVolumes[key];
    });
  }, [instrVolumes]);
  useEffect(() => {
    masterVolumeRef.current = masterVolume;
    if (masterGainRef.current) masterGainRef.current.gain.value = masterVolume;
  }, [masterVolume]);

  // ── Chargement des grooves sauvegardés ────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem("magnedrum_grooves_v1").then(val => {
      if (!val) return;
      try {
        const raw = JSON.parse(val);
        const pad = (arr) => { const a = arr || []; while (a.length < 8) a.push(null); return a; };
        const data = { "8th": pad(raw["8th"]), "16th": pad(raw["16th"]) };
        groovesRef.current = data;
        setGrooves(data);
      } catch {}
    });
  }, []);

  // ── Moteur audio Web Audio API (react-native-audio-api) ──────────────────
  const audioCtxRef = useRef(null);
  const buffersRef  = useRef({});

  useEffect(() => {
    const loadAudio = async () => {
      try {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;

        // ── Routage audio : bufferSource → instrGain → masterGain → destination
        const masterGain = ctx.createGain();
        masterGain.gain.value = masterVolumeRef.current;
        masterGain.connect(ctx.destination);
        masterGainRef.current = masterGain;
        const gNodes = {};
        [...INSTRUMENTS.map(i => i.key), 'METRO'].forEach((key) => {
          const g = ctx.createGain();
          g.gain.value = instrVolumesRef.current[key] ?? 1;
          g.connect(masterGain);
          gNodes[key] = g;
        });
        gainNodesRef.current = gNodes;

        const keys = Object.keys(SAMPLE_FILES);
        let loaded = 0;

        for (const key of keys) {
          const asset = Asset.fromModule(SAMPLE_FILES[key]);
          await asset.downloadAsync();
          const response  = await fetch(asset.localUri);
          const arrayBuf  = await response.arrayBuffer();
          buffersRef.current[key] = await ctx.decodeAudioData(arrayBuf);
          loaded++;
          setLoadProgress(loaded / keys.length);
        }

        // ── Solo de batterie pendant le chargement ────────────────────────
        const bpmIntro = 100;
        const s8 = 60 / bpmIntro / 2; // durée d'une croche en secondes
        const t0 = ctx.currentTime + 0.1;
        const hit = (key, step) => {
          const buf = buffersRef.current[key];
          if (!buf) return;
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(masterGain);
          src.start(t0 + step * s8);
        };
        // Mesure 1 : groove de base
        [0,1,2,3,4,5,6,7].forEach(i => hit('HH', i));
        hit('BD', 0); hit('BD', 4);
        hit('SN', 2); hit('SN', 6);
        // Mesure 2 : fill
        hit('BD', 8);  hit('HH', 8);  hit('HH', 9);
        hit('SN', 10); hit('HH', 10); hit('SN', 11);
        hit('BD', 12); hit('SN', 12); hit('BD', 13);
        hit('SN', 14); hit('BD', 15); hit('SN', 15);

        await new Promise(r => setTimeout(r, Math.ceil(16 * s8 * 1000) + 200));
        Animated.timing(appFade, { toValue:1, duration:600, useNativeDriver:true })
          .start(() => setSoundsLoaded(true));

      } catch(e) {
        console.error("Audio load error:", e);
        setSoundsLoaded(true);
      }
    };
    loadAudio();
    return () => { audioCtxRef.current?.close?.(); };
  }, []);

  // ── Jouer un son (immédiat — tap sur cellule) ─────────────────────────────
  const playSound = useCallback((key) => {
    const ctx = audioCtxRef.current;
    const buf = buffersRef.current[key];
    if (!ctx || !buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gainNodesRef.current[key] ?? ctx.destination);
    src.start(ctx.currentTime);
  }, []);

  // ── Scheduler (scheduling précis via AudioContext) ─────────────────────────
  // nextStepTimeRef est maintenant en secondes (temps AudioContext)
  const LOOKAHEAD_SECS   = 0.1;  // 100 ms de lookahead
  const SCHEDULE_INTERVAL = 25;  // vérification toutes les 25 ms

  const scheduleSound = useCallback((key, when) => {
    const ctx = audioCtxRef.current;
    const buf = buffersRef.current[key];
    if (!ctx || !buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gainNodesRef.current[key] ?? ctx.destination);
    src.start(when);
  }, []);

  // ── Métronome synthétisé ──────────────────────────────────────────────────
  const playMetronomeClick = useCallback((when, isDownbeat = false) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(gainNodesRef.current['METRO'] ?? masterGainRef.current ?? ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = isDownbeat ? 1100 : 750;
      try {
        gain.gain.setValueAtTime(0.9, when);
        gain.gain.exponentialRampToValueAtTime(0.001, when + 0.08);
      } catch { gain.gain.value = 0.8; }
      osc.start(when);
      osc.stop(when + 0.1);
    } catch(e) {}
  }, []);

  const runScheduler = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !isPlayingRef.current) return;
    while (nextStepTimeRef.current < ctx.currentTime + LOOKAHEAD_SECS) {
      const stepsPerBeat = stepsRef.current === 8 ? 2 : 4;
      const secsPerStep  = 60 / bpmRef.current / stepsPerBeat;
      const step = currentStepRef.current;
      const p    = patternRef.current;
      INSTRUMENTS.forEach(({ key }) => {
        if (p[key]?.[step]) scheduleSound(key, nextStepTimeRef.current);
      });
      // ── Métronome : clic sur chaque temps (noire) ────────────────────────
      if (metronomeActiveRef.current) {
        const beatInterval = stepsRef.current === 8 ? 2 : 4;
        if (step % beatInterval === 0)
          playMetronomeClick(nextStepTimeRef.current, step === 0);
      }
      currentStepRef.current  = (step + 1) % stepsRef.current;
      // Swing : r=0.5 (droit) → r=0.667 (shuffle ternaire)
      const r = 0.5 + swingRef.current / 6;
      nextStepTimeRef.current += step % 2 === 0
        ? r * 2 * secsPerStep
        : (1 - r) * 2 * secsPerStep;

      // ── Auto-accélération : +2 BPM toutes les 4 mesures ─────────────────
      if (autoAccelRef.current && currentStepRef.current === 0) {
        cycleCountRef.current++;
        if (cycleCountRef.current >= 4) {
          cycleCountRef.current = 0;
          const newBpm = Math.min(200, bpmRef.current + 2);
          bpmRef.current = newBpm;
          setBpm(newBpm);
          setAccelFlash(null);
        } else if (cycleCountRef.current === 3) {
          // Dernière mesure avant le changement : prévenir le joueur
          setAccelFlash(Math.min(200, bpmRef.current + 2));
        }
      }
    }
  }, [scheduleSound, playMetronomeClick]);

  const startBar = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const ctx = audioCtxRef.current;
      if (!ctx || !isPlayingRef.current) return;
      const n = stepsRef.current;
      const now = ctx.currentTime;
      const secsPerMeasure = (60 / bpmRef.current) * 4;
      const elapsed = (now - playStartTimeRef.current) % secsPerMeasure;
      const pos = (elapsed / secsPerMeasure) * n;
      const cw = cellWRef.current;
      const iw = instrWRef.current;
      setBarLeftPx(iw + cw / 4 + (pos / n) * (n * cw + (n - 1) * 3 - cw));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopBar = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setBarLeftPx(null);
  }, []);

  // ── Grooves : sauvegarde / chargement ────────────────────────────────────
  const loadGroove = useCallback((idx) => {
    const groove = groovesRef.current[gridMode][idx];
    if (!groove) return;
    // Compatibilité ancien format (pattern direct) vs nouveau format ({ pattern, swing, instrVolumes })
    const pat  = groove.pattern ?? groove;
    const sw   = groove.swing   ?? 0;
    const vols = groove.instrVolumes ?? null;
    if (gridMode === "8th") setPattern8(pat);
    else setPattern16(pat);
    swingRef.current = sw;
    setSwing(sw);
    if (vols) {
      instrVolumesRef.current = vols;
      setInstrVolumes(vols);
      Object.entries(vols).forEach(([key, v]) => {
        if (gainNodesRef.current[key]) gainNodesRef.current[key].gain.value = mutedInstrs[key] ? 0 : v;
      });
    }
  }, [gridMode, mutedInstrs]);

  const handleGroovePressIn = useCallback((idx) => {
    const snapshot = JSON.parse(JSON.stringify(gridMode === "8th" ? pattern8 : pattern16));
    Animated.timing(groovePressAnims[idx], {
      toValue: 1, duration: 3000, useNativeDriver: false,
    }).start();
    groovePressTimers.current[idx] = setTimeout(() => {
      const entry = { pattern: snapshot, swing: swingRef.current, instrVolumes: { ...instrVolumesRef.current } };
      const updated = {
        ...groovesRef.current,
        [gridMode]: groovesRef.current[gridMode].map((g, i) => i === idx ? entry : g),
      };
      groovesRef.current = updated;
      setGrooves({ ...updated });
      AsyncStorage.setItem("magnedrum_grooves_v1", JSON.stringify(updated));
    }, 3000);
  }, [gridMode, pattern8, pattern16]);

  const handleGroovePressOut = useCallback((idx) => {
    groovePressAnims[idx].stopAnimation();
    groovePressAnims[idx].setValue(0);
    clearTimeout(groovePressTimers.current[idx]);
  }, []);

  // ── Décompte avant le départ ──────────────────────────────────────────────
  const stopAll = useCallback(() => {
    countdownTimers.current.forEach(clearTimeout);
    countdownTimers.current = [];
    countdownNodes.current.forEach(n => { try { n.stop(); } catch (_) {} });
    countdownNodes.current = [];
    setCountdown(null);
    setIsInCountdown(false);
    setAccelFlash(null);
    isPlayingRef.current = false;
    clearInterval(schedulerRef.current);
    cycleCountRef.current = 0;
    stopBar();
    setIsPlaying(false);
  }, [stopBar]);

  const startWithCountdown = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const secsPerBeat   = 60 / bpmRef.current;
    const countdownStart = ctx.currentTime + 0.05;
    const sequencerStart = countdownStart + 4 * secsPerBeat;

    // Clics baguette synthétisés sur les 4 temps du décompte
    const dest = masterGainRef.current ?? ctx.destination;
    countdownNodes.current = [0, 1, 2, 3].map(i => {
      const when = countdownStart + i * secsPerBeat;
      try {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(dest);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1800, when);
        osc.frequency.exponentialRampToValueAtTime(300, when + 0.025);
        gain.gain.setValueAtTime(0.9, when);
        gain.gain.exponentialRampToValueAtTime(0.001, when + 0.045);
        osc.start(when);
        osc.stop(when + 0.05);
        return osc;
      } catch { return null; }
    }).filter(Boolean);

    setIsInCountdown(true);
    setCountdown(1);
    const t1 = setTimeout(() => setCountdown(2), secsPerBeat * 1000);
    const t2 = setTimeout(() => setCountdown(3), secsPerBeat * 2000);
    const t3 = setTimeout(() => setCountdown(4), secsPerBeat * 3000);
    const t4 = setTimeout(() => setCountdown(null), (secsPerBeat * 3 + 0.4) * 1000);
    // Démarrer le scheduler 0.5 temps avant le downbeat
    const t5 = setTimeout(() => {
      scheduledStartRef.current = sequencerStart;
      setIsInCountdown(false);
      setIsPlaying(true);
    }, (secsPerBeat * 3.5) * 1000);

    countdownTimers.current = [t1, t2, t3, t4, t5];
  }, [scheduleSound, stopBar]);

  useEffect(() => {
    if (isPlaying) {
      const ctx = audioCtxRef.current;
      isPlayingRef.current    = true;
      currentStepRef.current  = 0;
      const startTime = scheduledStartRef.current ?? (ctx?.currentTime ?? 0);
      nextStepTimeRef.current   = startTime;
      playStartTimeRef.current  = startTime;
      scheduledStartRef.current = null;
      schedulerRef.current    = setInterval(runScheduler, SCHEDULE_INTERVAL);
      // Retarder la barre pour la synchroniser avec l'audio
      const delayMs = ctx ? Math.max(0, (startTime - ctx.currentTime) * 1000) : 0;
      if (delayMs > 10) setTimeout(() => { playStartTimeRef.current = audioCtxRef.current.currentTime; startBar(); }, delayMs);
      else { playStartTimeRef.current = audioCtxRef.current.currentTime; startBar(); }
    } else {
      isPlayingRef.current = false;
      clearInterval(schedulerRef.current);
      stopBar();
    }
    return () => { clearInterval(schedulerRef.current); stopBar(); };
  }, [isPlaying, runScheduler, startBar, stopBar]);

  // Resync nextStepTime on BPM change (bar position updates automatically via RAF)
  useEffect(() => {
    if (!isPlaying) return;
    const ctx = audioCtxRef.current;
    if (ctx) nextStepTimeRef.current = ctx.currentTime;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm]);

  // Animation de clignotement pour le décompte avant changement de tempo
  useEffect(() => {
    if (accelFlash === null) {
      accelFlashAnim.stopAnimation();
      accelFlashAnim.setValue(0);
      return;
    }
    Animated.loop(
      Animated.sequence([
        Animated.timing(accelFlashAnim, { toValue:1, duration:300, useNativeDriver:true }),
        Animated.timing(accelFlashAnim, { toValue:0.2, duration:300, useNativeDriver:true }),
      ])
    ).start();
  }, [accelFlash, accelFlashAnim]);

  const toggleMute = (key) => {
    setMutedInstrs(prev => {
      const muted = !prev[key];
      if (gainNodesRef.current[key]) gainNodesRef.current[key].gain.value = muted ? 0 : (instrVolumesRef.current[key] ?? 1);
      const next = { ...prev, [key]: muted };
      if (INSTRUMENTS.every(i => next[i.key])) {
        stopAll();
        setAllMutedMsg(true);
        setTimeout(() => setAllMutedMsg(false), 3000);
      }
      return next;
    });
  };

  const toggleCell = (instrKey, stepIdx) => {
    const newVal = pattern[instrKey]?.[stepIdx] ? 0 : 1;
    if (newVal === 1) playSound(instrKey);
    setPattern((prev) => {
      const row = [...prev[instrKey]];
      row[stepIdx] = newVal;
      return { ...prev, [instrKey]: row };
    });
  };

  const switchGrid = (mode) => {
    if (mode === gridMode) return;
    setIsPlaying(false);
    setGridMode(mode);
  };

  const changeBpm = (d) => {
    const newBpm = Math.min(200, Math.max(40, bpmRef.current + d));
    bpmRef.current = newBpm;
    setBpm(newBpm);
    if (isPlayingRef.current) {
      if (masterGainRef.current) masterGainRef.current.gain.value = 0;
      setTimeout(() => {
        if (masterGainRef.current) masterGainRef.current.gain.value = masterVolumeRef.current;
        currentStepRef.current = 0;
        nextStepTimeRef.current = audioCtxRef.current.currentTime;
        runScheduler();
      }, 30);
    }
  };

  cellWRef.current  = cellW;
  instrWRef.current = 0;

  const barW = Math.floor(cellW / 2);
  const gridZoneH  = INSTRUMENTS.length * (cellH + 4) + 4;
  const noteIconSz = Math.min(TOOLBAR_H * 0.35, 36);
  // Largeurs des sections toolbar basées sur la largeur écran
  const TW_DIVIDERS = 3 * (1.5 + 8) + 6 * 6; // dividers + gaps ≈ 64px
  const TW_AVAIL    = BOARD_W - 20 - TW_DIVIDERS;
  const TW_MODE  = Math.round(TW_AVAIL * 0.18);
  const TW_SWING = Math.round(TW_AVAIL * 0.14);
  const TW_BPM   = Math.round(TW_AVAIL * 0.30);
  const TW_PLAY  = TW_AVAIL - TW_MODE - TW_SWING - TW_BPM;

  if (!soundsLoaded) return (
    <LoadingScreen
      progress={loadProgress}
      introMuted={introMuted}
      onToggleMute={() => setIntroMuted(prev => {
        const muted = !prev;
        if (masterGainRef.current) masterGainRef.current.gain.value = muted ? 0 : masterVolumeRef.current;
        return muted;
      })}
    />
  );

  return (
    <Animated.View style={[S.root, { opacity:appFade }]}>
      <StatusBar hidden />

      {allMutedMsg && (
        <View pointerEvents="none" style={{ position:"absolute", top:0, left:0, right:0, bottom:0, justifyContent:"center", alignItems:"center", zIndex:100, backgroundColor:"rgba(250,255,250,0.88)" }}>
          <Text style={{ fontSize:22, fontWeight:"900", color:"#E84020", letterSpacing:2, textAlign:"center" }}>
            VÉRIFIER LES VOLUMES
          </Text>
        </View>
      )}

      {/* ══ TABLEAU ══ */}
      <View style={{ flexDirection:"row", height:BOARD_H, margin:MARGIN }}>

        {/* ── Colonne instruments (hors du tableau blanc) ── */}
        <View style={{ width:INSTR_W, paddingTop: BORDER + PAD + 18 }}>
          {INSTRUMENTS.map((instr, rowIdx) => (
            <View key={instr.key} style={{ height: cellH + 4 + (rowIdx < INSTRUMENTS.length-1 ? 1 : 0), justifyContent:"center" }}>
              <TouchableOpacity
                onPress={() => toggleMute(instr.key)}
                onLongPress={() => { activeVolumeInstrRef.current = instr.key; setActiveVolumeInstr(instr.key); }}
                delayLongPress={400}
                activeOpacity={0.7}
              >
                <View style={[S.instrChip, { borderColor: instr.color, backgroundColor: instr.color + "22", opacity: mutedInstrs[instr.key] ? 0.35 : 1 }]}>
                  <Image source={TOKENS[instr.key]}
                    style={{ width:Math.min(INSTR_W-14, cellH-14), height:Math.min(INSTR_W-14, cellH-14), borderRadius:30 }} />
                  <View style={[S.instrVolBar, { width: Math.min(INSTR_W-16, 28) }]}>
                    <View style={[S.instrVolFill, { width:`${Math.round(instrVolumes[instr.key]*100)}%`, backgroundColor:instr.color }]} />
                  </View>
                </View>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <View style={{ width:GAP }} />

        <View style={[S.board, { flex:1, height:BOARD_H }]}>
        <View style={S.boardInner}>

          <View style={S.labelsRow}>
            {labels.map((lbl, i) => {
              const isMain = gridMode==="8th" ? i%2===0 : i%4===0;
              return (
                <View key={i} style={{ width:cellW, alignItems:"center" }}>
                  <Text style={[S.labelText, isMain && S.labelStrong]}>{lbl}</Text>
                </View>
              );
            })}
          </View>

          <View style={S.divider} />

          <View style={{ position:"relative" }}>
            {countdown !== null && (
              <Animated.View pointerEvents="none" style={[S.countdownOverlay]}>
                <Text style={[S.countdownText, { fontSize:Math.min(W*0.22, 130) }]}>
                  {countdown}
                </Text>
              </Animated.View>
            )}
            {isPlaying && barLeftPx !== null && (
              <View pointerEvents="none"
                style={[S.playBar, { left:barLeftPx, width:barW, height:gridZoneH }]}>
                <LinearGradient
                  colors={["rgba(255,160,0,0)", "rgba(240,130,0,0.35)", "rgba(200,90,0,0.6)", "rgba(240,130,0,0.35)", "rgba(255,160,0,0)"]}
                  start={{ x:0, y:0.5 }} end={{ x:1, y:0.5 }}
                  style={StyleSheet.absoluteFill}
                />
              </View>
            )}

            {INSTRUMENTS.map((instr, rowIdx) => (
              <View key={instr.key}>
                <View style={{ flexDirection:"row", alignItems:"center", marginVertical:2 }}>
                  <View
                    style={{ flexDirection:"row", gap:GAP }}
                    ref={(r) => { if (r) cellsContainerRefs.current[instr.key] = r; }}
                    onLayout={() => {
                      cellsContainerRefs.current[instr.key]?.measure((x, y, w, h, pageX) => {
                        cellsPageXRef.current[instr.key] = pageX;
                      });
                    }}
                    onStartShouldSetResponder={() => true}
                    onResponderGrant={(e) => {
                      const x  = e.nativeEvent.pageX - (cellsPageXRef.current[instr.key] ?? 0);
                      const si = Math.min(steps-1, Math.max(0, Math.floor(x / (cellW + GAP))));
                      const newVal = pattern[instr.key]?.[si] ? 0 : 1;
                      dragPaintRef.current = { instrKey: instr.key, paintValue: newVal, lastStep: si };
                      if (newVal === 1) playSound(instr.key);
                      setPattern(prev => { const row=[...prev[instr.key]]; row[si]=newVal; return {...prev, [instr.key]:row}; });
                    }}
                    onResponderMove={(e) => {
                      const drag = dragPaintRef.current;
                      if (!drag) return;
                      const x  = e.nativeEvent.pageX - (cellsPageXRef.current[instr.key] ?? 0);
                      const si = Math.min(steps-1, Math.max(0, Math.floor(x / (cellW + GAP))));
                      if (si === drag.lastStep) return;
                      drag.lastStep = si;
                      if (drag.paintValue === 1) playSound(drag.instrKey);
                      setPattern(prev => { const row=[...prev[drag.instrKey]]; row[si]=drag.paintValue; return {...prev, [drag.instrKey]:row}; });
                    }}
                    onResponderRelease={() => { dragPaintRef.current = null; }}
                  >
                    {Array.from({ length:steps }).map((_, si) => {
                      const isActive   = pattern[instr.key]?.[si] === 1;
                      const isDownbeat = gridMode==="8th" ? si%2===0 : si%4===0;
                      const lineW      = isDownbeat ? 3 : 1.5;
                      const lineColor  = isDownbeat ? "#886655" : "#CCBBAA";
                      return (
                        <View key={si}
                          style={{ width:cellW, height:cellH, justifyContent:"center", alignItems:"center" }}
                        >
                          <View style={{
                            position:"absolute", top:0, bottom:0,
                            width:lineW, backgroundColor:lineColor,
                          }} />
                          {isActive && (
                            <View style={{ position:"relative",
                              shadowColor:"#000", shadowOffset:{width:2,height:3},
                              shadowOpacity:0.32, shadowRadius:3, elevation:5 }}>
                              <Image source={TOKENS[instr.key]}
                                style={{ width:tokenSz, height:tokenSz, borderRadius:tokenSz/2 }} />
                              <View style={[S.tokenGloss, { borderRadius:tokenSz/2,
                                width:tokenSz*0.42, height:tokenSz*0.32 }]} />
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
                {rowIdx < INSTRUMENTS.length-1 && <View style={S.rowDivider} />}
              </View>
            ))}
          </View>
        </View>
        </View>
      </View>

      {/* ══ GROOVE BAR ══ */}
      <View style={[S.grooveBar, { height:GROOVE_BAR_H, marginHorizontal:MARGIN, marginBottom:MARGIN }]}>
        {[0,1,2,3,4,5,6,7].map(idx => {
          const g = grooves[gridMode][idx];
          const pat = g?.pattern ?? g;
          const hasSaved = !!g && !!pat && Object.values(pat).some(row => Array.isArray(row) && row.some(v => v === 1));
          const fillW = groovePressAnims[idx].interpolate({
            inputRange: [0,1], outputRange: ["0%","100%"],
          });
          return (
            <TouchableOpacity
              key={idx}
              style={[S.grooveBtn, hasSaved && S.groovestBtnSaved]}
              onPress={() => loadGroove(idx)}
              onPressIn={() => handleGroovePressIn(idx)}
              onPressOut={() => handleGroovePressOut(idx)}
              activeOpacity={0.7}
            >
              <Animated.View style={[S.grooveFill, { width: fillW }]} />
              <Text style={[S.grooveNum, hasSaved && S.grooveNumSaved]}>{idx + 1}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ══ TOOLBAR ══ */}
      <View style={[S.toolbar, { height:TOOLBAR_H, marginHorizontal:MARGIN, marginBottom:MARGIN }]}>

        <View style={[S.toolSection, { width:TW_MODE, flex:undefined, flexWrap:"nowrap" }]}>
          {["8th","16th"].map((mode) => {
            const iconSz = Math.floor((TW_MODE - 6 - 4) / 2); // 6=gap, 4=padding*2
            return (
              <TouchableOpacity key={mode}
                style={[S.modeBtn, gridMode===mode && S.modeBtnActive, { paddingHorizontal:2, paddingVertical:4 }]}
                onPress={() => switchGrid(mode)}>
                <Image source={NOTES[mode]} style={{ width:iconSz, height:iconSz, resizeMode:"contain" }} />
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={S.toolDivider} />

        <View style={{ width:TW_SWING, alignItems:"center", justifyContent:"center", gap:4, paddingHorizontal:4 }}>
          <Text style={{ color:"#336633", fontSize:9, fontWeight:"700", letterSpacing:2 }}>SWING</Text>
          <View
            style={{ width:"100%", height:28, justifyContent:"center" }}
            ref={(r) => { if (r) swingSliderRef.current = r; }}
            onLayout={() => {
              swingSliderRef.current?.measure((x, y, w, h, pageX) => {
                swingPageXRef.current = pageX;
                swingWidthRef.current = w;
              });
            }}
            onStartShouldSetResponder={() => true}
            onResponderGrant={(e) => {
              const val = Math.max(0, Math.min(1, (e.nativeEvent.pageX - swingPageXRef.current) / swingWidthRef.current));
              swingRef.current = val; setSwing(val);
            }}
            onResponderMove={(e) => {
              const val = Math.max(0, Math.min(1, (e.nativeEvent.pageX - swingPageXRef.current) / swingWidthRef.current));
              swingRef.current = val; setSwing(val);
            }}
          >
            <View style={{ height:2, backgroundColor:"#A8D8B8", borderRadius:2, marginHorizontal:8 }} />
            <View style={{ position:"absolute", left: 8 + swing * (swingWidthRef.current - 24), width:16, height:16, borderRadius:8, backgroundColor:"#22AA44", top:6, shadowColor:"#000", shadowOpacity:0.4, shadowRadius:3, elevation:4 }} />
          </View>
          <Text style={{ color:"#336633", fontSize:9, fontWeight:"700" }}>{Math.round(swing * 100)}%</Text>
        </View>

        <View style={S.toolDivider} />

        <View style={[S.toolSection, { width:TW_BPM, flex:undefined }]}>
          <View style={{ alignItems:"center" }}>
            <Text style={[S.bpmValue, { fontSize:Math.min(TOOLBAR_H*0.38,36) }]}>{bpm}</Text>
            <Text style={S.bpmUnit}>BPM</Text>
          </View>
          <View style={{ gap:4 }}>
            <View style={{ flexDirection:"row", gap:4 }}>
              <TouchableOpacity style={S.bpmBtn} onPress={() => changeBpm(1)}><Text style={S.bpmBtnText}>+1</Text></TouchableOpacity>
              <TouchableOpacity style={S.bpmBtn} onPress={() => changeBpm(5)}><Text style={S.bpmBtnText}>+5</Text></TouchableOpacity>
            </View>
            <View style={{ flexDirection:"row", gap:4 }}>
              <TouchableOpacity style={S.bpmBtn} onPress={() => changeBpm(-1)}><Text style={S.bpmBtnText}>−1</Text></TouchableOpacity>
              <TouchableOpacity style={S.bpmBtn} onPress={() => changeBpm(-5)}><Text style={S.bpmBtnText}>−5</Text></TouchableOpacity>
            </View>
          </View>
          <View style={{ alignItems:"center", gap:3 }}>
            {accelFlash !== null && (
              <Animated.Text style={[S.accelFlashText, { opacity: accelFlashAnim }]}>
                → {accelFlash}
              </Animated.Text>
            )}
            <TouchableOpacity
              style={[S.accelBtn, autoAccel && S.accelBtnOn, { width:47, height:45, justifyContent:"center" }]}
              onPress={() => { setAutoAccel(v => !v); cycleCountRef.current = 0; setAccelFlash(null); }}>
              <Text style={[S.accelBtnText, autoAccel && S.accelBtnTextOn]}>+2</Text>
              <Text style={[S.accelBtnSub,  autoAccel && S.accelBtnTextOn]}>×4</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.metroBtn, metronomeActive && S.metroBtnOn]}
              onPress={() => {
                setMetronomeActive(v => !v);
                if (isPlayingRef.current) {
                  stopAll();
                  startWithCountdown();
                }
              }}
              onLongPress={() => { activeVolumeInstrRef.current = 'METRO'; setActiveVolumeInstr('METRO'); }}
              delayLongPress={400}>
              <Image source={METRO_ICON}
                style={{ width: noteIconSz * 0.85, height: noteIconSz * 0.85,
                  resizeMode:"contain",
                  tintColor: metronomeActive ? "#CC9900" : "#AABBAA" }} />
              <View style={[S.instrVolBar, { width: 28, marginTop: 2 }]}>
                <View style={[S.instrVolFill, { width:`${Math.round(instrVolumes['METRO']*100)}%`, backgroundColor: metronomeActive ? "#CC9900" : "#AABBAA" }]} />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        <View style={S.toolDivider} />

        <View style={[S.toolSection, { width:TW_PLAY, flex:undefined }]}>
          <TouchableOpacity
            style={[S.playBtn, (isPlaying || isInCountdown) && S.playBtnStop]}
            onPress={() => (isPlaying || isInCountdown) ? stopAll() : (withCountdown ? startWithCountdown() : setIsPlaying(true))}>
            <Text style={S.playBtnText}>{(isPlaying || isInCountdown) ? "⏹  STOP" : "▶  PLAY"}</Text>
          </TouchableOpacity>
          <View style={{ gap:4 }}>
            <TouchableOpacity style={S.clearBtn}
              onPress={() => { setIsPlaying(false); setPattern8(makeEmpty(8)); setPattern16(makeEmpty(16)); }}>
              <Text style={S.clearBtnText}>EFFACER</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.countdownToggle, withCountdown && S.countdownToggleOn]}
              onPress={() => setWithCountdown(v => !v)}>
              <Text style={[S.countdownToggleText, withCountdown && S.countdownToggleTextOn]}>
                COUNT-IN
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={S.masterVolSection}
            onLongPress={() => { activeVolumeInstrRef.current = 'MASTER'; setActiveVolumeInstr('MASTER'); }}
            delayLongPress={400}
            activeOpacity={0.7}
          >
            <Text style={S.masterVolLabel}>VOL</Text>
            <View style={S.masterVolBarContainer}>
              <View style={[S.masterVolBarFill, { height: `${Math.round(masterVolume * 100)}%` }]} />
            </View>
            <Text style={S.masterVolSmallValue}>{Math.round(masterVolume * 100)}</Text>
          </TouchableOpacity>
        </View>

      </View>

      {/* ══ OVERLAY VOLUME ══ */}
      {activeVolumeInstr && (() => {
        const info = activeVolumeInstr === 'METRO'
          ? { label: 'Métronome', color: '#CC9900' }
          : activeVolumeInstr === 'MASTER'
          ? { label: 'Volume général', color: '#336633' }
          : INSTRUMENTS.find(i => i.key === activeVolumeInstr);
        const currentVol = activeVolumeInstr === 'MASTER'
          ? masterVolume
          : instrVolumes[activeVolumeInstr];
        return (
          <View style={S.volumeOverlay} {...volumePanResponder.panHandlers}>
            <View style={S.volumePanel}>
              {activeVolumeInstr === 'METRO'
                ? <Image source={METRO_ICON} style={{ width:48, height:48, resizeMode:"contain", tintColor:info.color }} />
                : activeVolumeInstr === 'MASTER'
                ? <Text style={{ fontSize:32 }}>🔊</Text>
                : <Image source={TOKENS[activeVolumeInstr]} style={{ width:48, height:48, borderRadius:24 }} />
              }
              <Text style={[S.volumeInstrName, { color: info?.color }]}>{info?.label}</Text>
              <View style={S.volumeTrack}>
                <View style={[S.volumeTrackFill, {
                  height: `${Math.round(currentVol * 100)}%`,
                  backgroundColor: info?.color,
                }]} />
              </View>
              <Text style={S.volumePct}>{Math.round(currentVol * 100)} %</Text>
              <Text style={S.volumeHint}>↑ glisser ↓</Text>
            </View>
          </View>
        );
      })()}
    </Animated.View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  root: { flex:1, backgroundColor:"#D4EEDC" },

  loadScreen:       { flex:1, backgroundColor:"#6CC98A", alignItems:"center", justifyContent:"center" },
  loadLogo:         { fontWeight:"900", color:"#FFFFFF", letterSpacing:4,
                      textShadowColor:"rgba(0,0,0,0.2)", textShadowOffset:{width:1,height:2}, textShadowRadius:6 },
  tokensRow:        { flexDirection:"row", gap:32, alignItems:"flex-end" },
  tokenCol:         { alignItems:"center", gap:4 },
  tokenGloss:       { position:"absolute", top:3, left:4, backgroundColor:"rgba(255,255,255,0.38)" },
  tokenShadow:      { height:6, borderRadius:3, backgroundColor:"rgba(0,0,0,0.25)", marginTop:2 },
  tokenLabel:       { color:"rgba(255,255,255,0.9)", fontWeight:"700", letterSpacing:0.5, marginTop:4 },
  progressBarOuter: { height:10, backgroundColor:"rgba(255,255,255,0.3)", borderRadius:6, overflow:"hidden" },
  progressBarInner: { height:"100%", backgroundColor:"#FFFFFF", borderRadius:6 },
  progressText:     { color:"#FFFFFF", fontWeight:"900", marginTop:10, letterSpacing:2 },
  loadHint:         { color:"rgba(255,255,255,0.75)", marginTop:6, letterSpacing:1, fontWeight:"600" },

  board:       { backgroundColor:"#FFFEF5", borderRadius:18, borderWidth:5, borderColor:"#A8D8B8",
                 shadowColor:"#000", shadowOffset:{width:2,height:4}, shadowOpacity:0.18, shadowRadius:6, elevation:7,
                 overflow:"hidden" },
  boardInner:  { flex:1, padding:8 },
  logo:        { fontWeight:"900", color:"#E84020", letterSpacing:4, textAlign:"center", marginBottom:2 },
  labelsRow:   { flexDirection:"row", gap:3, marginBottom:2 },
  labelText:   { fontSize:8, color:"#AABBAA", fontWeight:"700" },
  labelStrong: { color:"#558855", fontSize:9, fontWeight:"900" },
  divider:     { height:1, backgroundColor:"#C8E0D0", marginBottom:3 },
  rowDivider:  { height:1, backgroundColor:"#DCF0E4" },
  playBar:     { position:"absolute", top:0, zIndex:10, overflow:"hidden" },
  countdownOverlay: { position:"absolute", top:0, left:0, right:0, bottom:0,
                      justifyContent:"center", alignItems:"center", zIndex:30,
                      backgroundColor:"rgba(250,255,250,0.82)" },
  countdownText:    { fontWeight:"900", color:"#E84020", letterSpacing:2,
                      textShadowColor:"rgba(0,0,0,0.15)", textShadowOffset:{width:2,height:3}, textShadowRadius:6 },

  grooveBar:       { backgroundColor:"#EAF7EE", borderRadius:12, borderWidth:2, borderColor:"#A8D8B8",
                     flexDirection:"row", alignItems:"center", paddingHorizontal:8, gap:8 },
  grooveBarLabel:  { fontSize:8, color:"#558866", fontWeight:"800", letterSpacing:1, width:40 },
  grooveBtn:       { flex:1, height:32, borderRadius:10, borderWidth:2, borderColor:"#A8D8B8",
                     backgroundColor:"#FFFFFF", justifyContent:"center", alignItems:"center",
                     overflow:"hidden",
                     shadowColor:"#000", shadowOffset:{width:0,height:2}, shadowOpacity:0.08, shadowRadius:2, elevation:2 },
  groovestBtnSaved: { borderColor:"#22AA44", backgroundColor:"#EAFAF0" },
  grooveFill:      { position:"absolute", top:0, bottom:0, left:0,
                     backgroundColor:"rgba(232,64,32,0.15)" },
  grooveNum:       { fontSize:15, fontWeight:"900", color:"#88BBAA", zIndex:1 },
  grooveNumSaved:  { color:"#22AA44" },

  accelBtn:      { paddingHorizontal:8, paddingVertical:4, borderRadius:9, alignItems:"center",
                   borderWidth:2, borderColor:"#A8D8B8", backgroundColor:"#FFFFFF" },
  accelBtnOn:    { borderColor:"#2299EE", backgroundColor:"#EEF6FF" },
  accelBtnText:  { fontSize:12, fontWeight:"900", color:"#AABBCC" },
  accelBtnSub:   { fontSize:7,  fontWeight:"800", color:"#AABBCC", letterSpacing:0.5 },
  accelBtnTextOn:{ color:"#2299EE" },
  accelFlashText:{ fontSize:11, fontWeight:"900", color:"#E84020", letterSpacing:1 },

  countdownToggle:     { paddingHorizontal:7, paddingVertical:6, borderRadius:9,
                         borderWidth:2, borderColor:"#A8D8B8", backgroundColor:"#FFFFFF" },
  countdownToggleOn:   { borderColor:"#22AA44", backgroundColor:"#EAFAF0" },
  countdownToggleText: { fontSize:9, fontWeight:"800", color:"#AABBAA", letterSpacing:2 },
  countdownToggleTextOn: { color:"#22AA44" },
  instrShadow: { shadowColor:"#000", shadowOffset:{width:1,height:3}, shadowOpacity:0.22,
                 shadowRadius:3, elevation:4, borderRadius:22 },

  toolbar:      { backgroundColor:"#EAF7EE", borderRadius:16, borderWidth:2, borderColor:"#A8D8B8",
                  shadowColor:"#000", shadowOffset:{width:2,height:3}, shadowOpacity:0.12, shadowRadius:4, elevation:5,
                  flexDirection:"row", alignItems:"center", paddingHorizontal:10, gap:6 },
  toolSection:  { flex:1, alignItems:"center", justifyContent:"center", flexDirection:"row", flexWrap:"wrap", gap:6 },
  toolDivider:  { width:1.5, height:"60%", backgroundColor:"#A8D8B8", marginHorizontal:4 },
  modeBtn:      { alignItems:"center", paddingVertical:6, paddingHorizontal:9, borderRadius:12,
                  borderWidth:2.5, borderColor:"#A8D8B8", backgroundColor:"#FFFFFF",
                  shadowColor:"#000", shadowOffset:{width:1,height:2}, shadowOpacity:0.1, shadowRadius:2, elevation:2 },
  modeBtnActive:    { borderColor:"#E84020", backgroundColor:"#FFF4F0" },
  modeBtnSub:       { fontSize:8, color:"#88AA88", letterSpacing:0.3, marginTop:1, fontWeight:"700" },
  modeBtnActiveText:{ color:"#E84020", fontWeight:"900" },
  bpmValue:     { fontWeight:"900", color:"#224422" },
  bpmUnit:      { fontSize:7, color:"#88AA88", letterSpacing:2, fontWeight:"800" },
  bpmBtn:       { paddingHorizontal:9, paddingVertical:6, borderRadius:9, backgroundColor:"#FFFFFF",
                  borderWidth:2, borderColor:"#A8D8B8",
                  shadowColor:"#000", shadowOffset:{width:1,height:2}, shadowOpacity:0.1, shadowRadius:1, elevation:2 },
  bpmBtnText:   { color:"#336633", fontSize:12, fontWeight:"900" },
  playBtn:      { flex:1, paddingVertical:11, borderRadius:12, backgroundColor:"#22AA44",
                  justifyContent:"center", alignItems:"center",
                  shadowColor:"#000", shadowOffset:{width:1,height:3}, shadowOpacity:0.22, shadowRadius:4, elevation:5 },
  playBtnStop:  { backgroundColor:"#EE2222" },
  playBtnText:  { fontSize:14, fontWeight:"900", color:"#FFFFFF", letterSpacing:2 },
  clearBtn:     { paddingVertical:7, paddingHorizontal:8, borderRadius:10, borderWidth:2, borderColor:"#A8D8B8",
                  backgroundColor:"#FFFFFF", justifyContent:"center", alignItems:"center" },
  clearBtnText: { fontSize:9, color:"#558866", letterSpacing:2, fontWeight:"800" },

  // ── Métronome ────────────────────────────────────────────────────────────
  metroBtn:     { width:47, height:45, paddingHorizontal:8, paddingVertical:4, borderRadius:9, alignItems:"center", justifyContent:"center",
                  borderWidth:2, borderColor:"#A8D8B8", backgroundColor:"#FFFFFF" },
  metroBtnOn:   { borderColor:"#CC9900", backgroundColor:"#FFFBE8" },
  metroBtnText: { fontSize:14, color:"#AABBAA", fontWeight:"900" },
  metroBtnTextOn: { color:"#CC9900" },

  // ── Chip instrument gauche ───────────────────────────────────────────────
  instrChip:    { borderRadius:10, borderWidth:2, padding:3, alignItems:"center", justifyContent:"center", gap:3 },
  instrVolBar:  { height:4, borderRadius:2, backgroundColor:"rgba(0,0,0,0.1)", overflow:"hidden" },
  instrVolFill: { height:"100%", borderRadius:2 },

  // ── Volume maître ────────────────────────────────────────────────────────
  masterVolSection:     { alignItems:"center", gap:3, paddingHorizontal:6, paddingVertical:5,
                          borderRadius:9, borderWidth:2, borderColor:"#A8D8B8", backgroundColor:"#FFFFFF" },
  masterVolLabel:       { fontSize:7, fontWeight:"900", color:"#558866", letterSpacing:1 },
  masterVolBarContainer:{ width:14, height:50, borderRadius:7, backgroundColor:"rgba(0,0,0,0.08)",
                          overflow:"hidden", justifyContent:"flex-end" },
  masterVolBarFill:     { width:"100%", borderRadius:7, backgroundColor:"#22AA44" },
  masterVolSmallValue:  { fontSize:9, fontWeight:"900", color:"#224422" },

  // ── Overlay volume individuel ────────────────────────────────────────────
  volumeOverlay:   { position:"absolute", top:0, left:0, right:0, bottom:0,
                     backgroundColor:"rgba(0,0,0,0.38)", justifyContent:"center", alignItems:"center", zIndex:60 },
  volumePanel:     { alignItems:"center", gap:10, backgroundColor:"rgba(255,255,255,0.18)",
                     borderRadius:20, padding:20, minWidth:100 },
  volumeInstrName: { fontSize:13, fontWeight:"900", letterSpacing:1 },
  volumeTrack:     { width:44, height:220, backgroundColor:"rgba(255,255,255,0.25)",
                     borderRadius:22, overflow:"hidden", justifyContent:"flex-end" },
  volumeTrackFill: { width:"100%", borderRadius:22 },
  volumePct:       { color:"#FFFFFF", fontWeight:"900", fontSize:18 },
  volumeHint:      { color:"rgba(255,255,255,0.7)", fontSize:10, fontWeight:"600", letterSpacing:1 },
});
