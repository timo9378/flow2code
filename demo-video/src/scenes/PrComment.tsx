import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, Caption, DotGrid, Wordmark, fadeOut } from "../theme";

/**
 * Ken Burns over the real PR comment screenshot (1256 × 4378).
 * Shown at width 1010 inside a viewport; pans from the warning list
 * down to the highlighted Mermaid graph.
 */
export const PrComment: React.FC<{ exitAt: number; durationInFrames: number }> = ({
  exitAt,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });

  const IMG_W = 1010;
  const SCALE = IMG_W / 1256;
  const IMG_H = 4378 * SCALE; // ≈ 3520
  const VIEW_H = 780;

  const pan = interpolate(frame, [25, durationInFrames - 30], [0, -(IMG_H - VIEW_H) * 0.62], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity: fadeOut(frame, exitAt) }}>
      <DotGrid />
      <Wordmark />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            width: IMG_W,
            height: VIEW_H,
            borderRadius: 18,
            overflow: "hidden",
            border: `1.5px solid ${C.panelBorder}`,
            boxShadow: "0 40px 90px rgba(0,0,0,0.6)",
            opacity: enter,
            transform: `translateY(${(1 - enter) * 70}px) translateY(-40px)`,
            background: "#fff",
          }}
        >
          <Img
            src={staticFile("pr-comment.png")}
            style={{ width: IMG_W, transform: `translateY(${pan}px)` }}
          />
        </div>
      </AbsoluteFill>
      <Caption from={30}>
        One auto-updated comment on every PR — <span style={{ color: C.accent }}>graph included</span>.
      </Caption>
    </AbsoluteFill>
  );
};
