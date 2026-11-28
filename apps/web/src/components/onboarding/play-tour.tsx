import type { TourStep } from "@/components/onboarding/tour";
import { Kbd } from "@/components/ui/panel";

export const PLAY_TOUR_LABEL = "How to play";

/** First-visit walkthrough of Human vs Doctor. Runs before the clock starts, so it never costs a player time. */
export const PLAY_TOUR: TourStep[] = [
  {
    title: "Welcome to Human vs Doctor",
    body: (
      <>
        <p>
          Each case is a Flagsmith A/B test that is quietly broken: users see the experiment, but their purchases never get
          counted.
        </p>
        <p className="mt-2">
          Your job: find the bug in the code and fix it before the clock runs out. Learning how takes 30 seconds.
        </p>
      </>
    ),
  },
  {
    target: "symptom",
    title: "1. Read the symptom",
    body: "This tells you, in plain words, what looks wrong in the results.",
  },
  {
    target: "evidence",
    title: "2. Follow the clues",
    body: "The pipeline turns red where the data stops. Below it is the Flagsmith setup your code must match, like the exact metric event name.",
  },
  {
    target: "code",
    title: "3. Fix the code",
    body: "When you start, this file becomes editable. Usually one or two lines are wrong. Reset file undoes your edits.",
  },
  {
    target: "hint",
    title: "4. Stuck? Ask the Doctor",
    body: "You get one free hint per case. Players get one of two hint styles at random, and that is the A/B test we measure.",
  },
  {
    target: "verify",
    title: "5. Verify your repair",
    body: (
      <>
        Click Verify repair or press <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd>. The server checks your fix without running it. If it
        is still broken, you see where the data stops now.
      </>
    ),
  },
  {
    target: "clock",
    title: "6. Beat the Doctor",
    body: "You have 3 minutes. The green time is how long the AI Doctor took on this case. Beat it to top the leaderboard.",
  },
];
