import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import fishSuccessAnimation from "./assets/fish-success.json";
import "./App.css";

const SuccessLottie = lazy(() =>
  import("lottie-react").then((module) => ({ default: module.LottieSvg })),
);

type Session = {
  id: string;
  name: string;
  details: string | null;
  status: "active" | "completed";
  created_at: string;
  distributor_name?: string | null;
};

type Material = {
  id: string;
  title: string | null;
  author_editor: string;
  identifying_details: string | null;
  image_path: string | null;
  active: number;
};

type Staff = {
  id: string;
  name: string;
  active: number;
};

type VisitorAccessMode = "lan" | "cloudflare";
type TunnelStatus = { running: boolean; url: string | null };

type Entry = {
  id: string;
  material_id: string | null;
  author_editor_snapshot: string;
  quantity: number;
  material_title: string | null;
};

type Distribution = {
  id: string;
  patron_name: string;
  patron_sex: string;
  staff_name: string | null;
  distributed_at: string;
  is_voided: number;
  void_reason: string | null;
  entries: Entry[];
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers:
      options?.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options?.headers },
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

function startCloudflareTunnelForCurrentPage(): Promise<TunnelStatus> {
  const webPort =
    import.meta.env.DEV && window.location.port
      ? Number(window.location.port)
      : undefined;
  return api<TunnelStatus>("/api/tunnel/start", {
    method: "POST",
    body: JSON.stringify({ webPort }),
  });
}

function normalizePersonName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-PH")
    .replace(
      /(^|[\s'-])([a-z\u00C0-\u024F])/g,
      (_match, separator: string, letter: string) =>
        `${separator}${letter.toLocaleUpperCase("en-PH")}`,
    );
}

function Brand() {
  return (
    <div className="brand" aria-label="IDEA">
      <img src="/NFRDI.png" alt="NFRDI" />
      <span className="brand-name">IDEA</span>
    </div>
  );
}

function Modal({
  eyebrow,
  title,
  children,
  onClose,
  size = "standard",
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  onClose: () => void;
  size?: "standard" | "wide";
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const scrollY = window.scrollY;
    const body = document.body;
    const previousBodyStyles = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    const firstControl = dialog?.querySelector<HTMLElement>(
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    firstControl?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab" && dialog) {
        const controls = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (controls.length === 0) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    body.classList.add("modal-open");

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      body.classList.remove("modal-open");
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.width = previousBodyStyles.width;
      body.style.overflow = previousBodyStyles.overflow;
      window.scrollTo({ top: scrollY, behavior: "auto" });
      previousActiveElement?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="dialog-backdrop modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`dialog modal-dialog ${size === "wide" ? "modal-dialog-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="central-modal-title"
      >
        <button
          className="dialog-close"
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          ×
        </button>
        <header className="modal-header">
          <p className="eyebrow">{eyebrow}</p>
          <h2 id="central-modal-title">{title}</h2>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function App() {
  const sessionPath = window.location.pathname.match(/^\/session\/([^/]+)$/);
  return sessionPath ? (
    <VisitorView sessionId={decodeURIComponent(sessionPath[1])} />
  ) : (
    <AdminView />
  );
}

function VisitorView({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [name, setName] = useState("");
  const [sex, setSex] = useState("Female");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasSelectedMaterial = Object.values(quantities).some(
    (quantity) => quantity > 0,
  );
  const canSubmit =
    name.trim().length > 0 && sex.length > 0 && hasSelectedMaterial;

  useEffect(() => {
    api<{ session: Session; materials: Material[] }>(
      `/api/sessions/${sessionId}`,
    )
      .then((details) => {
        setSession(details.session);
        setMaterials(details.materials);
      })
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : "Could not load session",
        ),
      );
  }, [sessionId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;
    setError("");
    const entries = Object.entries(quantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([materialId, quantity]) => ({ materialId, quantity }));
    if (!entries.length) {
      setError("Select at least one IEC material.");
      return;
    }
    setIsSubmitting(true);
    try {
      await api(`/api/sessions/${sessionId}/distributions`, {
        method: "POST",
        body: JSON.stringify({ name, sex, entries }),
      });
      setSubmitted(true);
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Submission failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    return (
      <main className="visitor-page success-page">
        <div className="success-card">
          <div
            className="success-icon success-lottie"
            aria-label="Request submitted successfully"
            role="img"
          >
            {reduceMotion ? (
              <span aria-hidden="true">✓</span>
            ) : (
              <Suspense fallback={<span aria-hidden="true">✓</span>}>
                <SuccessLottie
                  src={fishSuccessAnimation}
                  loop={false}
                  autoplay
                  aria-hidden="true"
                />
              </Suspense>
            )}
          </div>
          <p className="eyebrow">Request received</p>
          <h1>Thank you, {name}.</h1>
          <p>Enjoy!</p>
          <button
            className="button primary success-action"
            type="button"
            onClick={() => window.location.reload()}
          >
            Request materials again
          </button>
        </div>
      </main>
    );
  }

  if (error && !session)
    return (
      <main className="visitor-page">
        <div className="empty-state">{error}</div>
      </main>
    );
  if (!session)
    return (
      <main className="visitor-page">
        <div className="empty-state">Loading session…</div>
      </main>
    );

  return (
    <main className="visitor-page">
      <header className="visitor-header">
        <Brand />
        <div>
          <p className="eyebrow">IEC distribution</p>
          <h1>{session.name}</h1>
          {session.details && (
            <p className="session-details">{session.details}</p>
          )}
        </div>
      </header>
      {session.status !== "active" ? (
        <div className="empty-state">
          This distribution session is completed.
        </div>
      ) : (
        <form className="visitor-form" onSubmit={submit}>
          <section className="form-section">
            <div className="section-heading">
              <span>01</span>
              <div>
                <p className="eyebrow">01 — Patron details</p>
                <h2>Your information</h2>
              </div>
            </div>
            <div className="field-grid">
              <label>
                <span>Name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={() =>
                    setName((current) => normalizePersonName(current))
                  }
                  required
                  maxLength={200}
                  autoComplete="name"
                />
              </label>
              <fieldset className="sex-switch">
                <legend>Sex</legend>
                {["Female", "Male"].map((option) => (
                  <label key={option}>
                    <input
                      type="radio"
                      name="sex"
                      value={option}
                      checked={sex === option}
                      onChange={(event) => setSex(event.target.value)}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </fieldset>
            </div>
          </section>

          <section className="form-section">
            <div className="section-heading">
              <span>02</span>
              <div>
                <p className="eyebrow">02 — Materials</p>
                <h2>Select IEC materials</h2>
              </div>
            </div>
            {materials.length === 0 ? (
              <div className="empty-state">
                No materials are available for this session.
              </div>
            ) : (
              <div className="material-grid">
                {materials.map((material) => {
                  const quantity = quantities[material.id] ?? 0;
                  return (
                    <article
                      className={`material-card ${quantity > 0 ? "selected" : ""}`}
                      key={material.id}
                    >
                      {material.image_path ? (
                        <img
                          src={`/uploads/${encodeURIComponent(material.image_path)}`}
                          alt={material.title ?? material.author_editor}
                        />
                      ) : (
                        <div className="image-placeholder" aria-hidden="true">
                          IEC
                        </div>
                      )}
                      <div className="material-content">
                        {material.title && <h3>{material.title}</h3>}
                        <p>
                          <strong>Author / Editor:</strong>{" "}
                          {material.author_editor}
                        </p>
                        {material.identifying_details && (
                          <p>{material.identifying_details}</p>
                        )}
                        <div className="quantity-control">
                          <button
                            type="button"
                            aria-label={`Decrease ${material.title ?? material.author_editor}`}
                            onClick={() =>
                              setQuantities((current) => ({
                                ...current,
                                [material.id]: Math.max(0, quantity - 1),
                              }))
                            }
                          >
                            −
                          </button>
                          <input
                            aria-label="Quantity"
                            type="number"
                            min="0"
                            max="999"
                            value={quantity}
                            onChange={(event) =>
                              setQuantities((current) => ({
                                ...current,
                                [material.id]: Math.max(
                                  0,
                                  Math.min(999, Number(event.target.value)),
                                ),
                              }))
                            }
                          />
                          <button
                            type="button"
                            aria-label={`Increase ${material.title ?? material.author_editor}`}
                            onClick={() =>
                              setQuantities((current) => ({
                                ...current,
                                [material.id]: Math.min(999, quantity + 1),
                              }))
                            }
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {error && (
            <p
              key={error}
              className="form-error visitor-submit-error"
              role="alert"
            >
              {error}
            </p>
          )}
          <div className="visitor-submit-dock">
            <button
              className="button primary submit-button"
              type="submit"
              disabled={isSubmitting || !canSubmit}
              aria-busy={isSubmitting}
              aria-disabled={isSubmitting || !canSubmit}
            >
              {isSubmitting ? "Sending request…" : "Send material request"}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}

function AccessSettingsPanel({
  accessMode,
  tunnelStatus,
  tunnelBusy,
  tunnelError,
  onChange,
}: {
  accessMode: VisitorAccessMode;
  tunnelStatus: TunnelStatus;
  tunnelBusy: boolean;
  tunnelError: string;
  onChange: (mode: VisitorAccessMode) => void;
}) {
  return (
    <section className="access-settings">
      <div className="access-setting-row">
        <div>
          <p className="eyebrow">Visitor QR connection</p>
          <h2>Choose how visitors connect</h2>
          <p>
            Use the host laptop’s local Wi-Fi network or a temporary public
            Cloudflare address.
          </p>
        </div>
        <label className="access-switch">
          <span>Cloudflare tunnel</span>
          <input
            type="checkbox"
            role="switch"
            checked={accessMode === "cloudflare"}
            disabled={tunnelBusy}
            onChange={(event) =>
              onChange(event.target.checked ? "cloudflare" : "lan")
            }
            aria-label="Use Cloudflare tunnel for visitor QR codes"
          />
          <span className="access-switch-control" aria-hidden="true" />
        </label>
      </div>
      <p className="access-status" aria-live="polite">
        {tunnelBusy
          ? accessMode === "cloudflare"
            ? "Starting Cloudflare tunnel…"
            : "Stopping Cloudflare tunnel…"
          : accessMode === "cloudflare"
            ? tunnelStatus.running
              ? "Cloudflare is ready for visitor QR codes."
              : "Cloudflare tunnel is not running."
            : "Visitor QR codes use the host laptop’s local network address."}
      </p>
      {accessMode === "cloudflare" && tunnelStatus.url && (
        <p className="tunnel-address">
          <span>Current temporary address</span>
          <strong>{tunnelStatus.url}</strong>
        </p>
      )}
      {tunnelError && (
        <p className="form-error" role="alert">
          {tunnelError}
        </p>
      )}
      <p className="access-note">
        Cloudflare mode requires the <code>cloudflared</code> command on the
        host laptop and an internet connection. The temporary address changes
        when the tunnel restarts. Only visitor pages and distribution
        submissions are available through this tunnel; administration and
        records remain local.
      </p>
    </section>
  );
}

function AdminView() {
  const [tab, setTab] = useState<
    "dashboard" | "sessions" | "materials" | "staff" | "records" | "settings"
  >("dashboard");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [accessMode, setAccessMode] = useState<VisitorAccessMode>(() =>
    localStorage.getItem("idea-visitor-access-mode") === "cloudflare"
      ? "cloudflare"
      : "lan",
  );
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus>({
    running: false,
    url: null,
  });
  const [tunnelBusy, setTunnelBusy] = useState(true);
  const [tunnelError, setTunnelError] = useState("");
  const initialAccessMode = useRef(accessMode);

  useEffect(() => {
    let cancelled = false;
    async function synchronizeTunnel() {
      try {
        let status = await api<TunnelStatus>("/api/tunnel/status");
        if (initialAccessMode.current === "cloudflare" && !status.running) {
          setTunnelBusy(true);
          status = await startCloudflareTunnelForCurrentPage();
        } else if (initialAccessMode.current === "lan" && status.running) {
          status = await api<TunnelStatus>("/api/tunnel/stop", {
            method: "POST",
          });
        }
        if (!cancelled) setTunnelStatus(status);
      } catch (reason) {
        if (!cancelled)
          setTunnelError(
            reason instanceof Error
              ? reason.message
              : "Could not check the tunnel status",
          );
      } finally {
        if (!cancelled) setTunnelBusy(false);
      }
    }
    void synchronizeTunnel();
    return () => {
      cancelled = true;
    };
  }, []);

  async function changeAccessMode(mode: VisitorAccessMode) {
    setTunnelBusy(true);
    setTunnelError("");
    try {
      const status =
        mode === "cloudflare"
          ? await startCloudflareTunnelForCurrentPage()
          : await api<TunnelStatus>("/api/tunnel/stop", { method: "POST" });
      localStorage.setItem("idea-visitor-access-mode", mode);
      setAccessMode(mode);
      setTunnelStatus(status);
    } catch (reason) {
      setTunnelError(
        reason instanceof Error
          ? reason.message
          : "Could not change the visitor connection mode",
      );
    } finally {
      setTunnelBusy(false);
    }
  }

  async function refresh() {
    const [sessionList, materialList, staffList] = await Promise.all([
      api<Session[]>("/api/sessions"),
      api<Material[]>("/api/materials"),
      api<Staff[]>("/api/staff"),
    ]);
    setSessions(sessionList);
    setMaterials(materialList);
    setStaff(staffList);
  }

  useEffect(() => {
    void Promise.all([
      api<Session[]>("/api/sessions"),
      api<Material[]>("/api/materials"),
      api<Staff[]>("/api/staff"),
    ])
      .then(([sessionList, materialList, staffList]) => {
        setSessions(sessionList);
        setMaterials(materialList);
        setStaff(staffList);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <Brand />
        <nav aria-label="Administration">
          <button
            className={tab === "dashboard" ? "active" : ""}
            onClick={() => setTab("dashboard")}
          >
            Dashboard
          </button>
          <button
            className={tab === "sessions" ? "active" : ""}
            onClick={() => setTab("sessions")}
          >
            Sessions
          </button>
          <button
            className={tab === "materials" ? "active" : ""}
            onClick={() => setTab("materials")}
          >
            IEC catalog
          </button>
          <button
            className={tab === "staff" ? "active" : ""}
            onClick={() => setTab("staff")}
          >
            Staff
          </button>
          <button
            className={tab === "records" ? "active" : ""}
            onClick={() => setTab("records")}
          >
            Records
          </button>
          <button
            className={tab === "settings" ? "active" : ""}
            onClick={() => setTab("settings")}
          >
            Settings
          </button>
        </nav>
      </aside>
      <main className="admin-main tab-content" key={tab}>
        <header className="admin-header">
          <div>
            <p className="eyebrow">Administration</p>
            <h1>
              {tab === "dashboard"
                ? "Distribution dashboard"
                : tab === "sessions"
                  ? "Exhibit sessions"
                  : tab === "materials"
                    ? "IEC catalog"
                    : tab === "staff"
                      ? "Staff directory"
                      : tab === "records"
                        ? "Distribution records"
                        : "Settings"}
            </h1>
          </div>
        </header>
        {tab === "dashboard" && <DashboardPanel sessions={sessions} />}
        {tab === "sessions" && (
          <SessionsPanel
            sessions={sessions}
            materials={materials}
            staff={staff}
            refresh={refresh}
            accessMode={accessMode}
          />
        )}
        {tab === "materials" && (
          <MaterialsPanel materials={materials} refresh={refresh} />
        )}
        {tab === "staff" && <StaffPanel staff={staff} refresh={refresh} />}
        {tab === "records" && (
          <RecordsPanel sessions={sessions} materials={materials} />
        )}
        {tab === "settings" && (
          <AccessSettingsPanel
            accessMode={accessMode}
            tunnelStatus={tunnelStatus}
            tunnelBusy={tunnelBusy}
            tunnelError={tunnelError}
            onChange={(mode) => void changeAccessMode(mode)}
          />
        )}
      </main>
    </div>
  );
}

type DashboardSummary = {
  overall: {
    copies: number;
    patrons: number;
    male: number;
    female: number;
    malePercentage: number;
    femalePercentage: number;
    transactions: number;
    distinctMaterials: number;
    averageCopiesPerPatron: number;
    sessions: number;
  };
  exhibit: {
    copies: number;
    patrons: number;
    male: number;
    female: number;
    malePercentage: number;
    femalePercentage: number;
    transactions: number;
    distinctMaterials: number;
    averageCopiesPerPatron: number;
    session: Session;
  } | null;
  trend: Array<{ date: string; copies: number }>;
  materials: Array<{ name: string; imagePath: string | null; copies: number }>;
  staff: Array<{ name: string; transactions: number; copies: number }>;
  sessionVolume: Array<{
    id: string;
    name: string;
    status: string;
    transactions: number;
    copies: number;
  }>;
  recent: Array<{
    id: string;
    distributed_at: string;
    patronName: string;
    patronSex: string;
    distributedBy: string | null;
    iecTitle: string;
    quantity: number;
  }>;
  latestSessionActivity: string | null;
};

function DashboardPanel({ sessions }: { sessions: Session[] }) {
  const [sessionId, setSessionId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");
  const activeSession = sessions.find((session) => session.status === "active");
  const effectiveSessionId =
    sessionId || activeSession?.id || sessions[0]?.id || "";

  useEffect(() => {
    if (!effectiveSessionId && sessions.length === 0) {
      void api<DashboardSummary>("/api/dashboard/summary")
        .then(setData)
        .catch((reason: unknown) =>
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load dashboard",
          ),
        );
      return;
    }
    const params = new URLSearchParams();
    if (effectiveSessionId) params.set("sessionId", effectiveSessionId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    const query = params.size ? `?${params.toString()}` : "";
    void api<DashboardSummary>(`/api/dashboard/summary${query}`)
      .then(setData)
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : "Could not load dashboard",
        ),
      );
  }, [effectiveSessionId, sessions.length, dateFrom, dateTo]);

  if (error)
    return (
      <div className="empty-state" role="alert">
        {error}
      </div>
    );
  if (!data) return <div className="empty-state">Loading dashboard…</div>;

  const overall = data.overall;
  const exhibit = data.exhibit;
  const maxTrend = Math.max(1, ...data.trend.map((item) => item.copies));
  const maxMaterial = Math.max(1, ...data.materials.map((item) => item.copies));
  const maxStaff = Math.max(1, ...data.staff.map((item) => item.copies));
  const maxSession = Math.max(
    1,
    ...data.sessionVolume.map((item) => item.copies),
  );

  return (
    <div className="dashboard">
      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <p className="eyebrow">Institution-wide</p>
          <h2>01 — Overall distribution</h2>
        </div>
        <div className="dashboard-grid overall-grid">
          <Metric label="Physical copies" value={overall.copies} />
          <Metric label="Patrons served" value={overall.patrons} />
          <Metric
            label="Distribution transactions"
            value={overall.transactions}
          />
          <Metric
            label="Distinct IEC materials"
            value={overall.distinctMaterials}
          />
          <Metric label="Exhibit sessions" value={overall.sessions} />
          <Metric
            label="Average copies per patron"
            value={overall.averageCopiesPerPatron.toFixed(1)}
          />
        </div>
        <div className="dashboard-grid sex-grid">
          <SexMetric
            label="Male patrons"
            value={overall.male}
            percentage={overall.malePercentage}
          />
          <SexMetric
            label="Female patrons"
            value={overall.female}
            percentage={overall.femalePercentage}
          />
        </div>
      </section>

      <section className="dashboard-section exhibit-overview">
        <div className="exhibit-heading">
          <div>
            <p className="eyebrow">Exhibit-specific</p>
            <h2>02 — Selected exhibit</h2>
          </div>
          <label>
            <span>Select exhibit</span>
            <select
              value={effectiveSessionId}
              onChange={(event) => setSessionId(event.target.value)}
            >
              {sessions.map((session) => (
                <option value={session.id} key={session.id}>
                  {session.name} — {session.status}
                </option>
              ))}
            </select>
          </label>
          <div className="date-range">
            <label>
              <span>From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </label>
            <label>
              <span>To</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </label>
            {(dateFrom || dateTo) && (
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                }}
              >
                Clear range
              </button>
            )}
          </div>
        </div>
        {exhibit && (
          <>
            <div className="exhibit-status">
              <strong>{exhibit.session.name}</strong>
              <span className={`status-pill ${exhibit.session.status}`}>
                {exhibit.session.status}
              </span>
              {data.latestSessionActivity && (
                <span>
                  Latest:{" "}
                  {new Date(data.latestSessionActivity).toLocaleString()}
                </span>
              )}
            </div>
            <div className="dashboard-grid overall-grid exhibit-grid">
              <Metric label="Physical copies" value={exhibit.copies} />
              <Metric label="Patrons served" value={exhibit.patrons} />
              <Metric
                label="Distribution transactions"
                value={exhibit.transactions}
              />
              <Metric
                label="Distinct IEC materials"
                value={exhibit.distinctMaterials}
              />
              <Metric
                label="Average copies per patron"
                value={exhibit.averageCopiesPerPatron.toFixed(1)}
              />
            </div>
            <div className="dashboard-grid sex-grid">
              <SexMetric
                label="Male patrons"
                value={exhibit.male}
                percentage={exhibit.malePercentage}
              />
              <SexMetric
                label="Female patrons"
                value={exhibit.female}
                percentage={exhibit.femalePercentage}
              />
            </div>
          </>
        )}
      </section>

      <section className="dashboard-section analytics-grid">
        <ChartPanel title="03 — Distribution trend" eyebrow="Daily copies">
          {data.trend.length === 0 ? (
            <EmptyChart>No distribution data</EmptyChart>
          ) : (
            <div
              className="trend-chart"
              role="img"
              aria-label="Daily physical copies distributed"
            >
              {data.trend.map((item) => (
                <div className="trend-column" key={item.date}>
                  <span
                    className="trend-bar"
                    style={{
                      height: `${Math.max(8, (item.copies / maxTrend) * 100)}%`,
                    }}
                  />
                  <small>{item.date.slice(5)}</small>
                </div>
              ))}
            </div>
          )}
        </ChartPanel>

        <ChartPanel
          title="04 — Most distributed IEC"
          eyebrow="Copies distributed"
        >
          {data.materials.length === 0 ? (
            <EmptyChart>No IEC distribution data</EmptyChart>
          ) : (
            <div className="rank-list">
              {data.materials.map((item, index) => (
                <div className="rank-row" key={`${item.name}-${index}`}>
                  {item.imagePath ? (
                    <img
                      src={`/uploads/${encodeURIComponent(item.imagePath)}`}
                      alt=""
                    />
                  ) : (
                    <span className="rank-placeholder">IEC</span>
                  )}
                  <div>
                    <strong>{item.name}</strong>
                    <span className="rank-track">
                      <span
                        style={{
                          width: `${(item.copies / maxMaterial) * 100}%`,
                        }}
                      />
                    </span>
                  </div>
                  <b>{item.copies}</b>
                </div>
              ))}
            </div>
          )}
        </ChartPanel>

        <ChartPanel
          title="05 — Distribution by exhibit"
          eyebrow="Physical copies"
        >
          {data.sessionVolume.length === 0 ? (
            <EmptyChart>No exhibit data</EmptyChart>
          ) : (
            <div className="bar-list">
              {data.sessionVolume.map((item) => (
                <div className="bar-row" key={item.id}>
                  <span>{item.name}</span>
                  <div className="bar-track">
                    <span
                      style={{ width: `${(item.copies / maxSession) * 100}%` }}
                    />
                  </div>
                  <b>{item.copies}</b>
                </div>
              ))}
            </div>
          )}
        </ChartPanel>

        <ChartPanel
          title="06 — Distribution by staff"
          eyebrow="Copies and transactions"
        >
          {data.staff.length === 0 ? (
            <EmptyChart>No staff distribution data</EmptyChart>
          ) : (
            <div className="bar-list staff-bars">
              {data.staff.map((item) => (
                <div className="bar-row" key={item.name}>
                  <span>{item.name}</span>
                  <div className="bar-track">
                    <span
                      style={{ width: `${(item.copies / maxStaff) * 100}%` }}
                    />
                  </div>
                  <b>{item.copies}</b>
                  <small>{item.transactions} transactions</small>
                </div>
              ))}
            </div>
          )}
        </ChartPanel>
      </section>

      <section className="dashboard-section recent-section">
        <div className="dashboard-section-heading">
          <p className="eyebrow">Latest submissions</p>
          <h2>07 — Recent distribution activity</h2>
        </div>
        {data.recent.length === 0 ? (
          <EmptyChart>No distribution activity</EmptyChart>
        ) : (
          <div className="recent-table">
            {data.recent.map((row, index) => (
              <article key={`${row.id}-${row.iecTitle}-${index}`}>
                <time>{new Date(row.distributed_at).toLocaleString()}</time>
                <strong>{row.patronName}</strong>
                <span>{row.patronSex}</span>
                <span>{row.iecTitle}</span>
                <b>× {row.quantity}</b>
                <span>{row.distributedBy ?? "Unknown"}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <p className="eyebrow">{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function SexMetric({
  label,
  value,
  percentage,
}: {
  label: string;
  value: number;
  percentage: number;
}) {
  return (
    <div className="sex-metric">
      <div>
        <p className="eyebrow">{label}</p>
        <strong>{value}</strong>
      </div>
      <b>{percentage.toFixed(1)}%</b>
    </div>
  );
}

function ChartPanel({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <article className="chart-panel">
      <header>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
      </header>
      {children}
    </article>
  );
}

function EmptyChart({ children }: { children: ReactNode }) {
  return <div className="empty-chart">{children}</div>;
}

function SessionsPanel({
  sessions,
  materials,
  staff,
  refresh,
  accessMode,
}: {
  sessions: Session[];
  materials: Material[];
  staff: Staff[];
  refresh: () => Promise<void>;
  accessMode: VisitorAccessMode;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [details, setDetails] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [distributorId, setDistributorId] = useState("");
  const [qr, setQr] = useState<{
    url: string;
    dataUrl: string;
    mode: VisitorAccessMode;
  } | null>(null);
  const [qrError, setQrError] = useState("");
  const [deleting, setDeleting] = useState<Session | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [error, setError] = useState("");
  const closeCreating = useCallback(() => setCreating(false), []);
  const closeQr = useCallback(() => setQr(null), []);
  const closeDeleting = useCallback(() => setDeleting(null), []);

  async function createSession(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (selected.length === 0) {
      setError("Choose at least one IEC brought to this exhibit.");
      return;
    }
    if (!distributorId) {
      setError("Choose one distributor for this exhibit.");
      return;
    }
    try {
      await api<Session>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          name,
          details,
          status: "active",
          materialIds: selected,
          staffId: distributorId,
        }),
      });
      setCreating(false);
      setName("");
      setDetails("");
      setSelected([]);
      setDistributorId("");
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not create session",
      );
    }
  }

  async function deleteSession() {
    if (!deleting || deleteConfirmation !== "DELETE SESSION") return;
    setError("");
    try {
      await api(`/api/sessions/${deleting.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmation: "DELETE SESSION" }),
      });
      setDeleting(null);
      setDeleteConfirmation("");
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not delete session",
      );
    }
  }

  async function toggleStatus(session: Session) {
    await api(`/api/sessions/${session.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: session.status === "active" ? "completed" : "active",
      }),
    });
    await refresh();
  }

  async function showQr(session: Session) {
    setQrError("");
    try {
      const query = new URLSearchParams({ mode: accessMode });
      if (import.meta.env.DEV && window.location.port)
        query.set("webPort", window.location.port);
      const result = await api<{ url: string; dataUrl: string }>(
        `/api/sessions/${session.id}/qr?${query}`,
      );
      setQr({ ...result, mode: accessMode });
    } catch (reason) {
      setQrError(
        reason instanceof Error ? reason.message : "Could not generate QR code",
      );
    }
  }

  return (
    <>
      <div className="toolbar">
        <p>
          {sessions.length} session{sessions.length === 1 ? "" : "s"}
        </p>
        <button
          className="button primary"
          type="button"
          onClick={() => setCreating(true)}
        >
          Create session
        </button>
      </div>
      {qrError && (
        <p className="form-error" role="alert">
          {qrError}
        </p>
      )}
      {creating && (
        <Modal
          eyebrow="New exhibit"
          title="Create session"
          size="wide"
          onClose={closeCreating}
        >
          <form onSubmit={createSession}>
            <div className="field-grid">
              <label>
                <span>Event name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>Event details</span>
                <input
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                />
              </label>
            </div>
            <label>
              <span>Session distributor</span>
              <select
                value={distributorId}
                onChange={(event) => setDistributorId(event.target.value)}
                required
              >
                <option value="">Select one distributor</option>
                {staff
                  .filter((person) => person.active === 1)
                  .map((person) => (
                    <option value={person.id} key={person.id}>
                      {person.name}
                    </option>
                  ))}
              </select>
            </label>
            <fieldset className="catalog-checklist">
              <legend>
                IEC materials brought and made available ({selected.length}{" "}
                selected)
              </legend>
              {materials
                .filter((material) => material.active === 1)
                .map((material) => (
                  <label
                    className={selected.includes(material.id) ? "selected" : ""}
                    key={material.id}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(material.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, material.id]
                            : current.filter((id) => id !== material.id),
                        )
                      }
                    />
                    <span>
                      {material.title || material.author_editor}
                      <small>Author / Editor: {material.author_editor}</small>
                    </span>
                  </label>
                ))}
              {materials.filter((material) => material.active === 1).length ===
                0 && (
                <p className="form-error">
                  Add and activate at least one IEC in the catalog first.
                </p>
              )}
            </fieldset>
            {error && <p className="form-error">{error}</p>}
            <div className="button-row">
              <button
                className="button ghost"
                type="button"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button className="button primary" type="submit">
                Create session
              </button>
            </div>
          </form>
        </Modal>
      )}
      <div className="session-list">
        {sessions.map((session) => (
          <article className="session-card" key={session.id}>
            <div className="session-card-main">
              <div className={`status-dot ${session.status}`} />
              <div>
                <h2>{session.name}</h2>
                {session.details && <p>{session.details}</p>}
                {session.distributor_name && (
                  <p>
                    <strong>Distributor:</strong> {session.distributor_name}
                  </p>
                )}
                <small>
                  Created {new Date(session.created_at).toLocaleDateString()}
                </small>
              </div>
            </div>
            <div className="button-row">
              <button
                className="button ghost"
                type="button"
                onClick={() => showQr(session)}
              >
                QR code
              </button>
              <button
                className="button ghost"
                type="button"
                onClick={() => toggleStatus(session)}
              >
                {session.status === "active" ? "Complete" : "Activate"}
              </button>
              <button
                className="button danger-button"
                type="button"
                onClick={() => {
                  setDeleting(session);
                  setDeleteConfirmation("");
                  setError("");
                }}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
      {qr && (
        <Modal
          eyebrow={
            qr.mode === "cloudflare" ? "Cloudflare tunnel" : "Local network"
          }
          title="Session QR code"
          onClose={closeQr}
        >
          <img src={qr.dataUrl} alt="Session QR code" />
          <p className="qr-url">{qr.url}</p>
        </Modal>
      )}
      {deleting && (
        <Modal
          eyebrow="Permanent deletion"
          title={`Delete ${deleting.name}?`}
          onClose={closeDeleting}
        >
          <p>
            This will permanently remove the session and all of its distribution
            records.
          </p>
          <label>
            <span>Type DELETE SESSION to confirm</span>
            <input
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              autoComplete="off"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="button-row">
            <button
              className="button ghost"
              type="button"
              onClick={closeDeleting}
            >
              Cancel
            </button>
            <button
              className="button danger-button"
              type="button"
              disabled={deleteConfirmation !== "DELETE SESSION"}
              onClick={() => void deleteSession()}
            >
              Delete session
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function MaterialsPanel({
  materials,
  refresh,
}: {
  materials: Material[];
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [authorEditor, setAuthorEditor] = useState("");
  const [identifyingDetails, setIdentifyingDetails] = useState("");
  const [error, setError] = useState("");
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [active, setActive] = useState(true);
  const closeEditing = useCallback(() => {
    setEditing(false);
    setEditingMaterial(null);
  }, []);

  async function createMaterial(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (editingMaterial) {
        await api(`/api/materials/${editingMaterial.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title,
            authorEditor,
            identifyingDetails,
            active,
          }),
        });
      } else {
        await api("/api/materials", {
          method: "POST",
          body: JSON.stringify({
            title,
            authorEditor,
            identifyingDetails,
            active,
          }),
        });
      }
      setEditing(false);
      setEditingMaterial(null);
      setTitle("");
      setAuthorEditor("");
      setIdentifyingDetails("");
      setActive(true);
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not create material",
      );
    }
  }

  function openAddMaterial() {
    setEditingMaterial(null);
    setTitle("");
    setAuthorEditor("");
    setIdentifyingDetails("");
    setActive(true);
    setError("");
    setEditing(true);
  }

  function openEditMaterial(material: Material) {
    setEditingMaterial(material);
    setTitle(material.title ?? "");
    setAuthorEditor(material.author_editor);
    setIdentifyingDetails(material.identifying_details ?? "");
    setActive(material.active === 1);
    setError("");
    setEditing(true);
  }

  async function uploadImage(materialId: string, file: File) {
    const form = new FormData();
    form.append("image", file);
    await api(`/api/materials/${materialId}/image`, {
      method: "POST",
      body: form,
    });
    await refresh();
  }

  async function toggleMaterial(material: Material) {
    await api(`/api/materials/${material.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: material.active !== 1 }),
    });
    await refresh();
  }

  return (
    <>
      <div className="toolbar">
        <p>
          {materials.length} catalog entr{materials.length === 1 ? "y" : "ies"}
        </p>
        <button
          className="button primary"
          type="button"
          onClick={openAddMaterial}
        >
          Add material
        </button>
      </div>
      {editing && (
        <Modal
          eyebrow="IEC catalog"
          title={editingMaterial ? "Edit IEC material" : "Add IEC material"}
          onClose={closeEditing}
        >
          <form onSubmit={createMaterial}>
            <div className="field-grid">
              <label>
                <span>Title</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label>
                <span>Author / Editor</span>
                <input
                  value={authorEditor}
                  onChange={(event) => setAuthorEditor(event.target.value)}
                  required
                />
              </label>
            </div>
            <label>
              <span>Other identifying information</span>
              <input
                value={identifyingDetails}
                onChange={(event) => setIdentifyingDetails(event.target.value)}
              />
            </label>
            {editingMaterial && (
              <div className="edit-material-image">
                {editingMaterial.image_path ? (
                  <img
                    src={`/uploads/${encodeURIComponent(editingMaterial.image_path)}`}
                    alt={title || authorEditor}
                  />
                ) : (
                  <div className="image-placeholder">No image</div>
                )}
                <div>
                  <label className="upload-button">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file)
                          void uploadImage(editingMaterial.id, file).then(
                            async () => {
                              const refreshed =
                                await api<Material[]>("/api/materials");
                              const updated = refreshed.find(
                                (material) =>
                                  material.id === editingMaterial.id,
                              );
                              if (updated) setEditingMaterial(updated);
                              await refresh();
                            },
                          );
                      }}
                    />
                    {editingMaterial.image_path
                      ? "Replace image"
                      : "Upload image"}
                  </label>
                  {editingMaterial.image_path && (
                    <button
                      className="text-button danger"
                      type="button"
                      onClick={async () => {
                        await api(
                          `/api/materials/${editingMaterial.id}/image`,
                          { method: "DELETE" },
                        );
                        setEditingMaterial({
                          ...editingMaterial,
                          image_path: null,
                        });
                        await refresh();
                      }}
                    >
                      Remove image
                    </button>
                  )}
                </div>
              </div>
            )}
            <label className="status-checkbox">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />
              <span>Catalog entry is active</span>
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="button-row">
              <button
                className="button ghost"
                type="button"
                onClick={() => {
                  setEditing(false);
                  setEditingMaterial(null);
                }}
              >
                Cancel
              </button>
              <button className="button primary" type="submit">
                {editingMaterial ? "Save changes" : "Add material"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      <div className="catalog-grid">
        {materials.map((material) => (
          <article className="catalog-card" key={material.id}>
            {material.image_path ? (
              <img
                src={`/uploads/${encodeURIComponent(material.image_path)}`}
                alt={material.title ?? material.author_editor}
              />
            ) : (
              <div className="image-placeholder">No image</div>
            )}
            <div className="catalog-card-content">
              {material.title && <h2>{material.title}</h2>}
              <p>
                <strong>Author / Editor:</strong> {material.author_editor}
              </p>
              {material.identifying_details && (
                <p>{material.identifying_details}</p>
              )}
              <button
                className="button ghost full"
                type="button"
                onClick={() => openEditMaterial(material)}
              >
                Edit material
              </button>
              <label className="upload-button">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadImage(material.id, file);
                  }}
                />
                {material.image_path ? "Replace image" : "Upload image"}
              </label>
              {material.image_path && (
                <button
                  className="text-button"
                  type="button"
                  onClick={async () => {
                    await api(`/api/materials/${material.id}/image`, {
                      method: "DELETE",
                    });
                    await refresh();
                  }}
                >
                  Remove image
                </button>
              )}
              <button
                className="button ghost full"
                type="button"
                onClick={() => toggleMaterial(material)}
              >
                {material.active === 1 ? "Deactivate" : "Activate"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function StaffPanel({
  staff,
  refresh,
}: {
  staff: Staff[];
  refresh: () => Promise<void>;
}) {
  const [name, setName] = useState("");

  async function addStaff(event: FormEvent) {
    event.preventDefault();
    await api("/api/staff", {
      method: "POST",
      body: JSON.stringify({ name, active: true }),
    });
    setName("");
    await refresh();
  }

  return (
    <>
      <div className="panel form-panel">
        <h2>Add staff member</h2>
        <form className="inline-form" onSubmit={addStaff}>
          <label>
            <span>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => setName((current) => normalizePersonName(current))}
              required
            />
          </label>
          <button className="button primary" type="submit">
            Add staff
          </button>
        </form>
      </div>
      <div className="table-panel">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((person) => (
              <tr key={person.id}>
                <td>{person.name}</td>
                <td>
                  <span
                    className={`status-pill ${person.active === 1 ? "active" : "inactive"}`}
                  >
                    {person.active === 1 ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  <button
                    className="text-button"
                    type="button"
                    onClick={async () => {
                      await api(`/api/staff/${person.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ active: person.active !== 1 }),
                      });
                      await refresh();
                    }}
                  >
                    {person.active === 1 ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RecordsPanel({
  sessions,
  materials,
}: {
  sessions: Session[];
  materials: Material[];
}) {
  const [sessionId, setSessionId] = useState("");
  const [records, setRecords] = useState<Distribution[]>([]);
  const [search, setSearch] = useState("");
  const [correcting, setCorrecting] = useState<Distribution | null>(null);
  const [name, setName] = useState("");
  const [sex, setSex] = useState("Female");
  const [entries, setEntries] = useState<
    Array<{ materialId: string; quantity: number }>
  >([]);

  async function loadRecords(id: string) {
    setSessionId(id);
    if (!id) {
      setRecords([]);
      return;
    }
    setRecords(await api<Distribution[]>(`/api/sessions/${id}/distributions`));
  }

  function beginCorrection(record: Distribution) {
    setCorrecting(record);
    setName(record.patron_name);
    setSex(record.patron_sex);
    setEntries(
      record.entries.map((entry) => ({
        materialId: entry.material_id ?? "",
        quantity: entry.quantity,
      })),
    );
  }

  async function saveCorrection(event: FormEvent) {
    event.preventDefault();
    if (!correcting) return;
    await api(`/api/distributions/${correcting.id}/correct`, {
      method: "POST",
      body: JSON.stringify({ name, sex, entries }),
    });
    setCorrecting(null);
    await loadRecords(sessionId);
  }

  async function voidRecord(record: Distribution) {
    const reason = window.prompt("Reason for voiding this distribution:");
    if (!reason?.trim()) return;
    await api(`/api/distributions/${record.id}/void`, {
      method: "POST",
      body: JSON.stringify({ reason: reason.trim() }),
    });
    await loadRecords(sessionId);
  }

  const visibleRecords = records.filter((record) => {
    const haystack =
      `${record.patron_name} ${record.patron_sex} ${record.staff_name ?? ""} ${record.entries.map((entry) => entry.author_editor_snapshot).join(" ")}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });
  const totalCopies = visibleRecords
    .filter((record) => record.is_voided === 0)
    .reduce(
      (total, record) =>
        total + record.entries.reduce((sum, entry) => sum + entry.quantity, 0),
      0,
    );

  return (
    <>
      <div className="record-toolbar">
        <label>
          <span>Session</span>
          <select
            value={sessionId}
            onChange={(event) => void loadRecords(event.target.value)}
          >
            <option value="">Select a session</option>
            {sessions.map((session) => (
              <option value={session.id} key={session.id}>
                {session.name}
              </option>
            ))}
          </select>
        </label>
        <label className="search-field">
          <span>Search records</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, staff, or IEC author"
            disabled={!sessionId}
          />
        </label>
        {sessionId && (
          <a
            className="button primary"
            href={`/api/sessions/${sessionId}/export`}
            download
          >
            Export .xlsx
          </a>
        )}
      </div>
      {sessionId && (
        <div className="metrics">
          <div>
            <p className="eyebrow">Active transactions</p>
            <strong>
              {visibleRecords.filter((record) => record.is_voided === 0).length}
            </strong>
          </div>
          <div>
            <p className="eyebrow">Physical copies</p>
            <strong>{totalCopies}</strong>
          </div>
        </div>
      )}
      {correcting && (
        <div className="panel form-panel correction-panel">
          <h2>Correct distribution</h2>
          <p className="correction-note">
            The original transaction is preserved and voided; a corrected
            transaction will be created.
          </p>
          <form onSubmit={saveCorrection}>
            <div className="field-grid">
              <label>
                <span>Name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>Sex</span>
                <select
                  value={sex === "Female" || sex === "Male" ? sex : "Female"}
                  onChange={(event) => setSex(event.target.value)}
                >
                  <option>Female</option>
                  <option>Male</option>
                </select>
              </label>
            </div>
            <div className="correction-entries">
              {entries.map((entry, index) => (
                <div className="correction-entry" key={index}>
                  <label>
                    <span>IEC material</span>
                    <select
                      value={entry.materialId}
                      onChange={(event) =>
                        setEntries((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, materialId: event.target.value }
                              : item,
                          ),
                        )
                      }
                    >
                      {materials.map((material) => (
                        <option value={material.id} key={material.id}>
                          {material.title || material.author_editor}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Quantity</span>
                    <input
                      type="number"
                      min="1"
                      max="999"
                      value={entry.quantity}
                      onChange={(event) =>
                        setEntries((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  quantity: Number(event.target.value),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      setEntries((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  setEntries((current) => [
                    ...current,
                    { materialId: materials[0]?.id ?? "", quantity: 1 },
                  ])
                }
              >
                Add IEC entry
              </button>
            </div>
            <div className="button-row">
              <button
                className="button ghost"
                type="button"
                onClick={() => setCorrecting(null)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={
                  !entries.length ||
                  entries.some(
                    (entry) => !entry.materialId || entry.quantity < 1,
                  )
                }
              >
                Save correction
              </button>
            </div>
          </form>
        </div>
      )}
      {sessionId && (
        <div className="record-list">
          {visibleRecords.map((record) => (
            <article
              className={`record-card ${record.is_voided === 1 ? "voided" : ""}`}
              key={record.id}
            >
              <div className="record-main">
                <div>
                  <h2>{record.patron_name}</h2>
                  <p>
                    {record.patron_sex} · Distributed by{" "}
                    {record.staff_name ?? "Unknown"}
                  </p>
                  <small>
                    {new Date(record.distributed_at).toLocaleString()}
                  </small>
                </div>
                {record.is_voided === 1 && (
                  <span className="status-pill inactive">Voided</span>
                )}
              </div>
              <div className="entry-list">
                {record.entries.map((entry) => (
                  <div key={entry.id}>
                    <span>
                      {entry.material_title || entry.author_editor_snapshot}
                    </span>
                    <strong>× {entry.quantity}</strong>
                  </div>
                ))}
              </div>
              {record.is_voided === 0 && (
                <div className="button-row">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => beginCorrection(record)}
                  >
                    Correct
                  </button>
                  <button
                    className="text-button danger"
                    type="button"
                    onClick={() => voidRecord(record)}
                  >
                    Void
                  </button>
                </div>
              )}
            </article>
          ))}
          {visibleRecords.length === 0 && (
            <div className="empty-state">
              No distribution records match this view.
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default App;
