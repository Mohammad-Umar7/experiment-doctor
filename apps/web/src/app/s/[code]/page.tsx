import type { Metadata } from "next";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/panel";
import { DOCTOR_RECORD } from "@/lib/doctor-record";
import { formatMs } from "@/lib/game/time";
import { readShareCode } from "@/lib/server/share";

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const share = readShareCode(code);
  if (!share) return { title: "Human vs Doctor" };
  const time = formatMs(share.ms);
  return {
    title: `Fixed a broken A/B test in ${time}`,
    description: `A verified repair of "${share.caseTitle}" in ${time}. The AI Doctor did it in ${DOCTOR_RECORD.time}. Can you beat it?`,
  };
}

async function ShareBody({ params }: Props) {
  const { code } = await params;
  const share = readShareCode(code);
  if (!share) {
    return (
      <>
        <h1 className="mt-3 text-[32px] font-semibold tracking-[-0.03em]">This share link is not valid.</h1>
        <p className="mt-3 text-[15px] text-fg-secondary">It may have been edited. The challenge itself is still open.</p>
      </>
    );
  }
  const beat = share.ms < DOCTOR_RECORD.ms;
  return (
    <>
      <p className="mt-4 font-mono text-[56px] font-medium leading-none tabular text-fg sm:text-[72px]">{formatMs(share.ms)}</p>
      <p className="mt-4 text-[16px] text-fg-secondary">
        A server-verified repair of case {share.caseId}, &quot;{share.caseTitle}&quot;.{" "}
        {beat ? (
          <span className="text-healthy">Faster than the AI Doctor ({DOCTOR_RECORD.time}).</span>
        ) : (
          <span>The AI Doctor did it in {DOCTOR_RECORD.time}.</span>
        )}
      </p>
    </>
  );
}

export default function SharePage(props: Props) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center px-4 py-20 text-center sm:px-6">
      <Eyebrow>Human vs Doctor · experiment revived</Eyebrow>
      <Suspense fallback={<p className="mt-4 font-mono text-[56px] text-fg-muted">--:--.--</p>}>
        <ShareBody {...props} />
      </Suspense>
      <div className="mt-10 flex justify-center">
        <ButtonLink href="/play" size="lg">
          Can you beat it?
        </ButtonLink>
      </div>
    </div>
  );
}
