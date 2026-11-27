#!/usr/bin/env node
/**
 * Seeds the local rescue lab (selfhost/docker-compose.yml) with a ready-to-break experiment:
 * admin user, organisation, project, environment, the Flagsmith-database warehouse,
 * the multivariate flag checkout_button, the metric "purchase" and a running experiment.
 *
 *   docker compose -p doctor-lab -f selfhost/docker-compose.yml up -d
 *   node selfhost/seed.mjs
 *
 * Writes selfhost/lab.env (git-ignored) with the environment key and a master API key so the
 * official Flagsmith CLI and the Doctor can talk to this instance:
 *   FLAGSMITH_API_URL=http://localhost:8000  FLAGSMITH_API_KEY_localhost_8000=...
 *
 * The credentials below are for this throwaway local lab only.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const API = process.env.LAB_API_URL ?? "http://localhost:8000";
const EMAIL = process.env.LAB_ADMIN_EMAIL ?? "doctor@lab.localhost";
const PASSWORD = process.env.LAB_ADMIN_PASSWORD ?? "lab-only-Ch4ngeMe!";
const COMPOSE = ["compose", "-p", "doctor-lab", "-f", join(here, "docker-compose.yml")];

function step(msg) {
  console.log(`\x1b[2m›\x1b[0m ${msg}`);
}

async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${API}/api/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 400)}`);
  return data;
}

async function main() {
  step("creating the lab admin (ignored if it already exists)");
  try {
    execFileSync(
      "docker",
      [...COMPOSE, "exec", "-T", "-e", `DJANGO_SUPERUSER_EMAIL=${EMAIL}`, "-e", `DJANGO_SUPERUSER_PASSWORD=${PASSWORD}`, "-e", "DJANGO_SUPERUSER_FIRST_NAME=Doctor", "-e", "DJANGO_SUPERUSER_LAST_NAME=Lab", "-e", "DJANGO_SUPERUSER_SIGN_UP_TYPE=NO_INVITE", "flagsmith", "flagsmith", "createsuperuser", "--noinput"],
      { stdio: "pipe" },
    );
  } catch (error) {
    const out = String(error.stderr ?? error.stdout ?? "");
    if (!/already|exists|unique/i.test(out)) throw new Error(`createsuperuser failed: ${out.slice(0, 400)}`);
  }

  step("logging in");
  const { key } = await api("auth/login/", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
  const token = `Token ${key}`;

  step("organisation, project, environment");
  const orgs = await api("organisations/", { token });
  const org =
    (orgs.results ?? orgs).find((o) => o.name === "Doctor Lab") ??
    (await api("organisations/", { method: "POST", token, body: { name: "Doctor Lab" } }));
  const projects = await api(`projects/?organisation=${org.id}`, { token });
  const project =
    projects.find((p) => p.name === "checkout-lab") ??
    (await api("projects/", { method: "POST", token, body: { name: "checkout-lab", organisation: org.id } }));
  const envs = await api(`environments/?project=${project.id}`, { token });
  const env =
    (envs.results ?? envs).find((e) => e.name === "Lab") ??
    (await api("environments/", { method: "POST", token, body: { name: "Lab", project: project.id } }));

  step("warehouse: Flagsmith database (events stored in this instance's PostgreSQL)");
  const warehouses = await api(`environments/${env.api_key}/warehouse-connections/`, { token });
  if (!warehouses.length) {
    await api(`environments/${env.api_key}/warehouse-connections/`, {
      method: "POST",
      token,
      body: { name: "Flagsmith database", warehouse_type: "postgres", config: { source: "flagsmith_database" } },
    });
  }

  step("multivariate flag checkout_button with a keyed one_click variant");
  const features = await api(`projects/${project.id}/features/?search=checkout_button`, { token });
  const feature =
    (features.results ?? []).find((f) => f.name === "checkout_button") ??
    (await api(`projects/${project.id}/features/`, {
      method: "POST",
      token,
      body: {
        name: "checkout_button",
        type: "MULTIVARIATE",
        initial_value: "control",
        default_enabled: true,
        multivariate_options: [{ type: "unicode", string_value: "one_click", key: "one_click", default_percentage_allocation: 0 }],
      },
    }));
  const option = (feature.multivariate_options ?? [])[0];

  step('metric "purchase" and a running 50/50 experiment');
  const metrics = await api(`environments/${env.api_key}/experiment-metrics/`, { token });
  const metric =
    (metrics.results ?? metrics).find((m) => m.definition?.event === "purchase") ??
    (await api(`environments/${env.api_key}/experiment-metrics/`, {
      method: "POST",
      token,
      body: { name: "Purchase", aggregation: "occurrence", direction: "up", definition: { version: 1, event: "purchase" } },
    }));
  const experiments = await api(`environments/${env.api_key}/experiments/`, { token });
  let experiment = (experiments.results ?? []).find((e) => e.feature === feature.id || e.feature?.id === feature.id);
  if (!experiment) {
    experiment = await api(`environments/${env.api_key}/experiments/`, {
      method: "POST",
      token,
      body: {
        feature: feature.id,
        name: "One-click checkout",
        hypothesis: "A one-click checkout button increases purchases.",
        metrics: [{ metric: metric.id, expected_direction: "increase" }],
        experiment_rollout: {
          enabled: true,
          rollout_percentage: 100,
          feature_state_value: { type: "string", value: "control" },
          multivariate_feature_state_values: [{ multivariate_feature_option: option.id, percentage_allocation: 50 }],
        },
      },
    });
  }
  if (experiment.status !== "running") {
    experiment = await api(`environments/${env.api_key}/experiments/${experiment.id}/start/`, { method: "POST", token });
  }

  step("master API key for the Flagsmith CLI");
  const master = await api(`organisations/${org.id}/master-api-keys/`, {
    method: "POST",
    token,
    body: { name: `doctor-lab-${Date.now()}`, is_admin: true },
  });

  const lab = {
    FLAGSMITH_API_URL: API,
    FLAGSMITH_API_KEY_localhost_8000: master.key,
    LAB_ENVIRONMENT_KEY: env.api_key,
    LAB_PROJECT_ID: project.id,
    LAB_ORGANISATION_ID: org.id,
    LAB_EXPERIMENT_ID: experiment.id,
    LAB_FEATURE_ID: feature.id,
  };
  writeFileSync(join(here, "lab.env"), Object.entries(lab).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  writeFileSync(
    join(here, "flagsmith.json"),
    JSON.stringify({ project: project.id, organisation: org.id, environment: env.api_key }, null, 2) + "\n",
  );

  console.log(`\n\x1b[32m✓ lab ready\x1b[0m  experiment ${experiment.id} is ${experiment.status} in environment ${env.api_key}`);
  console.log("  credentials for the CLI are in selfhost/lab.env (git-ignored)");
}

main().catch((error) => {
  console.error(`\x1b[31m✗ ${error.message}\x1b[0m`);
  process.exit(1);
});
