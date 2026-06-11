import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { C } from "./theme";
import { CanvasHook } from "./scenes/CanvasHook";
import { TextDiff } from "./scenes/TextDiff";
import { FlowDiff } from "./scenes/FlowDiff";
import { PrComment } from "./scenes/PrComment";
import { Pillars } from "./scenes/Pillars";
import { Outro } from "./scenes/Outro";

// scene lengths (frames @ 30fps)
const HOOK = 165;
const TEXT_DIFF = 190;
const FLOW_DIFF = 320;
const PR = 245;
const PILLARS = 175;
const OUTRO = 140;

export const TOTAL_FRAMES = HOOK + TEXT_DIFF + FLOW_DIFF + PR + PILLARS + OUTRO; // 1235 ≈ 41s

export const Main: React.FC = () => {
  let at = 0;
  const seq = (len: number) => {
    const from = at;
    at += len;
    return { from, durationInFrames: len + 14 }; // overlap for cross-fades
  };

  const sHook = seq(HOOK);
  const sText = seq(TEXT_DIFF);
  const sFlow = seq(FLOW_DIFF);
  const sPr = seq(PR);
  const sPillars = seq(PILLARS);
  const sOutro = seq(OUTRO);

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Audio src={staticFile("soundtrack.wav")} />
      <Sequence {...sHook}>
        <CanvasHook exitAt={HOOK} />
      </Sequence>
      <Sequence {...sText}>
        <TextDiff exitAt={TEXT_DIFF} />
      </Sequence>
      <Sequence {...sFlow}>
        <FlowDiff exitAt={FLOW_DIFF} />
      </Sequence>
      <Sequence {...sPr}>
        <PrComment exitAt={PR} durationInFrames={PR} />
      </Sequence>
      <Sequence {...sPillars}>
        <Pillars exitAt={PILLARS} />
      </Sequence>
      <Sequence {...sOutro}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};
