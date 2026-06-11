import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, DotGrid, FONT, Rise, Wordmark, fadeOut } from "../theme";

export const Hook: React.FC<{ exitAt: number }> = ({ exitAt }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity: fadeOut(frame, exitAt) }}>
      <DotGrid />
      <Wordmark />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          fontFamily: FONT,
          textAlign: "center",
        }}
      >
        <Rise from={8}>
          <div style={{ fontSize: 92, fontWeight: 800, color: C.text, letterSpacing: -2 }}>
            AI writes your backend now.
          </div>
        </Rise>
        <Rise from={32}>
          <div style={{ fontSize: 60, fontWeight: 600, color: C.dim, marginTop: 30 }}>
            Reviewing it is the bottleneck.
          </div>
        </Rise>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
