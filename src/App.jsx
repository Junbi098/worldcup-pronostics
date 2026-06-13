// src/App.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";
import { computePoints, pointBadge } from "./points";

// ─── CONSTANTES ──────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 60_000; // rafraîchit les matchs toutes les 60s
const POLL_LIVE_MS     = 30_000; // toutes les 30s si match en direct

// ─── UTILITAIRES ─────────────────────────────────────────────────────────────
function formatDate(iso) {
  return new Date(iso).toLocaleString("fr-FR", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
  });
}

function timeUntil(iso) {
  const diff = new Date(iso) - Date.now();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  if (h > 0) return `dans ${h}h${String(m).padStart(2, "0")}`;
  if (m > 0) return `dans ${m}m${String(s).padStart(2, "0")}s`;
  return `dans ${s}s`;
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

  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  // Polling adaptatif
  useEffect(() => {
    const hasLive = matches.some((m) => m.status === "live");
    const interval = hasLive ? POLL_LIVE_MS : POLL_INTERVAL_MS;
    const timer = setInterval(fetchMatches, interval);
    return () => clearInterval(timer);
  }, [matches, fetchMatches]);

  return { matches, loading, error, refetch: fetchMatches };
}

function usePronostics(participantId) {
  const [pronostics, setPronostics] = useState({}); // { matchId: {home_score, away_score} }

  const loadPronostics = useCallback(async () => {
    if (!participantId) return;
    const { data } = await supabase
      .from("pronostics")
      .select("match_id, home_score, away_score")
      .eq("participant_id", participantId);
    if (data) {
      const map = {};
      data.forEach((p) => { map[p.match_id] = p; });
      setPronostics(map);
    }
  }, [participantId]);

  useEffect(() => { loadPronostics(); }, [loadPronostics]);

  const savePronostic = useCallback(async (matchId, homeScore, awayScore) => {
    if (!participantId) return;
    const { error } = await supabase.from("pronostics").upsert(
      { participant_id: participantId, match_id: matchId, home_score: homeScore, away_score: awayScore },
      { onConflict: "participant_id,match_id" }
    );
    if (!error) {
      setPronostics((prev) => ({ ...prev, [matchId]: { home_score: homeScore, away_score: awayScore } }));
    }
    return !error;
  }, [participantId]);

  return { pronostics, savePronostic };
}

function useLeaderboard(matches) {
  const [board, setBoard] = useState([]);

  const refresh = useCallback(async () => {
    const finished = matches.filter((m) => m.status === "finished");
    if (!finished.length) { setBoard([]); return; }

    const { data: participants } = await supabase.from("participants").select("id, name");
    const { data: allPronostics } = await supabase
      .from("pronostics")
      .select("participant_id, match_id, home_score, away_score")
      .in("match_id", finished.map((m) => m.id));

    if (!participants || !allPronostics) return;

    const scores = participants.map((p) => {
      const myProno = allPronostics.filter((x) => x.participant_id === p.id);
      let total = 0, exact = 0, close = 0, trend = 0;
      finished.forEach((m) => {
        const prono = myProno.find((x) => x.match_id === m.id);
        if (!prono || !m.score) return;
        const pts = computePoints(prono, m.score);
        total += pts;
        if (pts === 5) exact++;
        else if (pts === 3) close++;
        else if (pts === 1) trend++;
      });
      return { name: p.name, total, exact, close, trend };
    });

    setBoard(scores.sort((a, b) => b.total - a.total || b.exact - a.exact || b.close - a.close));
  }, [matches]);

  useEffect(() => { refresh(); }, [refresh]);

  return board;
}

// ─── COMPOSANTS ──────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }) {
  const [name, setName]     = useState("");
  const [loading, setLoading] = useState(false);
  const [existing, setExisting] = useState([]);
  const [err, setErr]       = useState("");

  useEffect(() => {
    supabase.from("participants").select("name").order("name").then(({ data }) => {
      if (data) setExisting(data.map((p) => p.name));
    });
  }, []);

  const handleLogin = async (inputName) => {
    const trimmed = (inputName || name).trim();
    if (!trimmed) return;
    setLoading(true); setErr("");
    // Upsert participant
    const { data, error } = await supabase
      .from("participants")
      .upsert({ name: trimmed }, { onConflict: "name" })
      .select("id, name")
      .single();
    if (error || !data) { setErr("Erreur de connexion, réessaie."); setLoading(false); return; }
    onLogin(data);
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#030712",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Segoe UI', system-ui, sans-serif", padding: 24,
    }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
      <div style={{ fontSize: 60, marginBottom: 8 }}>⚽</div>
      <h1 style={{ fontWeight: 900, fontSize: 30, color: "#f9fafb", letterSpacing: -1, margin: "0 0 4px", textAlign: "center" }}>
        Pronostics
      </h1>
      <div style={{ color: "#d97706", fontWeight: 700, fontSize: 13, letterSpacing: 3, marginBottom: 36, textTransform: "uppercase" }}>
        Coupe du Monde 2026
      </div>

      <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 16, padding: 28, width: "100%", maxWidth: 380 }}>
        <label style={{ color: "#9ca3af", fontSize: 13, display: "block", marginBottom: 8 }}>
          Ton prénom pour jouer
        </label>
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          placeholder="Ex : Junbi, Thierry…"
          disabled={loading}
          style={{
            width: "100%", background: "#1f2937", border: "1px solid #374151",
            borderRadius: 10, color: "#f9fafb", fontSize: 16, fontWeight: 600,
            padding: "12px 14px", outline: "none", boxSizing: "border-box", marginBottom: 4,
          }}
        />
        {err && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <button onClick={() => handleLogin()} disabled={loading || !name.trim()} style={{
          width: "100%", background: name.trim() ? "#d97706" : "#374151",
          color: "#fff", border: "none", borderRadius: 10,
          padding: "13px 0", fontSize: 15, fontWeight: 800,
          cursor: name.trim() ? "pointer" : "not-allowed", marginTop: 10,
        }}>
          {loading ? "Connexion…" : "Entrer →"}
        </button>

        {existing.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ color: "#4b5563", fontSize: 12, marginBottom: 10 }}>Participants existants :</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {existing.map((n) => (
                <button key={n} onClick={() => handleLogin(n)} style={{
                  background: "#1f2937", border: "1px solid #374151", color: "#d1d5db",
                  borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer", fontWeight: 600,
                }}>{n}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, minute }) {
  if (status === "live") return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: "#7f1d1d", color: "#fca5a5",
      fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 99,
      letterSpacing: 1, textTransform: "uppercase",
    }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f87171", animation: "pulse 1s infinite" }} />
      LIVE {minute ? `${minute}'` : ""}
    </span>
  );
  if (status === "finished") return (
    <span style={{
      background: "#1a1a2e", color: "#6b7280",
      fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 99,
      letterSpacing: 1, textTransform: "uppercase",
    }}>Terminé</span>
  );
  return null;
}

function MatchCard({ match, pronostic, onSave }) {
  const locked = match.status === "live" || match.status === "finished";
  const [h, setH] = useState(pronostic?.home_score ?? "");
  const [a, setA] = useState(pronostic?.away_score ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [tick, setTick]     = useState(0);

  // Compte à rebours
  useEffect(() => {
    if (match.status !== "upcoming") return;
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [match.status]);

  // Synchro pronostic depuis parent
  useEffect(() => {
    if (pronostic) { setH(pronostic.home_score); setA(pronostic.away_score); }
  }, [pronostic]);

  const pts = match.status === "finished" && pronostic && match.score
    ? computePoints(pronostic, match.score) : null;
  const badge = pts !== null ? pointBadge(pts) : null;

  const handleSave = async () => {
    if (isNaN(+h) || isNaN(+a) || +h < 0 || +a < 0) return;
    setSaving(true);
    const ok = await onSave(match.id, +h, +a);
    setSaving(false);
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  const canSave = h !== "" && a !== "" && !isNaN(+h) && !isNaN(+a) && +h >= 0 && +a >= 0 && !locked;

  return (
    <div style={{
      background: "linear-gradient(135deg,#111827,#1a1f2e)",
      border: `1px solid ${match.status === "live" ? "#7f1d1d" : "#1f2937"}`,
      borderRadius: 14, padding: "18px 20px", marginBottom: 12,
      boxShadow: match.status === "live" ? "0 0 18px rgba(248,113,113,.12)" : "none",
    }}>
      {/* En-tête */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: "#4b5563", textTransform: "uppercase", letterSpacing: 1 }}>
          {match.group}
        </span>
        <StatusBadge status={match.status} minute={match.minute} />
      </div>

      {/* Équipes + score */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ flex: 1, textAlign: "right" }}>
          {match.home.crest
            ? <img src={match.home.crest} alt="" style={{ width: 36, height: 36, objectFit: "contain" }} />
            : <div style={{ fontSize: 28 }}>🏳️</div>}
          <div style={{ fontWeight: 700, color: "#e5e7eb", fontSize: 13, marginTop: 4 }}>
            {match.home.shortName || match.home.name}
          </div>
        </div>

        <div style={{ textAlign: "center", minWidth: 88 }}>
          {match.status === "upcoming" ? (
            <>
              <div style={{ fontSize: 13, color: "#6b7280" }}>
                {new Date(match.kickoff).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}
              </div>
              {timeUntil(match.kickoff) && (
                <div style={{ fontSize: 11, color: "#d97706", fontWeight: 600, marginTop: 2 }}>
                  {timeUntil(match.kickoff)}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 34, fontWeight: 900, color: "#f9fafb", letterSpacing: 2, fontFamily: "monospace" }}>
              {match.score?.home ?? "–"}<span style={{ color: "#374151" }}> – </span>{match.score?.away ?? "–"}
            </div>
          )}
        </div>

        <div style={{ flex: 1, textAlign: "left" }}>
          {match.away.crest
            ? <img src={match.away.crest} alt="" style={{ width: 36, height: 36, objectFit: "contain" }} />
            : <div style={{ fontSize: 28 }}>🏳️</div>}
          <div style={{ fontWeight: 700, color: "#e5e7eb", fontSize: 13, marginTop: 4 }}>
            {match.away.shortName || match.away.name}
          </div>
        </div>
      </div>

      {/* Date si à venir */}
      {match.status === "upcoming" && (
        <div style={{ textAlign: "center", fontSize: 11, color: "#6b7280", marginTop: 6 }}>
          {formatDate(match.kickoff)}
        </div>
      )}

      {/* Zone pronostic */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #1f2937", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        {locked ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#6b7280", fontSize: 12 }}>Mon pronostic :</span>
            {pronostic ? (
              <span style={{ fontWeight: 800, fontSize: 20, color: "#e5e7eb", fontFamily: "monospace" }}>
                {pronostic.home_score} – {pronostic.away_score}
              </span>
            ) : (
              <span style={{ color: "#4b5563", fontSize: 13, fontStyle: "italic" }}>Aucun pronostic</span>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#9ca3af", fontSize: 12 }}>Mon pronostic :</span>
            {[{ val: h, set: setH }, { val: a, set: setA }].map((inp, i) => (
              <input key={i} type="number" min="0" max="20" value={inp.val}
                onChange={(e) => inp.set(e.target.value)}
                style={{
                  width: 42, textAlign: "center", background: "#1f2937",
                  border: "1px solid #374151", borderRadius: 6, color: "#f9fafb",
                  fontSize: 18, fontWeight: 800, padding: "4px 0", fontFamily: "monospace", outline: "none",
                }}
              />
            ))}
            <button onClick={handleSave} disabled={!canSave || saving} style={{
              background: canSave ? (saved ? "#16a34a" : "#d97706") : "#374151",
              color: canSave ? "#fff" : "#6b7280",
              border: "none", borderRadius: 6, padding: "5px 12px",
              fontSize: 12, fontWeight: 700, cursor: canSave ? "pointer" : "not-allowed",
              transition: "background .2s",
            }}>
              {saving ? "…" : saved ? "✓ Sauvegardé" : "✓ Valider"}
            </button>
          </div>
        )}
        {badge && (
          <div style={{
            background: badge.bg, color: badge.color,
            padding: "4px 12px", borderRadius: 99, fontSize: 12, fontWeight: 700,
            border: `1px solid ${badge.color}33`,
          }}>
            {badge.label} · +{pts} pts
          </div>
        )}
      </div>
    </div>
  );
}

function Leaderboard({ board }) {
  const medals = ["🥇", "🥈", "🥉"];
  if (!board.length) return (
    <div style={{ color: "#4b5563", textAlign: "center", padding: 48, fontSize: 14 }}>
      Le classement apparaîtra après la fin des premiers matchs
    </div>
  );
  return (
    <div>
      <h2 style={{ color: "#f9fafb", fontWeight: 900, fontSize: 20, marginBottom: 16 }}>🏆 Classement</h2>
      {board.map((p, i) => (
        <div key={p.name} style={{
          background: i === 0 ? "linear-gradient(135deg,#1c1400,#2d2000)" : "#111827",
          border: `1px solid ${i === 0 ? "#d97706" : "#1f2937"}`,
          borderRadius: 12, padding: "14px 18px", marginBottom: 10,
          display: "flex", alignItems: "center", gap: 14,
          boxShadow: i === 0 ? "0 0 20px rgba(217,119,6,.2)" : "none",
        }}>
          <div style={{ fontSize: i < 3 ? 26 : 18, minWidth: 34, textAlign: "center" }}>
            {i < 3 ? medals[i] : <span style={{ color: "#6b7280", fontWeight: 700 }}>#{i + 1}</span>}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, color: i === 0 ? "#fbbf24" : "#e5e7eb", fontSize: 16 }}>{p.name}</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3, display: "flex", gap: 10 }}>
              <span style={{ color: "#22c55e" }}>⚡ {p.exact} exact</span>
              <span style={{ color: "#f59e0b" }}>≈ {p.close} proche</span>
              <span style={{ color: "#60a5fa" }}>↗ {p.trend} tendance</span>
            </div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: i === 0 ? "#fbbf24" : "#e5e7eb", fontFamily: "monospace" }}>
            {p.total}<span style={{ fontSize: 13, color: "#6b7280", fontWeight: 400 }}> pts</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── APP PRINCIPALE ───────────────────────────────────────────────────────────
export default function App() {
  const [participant, setParticipant] = useState(null);
  const [tab, setTab] = useState("matches");

  const { matches, loading, error } = useMatches();
  const { pronostics, savePronostic } = usePronostics(participant?.id);
  const board = useLeaderboard(matches);

  const liveCount     = matches.filter((m) => m.status === "live").length;
  const finishedCount = matches.filter((m) => m.status === "finished").length;

  if (!participant) return <LoginScreen onLogin={setParticipant} />;

  return (
    <div style={{ minHeight: "100vh", background: "#030712", fontFamily: "'Segoe UI',system-ui,sans-serif", color: "#f9fafb" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}} input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none} *{box-sizing:border-box}`}</style>

      {/* Header */}
      <div style={{
        background: "#030712", borderBottom: "1px solid #111827",
        padding: "14px 20px", position: "sticky", top: 0, zIndex: 10,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>⚽</span>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: -0.5 }}>Pronostics CDM 2026</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>
              {liveCount > 0 && <span style={{ color: "#f87171" }}>● {liveCount} en direct · </span>}
              {finishedCount} terminé{finishedCount > 1 ? "s" : ""}
            </div>
          </div>
        </div>
        <button onClick={() => setParticipant(null)} style={{
          background: "#1f2937", border: "none", color: "#9ca3af",
          borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer",
        }}>
          👤 {participant.name}
        </button>
      </div>

      {/* Navigation */}
      <div style={{ display: "flex", borderBottom: "1px solid #111827", background: "#030712" }}>
        {[{ key: "matches", label: "⚽ Matchs" }, { key: "leaderboard", label: "🏆 Classement" }].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flex: 1, background: "none", border: "none",
            color: tab === t.key ? "#d97706" : "#6b7280",
            fontWeight: tab === t.key ? 800 : 500,
            fontSize: 14, padding: "14px 0", cursor: "pointer",
            borderBottom: tab === t.key ? "2px solid #d97706" : "2px solid transparent",
            transition: "all .2s",
          }}>{t.label}</button>
        ))}
      </div>

      {/* Contenu */}
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "20px 16px" }}>
        {tab === "matches" && (
          <>
            {loading && <div style={{ color: "#6b7280", textAlign: "center", padding: 40 }}>Chargement des matchs…</div>}
            {error && <div style={{ color: "#f87171", textAlign: "center", padding: 20, fontSize: 14 }}>Erreur : {error}</div>}

            {["live", "upcoming", "finished"].map((status) => {
              const group = matches.filter((m) => m.status === status);
              if (!group.length) return null;
              const labels = { live: "🔴 En direct", upcoming: "⏰ À venir", finished: "✅ Terminés" };
              const colors = { live: "#f87171", upcoming: "#d97706", finished: "#4b5563" };
              return (
                <div key={status} style={{ marginBottom: 24 }}>
                  <div style={{ color: colors[status], fontWeight: 800, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>
                    {labels[status]}
                  </div>
                  {group.map((m) => (
                    <MatchCard key={m.id} match={m} pronostic={pronostics[m.id]} onSave={savePronostic} />
                  ))}
                </div>
              );
            })}
          </>
        )}
        {tab === "leaderboard" && <Leaderboard board={board} />}
      </div>

      {/* Légende */}
      <div style={{
        background: "#0a0f1a", borderTop: "1px solid #111827",
        padding: "12px 20px", display: "flex", justifyContent: "center", gap: 20, flexWrap: "wrap",
      }}>
        {[{ pts: 5, label: "Score exact", color: "#22c55e" }, { pts: 3, label: "±1 but", color: "#f59e0b" },
          { pts: 1, label: "Bonne tendance", color: "#60a5fa" }, { pts: 0, label: "Raté", color: "#4b5563" }].map((r) => (
          <div key={r.pts} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span style={{ fontWeight: 800, color: r.color }}>{r.pts} pts</span>
            <span style={{ color: "#6b7280" }}>{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
