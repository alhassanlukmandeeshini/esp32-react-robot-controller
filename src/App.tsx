import { useCallback, useEffect, useRef, useState } from "react";

const C = {
  bg: "var(--rover-bg)",
  panel: "var(--rover-panel)",
  panel2: "var(--rover-panel-2)",
  border: "var(--rover-border)",
  cyan: "var(--rover-cyan)",
  red: "#ef1f3d",
  green: "#10b981",
  amber: "#f59e0b",
  muted: "var(--rover-muted)",
};

const SPEEDS = [
  { label: "50%", value: 130 },
  { label: "75%", value: 190 },
  { label: "100%", value: 255 },
];

const MODES = [
  { key: "manual", label: "MANUAL" },
  { key: "roam", label: "FREE ROAM" },
  { key: "guard", label: "GUARD" },
];

type ConnState = "offline" | "connecting" | "online";

export default function App() {
  const [host, setHost] = useState("192.168.4.1");
  const [hostInput, setHostInput] = useState("192.168.4.1");
  const [connState, setConnState] = useState<ConnState>("offline");
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [mode, setMode] = useState("manual");
  const [speed, setSpeed] = useState(190);
  const [pressed, setPressed] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return localStorage.getItem("rover-theme") === "light" ? "light" : "dark";
  });

  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const activeIntervalRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const shouldReconnect = useRef(false);

  const send = useCallback((cmd: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(cmd);
      return true;
    }
    return false;
  }, []);

  const stopActive = useCallback(() => {
    if (activeIntervalRef.current) {
      window.clearInterval(activeIntervalRef.current);
      activeIntervalRef.current = null;
    }
    setPressed(null);
    send("S");
  }, [send]);

  const startActive = useCallback(
    (cmd: string) => {
      if (connState !== "online" || mode !== "manual") return;
      send(cmd);
      setPressed(cmd);
      if (activeIntervalRef.current) window.clearInterval(activeIntervalRef.current);
      activeIntervalRef.current = window.setInterval(() => send(cmd), 200);
    },
    [connState, mode, send]
  );

  const disconnect = useCallback(() => {
    shouldReconnect.current = false;
    if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
    if (pingIntervalRef.current) window.clearInterval(pingIntervalRef.current);
    stopActive();
    if (wsRef.current) wsRef.current.close(1000, "user disconnect");
    wsRef.current = null;
    setConnState("offline");
    setPingMs(null);
    setDistance(null);
  }, [stopActive]);

  const connect = useCallback(
    (targetHost: string) => {
      const cleanHost = targetHost.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!cleanHost) return;

      shouldReconnect.current = true;
      setError("");
      setConnState("connecting");
      setHost(cleanHost);

      try {
        const ws = new WebSocket(`ws://${cleanHost}/ws`);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnState("online");
          setError("");
          if (pingIntervalRef.current) window.clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = window.setInterval(() => {
            send("PING:" + Date.now());
          }, 2000);
        };

        ws.onmessage = (event) => {
          const msg = event.data;
          if (typeof msg !== "string") return;
          if (msg.startsWith("D:")) {
            const cm = parseInt(msg.slice(2), 10);
            if (!Number.isNaN(cm)) setDistance(cm);
          } else if (msg.startsWith("PONG:")) {
            const sentAt = parseInt(msg.slice(5), 10);
            if (!Number.isNaN(sentAt)) setPingMs(Date.now() - sentAt);
          }
        };

        ws.onerror = () => {
          setError("Could not connect. Check Wi-Fi and robot IP.");
          ws.close();
        };

        ws.onclose = () => {
          setConnState("offline");
          setPingMs(null);
          if (pingIntervalRef.current) window.clearInterval(pingIntervalRef.current);
          stopActive();
          if (shouldReconnect.current) {
            reconnectTimeoutRef.current = window.setTimeout(() => connect(cleanHost), 2000);
          }
        };
      } catch {
        setConnState("offline");
        setError("Invalid robot address.");
      }
    },
    [send, stopActive]
  );

  const emergencyStop = useCallback(() => {
    setMode("manual");
    send("M:manual");
    stopActive();
    send("S");
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
  }, [send, stopActive]);

  useEffect(() => {
    localStorage.setItem("rover-theme", theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      shouldReconnect.current = false;
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) window.clearInterval(pingIntervalRef.current);
      if (activeIntervalRef.current) window.clearInterval(activeIntervalRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  useEffect(() => {
    const stop = () => stopActive();
    const visibilityStop = () => {
      if (document.hidden) stopActive();
    };
    window.addEventListener("blur", stop);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchend", stop);
    window.addEventListener("pointerup", stop);
    document.addEventListener("visibilitychange", visibilityStop);
    return () => {
      window.removeEventListener("blur", stop);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchend", stop);
      window.removeEventListener("pointerup", stop);
      document.removeEventListener("visibilitychange", visibilityStop);
    };
  }, [stopActive]);

  useEffect(() => {
    const keys: Record<string, string> = {
      ArrowUp: "F",
      w: "F",
      W: "F",
      ArrowDown: "B",
      s: "B",
      S: "B",
      ArrowLeft: "L",
      a: "L",
      A: "L",
      ArrowRight: "R",
      d: "R",
      D: "R",
    };
    const onDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        emergencyStop();
        return;
      }
      const cmd = keys[event.key];
      if (!cmd || event.repeat || pressed) return;
      event.preventDefault();
      startActive(cmd);
    };
    const onUp = (event: KeyboardEvent) => {
      const cmd = keys[event.key];
      if (cmd && pressed === cmd) {
        event.preventDefault();
        stopActive();
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [emergencyStop, pressed, startActive, stopActive]);

  const handleConnect = () => {
    if (connState === "online" || connState === "connecting") disconnect();
    else connect(hostInput);
  };

  const setRobotMode = (nextMode: string) => {
    setMode(nextMode);
    send("M:" + nextMode);
    if (nextMode !== "manual") stopActive();
  };

  const setRobotSpeed = (value: number) => {
    setSpeed(value);
    send("V:" + value);
  };

  const setPan = (value: number) => {
    send("P:" + value);
  };

  let distColor = C.green;
  if (distance !== null && distance < 15) distColor = C.red;
  else if (distance !== null && distance < 40) distColor = C.amber;
  const proxPct = distance === null ? 0 : Math.max(0, Math.min(100, distance));
  const statusColor = connState === "online" ? C.green : connState === "connecting" ? C.amber : "#ff3d67";
  const statusLabel = connState === "online" ? "ONLINE" : connState === "connecting" ? "CONNECTING" : "OFFLINE";
  const isManual = mode === "manual";
  const canDrive = connState === "online" && isManual;

  return (
    <main data-theme={theme} className="min-h-screen overflow-x-hidden px-4 py-3 text-white" style={{ background: C.bg }}>
      <div className="mx-auto flex max-w-[680px] flex-col gap-4">
        <section className="rounded-[16px] border px-6 py-5" style={{ background: C.panel, borderColor: C.border }}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-[26px] font-black leading-none tracking-[0.18em]" style={{ color: C.cyan }}>ROVER PRO</h1>
              <p className="mt-3 text-[16px]" style={{ color: C.muted }}>{host}/ws</p>
            </div>
            <div className="flex items-center gap-3 font-bold">
              <button
                onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
                className="rounded-[9px] border px-3 py-2 text-[12px] font-black tracking-wider active:scale-[0.98]"
                style={{ background: C.panel2, borderColor: C.border, color: C.muted }}
              >
                {theme === "dark" ? "LIGHT" : "DARK"}
              </button>
              <span className="hidden sm:inline text-[16px]" style={{ color: C.muted }}>{pingMs === null ? "-- ms" : `${pingMs} ms`}</span>
              <span className="text-[17px] tracking-wider" style={{ color: statusColor }}>{statusLabel}</span>
            </div>
          </div>
        </section>

        <section className="rounded-[16px] border p-3" style={{ background: C.panel, borderColor: C.border }}>
          <div className="flex gap-3">
            <input
              value={hostInput}
              onChange={(event) => setHostInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && connState === "offline") handleConnect(); }}
              disabled={connState !== "offline"}
              className="min-w-0 flex-1 rounded-[10px] border px-4 text-[20px] font-bold outline-none disabled:opacity-70"
              style={{ background: C.panel2, borderColor: C.border, color: "var(--rover-text)" }}
              placeholder="192.168.4.1"
              spellCheck={false}
            />
            <button onClick={handleConnect} className="min-h-[57px] rounded-[12px] px-6 text-[17px] font-black tracking-wide active:scale-[0.98]" style={{ background: connState === "offline" ? C.cyan : C.red, color: connState === "offline" ? "#020812" : "#ffffff" }}>
              {connState === "offline" ? "CONNECT" : "DISCONNECT"}
            </button>
          </div>
          {error && <p className="mt-2 px-1 text-sm font-semibold" style={{ color: C.red }}>{error}</p>}
        </section>

        <button onClick={emergencyStop} className="flex h-[76px] items-center justify-center gap-3 rounded-[18px] text-[24px] font-black tracking-wider active:scale-[0.99]" style={{ background: C.red, color: "#ffffff" }}>
          <WarningIcon />
          EMERGENCY STOP
        </button>

        <section className="rounded-[20px] border px-5 py-10" style={{ background: "var(--rover-telemetry)", borderColor: C.cyan }}>
          <div className="grid grid-cols-2 gap-8 text-center">
            <div>
              <div className="text-[30px] font-black leading-none" style={{ color: distance === null ? C.green : distColor }}>{distance === null ? "--" : distance}</div>
              <div className="mt-5 text-[16px] uppercase tracking-wide" style={{ color: C.muted }}>Obstacle Dist (cm)</div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#314052]"><div className="h-full rounded-full transition-all" style={{ width: `${proxPct}%`, background: distColor }} /></div>
            </div>
            <div>
              <div className="text-[26px] font-black leading-none" style={{ color: C.cyan }}>{mode.toUpperCase()}</div>
              <div className="mt-5 text-[16px] uppercase tracking-wide" style={{ color: C.muted }}>Active State</div>
            </div>
          </div>
        </section>

        <section className="rounded-[16px] border p-2" style={{ background: C.panel, borderColor: C.border }}>
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((item) => (
              <button key={item.key} onClick={() => setRobotMode(item.key)} className="h-[52px] rounded-[11px] text-[18px] font-black tracking-wide active:scale-[0.98]" style={{ background: mode === item.key ? C.cyan : "transparent", color: mode === item.key ? "#020812" : C.muted }}>
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-4">
          <div className="rounded-[20px] border p-5 text-center" style={{ background: C.panel, borderColor: C.border, opacity: isManual ? 1 : 0.45 }}>
            <h2 className="mb-3 text-[16px] font-medium uppercase tracking-widest" style={{ color: C.muted }}>Drive</h2>
            <div className="flex flex-col items-center gap-8">
              <DPadButton direction="up" active={pressed === "F"} disabled={!canDrive} onDown={() => startActive("F")} onUp={stopActive} />
              <DPadButton direction="down" active={pressed === "B"} disabled={!canDrive} onDown={() => startActive("B")} onUp={stopActive} />
            </div>
          </div>

          <div className="rounded-[20px] border p-5 text-center" style={{ background: C.panel, borderColor: C.border, opacity: isManual ? 1 : 0.45 }}>
            <h2 className="mb-10 text-[16px] font-medium uppercase tracking-widest" style={{ color: C.muted }}>Steer &amp; Radar</h2>
            <div className="flex justify-center gap-4">
              <DPadButton direction="left" active={pressed === "L"} disabled={!canDrive} onDown={() => startActive("L")} onUp={stopActive} />
              <DPadButton direction="right" active={pressed === "R"} disabled={!canDrive} onDown={() => startActive("R")} onUp={stopActive} />
            </div>
            <div className="mt-9 grid grid-cols-3 gap-3">
              <MiniButton label="Look L" onClick={() => setPan(150)} />
              <MiniButton label="Center" onClick={() => setPan(90)} />
              <MiniButton label="Look R" onClick={() => setPan(30)} />
            </div>
          </div>
        </section>

        <section className="rounded-[16px] border px-5 py-4" style={{ background: C.panel, borderColor: C.border }}>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[16px] uppercase tracking-wider" style={{ color: C.muted }}>Throttle Speed</span>
            <div className="flex gap-2">
              {SPEEDS.map((item) => (
                <button key={item.value} onClick={() => setRobotSpeed(item.value)} className="h-[46px] rounded-[9px] border px-5 text-[16px] font-black active:scale-[0.98]" style={{ background: speed === item.value ? C.cyan : C.panel2, color: speed === item.value ? "#020812" : C.muted, borderColor: speed === item.value ? C.cyan : C.border }}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {connState !== "online" && <p className="text-center text-sm font-medium" style={{ color: C.muted }}>Connect first. Controls are disabled while offline for safety.</p>}
      </div>
    </main>
  );
}

function DPadButton({ direction, active, disabled, onDown, onUp }: { direction: "up" | "down" | "left" | "right"; active: boolean; disabled: boolean; onDown: () => void; onUp: () => void; }) {
  return (
    <button
      disabled={disabled}
      onPointerDown={(event) => {
        if (disabled) return;
        event.preventDefault();
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
        onDown();
      }}
      onPointerUp={(event) => { event.preventDefault(); onUp(); }}
      onPointerCancel={onUp}
      onPointerLeave={onUp}
      onLostPointerCapture={onUp}
      className="flex h-[106px] w-[106px] items-center justify-center rounded-[22px] border-[3px] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-80"
      style={{ background: active ? C.cyan : C.panel2, borderColor: active ? C.cyan : "#3b4c64", touchAction: "none" }}
      aria-label={direction}
    >
      <span className={`triangle triangle-${direction}`} />
    </button>
  );
}

function MiniButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex h-[50px] items-center justify-center gap-1 rounded-[9px] px-2 text-[16px] font-black active:scale-[0.98]" style={{ background: "#34445a", color: "#ffffff" }}>
      <EyeIcon />
      {label}
    </button>
  );
}

function WarningIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 22 20H2L12 3Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M12 9v5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M12 17.5h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z" fill="currentColor" opacity="0.95" />
      <circle cx="12" cy="12" r="2.4" fill="#34445a" />
    </svg>
  );
}