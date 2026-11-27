/**
 * The same diagnosis engine the CLI uses (packages/core), running in the browser.
 * Nothing leaves the page: code is scanned locally and rules run locally.
 */
import { diagnose, scanFiles, type Evidence, type Report } from "@experiment-doctor/core";

export type PastedFile = { path: string; content: string };

export function diagnoseCode(files: PastedFile[], config: Evidence["config"] = null, flag?: string): Report {
  const code = scanFiles(files);
  const evidence: Evidence = { schemaVersion: 1, collectedAt: new Date().toISOString(), target: flag ? { flag } : undefined, config, code };
  return diagnose(evidence);
}

export type { Report };
