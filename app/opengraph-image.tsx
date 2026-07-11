import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "WikiRace Arena — speedrun the encyclopedia";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#101014",
          fontWeight: 900,
        }}
      >
        <div style={{ display: "flex", fontSize: 110, color: "#f7f2e5" }}>
          WIKIRACE
        </div>
        <div style={{ display: "flex", fontSize: 110, color: "#d7ff00" }}>
          ⚡ARENA
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 34,
            marginTop: 28,
            color: "#f7f2e5",
            opacity: 0.75,
          }}
        >
          speedrun the encyclopedia — race friends through Wikipedia links
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 40,
            width: 640,
            height: 14,
            backgroundImage:
              "repeating-linear-gradient(90deg, #e9e4d4 0 20px, #101014 20px 40px)",
          }}
        />
      </div>
    ),
    size
  );
}
