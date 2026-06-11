import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, DotGrid, FONT, MONO, Wordmark, fadeOut } from "../theme";

const CARDS = [
  { icon: "⌨️", title: "CLI", code: "npx @timo9378/flow2code diff route.ts", note: "git-aware · works on HEAD" },
  { icon: "🔁", title: "GitHub Action", code: "uses: timo9378/flow2code@main", note: "one comment per PR" },
  { icon: "🤖", title: "MCP Server", code: "claude mcp add flow2code", note: "your agent can call it too" },
];

export const Pillars: React.FC<{ exitAt: number }> = ({ exitAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ opacity: fadeOut(frame, exitAt) }}>
      <DotGrid />
      <Wordmark />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ fontFamily: FONT, textAlign: "center", marginBottom: 64 }}>
          <div
            style={{
              fontSize: 64,
              fontWeight: 800,
              color: C.text,
              opacity: spring({ frame, fps, config: { damping: 200 } }),
            }}
          >
            Wherever you review code.
          </div>
        </div>
        <div style={{ display: "flex", gap: 38 }}>
          {CARDS.map((card, i) => {
            const p = spring({ frame: frame - 14 - i * 9, fps, config: { damping: 200 } });
            return (
              <div
                key={card.title}
                style={{
                  width: 520,
                  borderRadius: 20,
                  background: C.panel,
                  border: `1.5px solid ${C.panelBorder}`,
                  boxShadow: "0 30px 70px rgba(0,0,0,0.5)",
                  padding: "40px 38px",
                  opacity: p,
                  transform: `translateY(${(1 - p) * 60}px)`,
                  fontFamily: FONT,
                }}
              >
                <div style={{ fontSize: 46 }}>{card.icon}</div>
                <div style={{ fontSize: 38, fontWeight: 800, color: C.text, marginTop: 16 }}>
                  {card.title}
                </div>
                <div
                  style={{
                    marginTop: 22,
                    fontFamily: MONO,
                    fontSize: 19,
                    color: C.accentSoft,
                    background: "#0E1116",
                    border: `1px solid ${C.panelBorder}`,
                    borderRadius: 10,
                    padding: "14px 16px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {card.code}
                </div>
                <div style={{ marginTop: 18, fontSize: 24, color: C.dim }}>{card.note}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
