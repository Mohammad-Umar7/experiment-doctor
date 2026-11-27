import { ImageResponse } from "next/og";

export const alt = "Experiment Doctor: your experiment is flatlining. Find out why.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// One heartbeat drawn as a polyline: flat, then a PQRST complex, then flat.
const BEAT = "0,70 180,70 210,62 240,70 270,78 290,8 315,100 335,70 420,70 460,56 500,70 560,70";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#090B0F",
          padding: "64px 72px",
          color: "#F1F4F8",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              border: "1px solid #272D38",
              background: "#11141B",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="34" height="34" viewBox="0 0 32 32">
              <path d="M4 17h6l2-4 3 9 3-14 2.5 9H28" fill="none" stroke="#22FF88" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.5, display: "flex" }}>
            experiment <span style={{ color: "#A0A8B8", marginLeft: 8 }}>doctor</span>
          </div>
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              fontSize: 18,
              color: "#A98BFF",
              border: "1px solid rgba(104,55,252,0.4)",
              background: "rgba(104,55,252,0.1)",
              padding: "8px 16px",
              borderRadius: 999,
              letterSpacing: 2,
            }}
          >
            BUILT FOR FLAGSMITH EXPERIMENTATION
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -3, lineHeight: 1.02 }}>Your experiment is flatlining.</div>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -3, lineHeight: 1.02, color: "#A0A8B8" }}>Find out why.</div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <svg width="560" height="110" viewBox="0 0 560 110">
            <polyline points={BEAT} fill="none" stroke="#22FF88" strokeWidth="4" strokeLinejoin="round" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={{ fontSize: 22, color: "#778195", letterSpacing: 2 }}>HUMAN VS DOCTOR</div>
            <div style={{ fontSize: 26, color: "#F1F4F8" }}>Fix a broken A/B test in 3 minutes.</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
