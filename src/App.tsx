import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CopyCheck,
  FolderPlus,
  Library,
  Link2,
  Loader2,
  MonitorCheck,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Wrench,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  LANGUAGES,
  type Language,
  agentStatusLabel,
  detectionKindLabel,
  issueLabel,
  normalizeLanguage,
  opTypeLabel,
  riskLabel,
  statusLabel,
  t
} from "./i18n";
import type {
  AgentTarget,
  AgentRecord,
  ApplyResult,
  InventorySnapshot,
  Settings,
  SkillInstallation,
  SkillIssue,
  SkillRecord,
  SyncPlan
} from "./types";

type View = "agents" | "skills" | "preview" | "settings";

const defaultSettings: Settings = {
  libraryPath: "",
  projectFolders: [],
  customRoots: [],
  showRawPaths: false,
  language: "zh-CN"
};

export default function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [draftSettings, setDraftSettings] = useState<Settings>(defaultSettings);
  const [inventory, setInventory] = useState<InventorySnapshot | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [view, setView] = useState<View>("skills");
  const [query, setQuery] = useState("");
  const [includeOrphaned, setIncludeOrphaned] = useState(false);
  const [syncPlan, setSyncPlan] = useState<SyncPlan | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState("Starting");
  const [error, setError] = useState<string | null>(null);
  const language = normalizeLanguage(settings.language);
  const draftLanguage = normalizeLanguage(draftSettings.language);

  useEffect(() => {
    void boot();
  }, []);

  const filteredSkills = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!inventory) return [];
    if (!text) return inventory.skills;
    return inventory.skills.filter((skill) => {
      const haystack = [
        skill.displayName,
        skill.slug,
        skill.description ?? "",
        skill.installations.map((installation) => installation.agentLabel).join(" ")
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(text);
    });
  }, [inventory, query]);

  async function boot() {
    setBusy("Loading settings");
    setError(null);
    try {
      const loaded = await invoke<Settings>("get_settings");
      setSettings(loaded);
      setDraftSettings(loaded);
      await refreshInventory(false);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function refreshInventory(orphaned = includeOrphaned) {
    setBusy("Scanning skills");
    setError(null);
    try {
      const next = await invoke<InventorySnapshot>("scan_inventory", {
        options: { includeOrphaned: orphaned }
      });
      setInventory(next);
      setSelectedSkillId((current) => current && next.skills.some((skill) => skill.id === current) ? current : null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function previewAdopt(skill: SkillRecord) {
    const source = firstValidInstallation(skill);
    if (!source) return;
    setBusy("Planning import");
    setError(null);
    setApplyResult(null);
    try {
      const plan = await invoke<SyncPlan>("preview_adopt", {
        source: {
          installationId: source.id,
          entryPath: source.entryPath,
          slug: skill.slug
        }
      });
      setSyncPlan(plan);
      setView("preview");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function previewSync(skill: SkillRecord, targets?: AgentTarget[]) {
    setBusy("Planning sync");
    setError(null);
    setApplyResult(null);
    try {
      const validInstall = firstValidInstallation(skill);
      const plan = skill.canonicalStatus === "imported"
        ? await invoke<SyncPlan>("preview_sync", {
            skillId: skill.id,
            targets: targets ?? []
          })
        : await invoke<SyncPlan>("preview_sync_from_installation", {
            source: validInstall
              ? {
                  installationId: validInstall.id,
                  entryPath: validInstall.entryPath,
                  slug: skill.slug
                }
              : {
                  installationId: "",
                  entryPath: "",
                  slug: skill.slug
                },
            targets: targets ?? []
          });
      setSyncPlan(plan);
      setView("preview");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function applyPlan() {
    if (!syncPlan) return;
    setBusy("Applying plan");
    setError(null);
    try {
      const result = await invoke<ApplyResult>("apply_sync_plan", {
        planId: syncPlan.planId
      });
      setApplyResult(result);
      if (result.inventoryRefreshRecommended && result.errors.length === 0) {
        await refreshInventory();
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function saveSettings() {
    setBusy("Saving settings");
    setError(null);
    try {
      const saved = await invoke<Settings>("save_settings", { settings: draftSettings });
      setSettings(saved);
      setDraftSettings(saved);
      await refreshInventory();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function addProjectFolder() {
    const selected = await open({ directory: true, multiple: false, title: t(language, "projectFolders") });
    if (typeof selected !== "string") return;
    setDraftSettings((current) => ({
      ...current,
      projectFolders: Array.from(new Set([...current.projectFolders, selected]))
    }));
  }

  function updateLanguage(nextLanguage: Language) {
    const nextSettings = { ...settings, language: nextLanguage };
    setSettings(nextSettings);
    setDraftSettings((current) => ({ ...current, language: nextLanguage }));
    void invoke<Settings>("save_settings", { settings: nextSettings })
      .then((saved) => {
        setSettings(saved);
        setDraftSettings((current) => ({ ...current, language: saved.language }));
      })
      .catch((reason) => setError(String(reason)));
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={20} />
          </div>
          <div>
            <strong>Oh My Skills</strong>
            <span>{t(language, "appSubtitle")}</span>
          </div>
        </div>

        <nav className="nav">
          <NavButton icon={<MonitorCheck size={17} />} active={view === "agents"} onClick={() => setView("agents")}>
            {t(language, "navAgents")}
          </NavButton>
          <NavButton icon={<Library size={17} />} active={view === "skills"} onClick={() => setView("skills")}>
            {t(language, "navSkills")}
          </NavButton>
          <NavButton icon={<ShieldCheck size={17} />} active={view === "preview"} onClick={() => setView("preview")}>
            {t(language, "navPreview")}
          </NavButton>
          <NavButton icon={<SettingsIcon size={17} />} active={view === "settings"} onClick={() => setView("settings")}>
            {t(language, "navSettings")}
          </NavButton>
        </nav>

        <div className="sidebar-stat">
          <span>{t(language, "statTotalAgents")}</span>
          <strong>{inventory?.agents.length ?? 0}</strong>
        </div>
        <div className="sidebar-stat">
          <span>{t(language, "statSkills")}</span>
          <strong>{inventory?.skills.length ?? 0}</strong>
        </div>
        <div className="sidebar-stat">
          <span>{t(language, "statAgents")}</span>
          <strong>{inventory?.agents.filter((agent) => agent.installed).length ?? 0}</strong>
        </div>
        <div className="sidebar-stat danger">
          <span>{t(language, "statIssues")}</span>
          <strong>{inventory?.issues.length ?? 0}</strong>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="searchbox">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t(language, "searchPlaceholder")}
            />
          </div>
          <LanguageSwitch language={language} onChange={updateLanguage} />
          <label className="toggle">
            <input
              type="checkbox"
              checked={includeOrphaned}
              onChange={(event) => {
                setIncludeOrphaned(event.target.checked);
                void refreshInventory(event.target.checked);
              }}
            />
            {t(language, "includeOrphaned")}
          </label>
          <button className="icon-button" onClick={() => void refreshInventory()} title={t(language, "rescan")}>
            {busy ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
          </button>
        </header>

        {error && (
          <div className="banner error">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}

        {view === "agents" && inventory && (
          <AgentsView inventory={inventory} language={language} />
        )}
        {view === "skills" && (
          <SkillsView
            skills={filteredSkills}
            selectedSkillId={selectedSkillId}
            onSelect={setSelectedSkillId}
            settings={settings}
            agents={inventory?.agents ?? []}
            onAdopt={(skill) => void previewAdopt(skill)}
            onSync={(skill, target) => void previewSync(skill, [target])}
            language={language}
          />
        )}
        {view === "preview" && (
          <PreviewView
            plan={syncPlan}
            applyResult={applyResult}
            busy={Boolean(busy)}
            onApply={() => void applyPlan()}
            language={language}
          />
        )}
        {view === "settings" && (
          <SettingsView
            settings={draftSettings}
            activeSettings={settings}
            inventory={inventory}
            onChange={setDraftSettings}
            onSave={() => void saveSettings()}
            onAddProjectFolder={() => void addProjectFolder()}
            language={draftLanguage}
          />
        )}
      </section>

    </main>
  );
}

function NavButton({
  icon,
  active,
  children,
  onClick
}: {
  icon: React.ReactNode;
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      <span>{children}</span>
      {active && <ChevronRight size={16} />}
    </button>
  );
}

function LanguageSwitch({
  language,
  onChange
}: {
  language: Language;
  onChange: (language: Language) => void;
}) {
  return (
    <div className="language-switch" aria-label="Language">
      {LANGUAGES.map((item) => (
        <button
          key={item.code}
          className={language === item.code ? "active" : ""}
          onClick={() => onChange(item.code)}
          title={item.label}
        >
          {item.shortLabel}
        </button>
      ))}
    </div>
  );
}

function AgentsView({
  inventory,
  language
}: {
  inventory: InventorySnapshot;
  language: Language;
}) {
  const installedCount = inventory.agents.filter((agent) => agent.installed).length;

  return (
    <div className="panel">
      <div className="panel-title">
        <div>
          <h1>{t(language, "agentsTitle")}</h1>
          <p>{t(language, "agentsDescription")}</p>
        </div>
        <span className="path-chip">
          {installedCount}/{inventory.agents.length} {t(language, "agentInstalled")}
        </span>
      </div>

      <div className="table agent-table">
        <div className="thead grid-agents">
          <span>{t(language, "tableAgent")}</span>
          <span>{t(language, "tableInstallState")}</span>
          <span>{t(language, "tableSkillRoots")}</span>
          <span>{t(language, "tableDetectionSignals")}</span>
        </div>
        <div className="tbody">
          {inventory.agents.map((agent) => (
            <div className="tr grid-agents agent-row" key={agent.id}>
              <span>
                <strong>{agent.label}</strong>
                <small>{agent.globalRoots.join(" · ")}</small>
              </span>
              <span>
                <AgentStatusPill agent={agent} language={language} />
              </span>
              <span className="root-summary">
                {agent.skillRoots.length === 0 && <em>{t(language, "agentRootMissing")}</em>}
                {agent.skillRoots.map((root) => (
                  <span
                    key={`${root.scope}-${root.path}`}
                    className={`root-chip ${root.orphaned ? "orphaned" : root.exists ? "ready" : "missing"}`}
                    title={root.path}
                  >
                    {root.scope}: {root.orphaned
                      ? t(language, "agentRootOrphaned")
                      : root.exists
                        ? t(language, "agentRootReady")
                        : t(language, "agentRootMissing")}
                  </span>
                ))}
                {agent.skillEntryCount > 0 && <em>{agent.skillEntryCount}</em>}
              </span>
              <span className="signal-list">
                {agent.detectionSources.length === 0 && <em>{t(language, "noDetectionSignals")}</em>}
                {agent.detectionSources.map((source) => (
                  <span className="signal-chip" title={source.path} key={`${source.kind}-${source.path}`}>
                    {detectionKindLabel(language, source.kind)}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SkillsView({
  skills,
  selectedSkillId,
  onSelect,
  settings,
  agents,
  onAdopt,
  onSync,
  language
}: {
  skills: SkillRecord[];
  selectedSkillId: string | null;
  onSelect: (id: string | null) => void;
  settings: Settings;
  agents: AgentRecord[];
  onAdopt: (skill: SkillRecord) => void;
  onSync: (skill: SkillRecord, target: AgentTarget) => void;
  language: Language;
}) {
  return (
    <div className="panel skills-workbench">
      <div className="panel-title">
        <div>
          <h1>{t(language, "skillsTitle")}</h1>
          <p>{t(language, "skillsDescription")}</p>
        </div>
        <span className="path-chip">{settings.libraryPath || t(language, "libraryNotInitialized")}</span>
      </div>

      <div className="skill-card-list">
        {skills.map((skill) => {
          const expanded = selectedSkillId === skill.id;
          return (
            <SkillCard
              key={skill.id}
              skill={skill}
              expanded={expanded}
              agents={agents}
              settings={settings}
              onToggle={() => onSelect(expanded ? null : skill.id)}
              onAdopt={onAdopt}
              onSync={onSync}
              language={language}
            />
          );
        })}
      </div>
    </div>
  );
}

function SkillCard({
  skill,
  expanded,
  agents,
  settings,
  onToggle,
  onAdopt,
  onSync,
  language
}: {
  skill: SkillRecord;
  expanded: boolean;
  agents: AgentRecord[];
  settings: Settings;
  onToggle: () => void;
  onAdopt: (skill: SkillRecord) => void;
  onSync: (skill: SkillRecord, target: AgentTarget) => void;
  language: Language;
}) {
  const validInstall = firstValidInstallation(skill);
  const currentPath = skill.canonicalPath ?? validInstall?.entryPath ?? skill.installations[0]?.entryPath;
  const source = inferSkillSource(currentPath, skill);
  const missingAgents = agents.filter((agent) => agent.installed && skill.missingAgents.includes(agent.id));
  const installedAgents = skill.installations.slice(0, 5);
  const canProjectSync = settings.projectFolders.length > 0;

  return (
    <article className={`skill-card ${expanded ? "expanded" : ""}`}>
      <button className="skill-card-summary" onClick={onToggle}>
        <span className="skill-card-title">
          <strong>{skill.displayName}</strong>
          <small>{skill.description || skill.slug}</small>
        </span>
        <span className="skill-card-meta">
          <Coverage skill={skill} />
          <StatePill skill={skill} language={language} />
          <span className="agent-list compact">
            {installedAgents.map((installation) => (
              <AgentBadge
                key={installation.id}
                label={installation.agentLabel}
                status={installation.status}
                language={language}
              />
            ))}
            {skill.installations.length > installedAgents.length && (
              <em>+{skill.installations.length - installedAgents.length}</em>
            )}
          </span>
        </span>
      </button>

      {expanded && (
        <div className="skill-card-detail">
          <div className="skill-detail-grid">
            <InfoBlock label={t(language, "currentPath")} value={currentPath ?? t(language, "unknown")} code />
            <InfoBlock label={t(language, "source")} value={sourceLabel(language, source)} />
            <InfoBlock label={t(language, "description")} value={skill.description || t(language, "noDescription")} />
          </div>

          <div className="card-section">
            <div className="section-heading">
              <h3>{t(language, "syncTargets")}</h3>
              <button
                className="secondary-button"
                disabled={skill.canonicalStatus === "imported" || !validInstall}
                onClick={() => onAdopt(skill)}
              >
                <Library size={15} />
                {t(language, "import")}
              </button>
            </div>

            <div className="sync-target-grid">
              {missingAgents.length === 0 && <span className="muted">{t(language, "noMissingAgents")}</span>}
              {missingAgents.map((agent) => (
                <div className="sync-target" key={agent.id}>
                  <strong>{agent.label}</strong>
                  <div>
                    <button
                      className="secondary-button"
                      disabled={!validInstall}
                      onClick={() => onSync(skill, { agentId: agent.id, scope: "global" })}
                    >
                      <Link2 size={14} />
                      {t(language, "syncGlobal")}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={!validInstall || !canProjectSync || agent.projectRoots.length === 0}
                      onClick={() => onSync(skill, { agentId: agent.id, scope: "project" })}
                    >
                      <Link2 size={14} />
                      {t(language, "syncProject")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {skill.installations.length > 0 && (
            <div className="card-section">
              <h3>{t(language, "installedIn")}</h3>
              <div className="install-list inline">
                {skill.installations.map((installation) => (
                  <div className="install-row" key={installation.id}>
                    <AgentBadge label={installation.agentLabel} status={installation.status} language={language} />
                    <span>{installation.scope}</span>
                    {installation.isSymlink && <Link2 size={14} />}
                    {installation.issues.length > 0 && <AlertTriangle size={14} />}
                    {settings.showRawPaths && <code>{installation.entryPath}</code>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {skill.issues.length > 0 && (
            <div className="card-section">
              <h3>{t(language, "issues")}</h3>
              <IssueList issues={skill.issues} language={language} />
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function InfoBlock({
  label,
  value,
  code = false
}: {
  label: string;
  value: string;
  code?: boolean;
}) {
  return (
    <div className="info-block">
      <span>{label}</span>
      {code ? <code>{value}</code> : <strong>{value}</strong>}
    </div>
  );
}

function CompareView({
  inventory,
  skills,
  language
}: {
  inventory: InventorySnapshot;
  skills: SkillRecord[];
  language: Language;
}) {
  const visibleAgents = inventory.agents.filter((agent) => agent.installed);
  const matrixAgents = visibleAgents.length > 0 ? visibleAgents : inventory.agents;

  return (
    <div className="panel compare-panel">
      <div className="panel-title">
        <div>
          <h1>{t(language, "compareTitle")}</h1>
          <p>{t(language, "compareDescription")}</p>
        </div>
      </div>
      <div className="matrix">
        <div className="matrix-row matrix-head" style={{ gridTemplateColumns: matrixColumns(matrixAgents.length) }}>
          <span>{t(language, "tableSkill")}</span>
          {matrixAgents.map((agent) => (
            <span key={agent.id}>{agent.label}</span>
          ))}
        </div>
        {skills.map((skill) => (
          <div className="matrix-row" key={skill.id} style={{ gridTemplateColumns: matrixColumns(matrixAgents.length) }}>
            <strong>{skill.displayName}</strong>
            {matrixAgents.map((agent) => {
              const installation = skill.installations.find((item) => item.agentId === agent.id);
              return <MatrixCell key={agent.id} installation={installation} language={language} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewView({
  plan,
  applyResult,
  busy,
  onApply,
  language
}: {
  plan: SyncPlan | null;
  applyResult: ApplyResult | null;
  busy: boolean;
  onApply: () => void;
  language: Language;
}) {
  if (!plan) {
    return (
      <div className="empty-state">
        <ShieldCheck size={34} />
        <h1>{t(language, "noPlanTitle")}</h1>
        <p>{t(language, "noPlanDescription")}</p>
      </div>
    );
  }

  const blocked = plan.blockedConflicts.length > 0;

  return (
    <div className="panel">
      <div className="panel-title">
        <div>
          <h1>{plan.kind === "adopt" ? t(language, "importPreview") : t(language, "syncPreview")}</h1>
          <p>{plan.planId} · {riskLabel(language, plan.riskLevel)}</p>
        </div>
        <button className="primary-button" disabled={blocked || busy} onClick={onApply}>
          <CopyCheck size={17} />
          {t(language, "applyPlan")}
        </button>
      </div>

      {blocked && (
        <div className="banner warning">
          <AlertTriangle size={18} />
          <span>{plan.blockedConflicts.join(" · ")}</span>
        </div>
      )}

      {plan.preconditions.length > 0 && (
        <div className="note-list">
          {plan.preconditions.map((precondition) => (
            <span key={precondition}>{precondition}</span>
          ))}
        </div>
      )}

      <div className="operation-list">
        {plan.operations.map((operation) => (
          <div className={`operation ${operation.status}`} key={operation.id}>
            <StatusIcon status={operation.status} />
            <div>
              <strong>{operation.message}</strong>
              <small>{opTypeLabel(language, operation.opType)}</small>
              {operation.sourcePath && <code>{t(language, "from")} {operation.sourcePath}</code>}
              {operation.targetPath && <code>{t(language, "to")} {operation.targetPath}</code>}
              {operation.backupPath && <code>{t(language, "backup")} {operation.backupPath}</code>}
            </div>
          </div>
        ))}
      </div>

      {applyResult && (
        <div className={`apply-result ${applyResult.errors.length ? "error" : "success"}`}>
          <strong>{applyResult.errors.length ? t(language, "applyErrorTitle") : t(language, "applySuccessTitle")}</strong>
          <span>
            {applyResult.appliedOperations.length} {t(language, "applied")} · {applyResult.skippedOperations.length} {t(language, "skipped")}
          </span>
          {applyResult.errors.map((item) => (
            <code key={item}>{item}</code>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsView({
  settings,
  activeSettings,
  inventory,
  onChange,
  onSave,
  onAddProjectFolder,
  language
}: {
  settings: Settings;
  activeSettings: Settings;
  inventory: InventorySnapshot | null;
  onChange: (settings: Settings) => void;
  onSave: () => void;
  onAddProjectFolder: () => void;
  language: Language;
}) {
  return (
    <div className="panel settings-panel">
      <div className="panel-title">
        <div>
          <h1>{t(language, "settingsTitle")}</h1>
          <p>{t(language, "settingsDescription")}</p>
        </div>
        <button className="primary-button" onClick={onSave}>
          <Check size={17} />
          {t(language, "save")}
        </button>
      </div>

      <label className="field">
        <span>{t(language, "language")}</span>
        <div className="segmented-control">
          {LANGUAGES.map((item) => (
            <button
              key={item.code}
              className={normalizeLanguage(settings.language) === item.code ? "active" : ""}
              onClick={() => onChange({ ...settings, language: item.code })}
            >
              {item.label}
            </button>
          ))}
        </div>
      </label>

      <label className="field">
        <span>{t(language, "centralLibrary")}</span>
        <input
          value={settings.libraryPath}
          onChange={(event) => onChange({ ...settings, libraryPath: event.target.value })}
        />
      </label>
      <label className="switch-row">
        <input
          type="checkbox"
          checked={settings.showRawPaths}
          onChange={(event) => onChange({ ...settings, showRawPaths: event.target.checked })}
        />
        <span>{t(language, "showRawPaths")}</span>
      </label>

      <section className="settings-section">
        <div className="section-heading">
          <h2>{t(language, "projectFolders")}</h2>
          <button className="secondary-button" onClick={onAddProjectFolder}>
            <FolderPlus size={16} />
            {t(language, "add")}
          </button>
        </div>
        {settings.projectFolders.length === 0 && <p className="muted">{t(language, "noProjectFolders")}</p>}
        {settings.projectFolders.map((folder) => (
          <div className="path-row" key={folder}>
            <code>{folder}</code>
            <button
              className="icon-button"
              onClick={() =>
                onChange({
                  ...settings,
                  projectFolders: settings.projectFolders.filter((item) => item !== folder)
                })
              }
              title={t(language, "remove")}
            >
              <XCircle size={16} />
            </button>
          </div>
        ))}
      </section>

      <section className="settings-section">
        <h2>{t(language, "scanRoots")}</h2>
        <div className="roots-list">
          {inventory?.roots.map((root) => (
            <div className="root-row" key={`${root.agentId}-${root.scope}-${root.path}`}>
              <AgentBadge label={root.agentLabel} status={root.orphaned ? "orphaned" : "active"} language={language} />
              <span>{root.scope}</span>
              <code>{root.path}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>{t(language, "appData")}</h2>
        <code>{inventory?.appDataPath || activeSettings.libraryPath}</code>
      </section>
    </div>
  );
}

function Coverage({ skill }: { skill: SkillRecord }) {
  const total = skill.installations.length + skill.missingAgents.length;
  const percent = total === 0 ? 0 : Math.round((skill.installations.length / total) * 100);
  return (
    <div className="coverage">
      <span>{skill.installations.length}/{total}</span>
      <div>
        <i style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function AgentStatusPill({ agent, language }: { agent: AgentRecord; language: Language }) {
  const className = agent.status === "installed" ? "success" : agent.status === "residual" ? "warning" : "neutral";
  return <span className={`pill ${className}`}>{agentStatusLabel(language, agent.status)}</span>;
}

function StatePill({ skill, language }: { skill: SkillRecord; language: Language }) {
  if (skill.conflict) return <span className="pill warning">{t(language, "stateConflict")}</span>;
  if (skill.issues.length > 0) return <span className="pill danger">{t(language, "stateNeedsReview")}</span>;
  if (skill.canonicalStatus === "imported") return <span className="pill success">{t(language, "stateImported")}</span>;
  return <span className="pill neutral">{t(language, "stateExternal")}</span>;
}

function AgentBadge({ label, status, language }: { label: string; status: string; language: Language }) {
  return (
    <span className={`agent-badge ${status}`} title={statusLabel(language, status)}>
      {label}
    </span>
  );
}

function MatrixCell({ installation, language }: { installation?: SkillInstallation; language: Language }) {
  if (!installation) return <span className="matrix-cell missing">{t(language, "statusMissing")}</span>;
  return <span className={`matrix-cell ${installation.status}`}>{statusLabel(language, installation.status)}</span>;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "noop") return <Check size={18} />;
  if (status === "blocked") return <AlertTriangle size={18} />;
  return <Wrench size={18} />;
}

function IssueList({ issues, language }: { issues: SkillIssue[]; language: Language }) {
  if (issues.length === 0) return <span className="muted">{t(language, "noIssues")}</span>;
  return (
    <div className="issue-list">
      {issues.map((issue, index) => (
        <div className={`issue ${issue.severity}`} key={`${issue.code}-${index}`}>
          <AlertTriangle size={14} />
          <span>{issueLabel(language, issue.code, issue.message)}</span>
        </div>
      ))}
    </div>
  );
}

function firstValidInstallation(skill: SkillRecord): SkillInstallation | null {
  return (
    skill.installations.find((installation) => installation.status !== "invalid" && !installation.brokenSymlink) ??
    null
  );
}

function inferSkillSource(path: string | undefined, skill: SkillRecord): "skills-sh" | "github" | "plugin" | "library" | "local" {
  const value = (path ?? "").toLowerCase();
  if (value.includes("skills.sh")) return "skills-sh";
  if (value.includes("/plugins/") || value.includes("/plugin/")) return "plugin";
  if (value.includes("/library/skills/")) return "library";
  if (value.includes("/github/") || value.includes("/gh/") || value.includes(".git/")) return "github";
  if (skill.canonicalStatus === "imported") return "library";
  return "local";
}

function sourceLabel(language: Language, source: ReturnType<typeof inferSkillSource>): string {
  const labels: Record<ReturnType<typeof inferSkillSource>, { "zh-CN": string; en: string }> = {
    "skills-sh": { "zh-CN": "skills.sh", en: "skills.sh" },
    github: { "zh-CN": "GitHub 仓库", en: "GitHub repository" },
    plugin: { "zh-CN": "插件", en: "Plugin" },
    library: { "zh-CN": "中心库", en: "Library" },
    local: { "zh-CN": "本地", en: "Local" }
  };
  return labels[source][language];
}

function matrixColumns(agentCount: number) {
  return `minmax(220px, 1.4fr) repeat(${agentCount}, minmax(96px, 1fr))`;
}
