/**
 * sequencer.js — Scheduler angulaire précis pour disque vinyle
 *
 * Principe : le disque tourne à `bpm` tours/minute.
 * Chaque marqueur est positionné à un angle (0–360°).
 * Quand l'angle 0 (le "bras de lecture") passe sous un marqueur,
 * un son court est déclenché via AudioContext.
 * Lookahead de 25 ms pour une précision sous-milliseconde.
 *
 * Usage :
 *   import { createSequencer } from './sequencer';
 *
 *   const seq = createSequencer({ bpm: 120 });
 *   await seq.init();
 *
 *   seq.addMarker({ id: 'kick',  angle: 0   });   // downbeat
 *   seq.addMarker({ id: 'snare', angle: 180 });   // demi-tour
 *   seq.addMarker({ id: 'hat',   angle: 90  });   // quart de tour
 *
 *   seq.start();
 *   seq.setBpm(140);    // changement de tempo fluide
 *   seq.stop();
 *   seq.dispose();
 */

// ─── Constantes de scheduling ─────────────────────────────────────────────────
const LOOKAHEAD_SECS  = 0.025;   // 25 ms de fenêtre de pré-calcul
const TICK_INTERVAL   = 10;      // vérification toutes les 10 ms

// ─── Son de clic par défaut (oscillateur synthétisé) ──────────────────────────
function scheduleClick(ctx, gainNode, when, freq = 800, duration = 0.045) {
  try {
    const osc  = ctx.createOscillator();
    const env  = ctx.createGain();

    osc.type            = "sine";
    osc.frequency.value = freq;

    osc.connect(env);
    env.connect(gainNode ?? ctx.destination);

    // Enveloppe percussive : attaque immédiate, déclin rapide
    env.gain.setValueAtTime(0.001, when);
    env.gain.exponentialRampToValueAtTime(0.9,   when + 0.002);
    env.gain.exponentialRampToValueAtTime(0.001, when + duration);

    osc.start(when);
    osc.stop(when + duration + 0.005);
  } catch (_) { /* contexte suspendu ou fermé */ }
}

// ─── Lecture d'un AudioBuffer pré-chargé ─────────────────────────────────────
function scheduleBuffer(ctx, gainNode, buffer, when) {
  try {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gainNode ?? ctx.destination);
    src.start(when);
  } catch (_) {}
}

// ─── Fabrique principale ───────────────────────────────────────────────────────
export function createSequencer({
  bpm        = 120,
  masterGain = null,   // GainNode externe optionnel
  onTrigger  = null,   // callback({ marker, time, angle }) à chaque déclenchement
} = {}) {

  // ── État interne ─────────────────────────────────────────────────────────────
  let _ctx       = null;       // AudioContext
  let _gain      = null;       // GainNode maître interne
  let _bpm       = bpm;
  let _running   = false;
  let _tickTimer = null;

  // Heure AudioContext du début de la rotation courante
  let _rotStart  = 0;

  // Ensemble des clés déjà planifiées → évite les doublons
  const _scheduled = new Set();

  // Liste des marqueurs : { id, angle, buffer?, freq?, color? }
  let _markers = [];

  // ── Durée d'une rotation (secondes) ──────────────────────────────────────────
  const rotDur = () => 60 / Math.max(1, _bpm);

  // ── Nettoyer les clés trop anciennes (anti-fuite mémoire) ────────────────────
  function pruneScheduled() {
    const now = _ctx?.currentTime ?? 0;
    for (const key of _scheduled) {
      // la clé encode le timestamp d'émission en millisecondes
      const ts = parseFloat(key.split("|")[1]);
      if (!isNaN(ts) && ts < now - 1) _scheduled.delete(key);
    }
  }

  // ── Tick du scheduler ─────────────────────────────────────────────────────────
  function tick() {
    if (!_running || !_ctx) return;

    const now     = _ctx.currentTime;
    const dur     = rotDur();
    const horizon = now + LOOKAHEAD_SECS;

    // Avancer _rotStart si la rotation courante est déjà terminée
    while (_rotStart + dur < now) _rotStart += dur;

    for (const marker of _markers) {
      // Décalage temporel du marqueur dans la rotation (0 → dur)
      const offset = (marker.angle / 360) * dur;

      // Vérifier la rotation courante ET la suivante (lookahead peut chevaucher)
      for (let lap = 0; lap < 2; lap++) {
        const triggerTime = _rotStart + offset + lap * dur;

        if (triggerTime > now - 0.001 && triggerTime <= horizon) {
          // Clé unique : markerId + timestamp arrondi à la ms
          const key = `${marker.id}|${(triggerTime).toFixed(3)}`;

          if (!_scheduled.has(key)) {
            _scheduled.add(key);

            // Déclencher le son
            if (marker.buffer) {
              scheduleBuffer(_ctx, _gain, marker.buffer, triggerTime);
            } else {
              scheduleClick(_ctx, _gain, triggerTime, marker.freq ?? 800);
            }

            // Notifier l'appelant (animation, UI…)
            onTrigger?.({
              marker,
              time:  triggerTime,
              angle: marker.angle,
            });
          }
        }
      }
    }

    pruneScheduled();
  }

  // ── API publique ──────────────────────────────────────────────────────────────

  /**
   * Initialise l'AudioContext.
   * Doit être appelé depuis un geste utilisateur (règle navigateur/mobile).
   */
  async function init(existingCtx = null) {
    if (existingCtx) {
      _ctx = existingCtx;
    } else {
      const { AudioContext: AC } =
        (typeof window !== "undefined" && window) ||
        require("react-native-audio-api");
      _ctx = new AC();
    }

    // GainNode maître interne → masterGain externe (ou destination)
    _gain = _ctx.createGain();
    _gain.gain.value = 1;
    _gain.connect(masterGain ?? _ctx.destination);

    return _ctx;
  }

  /**
   * Ajouter un marqueur.
   * @param {object} opts
   * @param {string}      opts.id     - identifiant unique
   * @param {number}      opts.angle  - position angulaire en degrés (0–360)
   * @param {AudioBuffer} [opts.buffer] - buffer pré-chargé (sinon synthèse)
   * @param {number}      [opts.freq]   - fréquence du clic synthétisé (Hz)
   * @param {string}      [opts.color]  - couleur pour affichage UI
   */
  function addMarker(opts) {
    const angle = ((opts.angle % 360) + 360) % 360; // normaliser 0–360
    // Supprimer un marqueur existant avec le même id
    _markers = _markers.filter(m => m.id !== opts.id);
    _markers.push({ ...opts, angle });
  }

  /** Supprimer un marqueur par son id */
  function removeMarker(id) {
    _markers = _markers.filter(m => m.id !== id);
  }

  /** Retourner la liste des marqueurs (lecture seule) */
  function getMarkers() {
    return [..._markers];
  }

  /** Démarrer le scheduler */
  function start() {
    if (_running || !_ctx) return;
    _running  = true;
    _rotStart = _ctx.currentTime;     // la rotation commence maintenant
    _scheduled.clear();
    _tickTimer = setInterval(tick, TICK_INTERVAL);
    tick();                            // premier tick immédiat
  }

  /** Arrêter le scheduler */
  function stop() {
    _running = false;
    clearInterval(_tickTimer);
    _tickTimer = null;
    _scheduled.clear();
  }

  /**
   * Changer le BPM sans interruption.
   * Recalcule l'heure de début de rotation pour maintenir la continuité.
   */
  function setBpm(newBpm) {
    if (!_ctx) { _bpm = newBpm; return; }

    const now        = _ctx.currentTime;
    const oldDur     = rotDur();                          // durée avant changement
    const elapsed    = now - _rotStart;                   // temps écoulé dans la rotation courante
    const fraction   = (elapsed % oldDur) / oldDur;      // fraction de tour accomplie (0–1)

    _bpm = Math.max(1, newBpm);

    const newDur     = rotDur();
    // Repositionner _rotStart de sorte que la fraction soit conservée
    _rotStart = now - fraction * newDur;
  }

  /** Volume général du sequencer (0–1) */
  function setVolume(vol) {
    if (_gain) _gain.gain.value = Math.max(0, Math.min(1, vol));
  }

  /**
   * Angle courant du disque (0–360°), interpolé entre les ticks.
   * Utile pour animer un turntable en dehors du scheduler.
   */
  function getCurrentAngle() {
    if (!_ctx || !_running) return 0;
    const elapsed  = _ctx.currentTime - _rotStart;
    const fraction = (elapsed % rotDur()) / rotDur();
    return (fraction * 360) % 360;
  }

  /** Libérer les ressources */
  function dispose() {
    stop();
    _ctx?.close?.();
    _ctx     = null;
    _gain    = null;
    _markers = [];
  }

  return {
    init,
    start,
    stop,
    dispose,
    setBpm,
    setVolume,
    addMarker,
    removeMarker,
    getMarkers,
    getCurrentAngle,
    get bpm()     { return _bpm; },
    get running() { return _running; },
    get ctx()     { return _ctx; },
  };
}

// ─── Hook React (optionnel) ───────────────────────────────────────────────────
// Permet d'utiliser le sequencer dans un composant React/React Native
// sans gérer le cycle de vie manuellement.
//
//   const seq = useSequencer({ bpm: 120, onTrigger: ({ marker }) => console.log(marker.id) });
//   seq.addMarker({ id: 'kick', angle: 0 });
//   <Button onPress={seq.start} title="Play" />

import { useRef, useEffect, useCallback } from "react";

export function useSequencer({ bpm = 120, onTrigger = null, autoInit = true } = {}) {
  const seqRef = useRef(null);

  useEffect(() => {
    const seq = createSequencer({ bpm, onTrigger });
    seqRef.current = seq;
    if (autoInit) seq.init().catch(console.error);
    return () => seq.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mettre à jour le BPM sans recréer le sequencer
  useEffect(() => {
    seqRef.current?.setBpm(bpm);
  }, [bpm]);

  const start       = useCallback(() => seqRef.current?.start(),            []);
  const stop        = useCallback(() => seqRef.current?.stop(),             []);
  const addMarker   = useCallback((m) => seqRef.current?.addMarker(m),    []);
  const removeMarker= useCallback((id) => seqRef.current?.removeMarker(id),[]);
  const getMarkers  = useCallback(() => seqRef.current?.getMarkers() ?? [],[]);
  const setVolume   = useCallback((v) => seqRef.current?.setVolume(v),    []);
  const getAngle    = useCallback(() => seqRef.current?.getCurrentAngle() ?? 0, []);

  return { start, stop, addMarker, removeMarker, getMarkers, setVolume, getAngle };
}
