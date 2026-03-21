/**
 * Turntable.js — Disque vinyle rotatif pour Magnedrum
 * Vitesse de rotation pilotée par `bpm` (1 tour = 60 000 / bpm ms)
 *
 * Usage :
 *   import Turntable from './turntable';
 *   <Turntable bpm={120} isPlaying={true} size={400} />
 */

import { useEffect, useRef } from "react";
import { Animated, Easing, View, StyleSheet } from "react-native";

// ─── Couleurs vinyle ──────────────────────────────────────────────────────────
const VINYL_BLACK   = "#1A1A1A";
const GROOVE_DARK   = "#111111";
const GROOVE_LIGHT  = "#2A2A2A";
const LABEL_BG      = "#C0392B";   // étiquette rouge classique
const LABEL_TEXT    = "#F5F0E8";
const SHINE         = "rgba(255,255,255,0.06)";

// ─── Sillons concentriques ────────────────────────────────────────────────────
function Grooves({ size }) {
  const R = size / 2;
  // Rayon intérieur (zone étiquette) ~ 30 % du disque
  // Rayon extérieur (début sillons)  ~ 96 % du disque
  const rInner = R * 0.32;
  const rOuter = R * 0.96;
  const count  = 28;

  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const t    = i / (count - 1);                 // 0 → 1
        const r    = rOuter - t * (rOuter - rInner);  // rayon décroissant
        const diam = r * 2;
        const bg   = i % 2 === 0 ? GROOVE_DARK : GROOVE_LIGHT;
        return (
          <View
            key={i}
            style={{
              position:    "absolute",
              width:       diam,
              height:      diam,
              borderRadius: r,
              backgroundColor: bg,
              left: R - r,
              top:  R - r,
            }}
          />
        );
      })}
    </>
  );
}

// ─── Étiquette centrale ───────────────────────────────────────────────────────
function Label({ size }) {
  const R     = size / 2;
  const rLbl  = R * 0.30;
  const rHole = R * 0.035;

  return (
    <>
      {/* Fond étiquette */}
      <View style={{
        position:    "absolute",
        width:       rLbl * 2,
        height:      rLbl * 2,
        borderRadius: rLbl,
        backgroundColor: LABEL_BG,
        left: R - rLbl,
        top:  R - rLbl,
        alignItems:  "center",
        justifyContent: "center",
      }}>
        {/* Ligne décorative */}
        <View style={{ width: rLbl * 1.4, height: 1, backgroundColor: "rgba(255,255,255,0.25)", marginBottom: 4 }} />
        <View style={{ width: rLbl * 0.8, height: 1, backgroundColor: "rgba(255,255,255,0.15)" }} />
      </View>

      {/* Reflet léger */}
      <View style={{
        position:    "absolute",
        width:       rLbl * 2,
        height:      rLbl * 2,
        borderRadius: rLbl,
        backgroundColor: SHINE,
        left: R - rLbl,
        top:  R - rLbl,
      }} />

      {/* Trou central */}
      <View style={{
        position:    "absolute",
        width:       rHole * 2,
        height:      rHole * 2,
        borderRadius: rHole,
        backgroundColor: "#000",
        left: R - rHole,
        top:  R - rHole,
      }} />
    </>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function Turntable({ bpm = 80, isPlaying = false, size = 400 }) {
  const rotation = useRef(new Animated.Value(0)).current;
  const animRef  = useRef(null);

  const msPerTurn = 60000 / Math.max(1, bpm);  // durée d'un tour en ms

  useEffect(() => {
    if (isPlaying) {
      // Lire la valeur courante pour enchaîner sans saut
      rotation.stopAnimation((current) => {
        rotation.setValue(current % 1);
        const remaining = (1 - (current % 1)) * msPerTurn;

        const runLoop = () => {
          rotation.setValue(0);
          animRef.current = Animated.loop(
            Animated.timing(rotation, {
              toValue:        1,
              duration:       msPerTurn,
              easing:         Easing.linear,
              useNativeDriver: true,
            })
          );
          animRef.current.start();
        };

        // Premier segment jusqu'à 1, puis boucle
        Animated.timing(rotation, {
          toValue:        1,
          duration:       remaining,
          easing:         Easing.linear,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished && isPlayingRef.current) runLoop();
        });
      });
    } else {
      animRef.current?.stop();
    }
  }, [isPlaying]);

  // Recalculer la vitesse sans coupure quand le BPM change
  useEffect(() => {
    if (!isPlaying) return;
    rotation.stopAnimation((current) => {
      const frac      = current % 1;
      const remaining = (1 - frac) * msPerTurn;
      rotation.setValue(frac);

      const runLoop = () => {
        rotation.setValue(0);
        animRef.current = Animated.loop(
          Animated.timing(rotation, {
            toValue:        1,
            duration:       msPerTurn,
            easing:         Easing.linear,
            useNativeDriver: true,
          })
        );
        animRef.current.start();
      };

      Animated.timing(rotation, {
        toValue:        1,
        duration:       remaining,
        easing:         Easing.linear,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) runLoop();
      });
    });
  }, [bpm]);

  const spin = rotation.interpolate({
    inputRange:  [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  // Ref pour accéder à isPlaying dans les callbacks async
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  return (
    <View style={[styles.wrapper, { width: size, height: size }]}>
      {/* Disque rotatif */}
      <Animated.View style={{
        width:        size,
        height:       size,
        borderRadius: size / 2,
        backgroundColor: VINYL_BLACK,
        transform:    [{ rotate: spin }],
        overflow:     "hidden",
      }}>
        <Grooves size={size} />

        {/* Reflet de surface */}
        <View style={{
          position:        "absolute",
          width:           size,
          height:          size / 2,
          borderRadius:    size / 2,
          backgroundColor: SHINE,
          top: 0,
        }} />
      </Animated.View>

      {/* Étiquette (fixe par rapport au conteneur, pivote avec le disque via absolute) */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Label size={size} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems:     "center",
    justifyContent: "center",
  },
});
