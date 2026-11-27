# Experiment Doctor

**Your experiment is flatlining. Find out why.**

Experiment Doctor diagnoses broken [Flagsmith Experimentation](https://docs.flagsmith.com/experimentation) setups, proposes the exact fix, applies it only after you approve, and then verifies that exposures and conversions really arrive.

It ships as:

- a **CLI** (`experiment-doctor`) that reads your Flagsmith project through the official Flagsmith CLI and scans your code,
- an **Agent Skill** (`flagsmith-experiment-doctor`) so any coding agent can run the whole diagnose, fix, verify job,
- **Human vs Doctor**, a public game where developers race the Doctor to repair a broken experiment, which is itself a real Flagsmith A/B test.

Built for Toggle Wars, the Flagsmith Experimentation Hackathon by WeMakeDevs.

> Work in progress. Setup steps and results land here as they are built.
