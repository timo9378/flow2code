import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, MONO, fadeOut } from "../theme";

const CODE_LINES = [
  "export async function POST(req: Request) {",
  "  const ip = req.headers.get(\"x-forwarded-for\");",
  "  const { success } = await rateLimit.limit(ip);",
  "  if (!success) {",
  "    return NextResponse.json({...}, { status: 429 });",
  "  }",
  "  let body: unknown;",
  "  try {",
  "    body = await req.json();",
  "  } catch {",
  "    return NextResponse.json({...}, { status: 400 });",
  "  }",
  "  const parsed = CreateOrderSchema.safeParse(body);",
  "  // … 40 more lines",
];

/**
 * Hook: the namesake moment. The route's code gives way to the playground
 * canvas, zooming out from a node cluster to the full 22-node flow graph.
 */
export const CanvasHook: React.FC<{ exitAt: number }> = ({ exitAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // canvas zoom-out: focus near the trigger cluster, settle on the full graph
  const zoom = interpolate(frame, [6, 130], [2.25, 1.04], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.22, 0.8, 0.3, 1),
  });
  const canvasIn = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // code panel: present first, slides away as the graph takes over
  const codeOut = interpolate(frame, [40, 62], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.5, 0, 0.8, 0.4),
  });

  const cap1 = spring({ frame: frame - 4, fps, config: { damping: 200 } });
  const cap1out = interpolate(frame, [52, 66], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cap2 = spring({ frame: frame - 70, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill style={{ opacity: fadeOut(frame, exitAt), background: C.bg }}>
      <AbsoluteFill style={{ opacity: canvasIn }}>
        <Img
          src={staticFile("canvas.png")}
          style={{
            width: 1920,
            height: 1080,
            objectFit: "cover",
            transform: `scale(${zoom})`,
            transformOrigin: "44% 28%",
          }}
        />
        {/* vignette for caption legibility */}
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse at 50% 42%, transparent 55%, rgba(11,13,16,0.85) 100%)",
          }}
        />
      </AbsoluteFill>

      {/* code panel that gives way to the graph */}
      <div
        style={{
          position: "absolute",
          left: 96,
          top: 150,
          width: 760,
          borderRadius: 16,
          background: "rgba(14,17,22,0.94)",
          border: `1.5px solid ${C.panelBorder}`,
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
          padding: "30px 34px",
          fontFamily: MONO,
          fontSize: 22.5,
          lineHeight: 1.62,
          color: C.dim,
          opacity: codeOut,
          transform: `translateX(${(1 - codeOut) * -60}px)`,
        }}
      >
        {CODE_LINES.map((l, i) => (
          <div key={i} style={{ whiteSpace: "pre", color: i === 0 ? C.text : C.dim }}>
            {l}
          </div>
        ))}
      </div>

      {/* captions */}
      <div
        style={{
          position: "absolute",
          bottom: 96,
          width: "100%",
          textAlign: "center",
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: 52,
          color: C.text,
        }}
      >
        <div style={{ position: "absolute", width: "100%", opacity: cap1 * cap1out, transform: `translateY(${(1 - cap1) * 26}px)` }}>
          This is one of your API routes.
        </div>
        <div style={{ position: "absolute", width: "100%", opacity: cap2, transform: `translateY(${(1 - cap2) * 26}px)` }}>
          This is how <span style={{ color: C.accent }}>flow2code</span> sees it.
        </div>
      </div>
    </AbsoluteFill>
  );
};
