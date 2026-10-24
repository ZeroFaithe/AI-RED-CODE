/**
 * Cross-check Desk — deterministic per (reportId, round, channel).
 *
 * Channels:
 *   official  — PAGASA / MDRRMO / LGU hotline. Accurate but can be stale.
 *   news      — Radio / TV / online. Lags one round.
 *   social    — Social media search. Echoes origin, may inflate false claims (circular).
 *   barangay  — Phone call to barangay. Reliable, but unavailable in round 5.
 *
 * "Independent corroboration" = agreement from ≥ 2 channels with DIFFERENT origins.
 * Social always counts as circular (same origin chain), so it NEVER qualifies alone.
 */

import type { CheckChannel, CrossCheckResult, Report } from './types';
import { STALE_OFFICIAL_SERIES } from './scenario';

const LABELS: Record<CheckChannel, string> = {
  official: '📋 Official (PAGASA / MDRRMO / LGU hotline)',
  news:     '📰 News (radio, TV, online)',
  social:   '📱 Social media search',
  barangay: '📞 Barangay contact (phone call)',
};

/**
 * Pure, deterministic cross-check.
 * @param report  The report being cross-checked.
 * @param round   Current round number (1-5).
 * @param channel Which channel to query.
 */
export function crosscheck(report: Report, round: number, channel: CheckChannel): CrossCheckResult {
  const base: Omit<CrossCheckResult, 'summary' | 'cf' | 'independent' | 'stale' | 'circular' | 'unavailable'> = {
    channel,
    label: LABELS[channel],
    rd: round,
  };

  // ── OFFICIAL channel ────────────────────────────────────────────────────────
  if (channel === 'official') {
    // Stale advisory series: official desk has no updated record
    if (STALE_OFFICIAL_SERIES.has(report.id)) {
      return {
        ...base,
        summary: `The official hotline says: "No new record for this advisory. The last entry in this series (${report.id}) is from ${report.age >= 60 ? Math.floor(report.age / 60) + ' hour(s)' : report.age + ' min'} ago and has not been updated." This does NOT confirm the current situation.`,
        cf: 30,
        independent: true,    // different origin from the report itself
        stale: true,
        circular: false,
        unavailable: false,
      };
    }
    // Reports that came FROM an official source — the desk can confirm directly
    if (report.k === 'official') {
      return {
        ...base,
        summary: `Official records confirm this report is on file and was issued by ${report.src}. The information is ${report.age >= 120 ? 'potentially stale (' + Math.floor(report.age / 60) + ' h old)' : 'relatively recent (' + report.age + ' min old)'}.`,
        cf: report.t ? 80 : 50,   // lower confidence if report is false (official issued wrong info)
        independent: true,
        stale: report.age >= 480,
        circular: false,
        unavailable: false,
      };
    }
    // Social / resident reports — official desk may or may not have heard
    if (report.k === 'social') {
      return {
        ...base,
        summary: `Official desk has ${report.t ? 'received similar reports and is monitoring the area' : 'no corroborating data for this claim'}. Social media posts are not official records.`,
        cf: report.t ? 65 : 20,
        independent: true,
        stale: false,
        circular: false,
        unavailable: false,
      };
    }
    // Resident / drone / other — cross-reference
    return {
      ...base,
      summary: report.t
        ? `Official monitoring data for this area is consistent with the reported situation.`
        : `Official records do not support this claim. No matching alert has been issued for this area at this time.`,
      cf: report.t ? 75 : 25,
      independent: true,
      stale: false,
      circular: false,
      unavailable: false,
    };
  }

  // ── NEWS channel ────────────────────────────────────────────────────────────
  if (channel === 'news') {
    // News lags one round — events from the current round haven't been covered yet
    if (report.rd >= round) {
      return {
        ...base,
        summary: `No coverage yet. News outlets typically confirm events one round after they are reported. Check back next round.`,
        cf: 0,
        independent: true,
        stale: false,
        circular: false,
        unavailable: false,
      };
    }
    // Older events that news could have covered
    return {
      ...base,
      summary: report.t
        ? `Multiple news sources (radio and online) have reported this story. It matches the field situation.`
        : `News outlets have found this claim to be unsubstantiated. No follow-up coverage was published.`,
      cf: report.t ? 72 : 15,
      independent: true,
      stale: report.age >= 480,
      circular: false,
      unavailable: false,
    };
  }

  // ── SOCIAL channel ──────────────────────────────────────────────────────────
  if (channel === 'social') {
    // Social search always echoes the original post's origin group
    const shares = report.k === 'social' ? 'hundreds of' : 'some';
    return {
      ...base,
      summary: `⚠️ Social media shows ${shares} posts about this. Many people are repeating this claim — but they all trace back to the same original post (origin group ${report.g}). This is NOT independent evidence. Seeing a claim shared many times does not make it true.`,
      cf: report.t ? 40 : 40,  // same confidence whether true or false — social doesn't filter
      independent: false,   // ALWAYS circular: never qualifies as independent corroboration
      stale: false,
      circular: true,
      unavailable: false,
    };
  }

  // ── BARANGAY CONTACT channel ────────────────────────────────────────────────
  // (channel === 'barangay')
  if (round >= 5) {
    return {
      ...base,
      summary: `📵 Cannot reach the barangay. Cell towers and landlines are down in round 5 due to the storm. Try the official channel or amateur radio (Report R14) instead.`,
      cf: 0,
      independent: false,
      stale: false,
      circular: false,
      unavailable: true,
    };
  }
  // Reliable: reflects ground truth
  return {
    ...base,
    summary: report.t
      ? `Barangay contact confirmed: the situation is as reported. The local captain vouches for this information.`
      : `Barangay contact says this report is ${report.k === 'social' ? 'a social media exaggeration' : 'incorrect or outdated'}. Conditions on the ground do not match.`,
    cf: report.t ? 90 : 10,
    independent: true,
    stale: false,
    circular: false,
    unavailable: false,
  };
}

/**
 * Returns true when the list of cross-check results constitutes "independent corroboration":
 * at least two results that are NOT circular (not social echo) and ARE independent,
 * both agreeing that the claim is plausible (cf > 50).
 */
export function isCorroborated(results: CrossCheckResult[]): boolean {
  const valid = results.filter(r => r.independent && !r.circular && !r.unavailable && r.cf > 50);
  return valid.length >= 2;
}

/**
 * Returns true when the cross-check results contain credible contradictory evidence:
 * at least one independent, non-circular result with cf < 40 (low confidence = claim not supported).
 */
export function hasContradiction(results: CrossCheckResult[]): boolean {
  return results.some(r => r.independent && !r.circular && !r.unavailable && r.cf < 40);
}
