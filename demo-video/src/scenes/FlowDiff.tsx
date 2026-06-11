import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, Caption, DotGrid, MONO, Window, Wordmark, fadeOut } from "../theme";

const CMD = "npx @timo9378/flow2code diff route.ts";
const TYPE_START = 10;
const TYPE_SPEED = 1.1; // frames per char
const OUT_START = TYPE_START + CMD.length * TYPE_SPEED + 14;

const OUTPUT: { t: React.ReactNode; warn?: boolean }[] = [
  { t: <span style={{ color: C.text }}>📊 Flow diff: +0 added, <b>-2 removed</b>, ✏️ 2 modified, 18 unchanged</span> },
  { t: " " },
  { t: <span style={{ color: C.red, fontWeight: 700 }}>  ⚠️ Error handling removed: Try / Catch</span>, warn: true },
  { t: <span style={{ color: C.red, fontWeight: 700 }}>  ⚠️ Error response path removed: Response 400</span>, warn: true },
  {
    t: (
      <span style={{ color: C.amber }}>
        {"  "}🟡 Branch condition changed: <span style={{ color: C.dim }}>!product || product.stock {"<"} quantity</span> → <b>!product</b>
      </span>
    ),
  },
  { t: <span style={{ color: C.blue }}>{"  "}🆕 [warning] "req.json" has no error handling (line 19)</span> },
];

export const FlowDiff: React.FC<{ exitAt: number }> = ({ exitAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const slide = spring({ frame, fps, config: { damping: 200 } });
  const typed = CMD.slice(0, Math.max(0, Math.floor((frame - TYPE_START) / TYPE_SPEED)));
  const caret = Math.floor(frame / 14) % 2 === 0;

  return (
    <AbsoluteFill style={{ opacity: fadeOut(frame, exitAt) }}>
      <DotGrid />
      <Wordmark />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ transform: `translateY(${(1 - slide) * 80}px) translateY(-40px)`, opacity: slide }}>
          <Window title="terminal" width={1430}>
            <div style={{ padding: "34px 42px", fontFamily: MONO, fontSize: 28, lineHeight: 1.78, minHeight: 430 }}>
              <div style={{ color: C.text }}>
                <span style={{ color: C.green }}>❯ </span>
                {typed}
                {typed.length < CMD.length && caret ? <span style={{ color: C.accent }}>▍</span> : null}
              </div>
              <div style={{ height: 14 }} />
              {OUTPUT.map((l, i) => {
                const at = OUT_START + i * 9;
                const p = spring({ frame: frame - at, fps, config: { damping: 200 } });
                const glow = l.warn
                  ? interpolate(frame - at, [0, 10, 38], [0, 1, 0.45], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                    })
                  : 0;
                return (
                  <div
                    key={i}
                    style={{
                      opacity: p,
                      transform: `translateX(${(1 - p) * 26}px)`,
                      textShadow: glow ? `0 0 ${22 * glow}px rgba(248,113,113,0.9)` : undefined,
                      whiteSpace: "pre",
                    }}
                  >
                    {l.t}
                  </div>
                );
              })}
            </div>
          </Window>
        </div>
      </AbsoluteFill>
      <Caption from={OUT_START + 58}>
        The <span style={{ color: C.accent }}>flow diff</span> knows what actually changed.
      </Caption>
    </AbsoluteFill>
  );
};
