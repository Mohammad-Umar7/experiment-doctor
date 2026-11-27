import { describe, expect, it } from 'vitest';
import { diagnose } from '../src/diagnose';
import { renderHtmlReport } from '../src/report/html';
import { appWith, healthyEvidence } from './fixtures';

describe('renderHtmlReport', () => {
  it('renders a self-contained dark report with the pipeline and the patch', () => {
    const report = diagnose(
      appWith(`import flagsmith from '@flagsmith/flagsmith';
export async function go(user) {
  await flagsmith.init({ environmentID: 'aB3dE5fG7hJ9kL1mN3pQ5r', enableEvents: true });
  await flagsmith.identify(user.id);
  flagsmith.getExperimentFlag('checkout_button');
  flagsmith.trackEvent('Purchase');
}
window.addEventListener('pagehide', () => flagsmith.flushEvents());`),
    );
    const html = renderHtmlReport(report);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('#090B0F');
    expect(html).toContain('Repair required');
    expect(html).toContain('Primary finding');
    expect(html).toContain('<span class="del">-   flagsmith.trackEvent(&#39;Purchase&#39;);</span>');
    expect(html).toContain('aria-label="Pipeline"');
    expect(html).not.toMatch(/<script|<link|https:\/\/fonts/);
    expect(html).not.toContain('aB3dE5fG7hJ9kL1mN3pQ5r');
  });

  it('only shows green for a verified healthy report', () => {
    expect(renderHtmlReport(diagnose(healthyEvidence()))).toContain('Heartbeat: healthy');
    const ev = healthyEvidence();
    ev.config = null;
    const html = renderHtmlReport(diagnose(ev));
    expect(html).toContain('Not verifiable');
    expect(html).toContain('Flatline');
  });

  it('escapes HTML from evidence', () => {
    const report = diagnose(healthyEvidence());
    report.summary = '<img src=x onerror=alert(1)>';
    expect(renderHtmlReport(report)).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
