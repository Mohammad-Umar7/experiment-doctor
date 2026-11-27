import { ImageResponse } from "next/og";
import { doctorRecordFor } from "@/lib/doctor-record";
import { formatMs } from "@/lib/game/time";
import { readShareCode } from "@/lib/server/share";

export const alt = "A verified repair in Human vs Doctor";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BEAT = "0,60 160,60 190,52 220,60 250,68 270,6 295,96 315,60 400,60 440,46 480,60 540,60";

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const share = readShareCode(code);
  const time = share ? formatMs(share.ms) : "--:--.--";
  const beat = share ? share.ms < doctorRecordFor(share.caseId).ms : false;

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
          padding: "60px 72px",
          color: "#F1F4F8",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 600 }}>
            experiment <span style={{ color: "#A0A8B8", marginLeft: 8 }}>doctor</span>
          </div>
          <div style={{ display: "flex", fontSize: 20, letterSpacing: 3, color: "#22FF88" }}>EXPERIMENT REVIVED</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 30, color: "#A0A8B8" }}>
            {share ? `Fixed "${share.caseTitle}" in` : "Human vs Doctor"}
          </div>
          <div style={{ fontSize: 150, fontWeight: 600, letterSpacing: -4, lineHeight: 1 }}>{time}</div>
          <div style={{ display: "flex", fontSize: 30, marginTop: 12, color: beat ? "#22FF88" : "#A0A8B8" }}>
            {!share
              ? "Fix a broken A/B test in 3 minutes"
              : beat
                ? `Faster than the AI Doctor (${doctorRecordFor(share.caseId).time})`
                : `The AI Doctor: ${doctorRecordFor(share.caseId).time}`}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <svg width="540" height="100" viewBox="0 0 540 100">
            <polyline points={BEAT} fill="none" stroke="#22FF88" strokeWidth="4" strokeLinejoin="round" />
          </svg>
          <div style={{ fontSize: 28, color: "#F1F4F8" }}>Can you beat it?</div>
        </div>
      </div>
    ),
    size,
  );
}
