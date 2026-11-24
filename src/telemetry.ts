/**
 * Anonymous usage counts: which features people use and how often a pair passes, so Contrast Lab
 * can be shaped around how it's actually used. Same rules and receiver as the other Lab projects
 * (Quick Chess started it): one shared `lab_events` table in the UX Portfolio Supabase project.
 *
 * What is sent: an event name, a few small values (which mode, which side, a pass or fail), and
 * a random id for this visit (new every tab, nothing stored between visits). Never colors,
 * images, typed text, IP-derived data or a device fingerprint.
 *
 * Sent only from the live site (jayfox.design). Local builds, previews and tests send nothing,
 * unless VITE_TELEMETRY_URL is set at build time. Always off when the browser sends Do Not Track
 * or Global Privacy Control.
 */

export type EventName = "app_open" | "mode_change" | "pair_checked" | "action";

export type Props = Record<string, string | number | boolean | null>;

const LAB_RECEIVER = "https://ctjtaupulyxefuyeromj.supabase.co/functions/v1/lab-events";
const OVERRIDE: string | undefined = import.meta.env.VITE_TELEMETRY_URL;
const VERSION = 1;
const LIVE_HOST = /(^|\.)jayfox\.design$/;

function optedOut(): boolean {
  if (typeof navigator === "undefined") return true;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

let visit: string | null = null;
function visitId(): string {
  if (!visit) {
    visit =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
  }
  return visit;
}

function isLive(): boolean {
  return typeof location !== "undefined" && LIVE_HOST.test(location.hostname);
}

/** Where counts go from a page on this host, or nowhere. */
export function endpointFor(hostname: string, override = OVERRIDE): string | undefined {
  return override || (LIVE_HOST.test(hostname) ? LAB_RECEIVER : undefined);
}

/**
 * Where this visit came from, coarsely: the Lab page, elsewhere on jayfox.design, another site,
 * or nowhere (typed in, a bookmark, an app). Only this word is sent, never the address.
 */
export function arrivedFrom(referrer: string): "lab" | "site" | "other" | "direct" {
  if (!referrer) return "direct";
  try {
    const ref = new URL(referrer);
    if (!LIVE_HOST.test(ref.hostname)) return "other";
    return /^\/lab\/?$/.test(ref.pathname) ? "lab" : "site";
  } catch {
    return "direct";
  }
}

/** A ratio as a coarse band, so counts show "how far off" without recording the pair. */
export function ratioBand(ratio: number): string {
  if (ratio < 3) return "under_3";
  if (ratio < 4.5) return "3_to_4.5";
  if (ratio < 7) return "4.5_to_7";
  return "7_plus";
}

export function track(event: EventName, props: Props = {}) {
  if (import.meta.env.DEV) console.debug("[contrast-lab telemetry]", event, props);
  const endpoint = endpointFor(typeof location === "undefined" ? "" : location.hostname);
  if (!endpoint || optedOut()) return;
  const body = JSON.stringify({
    app: "contrast-lab",
    v: VERSION,
    event,
    props,
    visit: visitId(),
    live: isLive(),
    // Coarse screen class only, to tell phone from desktop use.
    screen: typeof window !== "undefined" && window.innerWidth < 860 ? "narrow" : "wide",
  });
  try {
    // Plain text, so the beacon needs no CORS preflight; the receiver parses the JSON.
    const blob = new Blob([body], { type: "text/plain" });
    if (navigator.sendBeacon?.(endpoint, blob)) return;
    void fetch(endpoint, { method: "POST", body, keepalive: true, mode: "no-cors" });
  } catch {
    // Counting is best effort: never let it get in the way of the tool.
  }
}

/** Shorthand for the "action" event: one name plus a few small values. */
export function action(name: string, props: Props = {}) {
  track("action", { name, ...props });
}
