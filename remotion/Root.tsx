import React from "react";
import { Composition } from "remotion";
import { createCanonicalCreativeFixture } from "../lib/creative/fixtures";
import {
  CREATIVE_REMOTION_COMPOSITION_ID,
  getCreativeCompositionMetadata,
  type CreativeRemotionInputProps,
} from "../lib/creative/remotion";
import { CreativeComposition } from "./CreativeComposition";

const defaultDocument = createCanonicalCreativeFixture();
const defaultMetadata = getCreativeCompositionMetadata(defaultDocument);

export function RemotionRoot() {
  return (
    <Composition
      id={CREATIVE_REMOTION_COMPOSITION_ID}
      component={CreativeComposition}
      width={defaultMetadata.width}
      height={defaultMetadata.height}
      fps={defaultMetadata.fps}
      durationInFrames={defaultMetadata.durationInFrames}
      defaultProps={{ document: defaultDocument, assets: {} } satisfies CreativeRemotionInputProps}
      calculateMetadata={({ props }: { props: CreativeRemotionInputProps }) => {
        const metadata = getCreativeCompositionMetadata(props.document);
        return {
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          durationInFrames: metadata.durationInFrames,
        };
      }}
    />
  );
}
