import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

const inter = loadInter("normal", { weights: ["400", "600", "800"] });
const mono = loadMono("normal", { weights: ["400", "700"] });

export const FONT = inter.fontFamily;
export const MONO = mono.fontFamily;

export const C = {
  bg: "#0B0D10",
  panel: "#14171C",
  panelBorder: "#262B33",
  text: "#E7EAEE",
  dim: "#9AA3AF",
  accent: "#F59E0B",
  accentSoft: "#FB923C",
  green: "#34D399",
  red: "#F87171",
  amber: "#FBBF24",
  blue: "#60A5FA",
};

/** Dotted canvas background, like the playground. */
export const DotGrid: React.FC<{ opacity?: number }> = ({ opacity = 1 }) => (
  <AbsoluteFill
    style={{
      backgroundColor: C.bg,
      backgroundImage: `radial-gradient(circle, #1d232b 1.4px, transparent 1.4px)`,
      backgroundSize: "34px 34px",
      opacity,
    }}
  />
);

/** Small wordmark pinned to a corner. */
export const Wordmark: React.FC = () => (
  <div
    style={{
      position: "absolute",
      top: 44,
      left: 56,
      fontFamily: FONT,
      fontWeight: 800,
      fontSize: 30,
      color: C.text,
      letterSpacing: -0.5,
    }}
  >
    <span style={{ color: C.accent }}>⌁</span> flow2code
  </div>
);

/** macOS-style window chrome. */
export const Window: React.FC<{
  title: string;
  width: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ title, width, children, style }) => (
  <div
    style={{
      width,
      borderRadius: 18,
      background: C.panel,
      border: `1.5px solid ${C.panelBorder}`,
      boxShadow: "0 40px 90px rgba(0,0,0,0.55)",
      overflow: "hidden",
      ...style,
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "16px 22px",
        borderBottom: `1.5px solid ${C.panelBorder}`,
      }}
    >
      {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
        <div key={c} style={{ width: 15, height: 15, borderRadius: 8, background: c }} />
      ))}
      <div
        style={{
          marginLeft: 16,
          fontFamily: MONO,
          fontSize: 21,
          color: C.dim,
        }}
      >
        {title}
      </div>
    </div>
    {children}
  </div>
);

/** Springs a child up+fade-in starting at `from` (local frame). */
export const Rise: React.FC<{
  from: number;
  children: React.ReactNode;
  distance?: number;
  style?: React.CSSProperties;
}> = ({ from, children, distance = 40, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - from, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${(1 - p) * distance}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Caption strip at the bottom of a scene. */
export const Caption: React.FC<{ from: number; children: React.ReactNode }> = ({
  from,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - from, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        position: "absolute",
        bottom: 84,
        width: "100%",
        textAlign: "center",
        fontFamily: FONT,
        fontWeight: 600,
        fontSize: 44,
        color: C.text,
        opacity: p,
        transform: `translateY(${(1 - p) * 26}px)`,
      }}
    >
      {children}
    </div>
  );
};

/** Cross-fade helper for scene exits. */
export const fadeOut = (frame: number, start: number, len = 12) =>
  interpolate(frame, [start, start + len], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
