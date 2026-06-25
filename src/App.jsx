// src/App.jsx
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Tv2, Eye, BarChart2, Trophy, Swords, Bell, User, LogOut,
  CheckCircle2, Radio, Clock, ChevronRight, Lock, AlertTriangle,
  Calendar, TrendingUp, Utensils, Medal, Award, X,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { computePoints } from "./points";

const POLL_INTERVAL_MS = 60_000;
const POLL_LIVE_MS     = 30_000;
const VAPID_PUBLIC_KEY = "BOqrM10PSHR99vvl1inYy4u3_w0BwkmxJ_nAKhux62ljmhRV4wXdS9Dkf24uj4h3z7T75VHskk5pHnmByKequd4";

// ─── RESPONSIVE ──────────────────────────────────────────────────────────────

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

// ─── UTILITAIRES ─────────────────────────────────────────────────────────────

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit",
  });
}

function formatPronoTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function timeUntil(iso) {
  const diff = new Date(iso) - Date.now();
  if (diff <= 0) return null;
  const days = Math.floor(diff / 86_400_000);
  const h    = Math.floor((diff % 86_400_000) / 3_600_000);
  const m    = Math.floor((diff % 3_600_000) / 60_000);
  const s    = Math.floor((diff % 60_000) / 1_000);
  if (days > 0) return `dans ${days}j ${h}h${String(m).padStart(2,"0")}`;
  if (h > 0)    return `dans ${h}h${String(m).padStart(2,"0")}`;
  if (m > 0)    return `dans ${m}m${String(s).padStart(2,"0")}s`;
  return `dans ${s}s`;
}

function isGroupStage(stage) {
  return stage === "GROUP_STAGE";
}

function stageLabel(stage) {
  const map = {
    "GROUP_STAGE":    "Phase de poules",
    "LAST_32":        "16èmes de finale",
    "LAST_16":        "8èmes de finale",
    "QUARTER_FINALS": "Quarts de finale",
    "SEMI_FINALS":    "Demi-finales",
    "THIRD_PLACE":    "Petite finale",
    "FINAL":          "Finale",
  };
  return map[stage] || stage || "";
}

function groupLabel(group) {
  if (!group) return "";
  return group.replace(/^GROUP[_-]?/i, "Groupe ");
}

function teamCode(team) {
  if (!team) return "TBD";
  return team.tla || team.shortName?.slice(0, 3).toUpperCase() || "TBD";
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "mc2026salt");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ─── NOTIFICATIONS ───────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (e) { return null; }
}

async function subscribeToPush(participantId) {
  const reg = await registerServiceWorker();
  if (!reg) return false;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;
  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    await supabase.from("push_subscriptions").upsert(
      { participant_id: participantId, subscription: sub.toJSON() },
      { onConflict: "participant_id" }
    );
    return true;
  } catch (e) { return false; }
}

async function unsubscribeFromPush(participantId) {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  await supabase.from("push_subscriptions").delete().eq("participant_id", participantId);
}

// ─── HOOKS ───────────────────────────────────────────────────────────────────

function useMatches() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetchMatches = useCallback(async () => {
    try {
      const res = await fetch("/api/matches");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { matches } = await res.json();
      setMatches(matches || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMatches(); }, [fetchMatches]);

  useEffect(() => {
    const hasLive = matches.some(m => m.status === "live");
    const timer = setInterval(fetchMatches, hasLive ? POLL_LIVE_MS : POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [matches, fetchMatches]);

  return { matches, loading, error };
}

function usePronostics(participantId) {
  const [pronostics, setPronostics] = useState({});

  const loadPronostics = useCallback(async () => {
    if (!participantId) return;
    const { data } = await supabase
      .from("pronostics")
      .select("match_id, home_score, away_score")
      .eq("participant_id", participantId);
    if (data) {
      const map = {};
      data.forEach(p => { map[p.match_id] = p; });
      setPronostics(map);
    }
  }, [participantId]);

  useEffect(() => { loadPronostics(); }, [loadPronostics]);

  const savePronostic = useCallback(async (matchId, homeScore, awayScore) => {
    if (!participantId) return false;
    const { error } = await supabase.from("pronostics").upsert(
      { participant_id: participantId, match_id: matchId, home_score: homeScore, away_score: awayScore },
      { onConflict: "participant_id,match_id" }
    );
    if (!error) {
      setPronostics(prev => ({ ...prev, [matchId]: { home_score: homeScore, away_score: awayScore } }));
    }
    return !error;
  }, [participantId]);

  return { pronostics, savePronostic };
}

function useLeaderboardData() {
  const [data, setData] = useState({ participants: [], allPronostics: [] });

  const refresh = useCallback(async () => {
    const [{ data: parts }, { data: pronos }] = await Promise.all([
      supabase.from("participants").select("id, name"),
      supabase.from("pronostics").select("participant_id, match_id, home_score, away_score, updated_at"),
    ]);
    setData({ participants: parts || [], allPronostics: pronos || [] });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return data;
}

function useNotifications(participant, matches, pronostics) {
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);

  useEffect(() => {
    const check = async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      setNotifEnabled(!!sub);
    };
    check();
  }, []);

  useEffect(() => {
    matches.filter(m => m.status === "finished").forEach(m => {
      localStorage.removeItem(`notif_sent_${m.id}`);
    });
  }, [matches]);

  useEffect(() => {
    if (!notifEnabled || !participant) return;
    matches.filter(m => m.status === "upcoming").forEach(m => {
      const diff = new Date(m.kickoff) - Date.now();
      const hasProno = !!pronostics[m.id];
      const key = `notif_sent_${m.id}`;
      if (diff > 0 && diff <= 3_600_000 && !hasProno && !localStorage.getItem(key)) {
        localStorage.setItem(key, "1");
        if (Notification.permission === "granted") {
          navigator.serviceWorker.ready.then(reg => {
            reg.showNotification("Match bientôt !", {
              body: `${m.home.shortName || m.home.name} vs ${m.away.shortName || m.away.name} — pense à pronostiquer !`,
              icon: "/icon.png", data: { url: "/" },
            });
          });
        }
      }
    });
  }, [matches, pronostics, notifEnabled, participant]);

  const toggle = async () => {
    if (!participant) return;
    setNotifLoading(true);
    if (notifEnabled) {
      await unsubscribeFromPush(participant.id);
      setNotifEnabled(false);
    } else {
      const ok = await subscribeToPush(participant.id);
      setNotifEnabled(ok);
    }
    setNotifLoading(false);
  };

  return { notifEnabled, notifLoading, toggle };
}

// ─── SHARED UI ───────────────────────────────────────────────────────────────

function FilterBar({ options, active, onChange, labelFn }) {
  return (
    <div style={{ overflowX: "auto", paddingBottom: 8, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 6, minWidth: "max-content" }}>
        {options.map(o => (
          <button key={o} onClick={() => onChange(o)} style={{
            background: active === o ? "#d97706" : "#111827",
            color: active === o ? "#fff" : "#9ca3af",
            border: `1px solid ${active === o ? "#d97706" : "#1f2937"}`,
            borderRadius: 99, padding: "5px 14px",
            fontSize: 12, fontWeight: 700, cursor: "pointer",
            whiteSpace: "nowrap", transition: "all .15s",
          }}>{labelFn ? labelFn(o) : o}</button>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, label, color, count }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, marginTop: 4 }}>
      <Icon size={14} color={color || "#d97706"} />
      <span style={{ fontWeight: 800, fontSize: 11, color: color || "#d97706", letterSpacing: 2, textTransform: "uppercase" }}>
        {label}
      </span>
      {count !== undefined && (
        <span style={{ fontSize: 11, color: "#4b5563", fontWeight: 500 }}>({count})</span>
      )}
    </div>
  );
}

function StatusBadge({ status, minute }) {
  if (status === "live") return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#7f1d1d", color: "#fca5a5", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, letterSpacing: 1 }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#f87171", animation: "pulse 1s infinite" }} />
      LIVE {minute ? `${minute}'` : ""}
    </span>
  );
  if (status === "finished") return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#0d1117", color: "#6b7280", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>
      <CheckCircle2 size={9} /> Terminé
    </span>
  );
  return null;
}

function ScoreTag({ pts }) {
  if (pts === null || pts === undefined) return null;
  const cfg = pts === 3
    ? { c: "#22c55e", bg: "#052e16", l: "Score exact" }
    : pts === 1
    ? { c: "#f59e0b", bg: "#2d1d00", l: "Tendance" }
    : { c: "#6b7280", bg: "#0d1117", l: "Raté" };
  return (
    <span style={{ background: cfg.bg, color: cfg.c, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, border: `1px solid ${cfg.c}33` }}>
      {cfg.l} · +{pts}pts
    </span>
  );
}

// ─── MATCH CARD ──────────────────────────────────────────────────────────────

function MatchCard({ match, pronostic, onSave, onViewPronos, compact }) {
  const kickedOff = new Date(match.kickoff) <= new Date();
  const locked    = match.status === "live" || match.status === "finished" || kickedOff;
  const [h, setH]           = useState(pronostic?.home_score ?? "");
  const [a, setA]           = useState(pronostic?.away_score ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [, setTick]         = useState(0);
  const [liveSec, setLiveSec] = useState(0);

  useEffect(() => {
    if (match.status !== "upcoming" && match.status !== "live") return;
    const iv = setInterval(() => {
      setTick(t => t + 1);
      if (match.status === "live") setLiveSec(s => s + 1);
    }, 1000);
    return () => clearInterval(iv);
  }, [match.status]);

  useEffect(() => {
    if (match.status === "live") setLiveSec(0);
  }, [match.minute, match.status]);

  useEffect(() => {
    if (pronostic) { setH(pronostic.home_score); setA(pronostic.away_score); }
  }, [pronostic]);

  const pts = match.status === "finished" && pronostic && match.score
    ? computePoints(pronostic, match.score) : null;

  const handleSave = async () => {
    if (isNaN(+h) || isNaN(+a) || +h < 0 || +a < 0) return;
    setSaving(true);
    const ok = await onSave(match.id, +h, +a);
    setSaving(false);
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  const canSave = h !== "" && a !== "" && !isNaN(+h) && !isNaN(+a) && +h >= 0 && +a >= 0 && !locked;
  const missingProno = match.status === "upcoming" && !kickedOff && !pronostic;

  return (
    <div style={{
      background: match.status === "live"
        ? "linear-gradient(135deg,#180a0a,#1f1215)"
        : "linear-gradient(135deg,#111827,#1a1f2e)",
      border: `1px solid ${match.status === "live" ? "#7f1d1d" : missingProno ? "#451a03" : "#1f2937"}`,
      borderRadius: 12,
      padding: compact ? "12px 14px" : "16px 18px",
      marginBottom: 0,
      boxShadow: match.status === "live" ? "0 0 18px rgba(248,113,113,.12)" : "none",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>
          {isGroupStage(match.stage) ? groupLabel(match.group) : stageLabel(match.stage)}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {missingProno && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "#d97706", fontWeight: 700, background: "#2d1d00", padding: "2px 6px", borderRadius: 99 }}>
              <AlertTriangle size={9} /> À pronostiquer
            </span>
          )}
          <StatusBadge status={match.status} minute={match.minute} />
          {match.status === "upcoming" && !kickedOff && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "#6b7280", background: "#0d1117", padding: "2px 7px", borderRadius: 99 }}>
              <Clock size={9} /> {formatTime(match.kickoff)}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, textAlign: "right" }}>
          {match.home.crest
            ? <img src={match.home.crest} alt="" style={{ width: compact ? 28 : 36, height: compact ? 28 : 36, objectFit: "contain" }} />
            : <span style={{ fontSize: compact ? 20 : 26 }}>🏳️</span>}
          <div style={{ fontWeight: 700, color: "#e5e7eb", fontSize: compact ? 11 : 13, marginTop: 4 }}>
            {match.home.shortName || match.home.name}
          </div>
        </div>

        <div style={{ textAlign: "center", minWidth: compact ? 72 : 88 }}>
          {match.score ? (
            <div style={{ fontSize: compact ? 24 : 30, fontWeight: 900, color: "#f9fafb", fontFamily: "monospace", letterSpacing: 2 }}>
              {match.score.home}<span style={{ color: "#374151" }}>–</span>{match.score.away}
            </div>
          ) : (
            <div style={{ fontSize: compact ? 18 : 22, color: "#4b5563", fontFamily: "monospace" }}>–</div>
          )}
          {match.status === "live" && match.minute !== null && match.minute !== undefined && (
            <div style={{
              display: "inline-block",
              marginTop: 6,
              background: "#052e16",
              color: "#4ade80",
              padding: "3px 10px",
              borderRadius: 6,
              fontSize: compact ? 12 : 14,
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              letterSpacing: 1,
            }}>
              {String(match.minute + Math.floor(liveSec / 60)).padStart(2, "0")}
              <span style={{ opacity: 0.6 }}>:</span>
              {String(liveSec % 60).padStart(2, "0")}
            </div>
          )}
          {match.status === "upcoming" && timeUntil(match.kickoff) && (
            <div style={{ fontSize: 10, color: "#d97706", fontWeight: 600, marginTop: 2 }}>{timeUntil(match.kickoff)}</div>
          )}
        </div>

        <div style={{ flex: 1, textAlign: "left" }}>
          {match.away.crest
            ? <img src={match.away.crest} alt="" style={{ width: compact ? 28 : 36, height: compact ? 28 : 36, objectFit: "contain" }} />
            : <span style={{ fontSize: compact ? 20 : 26 }}>🏳️</span>}
          <div style={{ fontWeight: 700, color: "#e5e7eb", fontSize: compact ? 11 : 13, marginTop: 4 }}>
            {match.away.shortName || match.away.name}
          </div>
        </div>
      </div>

      {!compact && (
        <div style={{ textAlign: "center", fontSize: 11, color: "#4b5563", marginTop: 6 }}>
          {formatDate(match.kickoff)}
        </div>
      )}

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #1f2937", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#6b7280" }}>Mon prono :</span>
          {locked ? (
            pronostic ? (
              <>
                <span style={{ fontWeight: 800, fontSize: compact ? 14 : 18, color: "#e5e7eb", fontFamily: "monospace" }}>
                  {pronostic.home_score} – {pronostic.away_score}
                </span>
                {pts !== null && <ScoreTag pts={pts} />}
              </>
            ) : (
              <span style={{ fontSize: 11, color: "#4b5563", fontStyle: "italic" }}>Aucun</span>
            )
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {[{ val: h, set: setH }, { val: a, set: setA }].map((inp, i) => (
                <input key={i} type="number" min="0" max="20" value={inp.val}
                  onChange={e => inp.set(e.target.value)}
                  style={{
                    width: 38, textAlign: "center", background: "#1f2937",
                    border: "1px solid #374151", borderRadius: 6, color: "#f9fafb",
                    fontSize: 16, fontWeight: 800, padding: "3px 0",
                    fontFamily: "monospace", outline: "none",
                  }}
                />
              ))}
              <button onClick={handleSave} disabled={!canSave || saving} style={{
                background: canSave ? (saved ? "#16a34a" : "#d97706") : "#374151",
                color: canSave ? "#fff" : "#6b7280",
                border: "none", borderRadius: 6, padding: "4px 10px",
                fontSize: 11, fontWeight: 700, cursor: canSave ? "pointer" : "not-allowed",
              }}>
                {saving ? "…" : saved ? "✓" : "Valider"}
              </button>
            </div>
          )}
        </div>

        <button onClick={() => onViewPronos(match.id)} style={{
          display: "flex", alignItems: "center", gap: 4,
          background: "#0d1117", border: "1px solid #374151",
          color: "#9ca3af", borderRadius: 8, padding: "4px 10px",
          fontSize: 11, fontWeight: 600, cursor: "pointer",
        }}>
          <Eye size={11} /> Pronos
        </button>
      </div>
    </div>
  );
}

// ─── MATCHES SCREEN ──────────────────────────────────────────────────────────

const MATCHES_STAGE_MAP = {
  "16èmes": "LAST_32",
  "8èmes":  "LAST_16",
  "Quarts": "QUARTER_FINALS",
  "Demis":  "SEMI_FINALS",
  "Finale": "FINAL",
};

function MatchesScreen({ matches, pronostics, onSave, onViewPronos, loading, error, isMobile }) {
  const [filter, setFilter] = useState("Tous");
  const filters = ["Tous","J1","J2","J3","16èmes","8èmes","Quarts","Demis","Finale"];

  const filterFn = m => {
    if (filter === "Tous") return true;
    if (filter === "J1") return m.matchday === 1 && isGroupStage(m.stage);
    if (filter === "J2") return m.matchday === 2 && isGroupStage(m.stage);
    if (filter === "J3") return m.matchday === 3 && isGroupStage(m.stage);
    if (filter === "Finale") return m.stage === "FINAL" || m.stage === "THIRD_PLACE";
    return m.stage === MATCHES_STAGE_MAP[filter];
  };

  const sorted = [...matches].sort((a, b) => {
    const order = { live: 0, upcoming: 1, finished: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    if (a.status === "upcoming") return new Date(a.kickoff) - new Date(b.kickoff);
    if (a.status === "finished") return new Date(b.kickoff) - new Date(a.kickoff);
    return 0;
  }).filter(filterFn);

  const live     = sorted.filter(m => m.status === "live");
  const upcoming = sorted.filter(m => m.status === "upcoming" && isGroupStage(m.stage));
  const knockout = sorted.filter(m => m.status !== "finished" && !isGroupStage(m.stage));
  const finished = sorted.filter(m => m.status === "finished");

  const upByDay = {};
  upcoming.forEach(m => { const d = m.matchday || 1; if (!upByDay[d]) upByDay[d]=[]; upByDay[d].push(m); });
  const finByDay = {};
  finished.forEach(m => { const d = m.matchday || 1; if (!finByDay[d]) finByDay[d]=[]; finByDay[d].push(m); });
  const knockByStage = {};
  knockout.forEach(m => { if (!knockByStage[m.stage]) knockByStage[m.stage]=[]; knockByStage[m.stage].push(m); });

  const grid = isMobile
    ? { display: "flex", flexDirection: "column", gap: 8 }
    : { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };

  return (
    <div>
      <FilterBar options={filters} active={filter} onChange={setFilter} />
      {loading && <div style={{ color: "#6b7280", textAlign: "center", padding: 40 }}>Chargement…</div>}
      {error && <div style={{ color: "#f87171", textAlign: "center", padding: 20, fontSize: 14 }}>Erreur : {error}</div>}

      {live.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle icon={Radio} label="En direct" color="#f87171" count={live.length} />
          <div style={grid}>
            {live.map(m => <MatchCard key={m.id} match={m} pronostic={pronostics[m.id]} onSave={onSave} onViewPronos={onViewPronos} compact={isMobile} />)}
          </div>
        </div>
      )}

      {Object.entries(upByDay).map(([day, ms]) => (
        <div key={day} style={{ marginBottom: 20 }}>
          <SectionTitle icon={Calendar} label={`Journée ${day}`} count={ms.length} />
          <div style={grid}>
            {ms.map(m => <MatchCard key={m.id} match={m} pronostic={pronostics[m.id]} onSave={onSave} onViewPronos={onViewPronos} compact={isMobile} />)}
          </div>
        </div>
      ))}

      {Object.entries(knockByStage).map(([stage, ms]) => (
        <div key={stage} style={{ marginBottom: 20 }}>
          <SectionTitle icon={Swords} label={stageLabel(stage)} color="#a78bfa" count={ms.length} />
          <div style={grid}>
            {ms.map(m => <MatchCard key={m.id} match={m} pronostic={pronostics[m.id]} onSave={onSave} onViewPronos={onViewPronos} compact={isMobile} />)}
          </div>
        </div>
      ))}

      {Object.entries(finByDay).map(([day, ms]) => (
        <div key={day} style={{ marginBottom: 20 }}>
          <SectionTitle icon={CheckCircle2} label={`Journée ${day} — Terminés`} color="#4b5563" count={ms.length} />
          <div style={grid}>
            {ms.map(m => <MatchCard key={m.id} match={m} pronostic={pronostics[m.id]} onSave={onSave} onViewPronos={onViewPronos} compact={isMobile} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── PRONOS SCREEN ───────────────────────────────────────────────────────────

function PronosScreen({ matches, currentUser, selectedMatchId, onClearFilter, isMobile }) {
  const [allPronostics, setAllPronostics] = useState([]);
  const [participants, setParticipants]   = useState([]);
  const [selectedMatch, setSelectedMatch] = useState(selectedMatchId || null);
  const [loading, setLoading]             = useState(true);
  const [filter, setFilter]               = useState("Tous");
  const filters = ["Tous","En cours","À venir","Terminés","J1","J2","J3","Phase finale"];

  useEffect(() => {
    if (selectedMatchId) setSelectedMatch(selectedMatchId);
  }, [selectedMatchId]);

  useEffect(() => {
    const load = async () => {
      const [{ data: parts }, { data: pronos }] = await Promise.all([
        supabase.from("participants").select("id, name").order("name"),
        supabase.from("pronostics").select("participant_id, match_id, home_score, away_score, updated_at"),
      ]);
      setParticipants(parts || []);
      setAllPronostics(pronos || []);
      setLoading(false);
    };
    load();
  }, []);

  const getProno = (participantId, matchId) =>
    allPronostics.find(p => p.participant_id === participantId && p.match_id === matchId);

  const filterMatch = m => {
    const kickedOff = new Date(m.kickoff) <= new Date();
    if (filter === "En cours") return m.status === "live";
    if (filter === "À venir") return m.status === "upcoming" && !kickedOff;
    if (filter === "Terminés") return m.status === "finished";
    if (filter === "J1") return m.matchday === 1;
    if (filter === "J2") return m.matchday === 2;
    if (filter === "J3") return m.matchday === 3;
    if (filter === "Phase finale") return !isGroupStage(m.stage);
    return true;
  };

  const relevantMatches = matches
    .filter(filterMatch)
    .sort((a, b) => {
      const order = { live: 0, upcoming: 1, finished: 2 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      if (a.status === "upcoming") return new Date(a.kickoff) - new Date(b.kickoff);
      return new Date(b.kickoff) - new Date(a.kickoff);
    });

  const active = selectedMatch
    ? relevantMatches.filter(m => m.id === selectedMatch)
    : relevantMatches;

  const pronoGrid = isMobile
    ? { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8 }
    : { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10 };

  const PronoCard = ({ name, prono, isMe, matchFinished, matchScore }) => {
    const pts = matchFinished && matchScore && prono ? computePoints(prono, matchScore) : null;
    return (
      <div style={{
        background: isMe ? "rgba(217,119,6,.1)" : "#0d1117",
        border: `1px solid ${isMe ? "#d97706" : "#1f2937"}`,
        borderRadius: 10, padding: "12px",
      }}>
        <div style={{ fontSize: 11, color: isMe ? "#fbbf24" : "#9ca3af", fontWeight: isMe ? 800 : 500, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
          {isMe && <User size={10} />}{name}
        </div>
        <div style={{ fontWeight: 900, color: "#f9fafb", fontFamily: "monospace", fontSize: 20, marginBottom: 4 }}>
          {prono.home_score} – {prono.away_score}
        </div>
        <div style={{ fontSize: 10, color: "#4b5563", marginBottom: pts !== null ? 6 : 0, display: "flex", alignItems: "center", gap: 3 }}>
          <Clock size={9} /> {formatPronoTime(prono.updated_at)}
        </div>
        {pts !== null && <ScoreTag pts={pts} />}
      </div>
    );
  };

  const UpcomingBlock = ({ m }) => {
    const pronoCount = allPronostics.filter(p => p.match_id === m.id).length;
    const hasMyProno = allPronostics.some(p => p.match_id === m.id && participants.find(x => x.name === currentUser)?.id === p.participant_id);
    return (
      <div style={{ background: "linear-gradient(135deg,#111827,#1a1f2e)", border: "1px solid #1f2937", borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          {m.home.crest
            ? <img src={m.home.crest} alt="" style={{ width: 22, height: 22, objectFit: "contain" }} />
            : <span>🏳️</span>}
          <span style={{ fontWeight: 700, color: "#e5e7eb", fontSize: 13 }}>{m.home.shortName || m.home.name}</span>
          <span style={{ color: "#6b7280", fontSize: 12 }}>vs</span>
          <span style={{ fontWeight: 700, color: "#e5e7eb", fontSize: 13 }}>{m.away.shortName || m.away.name}</span>
          {m.away.crest
            ? <img src={m.away.crest} alt="" style={{ width: 22, height: 22, objectFit: "contain" }} />
            : <span>🏳️</span>}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "#6b7280" }}>{formatDate(m.kickoff)}</span>
        </div>
        <div style={{ background: "#0d1117", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#6b7280", marginBottom: 8 }}>
            <Lock size={10} /> Pronostics révélés au coup d'envoi · {pronoCount}/{participants.length} déposés
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {participants.map(p => {
              const done = allPronostics.some(x => x.match_id === m.id && x.participant_id === p.id);
              return (
                <div key={p.id} style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: done ? "#052e16" : "#111827",
                  border: `1px solid ${done ? "#22c55e33" : "#1f2937"}`,
                  borderRadius: 99, padding: "3px 8px",
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: done ? "#22c55e" : "#4b5563", flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: done ? "#22c55e" : "#6b7280", fontWeight: done ? 700 : 400 }}>{p.name}</span>
                </div>
              );
            })}
          </div>
          {!hasMyProno && (
            <div style={{ marginTop: 8, padding: "7px 10px", background: "#2d1d00", borderRadius: 8, fontSize: 11, color: "#d97706", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
              <AlertTriangle size={11} /> Tu n'as pas encore pronostiqué ce match !
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading) return <div style={{ color: "#6b7280", textAlign: "center", padding: 40 }}>Chargement…</div>;

  return (
    <div>
      <FilterBar options={filters} active={filter} onChange={f => { setFilter(f); setSelectedMatch(null); onClearFilter?.(); }} />

      {relevantMatches.length > 0 && (
        <div style={{ overflowX: "auto", paddingBottom: 8, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 6, minWidth: "max-content" }}>
            <button onClick={() => { setSelectedMatch(null); onClearFilter?.(); }} style={{
              background: !selectedMatch ? "#d97706" : "#111827",
              color: !selectedMatch ? "#fff" : "#9ca3af",
              border: `1px solid ${!selectedMatch ? "#d97706" : "#1f2937"}`,
              borderRadius: 8, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer",
            }}>Tous</button>
            {relevantMatches.map(m => (
              <button key={m.id} onClick={() => setSelectedMatch(m.id === selectedMatch ? null : m.id)} style={{
                background: selectedMatch === m.id ? "#d97706" : "#111827",
                color: selectedMatch === m.id ? "#fff" : "#9ca3af",
                border: `1px solid ${selectedMatch === m.id ? "#d97706" : "#1f2937"}`,
                borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}>
                {m.home.shortName || m.home.name} vs {m.away.shortName || m.away.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {active.filter(m => m.status === "live").map(m => (
        <div key={m.id} style={{ marginBottom: 24 }}>
          <SectionTitle icon={Radio} label="En direct" color="#f87171" />
          <div style={{ background: "linear-gradient(135deg,#180a0a,#1f1215)", border: "1px solid #7f1d1d", borderRadius: 12, padding: "12px 16px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {m.home.crest ? <img src={m.home.crest} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} /> : "🏳️"}
              <span style={{ fontWeight: 800, color: "#f9fafb", fontSize: 14 }}>{m.home.shortName || m.home.name}</span>
              <span style={{ fontWeight: 900, color: "#f9fafb", fontFamily: "monospace", fontSize: 22 }}>{m.score?.home} – {m.score?.away}</span>
              <span style={{ fontWeight: 800, color: "#f9fafb", fontSize: 14 }}>{m.away.shortName || m.away.name}</span>
              {m.away.crest ? <img src={m.away.crest} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} /> : "🏳️"}
              <span style={{ flex: 1 }} />
              <StatusBadge status="live" minute={m.minute} />
            </div>
          </div>
          <div style={pronoGrid}>
            {participants
              .map(p => ({ p, prono: getProno(p.id, m.id) }))
              .filter(x => x.prono)
              .sort((a, b) => new Date(a.prono.updated_at) - new Date(b.prono.updated_at))
              .map(({ p, prono }) => (
                <PronoCard key={p.id} name={p.name} prono={prono} isMe={p.name === currentUser} matchFinished={false} />
              ))}
          </div>
        </div>
      ))}

      {active.filter(m => m.status === "upcoming").length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <SectionTitle icon={Clock} label="À venir" count={active.filter(m => m.status === "upcoming").length} />
          {active.filter(m => m.status === "upcoming").map(m => <UpcomingBlock key={m.id} m={m} />)}
        </div>
      )}

      {active.filter(m => m.status === "finished").map(m => (
        <div key={m.id} style={{ marginBottom: 24 }}>
          <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 12, padding: "12px 16px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {m.home.crest ? <img src={m.home.crest} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} /> : "🏳️"}
              <span style={{ fontWeight: 700, color: "#e5e7eb", fontSize: 14 }}>{m.home.shortName || m.home.name}</span>
              <span style={{ fontWeight: 900, color: "#f9fafb", fontFamily: "monospace", fontSize: 20 }}>{m.score?.home} – {m.score?.away}</span>
              <span style={{ fontWeight: 700, color: "#e5e7eb", fontSize: 14 }}>{m.away.shortName || m.away.name}</span>
              {m.away.crest ? <img src={m.away.crest} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} /> : "🏳️"}
              <span style={{ flex: 1 }} />
              <StatusBadge status="finished" />
            </div>
            <div style={{ fontSize: 11, color: "#4b5563", marginTop: 4 }}>{formatDate(m.kickoff)}</div>
          </div>
          <div style={pronoGrid}>
            {participants
              .map(p => ({ p, prono: getProno(p.id, m.id) }))
              .sort((a, b) => {
                if (!a.prono && !b.prono) return 0;
                if (!a.prono) return 1;
                if (!b.prono) return -1;
                return new Date(a.prono.updated_at) - new Date(b.prono.updated_at);
              })
              .map(({ p, prono }) => prono ? (
                <PronoCard key={p.id} name={p.name} prono={prono} isMe={p.name === currentUser} matchFinished={true} matchScore={m.score} />
              ) : (
                <div key={p.id} style={{ background: "#0d1117", border: "1px solid #1f2937", borderRadius: 10, padding: "12px", opacity: 0.4 }}>
                  <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "#4b5563", fontStyle: "italic" }}>Aucun prono</div>
                </div>
              ))}
          </div>
        </div>
      ))}

      {active.length === 0 && (
        <div style={{ color: "#4b5563", textAlign: "center", padding: 40, fontSize: 14 }}>
          Aucun match pour cette sélection
        </div>
      )}
    </div>
  );
}

// ─── GROUP STANDINGS ─────────────────────────────────────────────────────────

function GroupStandings({ matches, isMobile }) {
  const [filter, setFilter] = useState("Tous");
  const groups = [...new Set(matches.filter(m => isGroupStage(m.stage) && m.group).map(m => m.group))].sort();
  const filters = ["Tous", ...groups];

  const visibleGroups = filter === "Tous" ? groups : [filter];

  if (!groups.length) return (
    <div style={{ color: "#4b5563", textAlign: "center", padding: 40, fontSize: 14 }}>
      Les poules apparaîtront au début de la compétition
    </div>
  );

  return (
    <div>
      <FilterBar options={filters} active={filter} onChange={setFilter} labelFn={o => o === "Tous" ? "Tous" : groupLabel(o)} />
      <div style={isMobile ? {} : { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {visibleGroups.map(group => {
          const groupMatches = matches.filter(m => m.group === group);
          const teams = {};
          groupMatches.forEach(m => {
            [m.home, m.away].forEach(team => {
              if (!teams[team.name]) teams[team.name] = { name: team.name, crest: team.crest, shortName: team.shortName, j: 0, g: 0, n: 0, p: 0, bp: 0, bc: 0, pts: 0 };
            });
            if (m.status !== "finished" || !m.score) return;
            const { home: sh, away: sa } = m.score;
            const hn = m.home.name, an = m.away.name;
            teams[hn].j++; teams[an].j++;
            teams[hn].bp += sh; teams[hn].bc += sa;
            teams[an].bp += sa; teams[an].bc += sh;
            if (sh > sa)      { teams[hn].g++; teams[hn].pts += 3; teams[an].p++; }
            else if (sh < sa) { teams[an].g++; teams[an].pts += 3; teams[hn].p++; }
            else              { teams[hn].n++; teams[hn].pts++; teams[an].n++; teams[an].pts++; }
          });
          const sorted = Object.values(teams).sort((a, b) =>
            b.pts - a.pts || (b.bp - b.bc) - (a.bp - a.bc) || b.bp - a.bp
          );
          return (
            <div key={group} style={{ marginBottom: isMobile ? 24 : 0 }}>
              <div style={{ color: "#d97706", fontWeight: 800, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>{groupLabel(group)}</div>
              <div style={{ background: "#111827", borderRadius: 12, overflow: "hidden", border: "1px solid #1f2937" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 28px 28px 28px 28px 36px 36px", gap: 2, padding: "8px 12px", borderBottom: "1px solid #1f2937" }}>
                  {["Équipe","J","G","N","P","DB","Pts"].map(h => (
                    <div key={h} style={{ fontSize: 10, color: "#4b5563", fontWeight: 700, textAlign: h === "Équipe" ? "left" : "center" }}>{h}</div>
                  ))}
                </div>
                {sorted.map((t, i) => (
                  <div key={t.name} style={{
                    display: "grid", gridTemplateColumns: "1fr 28px 28px 28px 28px 36px 36px",
                    gap: 2, padding: "10px 12px",
                    background: i < 2 ? "rgba(217,119,6,.08)" : "transparent",
                    borderBottom: i < sorted.length - 1 ? "1px solid #1a1a2e" : "none",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      {i < 2 && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#d97706", flexShrink: 0 }} />}
                      {t.crest && <img src={t.crest} alt="" style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} />}
                      <span style={{ fontWeight: 700, color: "#e5e7eb", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.shortName || t.name}
                      </span>
                    </div>
                    {[t.j, t.g, t.n, t.p].map((v, vi) => (
                      <div key={vi} style={{ textAlign: "center", fontSize: 11, color: "#9ca3af" }}>{v}</div>
                    ))}
                    <div style={{ textAlign: "center", fontSize: 11, color: "#9ca3af" }}>
                      {t.bp - t.bc > 0 ? `+${t.bp - t.bc}` : t.bp - t.bc}
                    </div>
                    <div style={{ textAlign: "center", fontSize: 12, color: "#fbbf24", fontWeight: 800 }}>{t.pts}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 8 }}>● = qualifiés · DB = différence de buts</div>
    </div>
  );
}

// ─── BRACKET (style SoFoot) ──────────────────────────────────────────────────

const KNOCKOUT_ORDER = ["LAST_32","LAST_16","QUARTER_FINALS","SEMI_FINALS","THIRD_PLACE","FINAL"];

function BracketCard({ match, pronostic, side, big }) {
  if (!match) return (
    <div style={{
      background: "#0a0f1a", border: "1px dashed #1f2937",
      borderRadius: 5, padding: "8px 7px", minHeight: 46,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <span style={{ fontSize: 10, color: "#4b5563", fontStyle: "italic" }}>—</span>
    </div>
  );

  const isLive = match.status === "live";
  const isFinished = match.status === "finished";
  const isTBD = match.home.name === "À déterminer" || match.away.name === "À déterminer";
  const pts = isFinished && pronostic && match.score ? computePoints(pronostic, match.score) : null;
  const homeWins = isFinished && match.score && match.score.home > match.score.away;
  const awayWins = isFinished && match.score && match.score.away > match.score.home;
  const draw = isFinished && match.score && match.score.home === match.score.away;

  const TeamLine = ({ team, score, isWinner }) => (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 5,
      flexDirection: side === "right" ? "row-reverse" : "row",
      minHeight: 16,
    }}>
      {team.crest
        ? <img src={team.crest} alt="" style={{ width: big ? 14 : 12, height: big ? 14 : 12, objectFit: "contain", flexShrink: 0 }} />
        : <span style={{ width: big ? 14 : 12, height: big ? 14 : 12, background: "#1f2937", borderRadius: 2, flexShrink: 0 }} />}
      <span style={{
        flex: 1,
        textAlign: side === "right" ? "right" : "left",
        fontSize: big ? 11 : 10,
        fontWeight: isWinner ? 800 : 600,
        color: isWinner ? "#fbbf24" : draw ? "#e5e7eb" : isFinished && !isWinner ? "#6b7280" : "#e5e7eb",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        letterSpacing: 0.3,
      }}>
        {teamCode(team)}
      </span>
      {score !== null && score !== undefined && (
        <span style={{
          fontSize: big ? 12 : 11,
          fontWeight: 800,
          color: isWinner ? "#fbbf24" : "#9ca3af",
          fontFamily: "monospace",
          minWidth: 10,
          textAlign: "center",
        }}>
          {score}
        </span>
      )}
    </div>
  );

  return (
    <div style={{
      background: isLive ? "#1a0a0d" : big ? "linear-gradient(180deg,#1a1100,#0d0900)" : "#0f1623",
      border: `1px solid ${isLive ? "#7f1d1d" : big ? "#d97706" : isTBD ? "rgba(31,41,55,0.5)" : "#1f2937"}`,
      borderRadius: big ? 8 : 5,
      borderStyle: isTBD ? "dashed" : "solid",
      padding: big ? "8px 10px" : "5px 7px",
      position: "relative",
      borderLeft: side === "right" && !big ? `2px solid #d97706` : undefined,
      borderRight: side === "left" && !big ? `2px solid #d97706` : undefined,
      boxShadow: big ? "0 0 20px rgba(217,119,6,0.15)" : "none",
    }}>
      {isTBD ? (
        <div style={{ fontSize: 9, color: "#4b5563", fontStyle: "italic", textAlign: "center", padding: "8px 0" }}>
          À déterminer
        </div>
      ) : (
        <>
          <TeamLine team={match.home} score={match.score?.home} isWinner={homeWins} />
          <div style={{ height: 1, background: "#1f2937", margin: "3px 0" }} />
          <TeamLine team={match.away} score={match.score?.away} isWinner={awayWins} />
        </>
      )}
      {isLive && (
        <span style={{
          position: "absolute", top: -7, left: 5,
          fontSize: 8, background: "#7f1d1d", color: "#fca5a5",
          padding: "1px 5px", borderRadius: 3, fontWeight: 800, letterSpacing: 0.5,
        }}>LIVE</span>
      )}
      {pronostic && (
        <span style={{
          position: "absolute", top: -5, right: 4,
          fontSize: 8, fontWeight: 800, color: "#fff",
          background: pts === 3 ? "#16a34a" : pts === 1 ? "#d97706" : pts === 0 ? "#4b5563" : "#d97706",
          padding: "1px 5px", borderRadius: 99, letterSpacing: 0.3,
        }} title={`Ton prono : ${pronostic.home_score}-${pronostic.away_score}`}>
          {pts === null ? "PRONO" : `+${pts}`}
        </span>
      )}
    </div>
  );
}

function BracketScreen({ matches, pronostics }) {
  const knockout = matches.filter(m => !isGroupStage(m.stage) && m.stage);
  if (!knockout.length) return (
    <div style={{ color: "#4b5563", textAlign: "center", padding: 40, fontSize: 14 }}>
      Le tableau apparaîtra à partir des 16èmes de finale
    </div>
  );

  const byStage = {};
  KNOCKOUT_ORDER.forEach(s => {
    byStage[s] = knockout
      .filter(m => m.stage === s)
      .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  });

  const finalMatch = byStage.FINAL[0];
  const thirdPlace = byStage.THIRD_PLACE[0];

  // Champion prédit (à partir du prono de l'utilisateur sur la finale)
  const finalProno = finalMatch && pronostics[finalMatch.id];
  let predictedChampion = null;
  if (finalMatch && finalProno) {
    if (+finalProno.home_score > +finalProno.away_score) predictedChampion = finalMatch.home;
    else if (+finalProno.away_score > +finalProno.home_score) predictedChampion = finalMatch.away;
  }

  // Partage gauche/droite pour la mise en bracket
  const splitHalves = (arr) => {
    const half = Math.ceil(arr.length / 2);
    return [arr.slice(0, half), arr.slice(half)];
  };
  const [r16Left, r16Right] = splitHalves(byStage.LAST_16);
  const [qfLeft, qfRight]   = splitHalves(byStage.QUARTER_FINALS);
  const sfLeft  = byStage.SEMI_FINALS[0];
  const sfRight = byStage.SEMI_FINALS[1];

  const colStyle = { display: "flex", flexDirection: "column", justifyContent: "space-around", gap: 4 };
  const centerColStyle = { display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 10 };

  return (
    <div>
      {/* Champion prédit */}
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#d97706", fontWeight: 800, marginBottom: 6 }}>
          Mon vainqueur prédit
        </div>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 10,
          background: "linear-gradient(180deg,#1a1100,#0d0900)",
          border: "1px solid #d97706", borderRadius: 8,
          padding: "10px 22px",
          boxShadow: "0 0 24px rgba(217,119,6,0.15)",
        }}>
          <Trophy size={18} color="#fbbf24" />
          {predictedChampion ? (
            <>
              {predictedChampion.crest && (
                <img src={predictedChampion.crest} alt="" style={{ width: 22, height: 22, objectFit: "contain" }} />
              )}
              <span style={{ fontWeight: 800, fontSize: 15, color: "#fbbf24", letterSpacing: 0.3 }}>
                {predictedChampion.name?.toUpperCase()}
              </span>
            </>
          ) : (
            <span style={{ color: "#6b7280", fontStyle: "italic", fontSize: 13 }}>
              {finalMatch ? "Pronostique la finale pour voir ton vainqueur" : "À déterminer"}
            </span>
          )}
        </div>
      </div>

      {/* R32 en strip horizontal si la phase commence */}
      {byStage.LAST_32.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <SectionTitle icon={Swords} label="16èmes de finale" color="#a78bfa" count={byStage.LAST_32.length} />
          <div style={{ overflowX: "auto", paddingBottom: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${byStage.LAST_32.length}, minmax(120px,1fr))`, gap: 6, minWidth: byStage.LAST_32.length * 130 }}>
              {byStage.LAST_32.map(m => (
                <BracketCard key={m.id} match={m} pronostic={pronostics[m.id]} side="left" />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bracket centré : 8èmes → Finale → 8èmes */}
      <div style={{ marginBottom: 18 }}>
        <SectionTitle icon={Trophy} label="Tableau final" color="#d97706" />
        <div style={{ overflowX: "auto" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 0.85fr 0.7fr 1.3fr 0.7fr 0.85fr 1fr",
            gap: 4, alignItems: "stretch",
            minHeight: 380,
            minWidth: 720,
          }}>
            {/* 8èmes gauche */}
            <div style={colStyle}>
              <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#4b5563", fontWeight: 700, textAlign: "center", marginBottom: 4 }}>8èmes</div>
              {r16Left.map(m => <BracketCard key={m.id} match={m} pronostic={pronostics[m.id]} side="left" />)}
              {/* Pad if less than 4 */}
              {Array.from({ length: Math.max(0, 4 - r16Left.length) }).map((_, i) => <BracketCard key={`pad-l16-${i}`} match={null} side="left" />)}
            </div>
            {/* Quarts gauche */}
            <div style={colStyle}>
              <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#4b5563", fontWeight: 700, textAlign: "center", marginBottom: 4 }}>Quarts</div>
              {qfLeft.map(m => <BracketCard key={m.id} match={m} pronostic={pronostics[m.id]} side="left" />)}
              {Array.from({ length: Math.max(0, 2 - qfLeft.length) }).map((_, i) => <BracketCard key={`pad-qfl-${i}`} match={null} side="left" />)}
            </div>
            {/* Demi gauche */}
            <div style={{ ...colStyle, justifyContent: "center" }}>
              <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#4b5563", fontWeight: 700, textAlign: "center", marginBottom: 4 }}>Demi</div>
              <BracketCard match={sfLeft} pronostic={sfLeft && pronostics[sfLeft.id]} side="left" />
            </div>
            {/* Centre : trophée + finale */}
            <div style={centerColStyle}>
              <Trophy size={30} color="#fbbf24" />
              <div style={{ width: "100%" }}>
                {finalMatch ? (
                  <div style={{
                    background: "linear-gradient(180deg,#1a1100,#0d0900)",
                    border: "2px solid #d97706",
                    borderRadius: 8,
                    padding: "10px 12px",
                    boxShadow: "0 0 24px rgba(217,119,6,0.15)",
                  }}>
                    <div style={{ fontSize: 9, letterSpacing: 2.5, textTransform: "uppercase", color: "#d97706", fontWeight: 800, textAlign: "center", marginBottom: 8 }}>
                      Finale
                    </div>
                    <BracketCard match={finalMatch} pronostic={pronostics[finalMatch.id]} side="left" big />
                    <div style={{ fontSize: 9, color: "#6b7280", marginTop: 6, textAlign: "center", letterSpacing: 0.5 }}>
                      {formatDate(finalMatch.kickoff)}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: "center", color: "#4b5563", fontSize: 11, fontStyle: "italic", padding: 20 }}>
                    Finale à venir
                  </div>
                )}
              </div>
            </div>
            {/* Demi droite */}
            <div style={{ ...colStyle, justifyContent: "center" }}>
              <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#4b5563", fontWeight: 700, textAlign: "center", marginBottom: 4 }}>Demi</div>
              <BracketCard match={sfRight} pronostic={sfRight && pronostics[sfRight.id]} side="right" />
            </div>
            {/* Quarts droite */}
            <div style={colStyle}>
              <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#4b5563", fontWeight: 700, textAlign: "center", marginBottom: 4 }}>Quarts</div>
              {qfRight.map(m => <BracketCard key={m.id} match={m} pronostic={pronostics[m.id]} side="right" />)}
              {Array.from({ length: Math.max(0, 2 - qfRight.length) }).map((_, i) => <BracketCard key={`pad-qfr-${i}`} match={null} side="right" />)}
            </div>
            {/* 8èmes droite */}
            <div style={colStyle}>
              <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#4b5563", fontWeight: 700, textAlign: "center", marginBottom: 4 }}>8èmes</div>
              {r16Right.map(m => <BracketCard key={m.id} match={m} pronostic={pronostics[m.id]} side="right" />)}
              {Array.from({ length: Math.max(0, 4 - r16Right.length) }).map((_, i) => <BracketCard key={`pad-r16r-${i}`} match={null} side="right" />)}
            </div>
          </div>
        </div>
      </div>

      {/* 3ème place */}
      {thirdPlace && (
        <div style={{
          marginTop: 16, textAlign: "center",
          paddingTop: 16, borderTop: "1px dashed #1f2937",
        }}>
          <div style={{ fontSize: 9, letterSpacing: 2.5, textTransform: "uppercase", color: "#9ca3af", fontWeight: 700, marginBottom: 8 }}>
            Match pour la 3ème place
          </div>
          <div style={{ display: "inline-block", minWidth: 200 }}>
            <BracketCard match={thirdPlace} pronostic={pronostics[thirdPlace.id]} side="left" />
            <div style={{ fontSize: 10, color: "#4b5563", marginTop: 4, letterSpacing: 0.3 }}>
              {formatDate(thirdPlace.kickoff)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PARTICIPANT PRONOS MODAL ────────────────────────────────────────────────

function ParticipantPronosModal({ participant, matches, allPronostics, onClose }) {
  if (!participant) return null;

  const myPronos = allPronostics.filter(p => p.participant_id === participant.id);
  const pronoMap = new Map(myPronos.map(p => [p.match_id, p]));
  const finishedIds = new Set(matches.filter(m => m.status === "finished").map(m => m.id));

  let total = 0, exact = 0, trend = 0, missed = 0;
  myPronos.forEach(p => {
    if (!finishedIds.has(p.match_id)) return;
    const match = matches.find(m => m.id === p.match_id);
    if (!match?.score) return;
    const pts = computePoints(p, match.score);
    total += pts;
    if (pts === 3) exact++;
    else if (pts === 1) trend++;
    else missed++;
  });

  const matchesWithPronos = matches
    .filter(m => pronoMap.has(m.id))
    .sort((a, b) => {
      const order = { finished: 0, live: 1, upcoming: 2 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return new Date(b.kickoff) - new Date(a.kickoff);
    });

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#0d1117",
        borderRadius: 14,
        maxWidth: 680, width: "100%",
        maxHeight: "90vh", overflow: "hidden",
        border: "1px solid #1f2937",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          padding: "18px 22px", borderBottom: "1px solid #1f2937",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#f9fafb", letterSpacing: -0.3 }}>{participant.name}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span><b style={{ color: "#f9fafb" }}>{total}</b> pts au total</span>
              <span style={{ color: "#374151" }}>·</span>
              <span style={{ color: "#22c55e" }}>{exact} exact{exact > 1 ? "s" : ""}</span>
              <span style={{ color: "#374151" }}>·</span>
              <span style={{ color: "#f59e0b" }}>{trend} tendance{trend > 1 ? "s" : ""}</span>
              <span style={{ color: "#374151" }}>·</span>
              <span style={{ color: "#6b7280" }}>{missed} raté{missed > 1 ? "s" : ""}</span>
              <span style={{ color: "#374151" }}>·</span>
              <span>{myPronos.length} prono{myPronos.length > 1 ? "s" : ""}</span>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "#1f2937", border: "none", color: "#9ca3af",
            borderRadius: 8, padding: "8px 10px", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 22px 20px" }}>
          {matchesWithPronos.length === 0 ? (
            <div style={{ color: "#6b7280", textAlign: "center", padding: 40, fontSize: 13 }}>
              Aucun pronostic enregistré
            </div>
          ) : (
            matchesWithPronos.map(m => {
              const prono = pronoMap.get(m.id);
              const pts = m.status === "finished" && m.score ? computePoints(prono, m.score) : null;
              return (
                <div key={m.id} style={{
                  background: "#111827", border: "1px solid #1f2937",
                  borderRadius: 10, padding: "10px 14px", marginBottom: 8,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>
                      {isGroupStage(m.stage) ? groupLabel(m.group) : stageLabel(m.stage)}
                      {m.matchday && isGroupStage(m.stage) ? ` · J${m.matchday}` : ""}
                    </span>
                    <span style={{ flex: 1 }} />
                    <StatusBadge status={m.status} minute={m.minute} />
                    {m.status === "upcoming" && (
                      <span style={{ fontSize: 10, color: "#6b7280" }}>{formatDate(m.kickoff)}</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>
                        {m.home.shortName || m.home.name}
                      </span>
                      {m.home.crest && <img src={m.home.crest} alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />}
                    </div>
                    <div style={{ textAlign: "center", minWidth: 90 }}>
                      {m.score ? (
                        <span style={{ fontSize: 18, fontWeight: 900, color: "#f9fafb", fontFamily: "monospace" }}>
                          {m.score.home} – {m.score.away}
                        </span>
                      ) : (
                        <span style={{ fontSize: 14, color: "#4b5563", fontFamily: "monospace" }}>vs</span>
                      )}
                    </div>
                    <div style={{ flex: 1, textAlign: "left", display: "flex", alignItems: "center", gap: 6 }}>
                      {m.away.crest && <img src={m.away.crest} alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />}
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb" }}>
                        {m.away.shortName || m.away.name}
                      </span>
                    </div>
                  </div>
                  <div style={{
                    marginTop: 8, paddingTop: 8, borderTop: "1px solid #1f2937",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap",
                  }}>
                    <span style={{ fontSize: 11, color: "#6b7280" }}>Son prono :</span>
                    <span style={{ fontSize: 15, fontWeight: 800, color: "#e5e7eb", fontFamily: "monospace" }}>
                      {prono.home_score} – {prono.away_score}
                    </span>
                    {pts !== null && <ScoreTag pts={pts} />}
                    {prono.updated_at && (
                      <span style={{ fontSize: 10, color: "#4b5563", display: "flex", alignItems: "center", gap: 3 }}>
                        <Clock size={9} /> {formatPronoTime(prono.updated_at)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────

function LeaderboardScreen({ matches, isMobile }) {
  const [filter, setFilter] = useState("Global");
  const [selectedId, setSelectedId] = useState(null);
  const filters = ["Global","J1","J2","J3","Phase finale"];
  const medals = [Trophy, Award, Medal];
  const medalColors = ["#fbbf24","#9ca3af","#d97706"];

  const { participants, allPronostics } = useLeaderboardData();

  const board = useMemo(() => {
    let finished = matches.filter(m => m.status === "finished");
    if (filter === "J1") finished = finished.filter(m => m.matchday === 1 && isGroupStage(m.stage));
    else if (filter === "J2") finished = finished.filter(m => m.matchday === 2 && isGroupStage(m.stage));
    else if (filter === "J3") finished = finished.filter(m => m.matchday === 3 && isGroupStage(m.stage));
    else if (filter === "Phase finale") finished = finished.filter(m => !isGroupStage(m.stage));

    if (!finished.length || !participants.length) return [];

    const finishedIds = new Set(finished.map(m => m.id));
    const matchById = new Map(finished.map(m => [m.id, m]));

    return participants.map(p => {
      const myPronos = allPronostics.filter(x => x.participant_id === p.id && finishedIds.has(x.match_id));
      let total = 0, exact = 0, trend = 0;
      myPronos.forEach(prono => {
        const m = matchById.get(prono.match_id);
        if (!m || !m.score) return;
        const pts = computePoints(prono, m.score);
        total += pts;
        if (pts === 3) exact++;
        else if (pts === 1) trend++;
      });
      return { id: p.id, name: p.name, total, exact, trend };
    }).sort((a, b) => b.total - a.total || b.exact - a.exact || b.trend - a.trend);
  }, [matches, filter, participants, allPronostics]);

  const selectedParticipant = selectedId
    ? participants.find(p => p.id === selectedId)
    : null;

  if (!board.length) return (
    <div>
      <FilterBar options={filters} active={filter} onChange={setFilter} />
      <div style={{ color: "#4b5563", textAlign: "center", padding: 48, fontSize: 14 }}>
        {filter === "Global"
          ? "Le classement apparaîtra après la fin des premiers matchs"
          : `Aucun match terminé pour ${filter}`}
      </div>
    </div>
  );

  const top3 = board.slice(0, 3);
  const showWoodenSpoon = board.length >= 4;
  const rest = board.slice(3, showWoodenSpoon ? board.length - 1 : board.length);
  const last = showWoodenSpoon ? board[board.length - 1] : null;

  const clickable = { cursor: "pointer", transition: "transform .12s, box-shadow .12s" };

  return (
    <div>
      <FilterBar options={filters} active={filter} onChange={setFilter} />

      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 12, fontStyle: "italic" }}>
        Astuce : clique sur un participant pour voir tous ses pronostics
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "flex-end" }}>
        {[1, 0, 2].map(idx => {
          if (!top3[idx]) return null;
          const p = top3[idx];
          const isFirst = idx === 0;
          const MedalIcon = medals[idx];
          return (
            <div key={p.id} onClick={() => setSelectedId(p.id)} style={{
              flex: 1, textAlign: "center",
              background: isFirst ? "linear-gradient(135deg,#1c1400,#2d2000)" : "#111827",
              border: `1px solid ${isFirst ? "#d97706" : "#1f2937"}`,
              borderRadius: 12,
              padding: isFirst ? "18px 10px" : "14px 10px",
              boxShadow: isFirst ? "0 0 24px rgba(217,119,6,.2)" : "none",
              ...clickable,
            }}>
              <MedalIcon size={isFirst ? 28 : 22} color={medalColors[idx]} style={{ margin: "0 auto 6px" }} />
              <div style={{ fontWeight: 800, color: isFirst ? "#fbbf24" : "#e5e7eb", fontSize: isFirst ? 14 : 12 }}>{p.name}</div>
              <div style={{ fontSize: isFirst ? 26 : 20, fontWeight: 900, color: isFirst ? "#fbbf24" : "#f9fafb", fontFamily: "monospace", marginTop: 4 }}>
                {p.total}<span style={{ fontSize: 10, color: "#6b7280" }}>pts</span>
              </div>
              <div style={{ fontSize: 10, color: "#4b5563", marginTop: 4 }}>
                {p.exact} exact · {p.trend} tend.
              </div>
            </div>
          );
        })}
      </div>

      {rest.map((p, i) => (
        <div key={p.id} onClick={() => setSelectedId(p.id)} style={{
          background: "#111827", border: "1px solid #1f2937",
          borderRadius: 12, padding: "12px 16px", marginBottom: 8,
          display: "flex", alignItems: "center", gap: 12,
          ...clickable,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#6b7280", minWidth: 28, textAlign: "center" }}>#{i + 4}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: "#e5e7eb", fontSize: 14 }}>{p.name}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 3, color: "#22c55e" }}><TrendingUp size={10} /> {p.exact} exact</span>
              <span style={{ display: "flex", alignItems: "center", gap: 3, color: "#f59e0b" }}><ChevronRight size={10} /> {p.trend} tendance</span>
            </div>
          </div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#f9fafb", fontFamily: "monospace" }}>
            {p.total}<span style={{ fontSize: 11, color: "#6b7280" }}>pts</span>
          </div>
        </div>
      ))}

      {last && (
        <div onClick={() => setSelectedId(last.id)} style={{
          background: "#0d1117", border: "1px solid #1f2937", borderRadius: 12,
          padding: "12px 16px", marginTop: 8,
          display: "flex", alignItems: "center", gap: 12, opacity: 0.65,
          ...clickable,
        }}>
          <Utensils size={20} color="#6b7280" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: "#6b7280", fontSize: 14 }}>{last.name}</div>
            <div style={{ fontSize: 11, color: "#4b5563" }}>Cuillère en bois</div>
          </div>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#6b7280", fontFamily: "monospace" }}>
            {last.total}<span style={{ fontSize: 11 }}>pts</span>
          </div>
        </div>
      )}

      <ParticipantPronosModal
        participant={selectedParticipant}
        matches={matches}
        allPronostics={allPronostics}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }) {
  const [name, setName]         = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState("");

  const handleLogin = async () => {
    const trimmed = name.trim();
    if (!trimmed || !password) return;
    setLoading(true); setErr("");

    const { data } = await supabase
      .from("participants")
      .select("id, name, password")
      .eq("name", trimmed)
      .maybeSingle();

    const hashed = await hashPassword(password);

    if (data) {
      if (!data.password) {
        const { error } = await supabase.from("participants").update({ password: hashed }).eq("id", data.id);
        if (error) { setErr("Erreur, réessaie."); setLoading(false); return; }
        onLogin({ id: data.id, name: data.name });
      } else if (data.password === hashed) {
        onLogin({ id: data.id, name: data.name });
      } else {
        setErr("Mot de passe incorrect.");
      }
    } else {
      if (password.length < 4) { setErr("Mot de passe trop court (min. 4 caractères)."); setLoading(false); return; }
      const { data: newUser, error } = await supabase.from("participants").insert({ name: trimmed, password: hashed }).select("id, name").single();
      if (error || !newUser) { setErr("Erreur, réessaie."); setLoading(false); return; }
      onLogin(newUser);
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#030712",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Segoe UI', system-ui, sans-serif", padding: 24,
    }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
      <div style={{ marginBottom: 8, textAlign: "center" }}>
        <div style={{ fontSize: 13, color: "#d97706", fontWeight: 800, letterSpacing: 3, textTransform: "uppercase" }}>Moses Consulting</div>
        <div style={{ width: 40, height: 2, background: "#d97706", margin: "6px auto" }} />
      </div>
      <div style={{ fontSize: 52, marginBottom: 8 }}>⚽</div>
      <h1 style={{ fontWeight: 900, fontSize: 26, color: "#f9fafb", letterSpacing: -1, margin: "0 0 4px", textAlign: "center" }}>Pronostics</h1>
      <div style={{ color: "#d97706", fontWeight: 700, fontSize: 12, letterSpacing: 3, marginBottom: 32, textTransform: "uppercase" }}>
        Coupe du Monde 2026
      </div>
      <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 16, padding: 28, width: "100%", maxWidth: 380 }}>
        <label style={{ color: "#9ca3af", fontSize: 13, display: "block", marginBottom: 6 }}>Prénom</label>
        <input value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && document.getElementById("pwd").focus()}
          placeholder="Ex : Junbi, Thierry…" disabled={loading}
          style={{ width: "100%", background: "#1f2937", border: "1px solid #374151", borderRadius: 10, color: "#f9fafb", fontSize: 16, fontWeight: 600, padding: "12px 14px", outline: "none", boxSizing: "border-box", marginBottom: 12 }}
        />
        <label style={{ color: "#9ca3af", fontSize: 13, display: "block", marginBottom: 6 }}>Mot de passe</label>
        <input id="pwd" type="password" value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLogin()}
          placeholder="••••••••" disabled={loading}
          style={{ width: "100%", background: "#1f2937", border: "1px solid #374151", borderRadius: 10, color: "#f9fafb", fontSize: 16, padding: "12px 14px", outline: "none", boxSizing: "border-box" }}
        />
        <div style={{ fontSize: 11, color: "#4b5563", marginTop: 6, marginBottom: 4 }}>
          Nouveau ? Entre ton prénom et choisis un mot de passe.
        </div>
        {err && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 4 }}>{err}</div>}
        <button onClick={handleLogin} disabled={loading || !name.trim() || !password} style={{
          width: "100%", background: name.trim() && password ? "#d97706" : "#374151",
          color: "#fff", border: "none", borderRadius: 10, padding: "13px 0",
          fontSize: 15, fontWeight: 800, cursor: name.trim() && password ? "pointer" : "not-allowed", marginTop: 12,
        }}>
          {loading ? "Connexion…" : "Entrer →"}
        </button>
      </div>
    </div>
  );
}

// ─── NAV CONFIG ──────────────────────────────────────────────────────────────

const NAV = [
  { k: "matches",     Icon: Tv2,       label: "Matchs" },
  { k: "pronos",      Icon: Eye,       label: "Pronostics" },
  { k: "groups",      Icon: BarChart2, label: "Poules" },
  { k: "bracket",     Icon: Swords,    label: "Tableau" },
  { k: "leaderboard", Icon: Trophy,    label: "Classement" },
];

// ─── APP ─────────────────────────────────────────────────────────────────────

export default function App() {
  const isMobile = useIsMobile();

  const [participant, setParticipant] = useState(() => {
    try { const s = localStorage.getItem("mc_participant"); return s ? JSON.parse(s) : null; }
    catch { return null; }
  });
  const [tab, setTab]                             = useState("matches");
  const [pronosFilterMatchId, setPronosFilterMatchId] = useState(null);

  const { matches, loading, error }   = useMatches();
  const { pronostics, savePronostic } = usePronostics(participant?.id);
  const { notifEnabled, notifLoading, toggle: toggleNotif } = useNotifications(participant, matches, pronostics);

  const liveCount     = matches.filter(m => m.status === "live").length;
  const finishedCount = matches.filter(m => m.status === "finished").length;

  const handleLogin = p => {
    localStorage.setItem("mc_participant", JSON.stringify(p));
    setParticipant(p);
  };
  const handleLogout = () => {
    localStorage.removeItem("mc_participant");
    setParticipant(null);
  };
  const handleViewPronos = matchId => {
    setPronosFilterMatchId(matchId);
    setTab("pronos");
  };

  if (!participant) return <LoginScreen onLogin={handleLogin} />;

  const renderScreen = () => {
    switch (tab) {
      case "matches":     return <MatchesScreen matches={matches} pronostics={pronostics} onSave={savePronostic} onViewPronos={handleViewPronos} loading={loading} error={error} isMobile={isMobile} />;
      case "pronos":      return <PronosScreen matches={matches} currentUser={participant.name} selectedMatchId={pronosFilterMatchId} onClearFilter={() => setPronosFilterMatchId(null)} isMobile={isMobile} />;
      case "groups":      return <GroupStandings matches={matches} isMobile={isMobile} />;
      case "bracket":     return <BracketScreen matches={matches} pronostics={pronostics} />;
      case "leaderboard": return <LeaderboardScreen matches={matches} isMobile={isMobile} />;
      default:            return null;
    }
  };

  // ── DESKTOP LAYOUT ──
  if (!isMobile) return (
    <div style={{ display: "flex", height: "100vh", background: "#030712", fontFamily: "'Segoe UI',system-ui,sans-serif", color: "#f9fafb" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}} input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none} *{box-sizing:border-box} ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#030712} ::-webkit-scrollbar-thumb{background:#374151;border-radius:99px}`}</style>

      <div style={{ width: 240, background: "#0d1117", borderRight: "1px solid #1f2937", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid #1f2937" }}>
          <div style={{ fontSize: 10, color: "#d97706", fontWeight: 800, letterSpacing: 3, textTransform: "uppercase", marginBottom: 2 }}>Moses Consulting</div>
          <div style={{ fontWeight: 900, fontSize: 16, color: "#f9fafb", letterSpacing: -0.5 }}>Pronostics</div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>Coupe du Monde 2026</div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
            {liveCount > 0 && <span style={{ color: "#f87171", fontWeight: 600 }}>● {liveCount} en direct · </span>}
            {finishedCount} terminé{finishedCount > 1 ? "s" : ""}
          </div>
        </div>

        <div style={{ flex: 1, padding: "12px 10px" }}>
          {NAV.map(({ k, Icon, label }) => (
            <button key={k} onClick={() => setTab(k)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              background: tab === k ? "#2d1d00" : "none",
              border: `1px solid ${tab === k ? "#d97706" + "44" : "transparent"}`,
              color: tab === k ? "#d97706" : "#9ca3af",
              borderRadius: 10, padding: "10px 12px", marginBottom: 4,
              cursor: "pointer", textAlign: "left", transition: "all .15s",
              fontWeight: tab === k ? 700 : 500,
            }}>
              <Icon size={16} strokeWidth={tab === k ? 2.5 : 1.5} />
              <span style={{ fontSize: 13 }}>{label}</span>
              {tab === k && <ChevronRight size={12} style={{ marginLeft: "auto" }} />}
            </button>
          ))}
        </div>

        <div style={{ padding: "12px 10px", borderTop: "1px solid #1f2937" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#111827", borderRadius: 10, marginBottom: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#2d1d00", border: "1px solid #d9770644", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <User size={14} color="#d97706" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#f9fafb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{participant.name}</div>
              <div style={{ fontSize: 10, color: "#6b7280" }}>Participant</div>
            </div>
          </div>
          {"Notification" in window && (
            <button onClick={toggleNotif} disabled={notifLoading} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8,
              background: "none", border: "none", color: "#9ca3af",
              padding: "7px 10px", cursor: "pointer", borderRadius: 8, fontSize: 12,
              marginBottom: 4,
            }}>
              <Bell size={13} color={notifEnabled ? "#22c55e" : "#9ca3af"} />
              Notifications
              <span style={{ marginLeft: "auto", fontSize: 10, background: notifEnabled ? "#052e16" : "#1f2937", color: notifEnabled ? "#22c55e" : "#6b7280", padding: "1px 7px", borderRadius: 99, fontWeight: 700 }}>
                {notifLoading ? "…" : notifEnabled ? "ON" : "OFF"}
              </span>
            </button>
          )}
          <button onClick={handleLogout} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8,
            background: "none", border: "none", color: "#6b7280",
            padding: "7px 10px", cursor: "pointer", borderRadius: 8, fontSize: 12,
          }}>
            <LogOut size={13} /> Déconnexion
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px 28px", borderBottom: "1px solid #1f2937", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#030712" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 20, color: "#f9fafb" }}>
              {NAV.find(n => n.k === tab)?.label}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {renderScreen()}
        </div>

        <div style={{ padding: "10px 28px", borderTop: "1px solid #1f2937", display: "flex", gap: 24, background: "#0d1117" }}>
          {[{ pts: 3, label: "Score exact", color: "#22c55e" }, { pts: 1, label: "Bonne tendance", color: "#f59e0b" }, { pts: 0, label: "Raté", color: "#6b7280" }].map(r => (
            <div key={r.pts} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
              <span style={{ fontWeight: 800, color: r.color }}>{r.pts} pts</span>
              <span style={{ color: "#4b5563" }}>{r.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── MOBILE LAYOUT ──
  return (
    <div style={{ minHeight: "100vh", background: "#030712", fontFamily: "'Segoe UI',system-ui,sans-serif", color: "#f9fafb", paddingBottom: 64 }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}} input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none} *{box-sizing:border-box} ::-webkit-scrollbar{display:none}`}</style>

      <div style={{ background: "#030712", borderBottom: "1px solid #111827", padding: "10px 16px", position: "sticky", top: 0, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 9, color: "#d97706", fontWeight: 800, letterSpacing: 2, textTransform: "uppercase" }}>Moses Consulting</div>
          <div style={{ fontWeight: 900, fontSize: 14, letterSpacing: -0.5 }}>Pronostics CDM 2026</div>
          <div style={{ fontSize: 10, color: "#6b7280" }}>
            {liveCount > 0 && <span style={{ color: "#f87171" }}>● {liveCount} en direct · </span>}
            {finishedCount} terminé{finishedCount > 1 ? "s" : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {"Notification" in window && (
            <button onClick={toggleNotif} disabled={notifLoading} style={{
              background: notifEnabled ? "#052e16" : "#1f2937",
              border: `1px solid ${notifEnabled ? "#16a34a" : "#374151"}`,
              borderRadius: 8, padding: "6px 8px", cursor: "pointer",
            }}>
              <Bell size={14} color={notifEnabled ? "#22c55e" : "#6b7280"} />
            </button>
          )}
          <button onClick={handleLogout} style={{
            background: "#1f2937", border: "none", borderRadius: 8,
            padding: "6px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
          }}>
            <User size={12} color="#9ca3af" />
            <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600 }}>{participant.name}</span>
          </button>
        </div>
      </div>

      <div style={{ padding: "16px 14px" }}>
        {renderScreen()}
      </div>

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#0d1117", borderTop: "1px solid #1f2937", display: "flex", zIndex: 20, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {NAV.map(({ k, Icon, label }) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, background: "none", border: "none", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            padding: "8px 0 6px",
          }}>
            <Icon size={20} color={tab === k ? "#d97706" : "#4b5563"} strokeWidth={tab === k ? 2.5 : 1.5} />
            <span style={{ fontSize: 9, fontWeight: 700, color: tab === k ? "#d97706" : "#4b5563" }}>{label}</span>
            {tab === k && <div style={{ width: 16, height: 2, background: "#d97706", borderRadius: 99 }} />}
          </button>
        ))}
      </div>
    </div>
  );
}
