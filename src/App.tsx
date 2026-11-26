import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
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
  distributor_staff_id?: string | null;
  location_region?: string | null;
  location_province?: string | null;
  location_city?: string | null;
  location_details?: string | null;
};

type Material = {
  id: string;
  title: string | null;
  author_editor: string;
  identifying_details: string | null;
  image_path: string | null;
  active: number;
  stock_quantity?: number;
  visitor_limit?: number;
  distributed_quantity?: number;
  requires_social_checklist?: number;
};

type Staff = {
  id: string;
  name: string;
  active: number;
};

type VisitorAccessMode = "lan" | "cloudflare";
type TunnelStatus = { running: boolean; url: string | null };
type PHArea = { name: string; psgcCode: string };

const SOCIAL_LINKS = [
  {
    id: "facebook",
    label: "NFRDI Facebook Page",
    url: "https://web.facebook.com/nfrdiphilippines",
    required: true,
    action: "Like and follow",
  },
  {
    id: "tpjf",
    label: "TPJF Facebook Page",
    url: "https://web.facebook.com/TPJFNFRDI",
    required: true,
    action: "Like and follow",
  },
  {
    id: "youtube",
    label: "NFRDI YouTube",
    url: "https://www.youtube.com/@NFRDI_PHILIPPINES",
    required: true,
    action: "Subscribe",
  },
  {
    id: "x",
    label: "NFRDI on X",
    url: "https://x.com/DA_NFRDI",
    required: false,
    action: "Follow (optional)",
  },
];

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

function isInvertedName(value: string): boolean {
  const parts = value.split(",").map((part) => part.trim());
  return (
    parts.length === 2 &&
    parts.every((part) => part.length > 0) &&
    /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(parts.join(" "))
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
  showClose = true,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  onClose: () => void;
  size?: "standard" | "wide";
  showClose?: boolean;
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
        {showClose && (
          <button
            className="dialog-close"
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            ×
          </button>
        )}
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
  const [ageRange, setAgeRange] = useState("");
  const [regions, setRegions] = useState<PHArea[]>([]);
  const [provinces, setProvinces] = useState<PHArea[]>([]);
  const [cities, setCities] = useState<PHArea[]>([]);
  const [region, setRegion] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [sector, setSector] = useState("");
  const [purpose, setPurpose] = useState("");
  const [otherPurpose, setOtherPurpose] = useState("");
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [privacyNoticeRead, setPrivacyNoticeRead] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [showSocialChecklist, setShowSocialChecklist] = useState(false);
  const [socialChecks, setSocialChecks] = useState<Record<string, boolean>>({});
  const [pendingSocialId, setPendingSocialId] = useState<string | null>(null);
  const closeSocialChecklist = useCallback(
    () => setShowSocialChecklist(false),
    [],
  );
  const keepPrivacyModalOpen = useCallback(() => {}, []);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasSelectedMaterial = Object.values(quantities).some(
    (quantity) => quantity > 0,
  );
  const canSubmit =
    isInvertedName(name) &&
    Boolean(ageRange && region && province && city) &&
    (purpose !== "Other" || otherPurpose.trim().length > 0) &&
    sex.length > 0 &&
    hasSelectedMaterial;
  const needsSocialChecklist = materials.some(
    (material) =>
      material.requires_social_checklist === 1 &&
      (quantities[material.id] ?? 0) > 0,
  );
  const requiredSocialsComplete = SOCIAL_LINKS.filter(
    (item) => item.required,
  ).every((item) => socialChecks[item.id] === true);

  useEffect(() => {
    if (submitted) return;
    api<PHArea[]>("/api/locations/regions")
      .then(setRegions)
      .catch(() => setError("Could not load Philippine locations"));
    let active = true;
    const refreshSession = async (showError: boolean) => {
      try {
        const details = await api<{ session: Session; materials: Material[] }>(
          `/api/sessions/${sessionId}`,
        );
        if (!active) return;
        setSession(details.session);
        setMaterials(details.materials);
        setQuantities((current) => {
          const next = { ...current };
          const availableById = new Map(
            details.materials.map((material) => [
              material.id,
              Math.max(
                0,
                (material.stock_quantity ?? 0) -
                  (material.distributed_quantity ?? 0),
              ),
            ]),
          );
          for (const [materialId, quantity] of Object.entries(next)) {
            const material = details.materials.find(
              (item) => item.id === materialId,
            );
            if (!material) {
              next[materialId] = 0;
              continue;
            }
            const available = availableById.get(materialId) ?? 0;
            next[materialId] = Math.min(
              quantity,
              available,
              material.visitor_limit ?? 1,
            );
          }
          return next;
        });
      } catch (reason) {
        if (active && showError) {
          setError(
            reason instanceof Error ? reason.message : "Could not load session",
          );
        }
      }
    };

    void refreshSession(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshSession(false);
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [sessionId, submitted]);

  async function sendDistribution() {
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
        body: JSON.stringify({
          name,
          sex,
          ageRange,
          region,
          province,
          city,
          sector: sector || undefined,
          purpose:
            purpose === "Other"
              ? `Other: ${otherPurpose.trim()}`
              : purpose || undefined,
          privacyAccepted: true,
          entries,
        }),
      });
      setShowSocialChecklist(false);
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;
    setError("");
    if (needsSocialChecklist) {
      setShowSocialChecklist(true);
      return;
    }
    await sendDistribution();
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

  if (session.status === "active" && !privacyAccepted) {
    return (
      <main className="visitor-page">
        <Modal
          eyebrow="Privacy notice"
          title="Before you begin"
          onClose={keepPrivacyModalOpen}
          showClose={false}
        >
          <p>
            Scroll through the notice to its end to enable the acknowledgement.
          </p>
          <div
            className="privacy-notice-scroll"
            role="region"
            aria-label="Data privacy notice"
            tabIndex={0}
            onScroll={(event) => {
              const notice = event.currentTarget;
              if (
                notice.scrollTop + notice.clientHeight >=
                notice.scrollHeight - 4
              ) {
                setPrivacyNoticeRead(true);
              }
            }}
          >
            <p>
              <strong>DATA PRIVACY NOTICE:</strong> DA-NFRDI values the
              confidentiality of personal data, in accordance with the Data
              Privacy Act of 2012, its Implementing Rules and Regulations (IRR),
              other issuances of the National Privacy Commission, and other
              relevant laws in the Philippines. By signing this form, I give my
              full consent to the National Fisheries Research and Development
              Institute (NFRDI) to collect and use my personal information for
              official purposes. I also authorize NFRDI to use data to be
              collected for the purpose of processing, promotion and marketing
              in its official communication channels, research and analytics,
              monitoring and compliance with institutional and regulatory
              requirements. I understand that I may withdraw my consent at any
              time by providing written notice to NFRDI.
            </p>
          </div>
          <label className="privacy-acknowledgement">
            <input
              type="checkbox"
              checked={privacyChecked}
              disabled={!privacyNoticeRead}
              onChange={(event) => setPrivacyChecked(event.target.checked)}
            />
            <span>
              I have read and acknowledge the data privacy collection notice.
            </span>
          </label>
          <div className="button-row">
            <button
              className="button primary"
              type="button"
              disabled={!privacyNoticeRead || !privacyChecked}
              onClick={() => setPrivacyAccepted(true)}
            >
              Continue
            </button>
          </div>
        </Modal>
      </main>
    );
  }

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
                  pattern="[^,]+,\s*[^,]+"
                  title="Enter your name as Surname, First name MI (for example, Dela Cruz, Juan D.)."
                  placeholder="Surname, First name MI "
                  required
                  maxLength={200}
                  autoComplete="name"
                />
              </label>
              <label>
                <span>Age range</span>
                <select
                  value={ageRange}
                  onChange={(event) => setAgeRange(event.target.value)}
                  required
                >
                  <option value="">Select age range</option>
                  {[
                    "0–12",
                    "13–17",
                    "18–24",
                    "25–34",
                    "35–44",
                    "45–54",
                    "55–64",
                    "65+",
                  ].map((range) => (
                    <option key={range}>{range}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Region</span>
                <select
                  value={region}
                  onChange={async (event) => {
                    const code = event.target.value;
                    setRegion(code);
                    setProvince("");
                    setCity("");
                    setCities([]);
                    setProvinces(
                      code
                        ? await api<PHArea[]>(
                            `/api/locations/regions/${code}/provinces`,
                          )
                        : [],
                    );
                  }}
                  required
                >
                  <option value="">Select region</option>
                  {regions.map((item) => (
                    <option key={item.psgcCode} value={item.psgcCode}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Province</span>
                <select
                  value={province}
                  onChange={async (event) => {
                    const code = event.target.value;
                    setProvince(code);
                    setCity("");
                    setCities(
                      code
                        ? await api<PHArea[]>(
                            `/api/locations/provinces/${code}/cities`,
                          )
                        : [],
                    );
                  }}
                  required
                  disabled={!region}
                >
                  <option value="">Select province</option>
                  {provinces.map((item) => (
                    <option key={item.psgcCode} value={item.psgcCode}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>City</span>
                <select
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  required
                  disabled={!province}
                >
                  <option value="">Select city</option>
                  {cities.map((item) => (
                    <option key={item.psgcCode} value={item.psgcCode}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Sector (optional)</span>
                <select
                  value={sector}
                  onChange={(event) => setSector(event.target.value)}
                >
                  <option value="">Select sector</option>
                  {["Government", "Private", "Academe", "Independent"].map(
                    (value) => (
                      <option key={value}>{value}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                <span>Purpose of the IECs (optional)</span>
                <select
                  value={purpose}
                  onChange={(event) => {
                    setPurpose(event.target.value);
                    if (event.target.value !== "Other") setOtherPurpose("");
                  }}
                >
                  <option value="">Select purpose</option>
                  {[
                    "General Interest",
                    "Teaching Material",
                    "Government Reference",
                    "Professional Application",
                    "Media",
                    "Archive",
                    "Other",
                  ].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              {purpose === "Other" && (
                <label>
                  <span>Specify purpose</span>
                  <input
                    value={otherPurpose}
                    onChange={(event) => setOtherPurpose(event.target.value)}
                    maxLength={100}
                    pattern=".*\\S.*"
                    title="Enter a short purpose."
                    placeholder="Briefly describe the purpose"
                    required
                  />
                </label>
              )}
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
                  const available = Math.max(
                    0,
                    (material.stock_quantity ?? 0) -
                      (material.distributed_quantity ?? 0),
                  );
                  const maxQuantity = Math.min(
                    material.visitor_limit ?? 1,
                    available,
                  );
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
                        {available === 0 ? (
                          <p className="sold-out" role="status">
                            Sold out
                          </p>
                        ) : (
                          <>
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
                                max={maxQuantity}
                                value={quantity}
                                onChange={(event) =>
                                  setQuantities((current) => ({
                                    ...current,
                                    [material.id]: Math.max(
                                      0,
                                      Math.min(
                                        maxQuantity,
                                        Number(event.target.value),
                                      ),
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
                                    [material.id]: Math.min(
                                      maxQuantity,
                                      quantity + 1,
                                    ),
                                  }))
                                }
                              >
                                +
                              </button>
                            </div>
                            <small>
                              {available} {available === 1 ? "copy" : "copies"}{" "}
                              remaining · {material.visitor_limit} per visitor
                            </small>
                          </>
                        )}
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
              {isSubmitting ? "Sending request…" : "Proceed"}
            </button>
          </div>
        </form>
      )}
      {showSocialChecklist && needsSocialChecklist && (
        <Modal
          eyebrow="Tote bag requirement"
          title="Like, follow, and subscribe"
          onClose={closeSocialChecklist}
        >
          <p>
            To receive a tote bag, open and like/follow or subscribe to each
            required NFRDI page using the buttons below. Each step will be
            crossed out after its page opens. X is optional.
          </p>
          <div className="social-checklist">
            {SOCIAL_LINKS.map((item, index) => {
              const completed = socialChecks[item.id] === true;
              const previous = SOCIAL_LINKS[index - 1];
              const locked = Boolean(previous && !socialChecks[previous.id]);
              const pending = pendingSocialId === item.id;
              return (
                <div
                  className={`social-checklist-item ${completed ? "completed" : ""}`}
                  key={item.id}
                >
                  <div className="social-step-copy">
                    <strong>
                      {item.label}
                      {item.required ? " · Required" : " · Optional"}
                    </strong>
                    <small>{item.action}</small>
                  </div>
                  <button
                    className={`button ghost social-step-button ${completed ? "done" : ""}`}
                    type="button"
                    disabled={
                      completed || locked || pending || pendingSocialId !== null
                    }
                    onClick={() => {
                      if (pendingSocialId !== null || completed || locked)
                        return;
                      window.open(item.url, "_blank", "noopener,noreferrer");
                      setPendingSocialId(item.id);
                      window.setTimeout(() => {
                        setSocialChecks((current) => ({
                          ...current,
                          [item.id]: true,
                        }));
                        setPendingSocialId(null);
                      }, 1400);
                    }}
                  >
                    {completed ? (
                      <s>{item.action} · Done</s>
                    ) : pending ? (
                      "Opening page…"
                    ) : (
                      `Open page ↗`
                    )}
                  </button>
                </div>
              );
            })}
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="button-row">
            <button
              className="button ghost"
              type="button"
              onClick={closeSocialChecklist}
            >
              Back
            </button>
            <button
              className="button primary"
              type="button"
              disabled={!requiredSocialsComplete || isSubmitting}
              onClick={() => void sendDistribution()}
            >
              {isSubmitting ? "Sending request…" : "Submit request"}
            </button>
          </div>
        </Modal>
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

type ProfilePoint = { label: string; visits: number };
type DashboardVisitorProfile = {
  visits: number;
  sex: ProfilePoint[];
  ageRange: ProfilePoint[];
  sector: ProfilePoint[];
  purpose: ProfilePoint[];
  location: ProfilePoint[];
};
type DashboardScope = {
  copies: number;
  patrons: number;
  male: number;
  female: number;
  malePercentage: number;
  femalePercentage: number;
  transactions: number;
  distinctMaterials: number;
  averageCopiesPerPatron: number;
};
type StockItem = {
  id: string;
  name: string;
  brought: number;
  distributed: number;
  remaining: number;
};

type DashboardSummary = {
  overall: DashboardScope & { sessions: number };
  exhibit: (DashboardScope & { session: Session }) | null;
  profiles: {
    overall: DashboardVisitorProfile;
    exhibit: DashboardVisitorProfile | null;
  };
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

const countFormat = new Intl.NumberFormat("en-PH");
const formatCount = (value: number) => countFormat.format(value);

function formatShare(value: number, total: number): string {
  if (total <= 0 || value <= 0) return "0%";
  const share = (value / total) * 100;
  return share < 1 ? "<1%" : `${Math.round(share)}%`;
}

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
  });
}

/** Picks a round axis maximum and up to three gridlines. */
function niceScale(maxValue: number): { max: number; ticks: number[] } {
  if (maxValue <= 0) return { max: 1, ticks: [1] };
  const raw = maxValue / 3;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
    magnitude;
  const max = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];
  for (let value = step; value <= max + step / 2; value += step)
    ticks.push(value);
  return { max, ticks };
}

function DashSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="dash-section">
      <header className="dash-section-head">
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </header>
      {children}
    </section>
  );
}

function Panel({
  title,
  sub,
  span,
  children,
}: {
  title: string;
  sub?: string;
  span: 4 | 5 | 6 | 7 | 8 | 12;
  children: ReactNode;
}) {
  return (
    <article className={`dash-panel span-${span}`}>
      <header>
        <h3>{title}</h3>
        {sub && <p>{sub}</p>}
      </header>
      <div className="dash-panel-body">{children}</div>
    </article>
  );
}

function EmptyPanel({ children }: { children: ReactNode }) {
  return <div className="dash-empty">{children}</div>;
}

function Kpi({
  label,
  value,
  foot,
  hero = false,
}: {
  label: string;
  value: string;
  foot: string;
  hero?: boolean;
}) {
  return (
    <div className={`dash-kpi ${hero ? "is-hero" : ""}`}>
      <p className="eyebrow">{label}</p>
      <strong>{value}</strong>
      <small>{foot}</small>
    </div>
  );
}

/* ---------- Pie chart ---------------------------------------------------------------- */

type PieSlice = {
  label: string;
  visits: number;
  fill: string;
  share: number;
  start: number;
  end: number;
};

const PIE_FILL_COUNT = 6;

function pieFill(index: number, patternId: string): string {
  switch (index) {
    case 0:
      return "var(--blue)";
    case 1:
      return "var(--accent)";
    case 2:
      return `url(#${patternId}-hatch)`;
    case 3:
      return `url(#${patternId}-dots)`;
    case 4:
      return `url(#${patternId}-stripe)`;
    default:
      return "var(--cream)";
  }
}

function buildSlices(
  categories: ProfilePoint[],
  patternId: string,
  fixedColors: Record<string, number>,
): PieSlice[] {
  const positive = categories.filter((item) => item.visits > 0);
  const missing = positive.find((item) => item.label === "Not recorded");
  const named = positive
    .filter((item) => item.label !== "Not recorded")
    .sort((left, right) => right.visits - left.visits);

  const maxNamed = PIE_FILL_COUNT - 1 - (missing ? 1 : 0);
  const kept = named.slice(0, maxNamed);
  const rest = named.slice(maxNamed);
  const entries: Array<{ label: string; visits: number; fill: string }> = [];

  const used = new Set(Object.values(fixedColors));
  let cursor = 0;
  const nextColor = () => {
    while (used.has(cursor) && cursor < PIE_FILL_COUNT) cursor += 1;
    const index = Math.min(cursor, PIE_FILL_COUNT - 1);
    used.add(index);
    return index;
  };

  for (const item of kept) {
    const index = fixedColors[item.label] ?? nextColor();
    entries.push({ ...item, fill: pieFill(index, patternId) });
  }
  if (rest.length > 0) {
    entries.push({
      label: `Other (${rest.length})`,
      visits: rest.reduce((sum, item) => sum + item.visits, 0),
      fill: pieFill(5, patternId),
    });
  }
  if (missing) {
    entries.push({
      label: missing.label,
      visits: missing.visits,
      fill: `url(#${patternId}-grid)`,
    });
  }

  const sum = entries.reduce((total, item) => total + item.visits, 0);
  let angle = -Math.PI / 2;
  return entries.map((item) => {
    const share = sum > 0 ? item.visits / sum : 0;
    const start = angle;
    angle += share * Math.PI * 2;
    return { ...item, share, start, end: angle };
  });
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
) {
  const x0 = cx + r * Math.cos(start);
  const y0 = cy + r * Math.sin(start);
  const x1 = cx + r * Math.cos(end);
  const y1 = cy + r * Math.sin(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
}

function PieChart({
  name,
  categories,
  fixedColors = {},
}: {
  name: string;
  categories: ProfilePoint[];
  fixedColors?: Record<string, number>;
}) {
  const patternId = `pie-${useId().replace(/:/g, "")}`;
  const slices = buildSlices(categories, patternId, fixedColors);
  const total = slices.reduce((sum, slice) => sum + slice.visits, 0);

  if (total === 0)
    return <EmptyPanel>No {name.toLowerCase()} data yet</EmptyPanel>;

  const size = 200;
  const center = size / 2;
  const radius = 92;
  const summary = slices
    .map(
      (slice) =>
        `${slice.label} ${slice.visits} (${formatShare(slice.visits, total)})`,
    )
    .join(", ");

  return (
    <div className="dash-pie">
      <svg
        className="dash-pie-svg"
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${name}: ${summary}`}
      >
        <defs>
          <pattern
            id={`${patternId}-hatch`}
            width="9"
            height="9"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="9" height="9" style={{ fill: "var(--cream)" }} />
            <rect width="3.5" height="9" style={{ fill: "var(--blue)" }} />
          </pattern>
          <pattern
            id={`${patternId}-dots`}
            width="9"
            height="9"
            patternUnits="userSpaceOnUse"
          >
            <rect width="9" height="9" style={{ fill: "var(--accent)" }} />
            <circle cx="4.5" cy="4.5" r="1.8" style={{ fill: "var(--blue)" }} />
          </pattern>
          <pattern
            id={`${patternId}-stripe`}
            width="9"
            height="9"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-45)"
          >
            <rect width="9" height="9" style={{ fill: "var(--cream)" }} />
            <rect width="3.5" height="9" style={{ fill: "var(--accent)" }} />
          </pattern>
          <pattern
            id={`${patternId}-grid`}
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
          >
            <rect width="8" height="8" style={{ fill: "var(--cream)" }} />
            <path
              d="M0 0H8M0 0V8"
              style={{
                stroke: "var(--blue-muted)",
                strokeWidth: 1.5,
                fill: "none",
              }}
            />
          </pattern>
        </defs>
        {slices.length === 1 ? (
          <circle
            cx={center}
            cy={center}
            r={radius}
            style={{
              fill: slices[0].fill,
              stroke: "var(--ink)",
              strokeWidth: 3,
            }}
          />
        ) : (
          slices.map((slice) => (
            <path
              key={slice.label}
              d={arcPath(center, center, radius, slice.start, slice.end)}
              style={{
                fill: slice.fill,
                stroke: "var(--ink)",
                strokeWidth: 3,
                strokeLinejoin: "miter",
              }}
            />
          ))
        )}
        {slices
          .filter((slice) => slice.share >= 0.1)
          .map((slice) => {
            const middle = (slice.start + slice.end) / 2;
            const distance = slices.length === 1 ? 0 : radius * 0.62;
            const x = center + distance * Math.cos(middle);
            const y = center + distance * Math.sin(middle);
            return (
              <g key={`chip-${slice.label}`} aria-hidden="true">
                <rect
                  x={x - 23}
                  y={y - 12}
                  width="46"
                  height="24"
                  style={{
                    fill: "var(--cream)",
                    stroke: "var(--ink)",
                    strokeWidth: 2,
                  }}
                />
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    fill: "var(--ink)",
                    fontFamily: "var(--font-sans)",
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                >
                  {Math.round(slice.share * 100)}%
                </text>
              </g>
            );
          })}
      </svg>
      <ul className="dash-legend">
        {slices.map((slice) => (
          <li key={slice.label}>
            <svg className="dash-swatch" viewBox="0 0 22 22" aria-hidden="true">
              <rect
                x="1"
                y="1"
                width="20"
                height="20"
                style={{
                  fill: slice.fill,
                  stroke: "var(--ink)",
                  strokeWidth: 2,
                }}
              />
            </svg>
            <span title={slice.label}>{slice.label}</span>
            <b>{formatCount(slice.visits)}</b>
            <small>{formatShare(slice.visits, total)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Horizontal bar list ------------------------------------------------------ */

type BarItem = {
  key: string;
  label: string;
  value: number;
  aside?: string;
  note?: string;
  imagePath?: string | null;
  lead?: boolean;
  muted?: boolean;
};

function BarList({
  items,
  thumbnails = false,
}: {
  items: BarItem[];
  thumbnails?: boolean;
}) {
  const max = Math.max(1, ...items.map((item) => item.value));
  const allTied = items.length > 1 && items.every((item) => item.value === max);
  return (
    <ul className={`dash-bars ${thumbnails ? "has-thumbs" : ""}`}>
      {items.map((item) => (
        <li
          key={item.key}
          className={`${(item.lead ?? (!allTied && !item.muted && item.value === max)) ? "is-lead" : ""} ${item.muted ? "is-muted" : ""}`}
        >
          {thumbnails &&
            (item.imagePath ? (
              <img
                className="dash-thumb"
                src={`/uploads/${encodeURIComponent(item.imagePath)}`}
                alt=""
              />
            ) : (
              <span className="dash-thumb" aria-hidden="true">
                IEC
              </span>
            ))}
          <div className="dash-bar-body">
            <div className="dash-bar-head">
              <span title={item.label}>{item.label}</span>
              <b>{formatCount(item.value)}</b>
              {item.aside && <small>{item.aside}</small>}
            </div>
            <span className="dash-track" aria-hidden="true">
              <i
                style={{
                  width: `${item.value > 0 ? Math.max(3, (item.value / max) * 100) : 0}%`,
                }}
              />
            </span>
            {item.note && <small className="dash-bar-note">{item.note}</small>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function profileItems(points: ProfilePoint[], total: number): BarItem[] {
  return points.map((point) => ({
    key: point.label,
    label: point.label,
    value: point.visits,
    aside: formatShare(point.visits, total),
    muted: point.label === "Not recorded",
  }));
}

/** Accent for the highest column(s); no emphasis when every column is equal. */
function peakTone(values: number[], value: number): "ink" | "accent" {
  const max = Math.max(0, ...values);
  const allTied = values.length > 1 && values.every((item) => item === max);
  return max > 0 && value === max && !allTied ? "accent" : "ink";
}

/* ---------- Column chart ------------------------------------------------------------- */

type Column = {
  key: string;
  label: string;
  title: string;
  segments: Array<{ value: number; tone: "ink" | "accent" }>;
};

function ColumnChart({
  columns,
  ariaLabel,
  showValues,
}: {
  columns: Column[];
  ariaLabel: string;
  showValues: boolean;
}) {
  const totals = columns.map((column) =>
    column.segments.reduce((sum, segment) => sum + segment.value, 0),
  );
  const { max, ticks } = niceScale(Math.max(0, ...totals));
  const labelEvery = Math.max(1, Math.ceil(columns.length / 10));

  return (
    <div className="dash-cols" role="img" aria-label={ariaLabel}>
      <div className="dash-cols-axis" aria-hidden="true">
        {[0, ...ticks].map((tick) => (
          <span key={tick} style={{ bottom: `${(tick / max) * 100}%` }}>
            {formatCount(tick)}
          </span>
        ))}
      </div>
      <div className="dash-cols-plot">
        <div className="dash-cols-grid" aria-hidden="true">
          {ticks.map((tick) => (
            <i key={tick} style={{ bottom: `${(tick / max) * 100}%` }} />
          ))}
        </div>
        {columns.map((column, index) => {
          const total = totals[index];
          const height = `max(6px, ${(total / max) * 100}%)`;
          return (
            <div className="dash-col" key={column.key} title={column.title}>
              <div className="dash-col-area">
                {total > 0 && showValues && (
                  <b
                    className="dash-col-value"
                    style={{ bottom: `calc(${height} + 4px)` }}
                  >
                    {formatCount(total)}
                  </b>
                )}
                {total > 0 && (
                  <div className="dash-stack" style={{ height }}>
                    {column.segments
                      .filter((segment) => segment.value > 0)
                      .map((segment, segmentIndex) => (
                        <span
                          key={segmentIndex}
                          className={`tone-${segment.tone}`}
                          style={{ flex: `${segment.value} 1 0` }}
                        />
                      ))}
                  </div>
                )}
              </div>
              <small>{index % labelEvery === 0 ? column.label : ""}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Dashboard ---------------------------------------------------------------- */

function KpiRow({
  scope,
  stock,
}: {
  scope: DashboardScope;
  stock: StockItem[];
}) {
  const brought = stock.reduce((sum, item) => sum + item.brought, 0);
  const given = stock.reduce(
    (sum, item) => sum + Math.min(item.distributed, item.brought),
    0,
  );
  const known = scope.male + scope.female > 0;
  return (
    <div className="dash-kpis">
      <Kpi
        hero
        label="Copies distributed"
        value={formatCount(scope.copies)}
        foot={`${scope.averageCopiesPerPatron.toFixed(1)} per patron`}
      />
      <Kpi
        label="Unique patrons"
        value={formatCount(scope.patrons)}
        foot={
          known
            ? `${Math.round(scope.femalePercentage)}% female, ${Math.round(scope.malePercentage)}% male`
            : "No sex recorded"
        }
      />
      <Kpi
        label="Submissions"
        value={formatCount(scope.transactions)}
        foot={`${scope.transactions ? (scope.copies / scope.transactions).toFixed(1) : "0.0"} copies each`}
      />
      <Kpi
        label="Distinct IECs"
        value={formatCount(scope.distinctMaterials)}
        foot="Different materials given out"
      />
      {brought > 0 && (
        <Kpi
          label="Stock given out"
          value={`${Math.round((given / brought) * 100)}%`}
          foot={`${formatCount(given)} of ${formatCount(brought)} copies`}
        />
      )}
    </div>
  );
}

function StockPanel({ items }: { items: StockItem[] }) {
  const sorted = [...items].sort(
    (left, right) =>
      left.remaining / Math.max(1, left.brought) -
        right.remaining / Math.max(1, right.brought) ||
      left.name.localeCompare(right.name),
  );
  const brought = items.reduce((sum, item) => sum + item.brought, 0);
  const given = items.reduce(
    (sum, item) => sum + Math.min(item.distributed, item.brought),
    0,
  );
  return (
    <Panel
      title="Stock left"
      sub="Closest to running out first. Covers the whole exhibit, not the date range."
      span={6}
    >
      {sorted.length === 0 ? (
        <EmptyPanel>
          No stock counts for this exhibit. Set “Stock brought” when you edit
          the session.
        </EmptyPanel>
      ) : (
        <>
          <dl className="dash-stats">
            <div>
              <dt>Brought</dt>
              <dd>{formatCount(brought)}</dd>
            </div>
            <div>
              <dt>Given out</dt>
              <dd>{formatCount(given)}</dd>
            </div>
            <div>
              <dt>Left</dt>
              <dd>{formatCount(brought - given)}</dd>
            </div>
          </dl>
          <ul className="dash-bars">
            {sorted.map((item) => {
              const out = item.brought > 0 && item.remaining === 0;
              const low =
                !out &&
                item.brought > 0 &&
                item.remaining / item.brought <= 0.1;
              return (
                <li key={item.id}>
                  <div className="dash-bar-body">
                    <div className="dash-bar-head">
                      <span title={item.name}>{item.name}</span>
                      {out && <em className="dash-tag is-out">Sold out</em>}
                      {low && <em className="dash-tag is-low">Low</em>}
                      <b>{formatCount(item.remaining)}</b>
                      <small>left</small>
                    </div>
                    <span className="dash-track" aria-hidden="true">
                      <i
                        style={{
                          width: `${item.brought > 0 ? (Math.min(item.distributed, item.brought) / item.brought) * 100 : 0}%`,
                        }}
                      />
                    </span>
                    <small className="dash-bar-note">
                      {formatCount(item.distributed)} of{" "}
                      {formatCount(item.brought)} given out
                    </small>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}

function ProfileGrid({ profile }: { profile: DashboardVisitorProfile }) {
  const ageColumns: Column[] = profile.ageRange.map((item) => ({
    key: item.label,
    label: item.label === "Not recorded" ? "Blank" : item.label,
    title: `${item.label}: ${plural(item.visits, "submission", "submissions")}`,
    segments: [
      {
        value: item.visits,
        tone: peakTone(
          profile.ageRange.map((point) => point.visits),
          item.visits,
        ),
      },
    ],
  }));
  return (
    <div className="dash-grid">
      <Panel title="Age range" sub="Submissions per age group" span={8}>
        {profile.visits === 0 ? (
          <EmptyPanel>No visitor profile data for this view</EmptyPanel>
        ) : (
          <ColumnChart
            columns={ageColumns}
            showValues
            ariaLabel={`Submissions by age range. ${profile.ageRange
              .map((item) => `${item.label}: ${item.visits}`)
              .join("; ")}`}
          />
        )}
      </Panel>
      <Panel title="Sex" sub="Share of submissions" span={4}>
        <PieChart
          name="Sex"
          categories={profile.sex}
          fixedColors={{ Female: 0, Male: 1 }}
        />
      </Panel>
      <Panel title="Sector" sub="Share of submissions" span={4}>
        <PieChart name="Sector" categories={profile.sector} />
      </Panel>
      <Panel title="Home location" sub="City and province, top values" span={4}>
        {profile.visits === 0 ? (
          <EmptyPanel>No visitor profile data for this view</EmptyPanel>
        ) : (
          <BarList items={profileItems(profile.location, profile.visits)} />
        )}
      </Panel>
      <Panel title="IEC purpose" sub="Optional question, top answers" span={4}>
        {profile.visits === 0 ? (
          <EmptyPanel>No visitor profile data for this view</EmptyPanel>
        ) : (
          <BarList items={profileItems(profile.purpose, profile.visits)} />
        )}
      </Panel>
    </div>
  );
}

function DashboardPanel({ sessions }: { sessions: Session[] }) {
  const [sessionId, setSessionId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");
  const [stock, setStock] = useState<{
    sessionId: string;
    items: StockItem[];
  } | null>(null);
  const activeSession = sessions.find((session) => session.status === "active");
  const effectiveSessionId =
    sessionId || activeSession?.id || sessions[0]?.id || "";

  // Stock comes from the existing read-only GET /api/sessions/:id endpoint
  // (the same numbers the visitor page uses to enforce limits). Failures are
  // non-fatal: the stock panel just shows its empty state.
  useEffect(() => {
    if (!effectiveSessionId) return;
    let active = true;
    void api<{ session: Session; materials: Material[] }>(
      `/api/sessions/${effectiveSessionId}`,
    )
      .then((details) => {
        if (!active) return;
        const items = details.materials
          .filter((material) => (material.stock_quantity ?? 0) < 999999)
          .map((material) => {
            const brought = material.stock_quantity ?? 0;
            const distributed = material.distributed_quantity ?? 0;
            return {
              id: material.id,
              name: material.title?.trim() || material.author_editor,
              brought,
              distributed,
              remaining: Math.max(0, brought - distributed),
            };
          });
        setStock({ sessionId: effectiveSessionId, items });
      })
      .catch(() => {
        if (active) setStock({ sessionId: effectiveSessionId, items: [] });
      });
    return () => {
      active = false;
    };
  }, [effectiveSessionId]);
  const stockItems =
    stock && stock.sessionId === effectiveSessionId ? stock.items : [];

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

  const { overall, exhibit } = data;
  const hasDates = Boolean(dateFrom || dateTo);
  const dateText = hasDates
    ? `${dateFrom ? formatDate(dateFrom) : "Start"} to ${dateTo ? formatDate(dateTo) : "today"}`
    : "All dates";

  const peakTrend = data.trend.reduce(
    (peak, item) => (item.copies > peak.copies ? item : peak),
    { date: "", copies: 0 },
  );
  const trendValues = data.trend.map((item) => item.copies);
  const trendColumns: Column[] = data.trend.map((item) => ({
    key: item.date,
    label: formatDayLabel(item.date),
    title: `${formatDate(item.date)}: ${plural(item.copies, "copy", "copies")}`,
    segments: [
      { value: item.copies, tone: peakTone(trendValues, item.copies) },
    ],
  }));
  const rankedStaff = [...data.staff].sort(
    (left, right) =>
      right.copies - left.copies || right.transactions - left.transactions,
  );
  const rankedSessions = [...data.sessionVolume].sort(
    (left, right) =>
      right.copies - left.copies || right.transactions - left.transactions,
  );

  return (
    <div className="dash">
      <section
        className="dash-controls dash-controls-dates"
        aria-label="Dashboard date range"
      >
        <p className="dash-controls-label">Explore recorded activity</p>
        <label>
          <span>From</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </label>
        <label>
          <span>To</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </label>
        <button
          className="text-button"
          type="button"
          disabled={!hasDates}
          onClick={() => {
            setDateFrom("");
            setDateTo("");
          }}
        >
          Clear dates
        </button>
      </section>

      <div className="dash-body">
        <DashSection
          title="Institution-wide"
          note={`${dateText}. Patrons are counted once per name and sex. Exhibit sessions are the full historical count.`}
        >
          <div className="dash-kpis">
            <Kpi
              hero
              label="Copies distributed"
              value={formatCount(overall.copies)}
              foot={`${overall.averageCopiesPerPatron.toFixed(1)} per patron`}
            />
            <Kpi
              label="Unique patrons"
              value={formatCount(overall.patrons)}
              foot={
                overall.male + overall.female > 0
                  ? `${Math.round(overall.femalePercentage)}% female, ${Math.round(overall.malePercentage)}% male`
                  : "No sex recorded"
              }
            />
            <Kpi
              label="Submissions"
              value={formatCount(overall.transactions)}
              foot={`${overall.transactions ? (overall.copies / overall.transactions).toFixed(1) : "0.0"} copies each`}
            />
            <Kpi
              label="Distinct IECs"
              value={formatCount(overall.distinctMaterials)}
              foot="Different materials given out"
            />
            <Kpi
              label="Exhibit sessions"
              value={formatCount(overall.sessions)}
              foot="All time"
            />
          </div>
          <h3 className="dash-subhead">
            Who the library reaches
            <small>
              Counts {formatCount(data.profiles.overall.visits)} submissions, so
              repeat visits are included.
            </small>
          </h3>
          <ProfileGrid profile={data.profiles.overall} />
          <div className="dash-grid">
            <Panel
              title="Exhibits compared"
              sub="Copies given out per exhibit"
              span={12}
            >
              {rankedSessions.length === 0 ? (
                <EmptyPanel>No exhibit data</EmptyPanel>
              ) : (
                <BarList
                  items={rankedSessions.map((item) => ({
                    key: item.id,
                    label: item.name,
                    value: item.copies,
                    note: plural(
                      item.transactions,
                      "submission",
                      "submissions",
                    ),
                    lead: item.id === effectiveSessionId ? true : undefined,
                  }))}
                />
              )}
            </Panel>
          </div>
        </DashSection>

        <DashSection title="Selected exhibit">
          <section
            className="dash-controls dash-controls-exhibit"
            aria-label="Exhibit selection"
          >
            <label className="dash-scope-field">
              <span>Select exhibit</span>
              <select
                value={effectiveSessionId}
                onChange={(event) => setSessionId(event.target.value)}
              >
                {sessions.map((session) => (
                  <option value={session.id} key={session.id}>
                    {session.name} ({session.status})
                  </option>
                ))}
              </select>
            </label>
          </section>
          {exhibit && (
            <>
              <p className="dash-scope">
                <strong>{exhibit.session.name}</strong>
                <span className={`status-pill ${exhibit.session.status}`}>
                  {exhibit.session.status}
                </span>
                <span>
                  Created{" "}
                  {new Date(exhibit.session.created_at).toLocaleDateString()}
                </span>
                {data.latestSessionActivity && (
                  <span>
                    Latest submission{" "}
                    {new Date(data.latestSessionActivity).toLocaleString()}
                  </span>
                )}
              </p>
              <KpiRow scope={exhibit} stock={stockItems} />
              {data.profiles.exhibit && (
                <>
                  <h3 className="dash-subhead">
                    Who visited this exhibit
                    <small>
                      Counts {formatCount(data.profiles.exhibit.visits)}{" "}
                      submissions for this exhibit.
                    </small>
                  </h3>
                  <ProfileGrid profile={data.profiles.exhibit} />
                </>
              )}
              <div className="dash-grid">
                <Panel
                  title="Distribution trend"
                  sub={
                    peakTrend.copies > 0
                      ? `Daily copies. Peak: ${plural(peakTrend.copies, "copy", "copies")} on ${formatDayLabel(peakTrend.date)}`
                      : "Daily copies"
                  }
                  span={12}
                >
                  {trendColumns.length === 0 ? (
                    <EmptyPanel>No distribution data</EmptyPanel>
                  ) : (
                    <ColumnChart
                      columns={trendColumns}
                      showValues={trendColumns.length <= 14}
                      ariaLabel={`Daily physical copies distributed across ${trendColumns.length} dates. Peak: ${peakTrend.copies} copies on ${peakTrend.date}.`}
                    />
                  )}
                </Panel>
                <StockPanel items={stockItems} />
                <Panel
                  title="Most distributed IECs"
                  sub="Physical copies, top 10"
                  span={6}
                >
                  {data.materials.length === 0 ? (
                    <EmptyPanel>No IEC distribution data</EmptyPanel>
                  ) : (
                    <BarList
                      thumbnails
                      items={data.materials.map((item, index) => ({
                        key: `${item.name}-${index}`,
                        label: item.name,
                        value: item.copies,
                        imagePath: item.imagePath,
                      }))}
                    />
                  )}
                </Panel>
                <Panel
                  title="Distribution by staff"
                  sub="Copies handed out"
                  span={12}
                >
                  {rankedStaff.length === 0 ? (
                    <EmptyPanel>No staff distribution data</EmptyPanel>
                  ) : (
                    <BarList
                      items={rankedStaff.map((item) => ({
                        key: item.name,
                        label: item.name,
                        value: item.copies,
                        note: plural(
                          item.transactions,
                          "transaction",
                          "transactions",
                        ),
                      }))}
                    />
                  )}
                </Panel>
              </div>
            </>
          )}
        </DashSection>

        <DashSection title="Recent distribution activity">
          {data.recent.length === 0 ? (
            <EmptyPanel>No distribution activity</EmptyPanel>
          ) : (
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Patron</th>
                    <th scope="col">Sex</th>
                    <th scope="col">IEC</th>
                    <th scope="col" className="num">
                      Copies
                    </th>
                    <th scope="col">Given by</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((row, index) => (
                    <tr key={`${row.id}-${row.iecTitle}-${index}`}>
                      <td>{new Date(row.distributed_at).toLocaleString()}</td>
                      <th scope="row">{row.patronName}</th>
                      <td>{row.patronSex}</td>
                      <td>{row.iecTitle}</td>
                      <td className="num">{row.quantity}</td>
                      <td>{row.distributedBy ?? "Unknown"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DashSection>
      </div>
    </div>
  );
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
  const [stocks, setStocks] = useState<Record<string, number>>({});
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [socialChecklistFlags, setSocialChecklistFlags] = useState<
    Record<string, boolean>
  >({});
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [regions, setRegions] = useState<PHArea[]>([]);
  const [provinces, setProvinces] = useState<PHArea[]>([]);
  const [cities, setCities] = useState<PHArea[]>([]);
  const [locationRegion, setLocationRegion] = useState("");
  const [locationProvince, setLocationProvince] = useState("");
  const [locationCity, setLocationCity] = useState("");
  const [locationDetails, setLocationDetails] = useState("");
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
  const closeCreating = useCallback(() => {
    setCreating(false);
    setEditingSession(null);
    setName("");
    setDetails("");
    setSelected([]);
    setDistributorId("");
    setStocks({});
    setLimits({});
    setSocialChecklistFlags({});
    setError("");
    setLocationRegion("");
    setLocationProvince("");
    setLocationCity("");
    setLocationDetails("");
  }, []);
  const closeQr = useCallback(() => setQr(null), []);
  const closeDeleting = useCallback(() => setDeleting(null), []);

  useEffect(() => {
    api<PHArea[]>("/api/locations/regions")
      .then(setRegions)
      .catch(() => setError("Could not load Philippine locations"));
  }, []);

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
      const materialSettings = selected.map((materialId) => ({
        materialId,
        stockQuantity: stocks[materialId] ?? 0,
        visitorLimit: limits[materialId] ?? 1,
        requiresSocialChecklist: socialChecklistFlags[materialId] ?? false,
      }));
      await api<Session>(
        editingSession ? `/api/sessions/${editingSession.id}` : "/api/sessions",
        {
          method: editingSession ? "PATCH" : "POST",
          body: JSON.stringify({
            name,
            details,
            status: editingSession?.status ?? "active",
            materialSettings,
            staffId: distributorId,
            locationRegion,
            locationProvince,
            locationCity,
            locationDetails,
          }),
        },
      );
      setCreating(false);
      setName("");
      setDetails("");
      setSelected([]);
      setDistributorId("");
      setStocks({});
      setLimits({});
      setEditingSession(null);
      setSocialChecklistFlags({});
      setLocationRegion("");
      setLocationProvince("");
      setLocationCity("");
      setLocationDetails("");
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not create session",
      );
    }
  }

  async function editSession(session: Session) {
    try {
      const detailsResult = await api<{
        session: Session;
        materials: Material[];
      }>(`/api/sessions/${session.id}`);
      setEditingSession(session);
      setName(session.name);
      setDetails(session.details ?? "");
      setDistributorId(session.distributor_staff_id ?? "");
      setSelected(detailsResult.materials.map((material) => material.id));
      setStocks(
        Object.fromEntries(
          detailsResult.materials.map((material) => [
            material.id,
            material.stock_quantity ?? 0,
          ]),
        ),
      );
      setLimits(
        Object.fromEntries(
          detailsResult.materials.map((material) => [
            material.id,
            material.visitor_limit ?? 1,
          ]),
        ),
      );
      setSocialChecklistFlags(
        Object.fromEntries(
          detailsResult.materials.map((material) => [
            material.id,
            material.requires_social_checklist === 1,
          ]),
        ),
      );
      const availableRegions = regions.length
        ? regions
        : await api<PHArea[]>("/api/locations/regions");
      if (!regions.length) setRegions(availableRegions);
      const regionCode =
        availableRegions.find((item) => item.name === session.location_region)
          ?.psgcCode ?? "";
      const nextProvinces = regionCode
        ? await api<PHArea[]>(`/api/locations/regions/${regionCode}/provinces`)
        : [];
      const provinceCode =
        nextProvinces.find((item) => item.name === session.location_province)
          ?.psgcCode ?? "";
      const nextCities = provinceCode
        ? await api<PHArea[]>(`/api/locations/provinces/${provinceCode}/cities`)
        : [];
      setLocationRegion(regionCode);
      setProvinces(nextProvinces);
      setLocationProvince(provinceCode);
      setCities(nextCities);
      setLocationCity(
        nextCities.find((item) => item.name === session.location_city)
          ?.psgcCode ?? "",
      );
      setLocationDetails(session.location_details ?? "");
      setCreating(true);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not load session",
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
          onClick={() => {
            setEditingSession(null);
            setName("");
            setDetails("");
            setSelected([]);
            setDistributorId("");
            setStocks({});
            setLimits({});
            setSocialChecklistFlags({});
            setError("");
            setLocationRegion("");
            setLocationProvince("");
            setLocationCity("");
            setLocationDetails("");
            setCreating(true);
          }}
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
          title={editingSession ? "Edit session" : "Create session"}
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
            <div className="field-grid session-location-fields">
              <label>
                <span>Region</span>
                <select
                  value={locationRegion}
                  onChange={async (event) => {
                    const code = event.target.value;
                    setLocationRegion(code);
                    setLocationProvince("");
                    setLocationCity("");
                    setCities([]);
                    setProvinces(
                      code
                        ? await api<PHArea[]>(
                            `/api/locations/regions/${code}/provinces`,
                          )
                        : [],
                    );
                  }}
                  required
                >
                  <option value="">Select region</option>
                  {regions.map((item) => (
                    <option key={item.psgcCode} value={item.psgcCode}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Province</span>
                <select
                  value={locationProvince}
                  onChange={async (event) => {
                    const code = event.target.value;
                    setLocationProvince(code);
                    setLocationCity("");
                    setCities(
                      code
                        ? await api<PHArea[]>(
                            `/api/locations/provinces/${code}/cities`,
                          )
                        : [],
                    );
                  }}
                  required
                  disabled={!locationRegion}
                >
                  <option value="">Select province</option>
                  {provinces.map((item) => (
                    <option key={item.psgcCode} value={item.psgcCode}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>City</span>
                <select
                  value={locationCity}
                  onChange={(event) => setLocationCity(event.target.value)}
                  required
                  disabled={!locationProvince}
                >
                  <option value="">Select city</option>
                  {cities.map((item) => (
                    <option key={item.psgcCode} value={item.psgcCode}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="catalog-checklist">
              <legend>
                IEC materials brought and made available ({selected.length}{" "}
                selected)
              </legend>
              {materials
                .filter((material) => material.active === 1)
                .map((material) => (
                  <div
                    className={`catalog-material ${selected.includes(material.id) ? "selected" : ""}`}
                    key={material.id}
                  >
                    <label>
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
                    {selected.includes(material.id) && (
                      <div className="session-material-settings">
                        <label className="session-setting-field">
                          <span>Stock brought</span>
                          <input
                            aria-label={`Stock brought: ${material.title || material.author_editor}`}
                            type="number"
                            min="0"
                            max="999999"
                            value={stocks[material.id] ?? 0}
                            onChange={(event) =>
                              setStocks((current) => ({
                                ...current,
                                [material.id]: Math.max(
                                  0,
                                  Number(event.target.value),
                                ),
                              }))
                            }
                            required
                          />
                        </label>
                        <label className="session-setting-field">
                          <span>Limit per visitor</span>
                          <input
                            aria-label={`Limit per visitor: ${material.title || material.author_editor}`}
                            type="number"
                            min="1"
                            max="999"
                            value={limits[material.id] ?? 1}
                            onChange={(event) =>
                              setLimits((current) => ({
                                ...current,
                                [material.id]: Math.max(
                                  1,
                                  Number(event.target.value),
                                ),
                              }))
                            }
                            required
                          />
                        </label>
                        <label className="tote-bag-toggle">
                          <input
                            type="checkbox"
                            checked={socialChecklistFlags[material.id] ?? false}
                            onChange={(event) =>
                              setSocialChecklistFlags((current) => ({
                                ...current,
                                [material.id]: event.target.checked,
                              }))
                            }
                          />
                          <span>Require social checklist</span>
                        </label>
                      </div>
                    )}
                  </div>
                ))}
              {materials.filter((material) => material.active === 1).length ===
                0 && (
                <p className="form-error">
                  Add and activate at least one IEC in the catalog first.
                </p>
              )}
            </fieldset>
            <label className="session-location-details">
              <span>Specific building / location</span>
              <input
                value={locationDetails}
                onChange={(event) => setLocationDetails(event.target.value)}
                maxLength={150}
                placeholder="Building, room, or venue"
                required
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="button-row">
              <button
                className="button ghost"
                type="button"
                onClick={closeCreating}
              >
                Cancel
              </button>
              <button className="button primary" type="submit">
                {editingSession ? "Save changes" : "Create session"}
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
                onClick={() => void editSession(session)}
              >
                Edit
              </button>
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
