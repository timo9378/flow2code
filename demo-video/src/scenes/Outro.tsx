import React from "react";
import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, DotGrid, FONT, MONO } from "../theme";

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = spring({ frame, fps, config: { damping: 200 } });
  const rest = spring({ frame: frame - 16, fps, config: { damping: 200 } });
  const url = spring({ frame: frame - 30, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill>
      <DotGrid />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", fontFamily: FONT }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 30,
            fontSize: 110,
            fontWeight: 800,
            color: C.text,
            letterSpacing: -3,
            opacity: logo,
            transform: `scale(${0.92 + logo * 0.08})`,
          }}
        >
          <Img src={staticFile("logo.png")} style={{ width: 96, height: 96, imageRendering: "auto" }} />
          Flow2Code
        </div>
        <div style={{ fontSize: 44, color: C.dim, marginTop: 26, fontWeight: 600, opacity: rest }}>
          X-ray vision for your API routes.
        </div>
        <div
          style={{
            marginTop: 60,
            fontFamily: MONO,
            fontSize: 30,
            color: C.accentSoft,
            background: "#0E1116",
            border: `1.5px solid ${C.panelBorder}`,
            borderRadius: 14,
            padding: "20px 34px",
            opacity: url,
            transform: `translateY(${(1 - url) * 24}px)`,
          }}
        >
          github.com/timo9378/flow2code
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
