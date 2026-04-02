import { AbsoluteFill, Sequence } from "remotion";
import { IntroScene } from "./scenes/IntroScene";
import { HeroScene } from "./scenes/HeroScene";
import { ServicesScene } from "./scenes/ServicesScene";
import { AriaScene } from "./scenes/AriaScene";
import { SeoScene } from "./scenes/SeoScene";
import { StatsScene } from "./scenes/StatsScene";
import { CtaScene } from "./scenes/CtaScene";

export const NeuralFlowDemo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#050508" }}>
      {/* Scene 1: Logo intro (0-3s) */}
      <Sequence from={0} durationInFrames={90}>
        <IntroScene />
      </Sequence>

      {/* Scene 2: Hero headline (3-7s) */}
      <Sequence from={90} durationInFrames={120}>
        <HeroScene />
      </Sequence>

      {/* Scene 3: Services grid (7-11s) */}
      <Sequence from={210} durationInFrames={120}>
        <ServicesScene />
      </Sequence>

      {/* Scene 4: ARIA chatbot demo (11-14s) */}
      <Sequence from={330} durationInFrames={90}>
        <AriaScene />
      </Sequence>

      {/* Scene 5: SEO results (14-17s) */}
      <Sequence from={420} durationInFrames={90}>
        <SeoScene />
      </Sequence>

      {/* Scene 6: Stats counter (17-18.5s) */}
      <Sequence from={510} durationInFrames={45}>
        <StatsScene />
      </Sequence>

      {/* Scene 7: CTA outro (18.5-20s) */}
      <Sequence from={555} durationInFrames={45}>
        <CtaScene />
      </Sequence>
    </AbsoluteFill>
  );
};
