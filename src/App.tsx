import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import ReactMarkdown from "react-markdown";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Columns3,
  CopyCheck,
  ExternalLink,
  FileText,
  FolderPlus,
  Library,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Table2,
  Wrench,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AgentTarget,
  ApplyResult,
  InventorySnapshot,
  Settings,
  SkillContent,
  SkillInstallation,
  SkillIssue,
  SkillRecord,
  SyncPlan
} from "./types";

type View = "skills" | "compare" | "preview" | "settings";

const defaultSettings: Settings = {
  libraryPath: "",
  projectFolders: [],
  customRoots: [],
  showRawPaths: false
};

export default function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [draftSettings, setDraftSettings] = useState<Settings>(defaultSettings);
  const [inventory, setInventory] = useState<InventorySnapshot | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [skillContent, setSkillContent] = useState<SkillContent | null>(null);
  const [view, setView] = useState<View>("skills");
  const [query, setQuery] = useState("");
  const [includeOrphaned, setIncludeOrphaned] = useState(false);
  const [selectedTargets, setSelectedTargets] = useState<Record<string, boolean>>({});
  const [syncPlan, setSyncPlan] = useState<SyncPlan | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState("Starting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    const selectedSkill = inventory?.skills.find((skill) => skill.id === selectedSkillId);
    if (!selectedSkill) {
      setSkillContent(null);
      return;
    }
    const path = selectedSkill.canonicalPath ?? selectedSkill.installations[0]?.entryPath;
    if (!path) {
      setSkillContent(null);
      return;
    }
    invoke<SkillContent>("read_skill_content", { skillRef: { path } })
      .then(setSkillContent)
      .catch((reason) => setError(String(reason)));
    setSelectedTargets(
      Object.fromEntries(selectedSkill.missingAgents.map((agentId) => [agentId, true]))
    );
  }, [inventory, selectedSkillId]);

  const selectedSkill = useMemo(
    () => inventory?.skills.find((skill) => skill.id === selectedSkillId) ?? null,
    [inventory, selectedSkillId]
  );

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
      setSelectedSkillId((current) => current ?? next.skills[0]?.id ?? null);
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

  async function previewSync(skill: SkillRecord) {
    setBusy("Planning sync");
    setError(null);
    setApplyResult(null);
    const targets: AgentTarget[] = Object.entries(selectedTargets)
      .filter(([, selected]) => selected)
      .map(([agentId]) => ({ agentId, scope: "global" }));
    try {
      const plan = await invoke<SyncPlan>("preview_sync", {
        skillId: skill.id,
        targets
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
    const selected = await open({ directory: true, multiple: false, title: "Add project folder" });
    if (typeof selected !== "string") return;
    setDraftSettings((current) => ({
      ...current,
      projectFolders: Array.from(new Set([...current.projectFolders, selected]))
    }));
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
            <span>Local Agent Workbench</span>
          </div>
        </div>

        <nav className="nav">
          <NavButton icon={<Library size={17} />} active={view === "skills"} onClick={() => setView("skills")}>
            Skills
          </NavButton>
          <NavButton icon={<Columns3 size={17} />} active={view === "compare"} onClick={() => setView("compare")}>
            Compare
          </NavButton>
          <NavButton icon={<ShieldCheck size={17} />} active={view === "preview"} onClick={() => setView("preview")}>
            Sync Preview
          </NavButton>
          <NavButton icon={<SettingsIcon size={17} />} active={view === "settings"} onClick={() => setView("settings")}>
            Settings
          </NavButton>
        </nav>

        <div className="sidebar-stat">
          <span>Skills</span>
          <strong>{inventory?.skills.length ?? 0}</strong>
        </div>
        <div className="sidebar-stat">
          <span>Agents</span>
          <strong>{inventory?.agents.length ?? 0}</strong>
        </div>
        <div className="sidebar-stat danger">
          <span>Issues</span>
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
              placeholder="Search skills, descriptions, agents"
            />
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={includeOrphaned}
              onChange={(event) => {
                setIncludeOrphaned(event.target.checked);
                void refreshInventory(event.target.checked);
              }}
            />
            Include orphaned roots
          </label>
          <button className="icon-button" onClick={() => void refreshInventory()} title="Rescan">
            {busy ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
          </button>
        </header>

        {error && (
          <div className="banner error">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}

        {view === "skills" && (
          <SkillsView
            skills={filteredSkills}
            selectedSkillId={selectedSkillId}
            onSelect={setSelectedSkillId}
            settings={settings}
          />
        )}
        {view === "compare" && inventory && (
          <CompareView inventory={inventory} skills={filteredSkills} />
        )}
        {view === "preview" && (
          <PreviewView
            plan={syncPlan}
            applyResult={applyResult}
            busy={Boolean(busy)}
            onApply={() => void applyPlan()}
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
          />
        )}
      </section>

      <SkillDetail
        skill={selectedSkill}
        content={skillContent}
        agents={inventory?.agents ?? []}
        selectedTargets={selectedTargets}
        onTargetChange={(agentId, selected) =>
          setSelectedTargets((current) => ({ ...current, [agentId]: selected }))
        }
        onAdopt={previewAdopt}
        onSync={previewSync}
        showRawPaths={settings.showRawPaths}
      />
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

function SkillsView({
  skills,
  selectedSkillId,
  onSelect,
  settings
}: {
  skills: SkillRecord[];
  selectedSkillId: string | null;
  onSelect: (id: string) => void;
  settings: Settings;
}) {
  return (
    <div className="panel">
      <div className="panel-title">
        <div>
          <h1>Skills Inventory</h1>
          <p>Find where a skill lives, what is missing, and whether it is safe to sync.</p>
        </div>
        <span className="path-chip">{settings.libraryPath || "Library not initialized"}</span>
      </div>

      <div className="table skill-table">
        <div className="thead grid-skills">
          <span>Skill</span>
          <span>Coverage</span>
          <span>State</span>
          <span>Sources</span>
        </div>
        <div className="tbody">
          {skills.map((skill) => (
            <button
              key={skill.id}
              className={`tr grid-skills ${selectedSkillId === skill.id ? "selected" : ""}`}
              onClick={() => onSelect(skill.id)}
            >
              <span>
                <strong>{skill.displayName}</strong>
                <small>{skill.description || skill.slug}</small>
              </span>
              <span>
                <Coverage skill={skill} />
              </span>
              <span>
                <StatePill skill={skill} />
              </span>
              <span className="agent-list">
                {skill.installations.slice(0, 4).map((installation) => (
                  <AgentBadge key={installation.id} label={installation.agentLabel} status={installation.status} />
                ))}
                {skill.installations.length > 4 && <em>+{skill.installations.length - 4}</em>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CompareView({
  inventory,
  skills
}: {
  inventory: InventorySnapshot;
  skills: SkillRecord[];
}) {
  return (
    <div className="panel compare-panel">
      <div className="panel-title">
        <div>
          <h1>Agent Coverage Matrix</h1>
          <p>Installed, linked, broken, and missing states across known local Agents.</p>
        </div>
      </div>
      <div className="matrix">
        <div className="matrix-row matrix-head" style={{ gridTemplateColumns: matrixColumns(inventory.agents.length) }}>
          <span>Skill</span>
          {inventory.agents.map((agent) => (
            <span key={agent.id}>{agent.label}</span>
          ))}
        </div>
        {skills.map((skill) => (
          <div className="matrix-row" key={skill.id} style={{ gridTemplateColumns: matrixColumns(inventory.agents.length) }}>
            <strong>{skill.displayName}</strong>
            {inventory.agents.map((agent) => {
              const installation = skill.installations.find((item) => item.agentId === agent.id);
              return <MatrixCell key={agent.id} installation={installation} />;
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
  onApply
}: {
  plan: SyncPlan | null;
  applyResult: ApplyResult | null;
  busy: boolean;
  onApply: () => void;
}) {
  if (!plan) {
    return (
      <div className="empty-state">
        <ShieldCheck size={34} />
        <h1>No sync plan yet</h1>
        <p>Select a skill, then preview import or sync before anything is written.</p>
      </div>
    );
  }

  const blocked = plan.blockedConflicts.length > 0;

  return (
    <div className="panel">
      <div className="panel-title">
        <div>
          <h1>{plan.kind === "adopt" ? "Import Preview" : "Sync Preview"}</h1>
          <p>{plan.planId} · {plan.riskLevel}</p>
        </div>
        <button className="primary-button" disabled={blocked || busy} onClick={onApply}>
          <CopyCheck size={17} />
          Apply Plan
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
              <small>{operation.opType}</small>
              {operation.sourcePath && <code>from {operation.sourcePath}</code>}
              {operation.targetPath && <code>to {operation.targetPath}</code>}
              {operation.backupPath && <code>backup {operation.backupPath}</code>}
            </div>
          </div>
        ))}
      </div>

      {applyResult && (
        <div className={`apply-result ${applyResult.errors.length ? "error" : "success"}`}>
          <strong>{applyResult.errors.length ? "Apply finished with errors" : "Apply completed"}</strong>
          <span>
            {applyResult.appliedOperations.length} applied · {applyResult.skippedOperations.length} skipped
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
  onAddProjectFolder
}: {
  settings: Settings;
  activeSettings: Settings;
  inventory: InventorySnapshot | null;
  onChange: (settings: Settings) => void;
  onSave: () => void;
  onAddProjectFolder: () => void;
}) {
  return (
    <div className="panel settings-panel">
      <div className="panel-title">
        <div>
          <h1>Settings</h1>
          <p>Keep paths out of the way, but available when you need to audit them.</p>
        </div>
        <button className="primary-button" onClick={onSave}>
          <Check size={17} />
          Save
        </button>
      </div>

      <label className="field">
        <span>Central library</span>
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
        <span>Show raw filesystem paths in skill detail</span>
      </label>

      <section className="settings-section">
        <div className="section-heading">
          <h2>Project folders</h2>
          <button className="secondary-button" onClick={onAddProjectFolder}>
            <FolderPlus size={16} />
            Add
          </button>
        </div>
        {settings.projectFolders.length === 0 && <p className="muted">No project folders added yet.</p>}
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
              title="Remove"
            >
              <XCircle size={16} />
            </button>
          </div>
        ))}
      </section>

      <section className="settings-section">
        <h2>Scan roots</h2>
        <div className="roots-list">
          {inventory?.roots.map((root) => (
            <div className="root-row" key={`${root.agentId}-${root.scope}-${root.path}`}>
              <AgentBadge label={root.agentLabel} status={root.orphaned ? "orphaned" : "active"} />
              <span>{root.scope}</span>
              <code>{root.path}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>App data</h2>
        <code>{inventory?.appDataPath || activeSettings.libraryPath}</code>
      </section>
    </div>
  );
}

function SkillDetail({
  skill,
  content,
  agents,
  selectedTargets,
  onTargetChange,
  onAdopt,
  onSync,
  showRawPaths
}: {
  skill: SkillRecord | null;
  content: SkillContent | null;
  agents: { id: string; label: string }[];
  selectedTargets: Record<string, boolean>;
  onTargetChange: (agentId: string, selected: boolean) => void;
  onAdopt: (skill: SkillRecord) => void;
  onSync: (skill: SkillRecord) => void;
  showRawPaths: boolean;
}) {
  if (!skill) {
    return (
      <aside className="detail empty-detail">
        <FileText size={28} />
        <span>Select a skill</span>
      </aside>
    );
  }

  const missing = agents.filter((agent) => skill.missingAgents.includes(agent.id));
  const validInstall = firstValidInstallation(skill);

  return (
    <aside className="detail">
      <div className="detail-heading">
        <div>
          <h2>{skill.displayName}</h2>
          <span>{skill.slug}</span>
        </div>
        <StatePill skill={skill} />
      </div>

      <div className="action-row">
        <button
          className="secondary-button"
          disabled={skill.canonicalStatus === "imported" || !validInstall}
          onClick={() => onAdopt(skill)}
        >
          <Library size={16} />
          Import
        </button>
        <button
          className="primary-button"
          disabled={skill.canonicalStatus !== "imported"}
          onClick={() => onSync(skill)}
        >
          <Link2 size={16} />
          Sync
        </button>
      </div>

      <section className="detail-section">
        <h3>Installed in</h3>
        <div className="install-list">
          {skill.installations.map((installation) => (
            <div className="install-row" key={installation.id}>
              <AgentBadge label={installation.agentLabel} status={installation.status} />
              <span>{installation.scope}</span>
              {installation.isSymlink && <Link2 size={14} />}
              {installation.issues.length > 0 && <AlertTriangle size={14} />}
              {showRawPaths && <code>{installation.entryPath}</code>}
            </div>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <h3>Missing agents</h3>
        <div className="target-list">
          {missing.length === 0 && <span className="muted">No missing Agents in the current scan.</span>}
          {missing.slice(0, 12).map((agent) => (
            <label className="target-row" key={agent.id}>
              <input
                type="checkbox"
                checked={selectedTargets[agent.id] ?? false}
                onChange={(event) => onTargetChange(agent.id, event.target.checked)}
              />
              <span>{agent.label}</span>
            </label>
          ))}
          {missing.length > 12 && <span className="muted">+{missing.length - 12} more</span>}
        </div>
      </section>

      <section className="detail-section">
        <h3>Issues</h3>
        <IssueList issues={skill.issues} />
      </section>

      <section className="detail-section markdown-section">
        <div className="section-heading">
          <h3>SKILL.md</h3>
          {content?.path && <ExternalLink size={15} />}
        </div>
        {content ? (
          <ReactMarkdown>{content.markdownBody || content.content}</ReactMarkdown>
        ) : (
          <span className="muted">No readable SKILL.md for this selection.</span>
        )}
      </section>
    </aside>
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

function StatePill({ skill }: { skill: SkillRecord }) {
  if (skill.conflict) return <span className="pill warning">Conflict</span>;
  if (skill.issues.length > 0) return <span className="pill danger">Needs review</span>;
  if (skill.canonicalStatus === "imported") return <span className="pill success">Imported</span>;
  return <span className="pill neutral">External</span>;
}

function AgentBadge({ label, status }: { label: string; status: string }) {
  return <span className={`agent-badge ${status}`}>{label}</span>;
}

function MatrixCell({ installation }: { installation?: SkillInstallation }) {
  if (!installation) return <span className="matrix-cell missing">Missing</span>;
  return <span className={`matrix-cell ${installation.status}`}>{installation.status}</span>;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "noop") return <Check size={18} />;
  if (status === "blocked") return <AlertTriangle size={18} />;
  return <Wrench size={18} />;
}

function IssueList({ issues }: { issues: SkillIssue[] }) {
  if (issues.length === 0) return <span className="muted">No issues found.</span>;
  return (
    <div className="issue-list">
      {issues.map((issue, index) => (
        <div className={`issue ${issue.severity}`} key={`${issue.code}-${index}`}>
          <AlertTriangle size={14} />
          <span>{issue.message}</span>
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

function matrixColumns(agentCount: number) {
  return `minmax(220px, 1.4fr) repeat(${agentCount}, minmax(96px, 1fr))`;
}
