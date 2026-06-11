import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, Caption, DotGrid, MONO, Window, Wordmark, fadeOut } from "../theme";

const LINES: { t: string; kind: "ctx" | "del" | "add" }[] = [
  { t: "  const { productId, quantity } = parsed.data;", kind: "ctx" },
  { t: "", kind: "ctx" },
  { t: "- let body: unknown;", kind: "del" },
  { t: "- try {", kind: "del" },
  { t: "-   body = await req.json();", kind: "del" },
  { t: "- } catch {", kind: "del" },
  { t: '-   return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });', kind: "del" },
  { t: "- }", kind: "del" },
  { t: "+ const body = await req.json();", kind: "add" },
  { t: "", kind: "ctx" },
  { t: "- if (!product || product.stock < quantity) {", kind: "del" },
  { t: "+ if (!product) {", kind: "add" },
  { t: '    return NextResponse.json({ error: "Out of stock" }, { status: 409 });', kind: "ctx" },
];

export const TextDiff: React.FC<{ exitAt: number }> = ({ exitAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const slide = spring({ frame, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill style={{ opacity: fadeOut(frame, exitAt) }}>
      <DotGrid />
      <Wordmark />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ transform: `translateY(${(1 - slide) * 80}px) translateY(-40px)`, opacity: slide }}>
          <Window title="git diff — src/app/api/orders/route.ts" width={1280}>
            <div style={{ padding: "26px 34px", fontFamily: MONO, fontSize: 25.5, lineHeight: 1.62 }}>
              {LINES.map((l, i) => {
                const p = spring({ frame: frame - 12 - i * 2.2, fps, config: { damping: 200 } });
                const color = l.kind === "del" ? C.red : l.kind === "add" ? C.green : C.dim;
                const bg =
                  l.kind === "del"
                    ? "rgba(248,113,113,0.09)"
                    : l.kind === "add"
                      ? "rgba(52,211,153,0.09)"
                      : "transparent";
                return (
                  <div key={i} style={{ color, background: bg, opacity: p, whiteSpace: "pre", padding: "0 10px" }}>
                    {l.t || " "}
                  </div>
                );
              })}
            </div>
          </Window>
        </div>
      </AbsoluteFill>
      <Caption from={62}>
        Looks like a harmless cleanup, <span style={{ color: C.dim }}>right?</span>
      </Caption>
    </AbsoluteFill>
  );
};
