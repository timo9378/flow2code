import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, DotGrid, FONT, MONO, fadeOut } from "../theme";

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

  // Beat 1 (0–55): only the code panel, centered on a dark canvas.
  // Beat 2 (45–): code hands off to the canvas, which zooms out to the full graph.
  const codeIn = spring({ frame: frame - 2, fps, config: { damping: 200 } });
  const codeOut = interpolate(frame, [45, 64], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.5, 0, 0.8, 0.4),
  });

  const canvasIn = interpolate(frame, [50, 72], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const zoom = interpolate(frame, [50, 150], [2.05, 1.04], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.22, 0.8, 0.3, 1),
  });

  const cap1 = spring({ frame: frame - 10, fps, config: { damping: 200 } });
  const cap1out = interpolate(frame, [45, 58], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cap2 = spring({ frame: frame - 80, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill style={{ opacity: fadeOut(frame, exitAt), background: C.bg }}>
      <DotGrid opacity={1 - canvasIn} />

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
              "radial-gradient(ellipse at 50% 42%, transparent 55%, rgba(11,13,16,0.88) 100%)",
          }}
        />
      </AbsoluteFill>

      {/* beat 1: the code, alone and centered */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            width: 800,
            borderRadius: 16,
            background: "#0E1116",
            border: `1.5px solid ${C.panelBorder}`,
            boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
            padding: "32px 38px",
            fontFamily: MONO,
            fontSize: 23,
            lineHeight: 1.6,
            color: C.dim,
            opacity: codeIn * codeOut,
            transform: `translateY(${(1 - codeIn) * 50 - 30}px) scale(${1 - (1 - codeOut) * 0.06})`,
          }}
        >
          {CODE_LINES.map((l, i) => (
            <div key={i} style={{ whiteSpace: "pre", color: i === 0 ? C.text : C.dim }}>
              {l}
            </div>
          ))}
        </div>
      </AbsoluteFill>

      {/* captions */}
      <div
        style={{
          position: "absolute",
          bottom: 84,
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
          This is how <span style={{ color: C.accent }}>Flow2Code</span> sees it.
        </div>
      </div>
    </AbsoluteFill>
  );
};
