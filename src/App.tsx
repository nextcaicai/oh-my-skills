import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CopyCheck,
  FileText,
  FolderOpen,
  FolderPlus,
  Github,
  Globe2,
  Layers3,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  XCircle
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { agentIconAsset } from "./agentIconRegistry";
import type {
  AgentRecord,
  AgentTarget,
  ApplyResult,
  InventorySnapshot,
  ProjectWorkspaceCandidate,
  Settings as AppSettings,
  SkillInstallation,
  SkillIssue,
  SkillLockEntry,
  SkillRecord,
  SkillUpdateCheck,
  SyncOperation,
  SyncPlan
} from "./types";

type View = "agents" | "skills" | "sync";
type SkillWorkspace = "global" | "project";
type AgentViewFilter = "all" | "installed";
type SyncMode = "quick" | "managed";
type QuickMigrationMethod = "copy" | "symlink";

const defaultSettings: AppSettings = {
  libraryPath: "",
  projectFolders: [],
  customRoots: [],
  showRawPaths: false,
  language: "zh-CN"
};

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [draftSettings, setDraftSettings] = useState<AppSettings>(defaultSettings);
  const [inventory, setInventory] = useState<InventorySnapshot | null>(null);
  const [skillLocks, setSkillLocks] = useState<Record<string, SkillLockEntry>>({});
  const [view, setView] = useState<View>("agents");
  const [skillWorkspace, setSkillWorkspace] = useState<SkillWorkspace>("global");
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [selectedProjectFolder, setSelectedProjectFolder] = useState<string | null>(null);
  const [discoveredProjects, setDiscoveredProjects] = useState<ProjectWorkspaceCandidate[]>([]);
  const [discoveryBasePath, setDiscoveryBasePath] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [skillUpdateChecks, setSkillUpdateChecks] = useState<Record<string, SkillUpdateCheck>>({});
  const [updatingSkillIds, setUpdatingSkillIds] = useState<Set<string>>(new Set());
  const [syncPlan, setSyncPlan] = useState<SyncPlan | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState("启动中");
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const bootStartedRef = useRef(false);

  useEffect(() => {
    if (bootStartedRef.current) return;
    bootStartedRef.current = true;
    void boot();
  }, []);

  const agents = useMemo(
    () =>
      [...(inventory?.agents ?? [])].sort((left, right) => {
        if (left.installed !== right.installed) return left.installed ? -1 : 1;
        return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
      }),
    [inventory?.agents]
  );
  const installedAgents = useMemo(() => agents.filter((agent) => agent.installed), [agents]);
  const installedAgentIds = useMemo(() => new Set(installedAgents.map((agent) => agent.id)), [installedAgents]);
  const allSkills = inventory?.skills ?? [];
  const projectFolders = settings.projectFolders;

  useEffect(() => {
    setSelectedProjectFolder((current) => {
      if (current && projectFolders.includes(current)) return current;
      return projectFolders[0] ?? null;
    });
  }, [projectFolders]);

  useEffect(() => {
    if (agentFilter !== "all" && !installedAgentIds.has(agentFilter)) {
      setAgentFilter("all");
    }
  }, [agentFilter, installedAgentIds]);

  const globalSkills = useMemo(
    () => allSkills.filter((skill) => skill.installations.some((item) => item.scope === "global")),
    [allSkills]
  );

  const projectSkills = useMemo(
    () => projectSkillsForFolder(allSkills, selectedProjectFolder),
    [allSkills, selectedProjectFolder]
  );

  const visibleSourceSkills = skillWorkspace === "project" ? projectSkills : globalSkills;

  const filteredSkills = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return visibleSourceSkills.filter((skill) => {
      if (agentFilter !== "all" && !skill.installations.some((item) => item.agentId === agentFilter)) {
        return false;
      }

      if (!needle) return true;
      const haystack = [
        skill.displayName,
        skill.slug,
        skill.description ?? "",
        skill.installations.map((item) => item.agentLabel).join(" ")
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [agentFilter, query, visibleSourceSkills]);

  const selectedSkill = useMemo(
    () => selectedSkillId ? filteredSkills.find((skill) => skill.id === selectedSkillId) ?? null : null,
    [filteredSkills, selectedSkillId]
  );

  const queuedSkills = useMemo(
    () => allSkills.filter((skill) => selectedSkillIds.has(skill.id)),
    [allSkills, selectedSkillIds]
  );

  async function boot() {
    setBusy("读取设置");
    setError(null);
    if (!isTauriRuntime()) {
      setSettings(defaultSettings);
      setDraftSettings(defaultSettings);
      setSkillLocks(demoSkillLocks);
      setInventory(demoInventory);
      setSelectedSkillId(null);
      setBusy("");
      return;
    }
    try {
      const loaded = await invoke<AppSettings>("get_settings");
      setSettings(loaded);
      setDraftSettings(loaded);
      await refreshSkillLocks();
      await refreshInventory();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function refreshInventory() {
    setBusy("扫描本机 Agent 与 Skills");
    setError(null);
    try {
      await refreshSkillLocks();
      const next = await invoke<InventorySnapshot>("scan_inventory", {
        options: { includeOrphaned: false }
      });
      setInventory(next);
      setSkillUpdateChecks({});
      setSelectedSkillId((current) => {
        if (current && next.skills.some((skill) => skill.id === current)) return current;
        return null;
      });
      setSelectedSkillIds((current) => {
        const valid = new Set(next.skills.map((skill) => skill.id));
        return new Set([...current].filter((id) => valid.has(id)));
      });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function refreshSkillLocks() {
    if (!isTauriRuntime()) {
      setSkillLocks(demoSkillLocks);
      return;
    }
    const locks = await invoke<Record<string, SkillLockEntry>>("read_skill_lock");
    setSkillLocks(locks);
  }

  async function previewSkillsSync(skills = queuedSkills, targets: AgentTarget[] = []) {
    const skill = skills[0];
    if (!skill) return;
    setBusy("生成同步预览");
    setError(null);
    setApplyResult(null);
    if (!isTauriRuntime()) {
      setSyncPlan(demoPlan(skill, targets, "sync"));
      setView("sync");
      setBusy("");
      return;
    }
    try {
      const validInstall = firstValidInstallation(skill);
      const plan = skill.canonicalStatus === "imported"
        ? await invoke<SyncPlan>("preview_sync", {
            skillId: skill.slug,
            targets
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
            targets
          });
      setSyncPlan(plan);
      setView("sync");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function previewQuickMigration(skills = queuedSkills, method: QuickMigrationMethod, targets: AgentTarget[] = []) {
    const skill = skills[0];
    const source = skill ? firstValidInstallation(skill) : null;
    if (!skill || !source) return;
    setBusy("生成迁移预览");
    setError(null);
    setApplyResult(null);
    if (!isTauriRuntime()) {
      setSyncPlan(demoPlan(skill, targets, "quick-migrate"));
      setView("sync");
      setBusy("");
      return;
    }
    try {
      const plan = await invoke<SyncPlan>("preview_quick_migration", {
        source: {
          installationId: source.id,
          entryPath: source.entryPath,
          slug: skill.slug
        },
        targets,
        method
      });
      setSyncPlan(plan);
      setView("sync");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function previewAdopt(skill: SkillRecord) {
    const source = firstValidInstallation(skill);
    if (!source) return;
    setBusy("生成导入预览");
    setError(null);
    setApplyResult(null);
    if (!isTauriRuntime()) {
      setSyncPlan(demoPlan(skill, [], "adopt"));
      setView("sync");
      setBusy("");
      return;
    }
    try {
      const plan = await invoke<SyncPlan>("preview_adopt", {
        source: {
          installationId: source.id,
          entryPath: source.entryPath,
          slug: skill.slug
        }
      });
      setSyncPlan(plan);
      setView("sync");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function applyPlan() {
    if (!syncPlan) return;
    setBusy("执行同步计划");
    setError(null);
    if (!isTauriRuntime()) {
      setApplyResult({
        planId: syncPlan.planId,
        appliedOperations: syncPlan.operations.map((operation) => operation.id),
        skippedOperations: [],
        errors: [],
        inventoryRefreshRecommended: false
      });
      setBusy("");
      return;
    }
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
    setBusy("保存设置");
    setError(null);
    try {
      const saved = await invoke<AppSettings>("save_settings", { settings: draftSettings });
      setSettings(saved);
      setDraftSettings(saved);
      setSettingsOpen(false);
      await refreshInventory();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function saveProjectFolders(projectFolders: string[], busyLabel: string) {
    const nextSettings = {
      ...settings,
      projectFolders
    };
    setBusy(busyLabel);
    setError(null);
    try {
      if (isTauriRuntime()) {
        const saved = await invoke<AppSettings>("save_settings", { settings: nextSettings });
        setSettings(saved);
        setDraftSettings(saved);
      } else {
        setSettings(nextSettings);
        setDraftSettings(nextSettings);
      }
      await refreshInventory();
      return nextSettings;
    } catch (reason) {
      setError(String(reason));
      return null;
    } finally {
      setBusy("");
    }
  }

  async function addProjectPath(path: string) {
    const projectFolders = Array.from(new Set([...settings.projectFolders, path]));
    const saved = await saveProjectFolders(projectFolders, "关联项目工作区");
    if (!saved) return;
    setSelectedProjectFolder(path);
    setSkillWorkspace("project");
    setView("skills");
    setDiscoveredProjects((current) =>
      current.map((candidate) => candidate.path === path ? { ...candidate, alreadyLinked: true } : candidate)
    );
  }

  async function addProjectWorkspace() {
    const selected = await open({ directory: true, multiple: false, title: "关联项目工作区" });
    if (typeof selected !== "string") return;
    await addProjectPath(selected);
  }

  async function discoverProjectWorkspaces() {
    const selected = await open({ directory: true, multiple: false, title: "扫描发现项目工作区" });
    if (typeof selected !== "string") return;
    setBusy("扫描发现项目工作区");
    setError(null);
    setSkillWorkspace("project");
    setView("skills");
    setDiscoveryBasePath(selected);
    try {
      if (!isTauriRuntime()) {
        setDiscoveredProjects([]);
        return;
      }
      const candidates = await invoke<ProjectWorkspaceCandidate[]>("discover_project_workspaces", {
        basePath: selected
      });
      setDiscoveredProjects(candidates);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function removeProjectWorkspace(folder: string) {
    const nextProjectFolders = settings.projectFolders.filter((item) => item !== folder);
    const saved = await saveProjectFolders(nextProjectFolders, "移除项目工作区");
    if (!saved) return;
    if (selectedProjectFolder === folder) {
      setSelectedProjectFolder(saved.projectFolders[0] ?? null);
    }
    setDiscoveredProjects((current) =>
      current.map((candidate) => candidate.path === folder ? { ...candidate, alreadyLinked: false } : candidate)
    );
  }

  function addDraftProjectFolder() {
    void open({ directory: true, multiple: false, title: "添加项目工作区" }).then((selected) => {
      if (typeof selected !== "string") return;
      setDraftSettings((current) => ({
        ...current,
        projectFolders: Array.from(new Set([...current.projectFolders, selected]))
      }));
    });
  }

  function openAgentSkills(agent: AgentRecord) {
    setAgentFilter(agent.id);
    setQuery("");
    setSkillWorkspace("global");
    setView("skills");
    const firstSkill = globalSkills.find((skill) => skill.installations.some((item) => item.agentId === agent.id));
    setSelectedSkillId(firstSkill?.id ?? null);
  }

  function toggleSkill(id: string) {
    setSelectedSkillIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectForSync(skill: SkillRecord) {
    setSelectedSkillIds((current) => new Set(current).add(skill.id));
    setView("sync");
  }

  async function refreshSkillsShUpdateChecks(skills: SkillRecord[], locks: Record<string, SkillLockEntry>) {
    if (!isTauriRuntime() || skills.length === 0) return;
    for (const skill of skills) {
      const source = skillsShUpdateSource(skill, locks);
      if (!source) continue;
      setSkillUpdateChecks((current) => {
        if (current[skill.id]) return current;
        return { ...current, [skill.id]: { status: "checking" } };
      });
      try {
        const result = await invoke<SkillUpdateCheck>("check_skills_sh_update", {
          slug: skill.slug,
          entryPath: source.installation.entryPath,
          sourceUrl: source.sourceUrl,
          skillPath: source.lock.skillPath ?? null
        });
        setSkillUpdateChecks((current) => ({ ...current, [skill.id]: result }));
      } catch (reason) {
        setSkillUpdateChecks((current) => ({
          ...current,
          [skill.id]: failedUpdateCheck(reason)
        }));
      }
    }
  }

  async function updateSkillsShSkill(skill: SkillRecord) {
    const source = skillsShUpdateSource(skill, skillLocks);
    if (!source) return;
    setBusy(`更新 ${skill.displayName}`);
    setError(null);
    setUpdatingSkillIds((current) => new Set(current).add(skill.id));
    try {
      const result = await invoke<SkillUpdateCheck>("update_skills_sh_skill", {
        slug: skill.slug,
        entryPath: source.installation.entryPath,
        sourceUrl: source.sourceUrl,
        skillPath: source.lock.skillPath ?? null
      });
      setSkillUpdateChecks((current) => ({ ...current, [skill.id]: result }));
      await refreshInventory();
    } catch (reason) {
      setError(String(reason));
      setSkillUpdateChecks((current) => ({
        ...current,
        [skill.id]: failedUpdateCheck(reason)
      }));
    } finally {
      setUpdatingSkillIds((current) => {
        const next = new Set(current);
        next.delete(skill.id);
        return next;
      });
      setBusy("");
    }
  }

  return (
    <main className="app-shell">
      <header className="top-nav">
        <nav className="tab-bar" aria-label="主导航">
          <TabButton active={view === "agents"} onClick={() => setView("agents")}>
            发现 Agent
          </TabButton>
          <TabButton active={view === "skills"} onClick={() => setView("skills")}>
            发现 Skills
          </TabButton>
          <TabButton active={view === "sync"} onClick={() => setView("sync")}>
            同步 Skills
          </TabButton>
        </nav>

        <div className="top-actions">
          <button className="icon-button" onClick={() => setSettingsOpen(true)} title="设置">
            <Settings size={17} />
          </button>
          <button className="icon-button" onClick={() => void refreshInventory()} title="重新扫描">
            {busy ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
          </button>
        </div>
      </header>

      {error && (
        <div className="banner error">
          <AlertTriangle size={17} />
          <span>{error}</span>
        </div>
      )}

      <section className="content-frame">
        {view === "agents" && (
          <AgentsView
            agents={agents}
            skills={allSkills}
            installedCount={installedAgents.length}
            busy={busy}
            onAgentClick={openAgentSkills}
            onGoSkills={() => setView("skills")}
            onRefresh={() => void refreshInventory()}
          />
        )}

        {view === "skills" && (
          <SkillsView
            agents={installedAgents}
            skills={filteredSkills}
            allSkills={allSkills}
            sourceSkills={visibleSourceSkills}
            skillLocks={skillLocks}
            skillUpdateChecks={skillUpdateChecks}
            updatingSkillIds={updatingSkillIds}
            workspace={skillWorkspace}
            projectFolders={projectFolders}
            selectedProjectFolder={selectedProjectFolder}
            discoveredProjects={discoveredProjects}
            discoveryBasePath={discoveryBasePath}
            discovering={busy === "扫描发现项目工作区"}
            selectedSkill={selectedSkill}
            selectedSkillIds={selectedSkillIds}
            query={query}
            agentFilter={agentFilter}
            settings={settings}
            onQuery={setQuery}
            onAgentFilter={setAgentFilter}
            onWorkspace={(workspace) => {
              setSkillWorkspace(workspace);
              setSelectedSkillId(null);
              setQuery("");
              setAgentFilter("all");
            }}
            onSelectProject={(folder) => {
              setSelectedProjectFolder(folder);
              setSelectedSkillId(null);
              setQuery("");
              setAgentFilter("all");
            }}
            onSelectSkill={setSelectedSkillId}
            onToggleSkill={toggleSkill}
            onUpdateSkill={updateSkillsShSkill}
            onAdopt={previewAdopt}
            onSelectForSync={selectForSync}
            onRefresh={() => void refreshInventory()}
            onAddProject={() => void addProjectWorkspace()}
            onDiscoverProjects={() => void discoverProjectWorkspaces()}
            onLinkDiscoveredProject={(path) => void addProjectPath(path)}
            onRemoveProject={(folder) => void removeProjectWorkspace(folder)}
          />
        )}

        {view === "sync" && (
          <SyncView
            agents={installedAgents.length ? installedAgents : agents}
            queuedSkills={queuedSkills}
            settings={settings}
            plan={syncPlan}
            applyResult={applyResult}
            busy={Boolean(busy)}
            onRemoveSkill={(id) => {
              setSelectedSkillIds((current) => {
                const next = new Set(current);
                next.delete(id);
                return next;
              });
            }}
            onPreviewGlobal={(targets) => void previewSkillsSync(queuedSkills, targets)}
            onPreviewProject={(targets) => void previewSkillsSync(queuedSkills, targets)}
            onPreviewQuick={(method, targets) => void previewQuickMigration(queuedSkills, method, targets)}
            onApply={() => void applyPlan()}
            onGoSkills={() => setView("skills")}
          />
        )}
      </section>

      {settingsOpen && (
        <SettingsSheet
          settings={draftSettings}
          inventory={inventory}
          onChange={setDraftSettings}
          onClose={() => {
            setDraftSettings(settings);
            setSettingsOpen(false);
          }}
          onSave={() => void saveSettings()}
          onAddProjectFolder={addDraftProjectFolder}
        />
      )}
    </main>
  );
}

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function TabButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={`tab-button ${active ? "active" : ""}`} onClick={onClick}>
      <span>{children}</span>
    </button>
  );
}

function AgentsView({
  agents,
  skills,
  installedCount,
  busy,
  onAgentClick,
  onGoSkills,
  onRefresh
}: {
  agents: AgentRecord[];
  skills: SkillRecord[];
  installedCount: number;
  busy: string;
  onAgentClick: (agent: AgentRecord) => void;
  onGoSkills: () => void;
  onRefresh: () => void;
}) {
  const [agentViewFilter, setAgentViewFilter] = useState<AgentViewFilter>("installed");
  const visibleAgents = agentViewFilter === "installed" ? agents.filter((agent) => agent.installed) : agents;
  const issueCount = skills.reduce((total, skill) => total + skill.issues.length + (skill.conflict ? 1 : 0), 0);
  const summary = agentViewFilter === "all"
    ? `内置 ${agents.length} 个 Agent 的自动检测识别`
    : busy || `已发现 Agent ${installedCount} 个 · Skills ${skills.length} 个`;
  const primaryLabel = skills.length > 0 ? "查看已发现 Skills" : "重新扫描";
  const primaryAction = skills.length > 0 ? onGoSkills : onRefresh;

  return (
    <div className="agents-page">
      <section className="agent-status-strip" aria-label="扫描状态">
        <InfoBlock label="已安装 Agent" value={`${installedCount}`} />
        <InfoBlock label="已发现 Skills" value={`${skills.length}`} />
        <InfoBlock label="需检查" value={`${issueCount}`} />
        <button className="primary-button" onClick={primaryAction} type="button">
          {busy ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}
          {busy || primaryLabel}
        </button>
      </section>
      <div className="agent-filter-tabs" role="tablist" aria-label="Agent 过滤">
        <button
          className={agentViewFilter === "all" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={agentViewFilter === "all"}
          onClick={() => setAgentViewFilter("all")}
        >
          全部
        </button>
        <button
          className={agentViewFilter === "installed" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={agentViewFilter === "installed"}
          onClick={() => setAgentViewFilter("installed")}
        >
          已安装
        </button>
      </div>
      <div className="toolbar-row">
        <span>{summary}</span>
      </div>

      <section className="agent-list">
        {visibleAgents.map((agent) => {
          const signalSummary = agentSignalSummary(agent);
          const disabled = agentViewFilter === "all" && !agent.installed;
          return (
            <button
              className={`agent-card ${disabled ? "disabled" : ""}`}
              disabled={disabled}
              key={agent.id}
              onClick={() => onAgentClick(agent)}
            >
              <AgentIcon agent={agent} />
              <span className="agent-main">
                <strong>{agent.label}</strong>
                {signalSummary && <small>{signalSummary}</small>}
              </span>
              <span className="agent-count">
                <strong>{agentSkillCount(agent.id, skills)}</strong>
                <small>Skills</small>
              </span>
              <StatusPill status={agent.status} />
              <ChevronRight size={18} />
            </button>
          );
        })}
        {visibleAgents.length === 0 && (
          <div className="empty-list">
            <ShieldCheck size={28} />
            <strong>还没有检测到已安装 Agent</strong>
            <span>可以重新扫描，或切到“全部”查看 Oh My Skills 支持的 Agent。</span>
          </div>
        )}
      </section>
    </div>
  );
}

function SkillsView({
  agents,
  skills,
  allSkills,
  sourceSkills,
  skillLocks,
  skillUpdateChecks,
  updatingSkillIds,
  workspace,
  projectFolders,
  selectedProjectFolder,
  discoveredProjects,
  discoveryBasePath,
  discovering,
  selectedSkill,
  selectedSkillIds,
  query,
  agentFilter,
  settings,
  onQuery,
  onAgentFilter,
  onWorkspace,
  onSelectProject,
  onSelectSkill,
  onToggleSkill,
  onUpdateSkill,
  onAdopt,
  onSelectForSync,
  onRefresh,
  onAddProject,
  onDiscoverProjects,
  onLinkDiscoveredProject,
  onRemoveProject
}: {
  agents: AgentRecord[];
  skills: SkillRecord[];
  allSkills: SkillRecord[];
  sourceSkills: SkillRecord[];
  skillLocks: Record<string, SkillLockEntry>;
  skillUpdateChecks: Record<string, SkillUpdateCheck>;
  updatingSkillIds: Set<string>;
  workspace: SkillWorkspace;
  projectFolders: string[];
  selectedProjectFolder: string | null;
  discoveredProjects: ProjectWorkspaceCandidate[];
  discoveryBasePath: string | null;
  discovering: boolean;
  selectedSkill: SkillRecord | null;
  selectedSkillIds: Set<string>;
  query: string;
  agentFilter: string;
  settings: AppSettings;
  onQuery: (value: string) => void;
  onAgentFilter: (value: string) => void;
  onWorkspace: (value: SkillWorkspace) => void;
  onSelectProject: (folder: string) => void;
  onSelectSkill: (id: string | null) => void;
  onToggleSkill: (id: string) => void;
  onUpdateSkill: (skill: SkillRecord) => void;
  onAdopt: (skill: SkillRecord) => void;
  onSelectForSync: (skill: SkillRecord) => void;
  onRefresh: () => void;
  onAddProject: () => void;
  onDiscoverProjects: () => void;
  onLinkDiscoveredProject: (path: string) => void;
  onRemoveProject: (folder: string) => void;
}) {
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const selectedAgentLabel = agentFilter === "all"
    ? "全部 Agent"
    : agents.find((agent) => agent.id === agentFilter)?.label ?? "全部 Agent";
  const isProjectWorkspace = workspace === "project";
  const tabSummary = isProjectWorkspace
    ? selectedProjectFolder
      ? `管理 ${projectName(selectedProjectFolder)} 内生效的 Agent Skills，已发现 ${sourceSkills.length} 个。`
      : "关联一个项目工作区后，可以管理该项目内各 Agent 生效的 Skills。"
    : `管理这台机器上各 Agent 的全局 Skills，已发现 ${sourceSkills.length} 个。`;
  const hasProjectWorkspaces = projectFolders.length > 0;
  const emptyTitle = isProjectWorkspace
    ? hasProjectWorkspaces
      ? "这个项目还没有项目级 Skills"
      : "尚未关联项目工作区"
    : "还没有全局 Skills";
  const emptyBody = isProjectWorkspace
    ? hasProjectWorkspaces
      ? "可以从中心库同步到当前项目，或创建某个 Agent 的项目 skills 目录。"
      : "选择一个项目根目录后，Oh My Skills 会自动检测该项目下各 Agent 的项目级 Skills。"
    : "重新扫描或从中心库同步到某个 Agent 后，这里会显示机器级生效的 Skills。";

  return (
    <div className="skills-page">
      <section className="skills-workbench">
        <div className="skills-toolbar">
          <div className="scope-tabs workspace-tabs" role="tablist" aria-label="Skills 工作区">
            {(["global", "project"] as SkillWorkspace[]).map((scope) => (
              <button
                className={workspace === scope ? "active" : ""}
                key={scope}
                onClick={() => onWorkspace(scope)}
                role="tab"
                type="button"
                aria-selected={workspace === scope}
              >
                {scope === "global" ? "全局工作区" : "项目工作区"}
              </button>
            ))}
          </div>

          <div className="skills-toolbar-actions">
            {searchOpen && (
              <div className="searchbox compact">
                <Search size={16} />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => onQuery(event.target.value)}
                  placeholder="搜索 Skill、简介或 Agent"
                />
              </div>
            )}
            <button
              className={`icon-button plain ${searchOpen ? "active" : ""}`}
              onClick={() => {
                setAgentMenuOpen(false);
                setSearchOpen((open) => !open);
              }}
              title="搜索"
              type="button"
            >
              <Search size={18} />
            </button>
            <button className="icon-button plain" onClick={onRefresh} title="重新扫描" type="button">
              <RefreshCw size={17} />
            </button>
            <div className="agent-menu-wrap">
              <button className="agent-menu-trigger" onClick={() => setAgentMenuOpen((open) => !open)} type="button">
                <span>{selectedAgentLabel}</span>
                <ChevronDown size={14} />
              </button>
              {agentMenuOpen && (
                <div className="agent-menu" role="menu">
                  <button
                    className={agentFilter === "all" ? "active" : ""}
                    onClick={() => {
                      onAgentFilter("all");
                      setAgentMenuOpen(false);
                    }}
                    type="button"
                  >
                    <span>全部 Agent</span>
                    <strong>{sourceSkills.length}</strong>
                  </button>
                  {agents.map((agent) => (
                    <button
                      className={agentFilter === agent.id ? "active" : ""}
                      key={agent.id}
                      onClick={() => {
                        onAgentFilter(agent.id);
                        setAgentMenuOpen(false);
                      }}
                      type="button"
                    >
                      <span>{agent.label}</span>
                      <strong>{agentSkillCount(agent.id, sourceSkills)}</strong>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="skills-summary">
          <span>{tabSummary}</span>
          {isProjectWorkspace && (
            <div className="button-pair compact">
              <button className="secondary-button" onClick={onAddProject} type="button">
                <FolderPlus size={16} />
                关联项目
              </button>
              <button className="secondary-button" onClick={onDiscoverProjects} type="button">
                <Search size={16} />
                扫描发现
              </button>
            </div>
          )}
        </div>

        {isProjectWorkspace && (discovering || discoveryBasePath || discoveredProjects.length > 0) && (
          <section className="discovery-panel">
            <div className="discovery-heading">
              <span>
                <strong>扫描发现</strong>
                {discoveryBasePath && <small>{discoveryBasePath}</small>}
              </span>
              <button className="secondary-button" onClick={onDiscoverProjects} type="button">
                {discovering ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
                重新扫描
              </button>
            </div>
            <div className="discovery-list">
              {discoveredProjects.map((candidate) => (
                <article className="discovery-card" key={candidate.path}>
                  <span>
                    <strong>{candidate.name}</strong>
                    <code>{candidate.path}</code>
                  </span>
                  <div className="discovery-agents">
                    {candidate.agentRoots.map((root) => (
                      <AgentBadge label={`${root.agentLabel} · ${root.skillCount}`} status="linked" key={`${candidate.path}-${root.agentId}`} />
                    ))}
                  </div>
                  <button
                    className="secondary-button"
                    disabled={candidate.alreadyLinked}
                    onClick={() => onLinkDiscoveredProject(candidate.path)}
                    type="button"
                  >
                    <Check size={16} />
                    {candidate.alreadyLinked ? "已关联" : "关联"}
                  </button>
                </article>
              ))}
              {!discovering && discoveryBasePath && discoveredProjects.length === 0 && (
                <div className="empty-inline">
                  <FileText size={20} />
                  <span>没有发现包含项目级 Skills 的工作区。</span>
                </div>
              )}
            </div>
          </section>
        )}

        {isProjectWorkspace && hasProjectWorkspaces && (
          <div className="project-workspace-bar" aria-label="已关联项目工作区">
            {projectFolders.map((folder) => {
              const stats = projectStats(folder, allSkills);
              const active = selectedProjectFolder === folder;
              return (
                <button
                  className={`project-chip ${active ? "active" : ""}`}
                  key={folder}
                  onClick={() => onSelectProject(folder)}
                  type="button"
                >
                  <span>
                    <strong>{projectName(folder)}</strong>
                    <small>{folder}</small>
                  </span>
                  <em>{stats.skillCount} Skills · {stats.agentLabels.length || 0} Agents</em>
                  <XCircle
                    size={15}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveProject(folder);
                    }}
                  />
                </button>
              );
            })}
          </div>
        )}

        <div className="skill-list-board">
          <div className="skill-table-head">
            <span />
            <span>Skill</span>
            <span>Agent 覆盖</span>
            <span>状态</span>
          </div>

          <div className="skill-list">
            {skills.map((skill) => {
              const expanded = selectedSkill?.id === skill.id;
              return (
                <Fragment key={skill.id}>
                  <SkillRow
                    skill={skill}
                    agents={agents}
                    skillLocks={skillLocks}
                    active={expanded}
                    checked={selectedSkillIds.has(skill.id)}
                    updateCheck={skillUpdateChecks[skill.id]}
                    updating={updatingSkillIds.has(skill.id)}
                    onSelect={() => onSelectSkill(expanded ? null : skill.id)}
                    onToggle={() => onToggleSkill(skill.id)}
                    onUpdate={() => onUpdateSkill(skill)}
                  />
                  {expanded && (
                    <SkillDetail
                      skill={skill}
                      settings={settings}
                      skillLocks={skillLocks}
                      onAdopt={() => onAdopt(skill)}
                      onSelectForSync={() => onSelectForSync(skill)}
                    />
                  )}
                </Fragment>
              );
            })}
            {skills.length === 0 && (
              <div className="empty-list">
                <FileText size={28} />
                <strong>{emptyTitle}</strong>
                <span>{query || agentFilter !== "all" ? "试试切换 Agent 或清空搜索。" : emptyBody}</span>
                {isProjectWorkspace && !hasProjectWorkspaces && (
                  <div className="button-pair">
                    <button className="primary-button" onClick={onAddProject} type="button">
                      <FolderPlus size={16} />
                      关联项目工作区
                    </button>
                    <button className="secondary-button" onClick={onDiscoverProjects} type="button">
                      <Search size={16} />
                      扫描发现
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function SkillRow({
  skill,
  agents,
  skillLocks,
  active,
  checked,
  updateCheck,
  updating,
  onSelect,
  onToggle,
  onUpdate
}: {
  skill: SkillRecord;
  agents: AgentRecord[];
  skillLocks: Record<string, SkillLockEntry>;
  active: boolean;
  checked: boolean;
  updateCheck?: SkillUpdateCheck;
  updating: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onUpdate: () => void;
}) {
  return (
    <article className={`skill-row ${active ? "active" : ""}`} onClick={onSelect}>
      <label
        className={`select-checkbox ${checked ? "checked" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
        }}
        title="选择同步"
      >
        <input
          aria-label={`选择同步 ${skill.displayName}`}
          checked={checked}
          onChange={onToggle}
          type="checkbox"
        />
        <span>{checked && <Check size={14} />}</span>
      </label>
      <button className="skill-row-main" onClick={onSelect} type="button">
        <strong>
          <span className="skill-name-text">{skill.displayName}</span>
          <SourceOwnerTag skill={skill} skillLocks={skillLocks} />
          {active ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </strong>
        <span className="skill-row-description">{skill.description || skill.slug}</span>
      </button>
      <SkillAgentStack skill={skill} agents={agents} />
      <SkillStatusCell
        skill={skill}
        skillLocks={skillLocks}
        updateCheck={updateCheck}
        updating={updating}
        onUpdate={onUpdate}
      />
    </article>
  );
}

function SkillStatusCell({
  skill,
  skillLocks,
  updateCheck,
  updating,
  onUpdate
}: {
  skill: SkillRecord;
  skillLocks: Record<string, SkillLockEntry>;
  updateCheck?: SkillUpdateCheck;
  updating: boolean;
  onUpdate: () => void;
}) {
  const status = skillListStatus(skill, skillLocks, updateCheck);
  const title = updateCheck?.message ?? status.title;

  if (status.kind === "update") {
    return (
      <button
        className={`skill-status-badge ${status.kind}`}
        disabled={updating}
        onClick={(event) => {
          event.stopPropagation();
          onUpdate();
        }}
        title={title}
        type="button"
      >
        {updating ? "更新中" : status.label}
      </button>
    );
  }

  return (
    <span className={`skill-status-badge ${status.kind}`} title={title}>
      {status.label}
    </span>
  );
}

function SourceOwnerTag({ skill, skillLocks }: { skill: SkillRecord; skillLocks: Record<string, SkillLockEntry> }) {
  const source = skillSourceSummary(skill, skillLocks);
  if (!source.owner) return null;
  return <em title={source.detail}>{source.owner}</em>;
}

function SkillAgentStack({ skill, agents }: { skill: SkillRecord; agents: AgentRecord[] }) {
  const knownAgents = skill.installations
    .map((installation) => {
      const agent = agents.find((item) => item.id === installation.agentId);
      if (agent) return agent;
      return demoAgent(installation.agentId, installation.agentLabel, installation.status, 0, []);
    })
    .slice(0, 5);
  const extra = Math.max(0, skill.installations.length - knownAgents.length);

  return (
    <div className="skill-agent-stack" aria-label="已安装 Agent">
      {knownAgents.map((agent) => (
        <AgentIcon agent={agent} key={agent.id} />
      ))}
      {extra > 0 && <span className="agent-extra">+{extra}</span>}
      {knownAgents.length === 0 && <span className="muted">未安装</span>}
    </div>
  );
}

function SkillDetail({
  skill,
  settings,
  skillLocks,
  onAdopt,
  onSelectForSync
}: {
  skill: SkillRecord;
  settings: AppSettings;
  skillLocks: Record<string, SkillLockEntry>;
  onAdopt: () => void;
  onSelectForSync: () => void;
}) {
  const canAdopt = skill.canonicalStatus !== "imported" && Boolean(firstValidInstallation(skill));
  const source = skillSourceSummary(skill, skillLocks);
  const sourceInstallation = firstValidInstallation(skill);
  const localPath = skill.canonicalPath ?? sourceInstallation?.entryPath ?? "";

  return (
    <div className="skill-detail">
      {localPath && (
        <DetailField label="本地路径">
          <code title={localPath}>{settings.showRawPaths ? localPath : compactPath(localPath)}</code>
          <button
            className="meta-icon-button"
            onClick={(event) => {
              event.stopPropagation();
              void openPath(localPath);
            }}
            title="打开本地路径"
            type="button"
          >
            <FolderOpen size={15} />
          </button>
        </DetailField>
      )}

      <DetailField label="描述">
        <p>{skill.description || skill.slug}</p>
      </DetailField>

      {source.githubUrl && (
        <DetailField label="来源">
          <code title={source.githubUrl}>{source.detail}</code>
          <button
            className="meta-icon-button"
            onClick={(event) => {
              event.stopPropagation();
              void openUrl(source.githubUrl);
            }}
            title="打开 GitHub 仓库"
            type="button"
          >
            <Github size={15} />
          </button>
        </DetailField>
      )}

      {skill.issues.length > 0 && (
        <DetailField label="问题">
          <IssueList issues={skill.issues} />
        </DetailField>
      )}

      <div className="detail-actions">
        <button className="secondary-button" disabled={!canAdopt} onClick={onAdopt}>
          导入中心库
        </button>
        <button className="primary-button" onClick={onSelectForSync}>
          加入同步队列
        </button>
      </div>
    </div>
  );
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-field">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}

async function openPath(path: string) {
  if (!isTauriRuntime()) return;
  await invoke("open_path", { path });
}

async function openUrl(url: string | null) {
  if (!url || !isTauriRuntime()) return;
  await invoke("open_url", { url });
}

function SyncView({
  agents,
  queuedSkills,
  settings,
  plan,
  applyResult,
  busy,
  onRemoveSkill,
  onPreviewGlobal,
  onPreviewProject,
  onPreviewQuick,
  onApply,
  onGoSkills
}: {
  agents: AgentRecord[];
  queuedSkills: SkillRecord[];
  settings: AppSettings;
  plan: SyncPlan | null;
  applyResult: ApplyResult | null;
  busy: boolean;
  onRemoveSkill: (id: string) => void;
  onPreviewGlobal: (targets: AgentTarget[]) => void;
  onPreviewProject: (targets: AgentTarget[]) => void;
  onPreviewQuick: (method: QuickMigrationMethod, targets: AgentTarget[]) => void;
  onApply: () => void;
  onGoSkills: () => void;
}) {
  const [syncMode, setSyncMode] = useState<SyncMode>("quick");
  const [quickMethod, setQuickMethod] = useState<QuickMigrationMethod>("copy");
  const [targetScope, setTargetScope] = useState<"global" | "project">("global");
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(() => new Set(agents.map((agent) => agent.id)));
  const selectedSkill = queuedSkills[0] ?? null;
  const selectedSource = selectedSkill ? firstValidInstallation(selectedSkill) : null;

  useEffect(() => {
    setSelectedTargetIds((current) => {
      const validIds = new Set(agents.map((agent) => agent.id));
      const next = new Set([...current].filter((id) => validIds.has(id)));
      if (next.size > 0) return next;
      return new Set(agents.map((agent) => agent.id));
    });
  }, [agents]);

  const selectedTargets = agents.filter((agent) => selectedTargetIds.has(agent.id));
  const targets = selectedTargets.map((agent) => ({ agentId: agent.id, scope: targetScope }));
  const blocked = Boolean(plan?.blockedConflicts.length);
  const summary = plan ? syncPlanSummary(plan) : null;
  const groups = plan ? groupedOperations(plan.operations, agents) : [];
  const actionDisabled = !selectedSkill || selectedTargets.length === 0 || busy;
  const previewLabel = syncMode === "quick" ? "生成迁移预览" : "生成中心库同步预览";
  const generatedPlan = Boolean(plan);
  const sourcePath = selectedSource?.entryPath ?? "";
  const centralPath = selectedSkill ? `${settings.libraryPath}/${selectedSkill.slug}` : "";
  const confirmationText = plan
    ? planSummarySentence(plan, summary)
    : draftPlanSentence(syncMode, quickMethod, selectedTargets.length);

  function toggleTarget(agentId: string) {
    setSelectedTargetIds((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  function previewPlan() {
    if (syncMode === "quick") {
      onPreviewQuick(quickMethod, targets);
    } else if (targetScope === "project") {
      onPreviewProject(targets);
    } else {
      onPreviewGlobal(targets);
    }
  }

  return (
    <div className="sync-page">
      <section className="sync-main-pane">
        <div className="sync-mode-grid" aria-label="同步模式">
          <button className={`sync-mode-card ${syncMode === "quick" ? "active" : ""}`} onClick={() => setSyncMode("quick")} type="button">
            <CopyCheck size={24} />
            <span>
              <strong>快速迁移 <em>最快完成</em></strong>
              <small>直接复制或创建软链接到目标 Agent，不使用中心库</small>
            </span>
          </button>
          <button className={`sync-mode-card ${syncMode === "managed" ? "active" : ""}`} onClick={() => setSyncMode("managed")} type="button">
            <Link2 size={24} />
            <span>
              <strong>纳入中心库并同步 <em>长期管理</em></strong>
              <small>先复制到中心库，再用软链接分发到目标 Agent</small>
            </span>
          </button>
        </div>

        <div className="sync-work-grid">
          <section className="sync-form-pane">
            <SyncSection number="1" title="已选 Skill">
              {selectedSkill ? (
                <div className="selected-skill-card">
                  <FileText size={22} />
                  <span>
                    <strong>{selectedSkill.displayName}</strong>
                    <small>
                      来源 Agent {selectedSource?.agentLabel ?? "未知"} <i /> 来源路径 {sourcePath ? compactPath(sourcePath) : selectedSkill.slug}
                    </small>
                  </span>
                  <button className="icon-button subtle" onClick={() => onRemoveSkill(selectedSkill.id)} title="移除">
                    <XCircle size={16} />
                  </button>
                </div>
              ) : (
                <div className="empty-inline">
                  <ShieldCheck size={20} />
                  <span>还没有要同步的 Skill，请先回到发现 Skills 选择。</span>
                </div>
              )}
            </SyncSection>

            {syncMode === "quick" ? (
              <SyncSection number="2" title="迁移方式">
                <div className="option-grid two">
                  <button className={`choice-card ${quickMethod === "copy" ? "active" : ""}`} onClick={() => setQuickMethod("copy")} type="button">
                    <CopyCheck size={20} />
                    <span>
                      <strong>复制副本</strong>
                      <small>复制后目标 Agent 拥有独立副本</small>
                    </span>
                  </button>
                  <button className={`choice-card ${quickMethod === "symlink" ? "active" : ""}`} onClick={() => setQuickMethod("symlink")} type="button">
                    <Link2 size={20} />
                    <span>
                      <strong>创建软链接</strong>
                      <small>在目标 Agent 中创建软链接，指向原位置</small>
                    </span>
                  </button>
                </div>
              </SyncSection>
            ) : (
              <SyncSection number="2" title="中心库副本">
                <div className="managed-library-card">
                  <Link2 size={20} />
                  <span>
                    <strong>先复制到中心库，再用软链接分发到目标 Agent</strong>
                    <code title={centralPath}>{centralPath ? compactPath(centralPath) : "等待选择 Skill"}</code>
                  </span>
                  <em>将创建/确认</em>
                </div>
              </SyncSection>
            )}

            <SyncSection number="3" title="目标 Agent（可多选）">
              <div className="target-chip-grid">
                {agents.map((agent) => {
                  const selected = selectedTargetIds.has(agent.id);
                  const pathPreview = targetPathPreview(agent, targetScope);
                  return (
                    <button className={`target-chip ${selected ? "selected" : ""}`} key={agent.id} onClick={() => toggleTarget(agent.id)} type="button">
                      <AgentIcon agent={agent} />
                      <span>
                        <strong>{agent.label}</strong>
                        <small>{pathPreview ? compactPath(pathPreview) : "暂无项目路径"}</small>
                      </span>
                      {selected && <Check size={16} />}
                    </button>
                  );
                })}
              </div>
            </SyncSection>

            <SyncSection number="4" title="范围">
              <div className="option-grid two">
                <button className={`choice-card ${targetScope === "global" ? "active" : ""}`} onClick={() => setTargetScope("global")} type="button">
                  <Globe2 size={21} />
                  <span>
                    <strong>全局</strong>
                    <small>同步到各 Agent 的全局 Skills 目录</small>
                  </span>
                </button>
                <button className={`choice-card ${targetScope === "project" ? "active" : ""}`} onClick={() => setTargetScope("project")} type="button">
                  <FolderPlus size={21} />
                  <span>
                    <strong>当前项目</strong>
                    <small>同步到已关联项目的本地 Skills 目录</small>
                  </span>
                </button>
              </div>
            </SyncSection>
          </section>

          <aside className="sync-confirm-pane">
            <div className="pane-title">
              <div>
                <h1>执行前确认</h1>
                <p>预览前不会写入任何内容。</p>
              </div>
              <ShieldCheck size={24} />
            </div>

            <div className={`confirm-summary ${blocked ? "blocked" : ""}`}>
              {blocked ? <AlertTriangle size={22} /> : <Check size={22} />}
              <strong>{confirmationText}</strong>
            </div>

            {summary && (
              <div className="sync-summary-grid" aria-label="同步摘要">
                <InfoBlock label="创建" value={`${summary.create}`} />
                <InfoBlock label="覆盖/移除" value={`${summary.overwrite}`} />
                <InfoBlock label="备份" value={`${summary.backup}`} />
                <InfoBlock label="软链接" value={`${summary.symlink}`} />
                <InfoBlock label="跳过" value={`${summary.noop}`} />
                <InfoBlock label="阻塞" value={`${plan?.blockedConflicts.length ?? 0}`} />
              </div>
            )}

            {!plan && (
              <details className="confirm-details">
                <summary>查看预计操作说明</summary>
                <span>
                  {syncMode === "quick"
                    ? quickMethod === "copy"
                      ? "复制副本会让每个目标 Agent 拥有独立副本，后续更改互不影响。"
                      : "创建软链接会让目标 Agent 指向当前来源位置，不会复制中心库副本。"
                    : "中心库同步会先创建中心库副本，再在目标 Agent 中创建指向中心库的软链接。"}
                </span>
              </details>
            )}

            <div className="confirm-note">
              <strong>说明</strong>
              <span>{syncMode === "managed" ? "先复制到中心库，再用软链接分发到目标 Agent。" : "快速迁移不使用中心库，可选择复制副本或创建软链接。"}</span>
              <span>不会直接覆盖不同内容；冲突会在预览中阻塞。</span>
            </div>

            {plan && plan.preconditions.length > 0 && (
              <div className="precondition-note">
                <strong>执行前会先确认</strong>
                <span>{plan.preconditions.join(" · ")}</span>
              </div>
            )}
            {summary && summary.backup > 0 && (
              <div className="restore-note">
                <ShieldCheck size={17} />
                <span>计划会先把目标位置的现有内容移动到备份路径；如需恢复，可将备份内容复制回对应目标路径。</span>
              </div>
            )}
            {blocked && plan && (
              <div className="banner warning">
                <AlertTriangle size={17} />
                <span>{plan.blockedConflicts.join(" · ")}</span>
              </div>
            )}

            <details className="confirm-details" open={generatedPlan}>
              <summary>{generatedPlan ? "查看操作详情" : "生成预览后查看操作详情"}</summary>
              {generatedPlan && (
                <div className="operation-list compact">
                  {groups.map((group) => (
                    <section className="operation-group" key={group.key}>
                      <div className="operation-group-heading">
                        <strong>{group.title}</strong>
                        <span>{group.operations.length} 项操作</span>
                      </div>
                      {group.operations.map((operation) => (
                        <div className={`operation ${operation.status}`} key={operation.id}>
                          <StatusIcon status={operation.status} />
                          <div>
                            <strong>{operation.message}</strong>
                            <small>{operationTypeLabel(operation.opType)} · {operationStatusLabel(operation.status)}</small>
                            {(operation.sourcePath || operation.targetPath || operation.backupPath) && (
                              <details className="operation-paths">
                                <summary>查看路径与恢复信息</summary>
                                {operation.sourcePath && <code>来源 {operation.sourcePath}</code>}
                                {operation.targetPath && <code>目标 {operation.targetPath}</code>}
                                {operation.backupPath && <code>备份 {operation.backupPath}</code>}
                                {operation.backupPath && operation.targetPath && (
                                  <span>恢复方式：把备份路径内容复制回目标路径。</span>
                                )}
                              </details>
                            )}
                          </div>
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              )}
            </details>

            {applyResult && (
              <div className={`apply-result ${applyResult.errors.length ? "error" : "success"}`}>
                <strong>{applyResult.errors.length ? "执行完成，但有错误" : "执行完成"}</strong>
                <span>{applyResult.appliedOperations.length} 已执行 · {applyResult.skippedOperations.length} 已跳过</span>
                {applyResult.errors.map((item) => <code key={item}>{item}</code>)}
              </div>
            )}
          </aside>
        </div>

        <div className="sync-action-bar">
          <button className="secondary-button large" onClick={onGoSkills}>
            <Layers3 size={16} />
            返回选择 Skills
          </button>
          {generatedPlan ? (
            <div className="button-pair">
              <button className="secondary-button large" disabled={actionDisabled} onClick={previewPlan}>
                重新生成预览
              </button>
              <button className="primary-button large" disabled={!plan || blocked || busy} onClick={onApply}>
                <CopyCheck size={16} />
                执行同步计划
              </button>
            </div>
          ) : (
            <button className="primary-button large" disabled={actionDisabled} onClick={previewPlan}>
              {previewLabel}
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function SyncSection({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <section className="sync-section">
      <div className="sync-section-title">
        <span>{number}</span>
        <strong>{title}</strong>
      </div>
      {children}
    </section>
  );
}

function targetPathPreview(agent: AgentRecord, scope: "global" | "project") {
  return scope === "project" ? agent.projectRoots[0] : agent.globalRoots[0];
}

function draftPlanSentence(mode: SyncMode, method: QuickMigrationMethod, targetCount: number) {
  if (targetCount === 0) return "请选择至少 1 个目标 Agent。";
  if (mode === "managed") {
    return `将导入中心库 1 个 Skill，并创建 ${targetCount} 个软链接。`;
  }
  return method === "copy"
    ? `将复制 1 个 Skill 到 ${targetCount} 个 Agent。`
    : `将在 ${targetCount} 个 Agent 中创建软链接。`;
}

function planSummarySentence(plan: SyncPlan, summary: ReturnType<typeof syncPlanSummary> | null) {
  if (!summary) return "同步预览已生成。";
  if (plan.blockedConflicts.length > 0) return `发现 ${plan.blockedConflicts.length} 个阻塞，请先处理后再执行。`;
  const parts = [];
  if (summary.create > 0) parts.push(`创建 ${summary.create} 项`);
  if (summary.symlink > 0) parts.push(`创建 ${summary.symlink} 个软链接`);
  if (summary.backup > 0) parts.push(`备份 ${summary.backup} 项`);
  if (summary.noop > 0) parts.push(`跳过 ${summary.noop} 项`);
  return `${parts.join("，") || "无需变更"}，无阻塞。`;
}

function SettingsSheet({
  settings,
  inventory,
  onChange,
  onClose,
  onSave,
  onAddProjectFolder
}: {
  settings: AppSettings;
  inventory: InventorySnapshot | null;
  onChange: (settings: AppSettings) => void;
  onClose: () => void;
  onSave: () => void;
  onAddProjectFolder: () => void;
}) {
  return (
    <div className="sheet-backdrop">
      <aside className="settings-sheet">
        <div className="pane-title">
          <div>
            <h1>工作区设置</h1>
            <p>配置中心库、项目工作区和路径显示方式。</p>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭">
            <XCircle size={17} />
          </button>
        </div>

        <label className="field">
          <span>中心库</span>
          <input value={settings.libraryPath} onChange={(event) => onChange({ ...settings, libraryPath: event.target.value })} />
          <small>中心库用于保存规范 Skill 副本；同步时会从这里链接或复制到目标 Agent。</small>
        </label>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={settings.showRawPaths}
            onChange={(event) => onChange({ ...settings, showRawPaths: event.target.checked })}
          />
          显示原始文件路径
        </label>

        <section className="settings-section">
          <div className="section-heading">
            <h2>项目目录</h2>
            <button className="secondary-button" onClick={onAddProjectFolder}>
              <FolderPlus size={16} />
              添加
            </button>
          </div>
          {settings.projectFolders.map((folder) => (
            <div className="path-row" key={folder}>
              <code>{folder}</code>
              <button
                className="icon-button subtle"
                onClick={() => onChange({ ...settings, projectFolders: settings.projectFolders.filter((item) => item !== folder) })}
              >
                <XCircle size={16} />
              </button>
            </div>
          ))}
          {settings.projectFolders.length === 0 && <p className="muted">还没有添加项目目录。</p>}
        </section>

        <section className="settings-section">
          <h2>应用数据</h2>
          <code className="path-code">{inventory?.appDataPath || "尚未扫描"}</code>
        </section>

        <div className="sheet-actions">
          <button className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" onClick={onSave}>
            <Check size={16} />
            保存
          </button>
        </div>
      </aside>
    </div>
  );
}

function AgentIcon({ agent }: { agent: AgentRecord }) {
  const icon = agentIconAsset(agent.id);
  const fallback = agent.label.slice(0, 2).toUpperCase();
  const iconStyle = icon?.size ? ({ "--agent-icon-size": `${icon.size}px` } as CSSProperties) : undefined;

  return (
    <span className={`agent-icon ${agent.installed ? "installed" : ""}`}>
      {icon ? (
        <img alt="" aria-hidden="true" src={icon.src} style={iconStyle} />
      ) : (
        <em>{fallback}</em>
      )}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const label = status === "installed" ? "已安装" : "未安装";
  return <span className={`status-pill ${status}`}>{label}</span>;
}

function SkillState({ skill }: { skill: SkillRecord }) {
  if (skill.conflict) return <span className="status-pill residual">冲突</span>;
  if (skill.issues.length > 0) return <span className="status-pill residual">需检查</span>;
  if (skill.canonicalStatus === "imported") return <span className="status-pill installed">已导入</span>;
  return <span className="status-pill not-installed">外部</span>;
}

function Coverage({ skill }: { skill: SkillRecord }) {
  const total = skill.installations.length + skill.missingAgents.length;
  const percent = total === 0 ? 0 : Math.round((skill.installations.length / total) * 100);
  return (
    <span className="coverage">
      <i style={{ width: `${percent}%` }} />
      <em>{skill.installations.length}/{total}</em>
    </span>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-block">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AgentBadge({ label, status }: { label: string; status: string }) {
  return <span className={`agent-badge ${status}`}>{label}</span>;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "noop") return <Check size={18} />;
  if (status === "blocked") return <AlertTriangle size={18} />;
  return <Link2 size={18} />;
}

function IssueList({ issues }: { issues: SkillIssue[] }) {
  return (
    <div className="issue-list">
      {issues.map((issue, index) => (
        <div className={`issue ${issue.severity}`} key={`${issue.code}-${index}`}>
          <AlertTriangle size={14} />
          <span>
            <strong>{issue.message}</strong>
            <small>{issueActionHint(issue)}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function issueActionHint(issue: SkillIssue) {
  if (issue.code === "broken-symlink") return "建议修复断开的软链接后再同步。";
  if (issue.code === "content-conflict") return "建议先选择一个规范来源，避免覆盖不同内容。";
  if (issue.code === "missing-skill-md") return "建议确认目录是否为有效 Skill。";
  if (issue.code === "name-mismatch") return "建议统一目录名和 frontmatter name。";
  return issue.path ? `位置：${issue.path}` : "建议先检查这个 Skill 的来源和安装状态。";
}

function syncPlanSummary(plan: SyncPlan) {
  return plan.operations.reduce(
    (summary, operation) => {
      if (operation.opType === "create-root") summary.create += 1;
      if (operation.opType === "copy-to-library") summary.create += 1;
      if (operation.opType === "copy-to-target") summary.create += 1;
      if (operation.opType === "remove-existing") summary.overwrite += 1;
      if (operation.opType === "backup-existing") {
        summary.backup += 1;
        summary.overwrite += 1;
      }
      if (operation.opType === "create-symlink") summary.symlink += 1;
      if (operation.opType === "noop" || operation.status === "noop") summary.noop += 1;
      return summary;
    },
    { create: 0, overwrite: 0, backup: 0, symlink: 0, noop: 0 }
  );
}

function groupedOperations(operations: SyncOperation[], agents: AgentRecord[]) {
  const groups = new Map<string, { key: string; title: string; operations: SyncOperation[] }>();
  operations.forEach((operation) => {
    const agent = operation.agentId ? agents.find((item) => item.id === operation.agentId) : null;
    const scope = inferOperationScope(operation, agent);
    const title = agent ? `${agent.label} · ${scope === "project" ? "项目" : "全局"}` : "中心库 / 准备操作";
    const key = `${agent?.id ?? "library"}:${scope}`;
    if (!groups.has(key)) groups.set(key, { key, title, operations: [] });
    groups.get(key)?.operations.push(operation);
  });
  return Array.from(groups.values());
}

function inferOperationScope(operation: SyncOperation, agent: AgentRecord | null | undefined) {
  if (!agent || !operation.targetPath) return "library";
  if (agent.projectRoots.some((root) => root && operation.targetPath?.startsWith(root))) return "project";
  return "global";
}

function operationTypeLabel(opType: string) {
  const labels: Record<string, string> = {
	    noop: "无需操作",
	    "copy-to-library": "复制到中心库",
	    "copy-to-target": "复制到目标",
	    "create-root": "创建根目录",
    "remove-existing": "移除现有项",
    "backup-existing": "备份现有项",
    "create-symlink": "创建软链接"
  };
  return labels[opType] ?? opType;
}

function operationStatusLabel(status: string) {
  const labels: Record<string, string> = {
    noop: "跳过",
    planned: "计划中",
    blocked: "已阻塞"
  };
  return labels[status] ?? status;
}

function firstValidInstallation(skill: SkillRecord): SkillInstallation | null {
  return skill.installations.find((installation) => installation.status !== "invalid" && !installation.brokenSymlink) ?? null;
}

function skillListStatus(
  skill: SkillRecord,
  skillLocks: Record<string, SkillLockEntry>,
  updateCheck?: SkillUpdateCheck
) {
  if (
    skill.conflict ||
    skill.issues.length > 0 ||
    skill.installations.some((installation) => installation.brokenSymlink || installation.status === "invalid" || installation.status === "broken")
  ) {
    return { kind: "check", label: "需检查", title: "检测到内容冲突、缺失文件或无效安装入口" };
  }

  const agentsSkill = skill.installations.some((installation) => isAgentsSkillPath(installation.entryPath));
  if (agentsSkill && !skillsShLock(skill, skillLocks)) {
    return { kind: "check", label: "需检查", title: "skills.sh 安装缺少 lock 信息，无法判断来源和更新" };
  }

  if (updateCheck?.status === "available") {
    return { kind: "update", label: "可更新", title: "发现 skills.sh 来源有新内容，点击更新" };
  }
  if (updateCheck?.status === "checking") {
    return { kind: "checking", label: "检查中", title: "正在检查 skills.sh 来源是否有更新" };
  }
  if (updateCheck?.status === "check-failed") {
    return { kind: "ok", label: "可用", title: updateCheck.message ?? "更新检查失败，不影响当前可用性" };
  }

  return { kind: "ok", label: "可用", title: "当前未发现明显问题" };
}

function skillSourceSummary(skill: SkillRecord, skillLocks: Record<string, SkillLockEntry>) {
  const skillsShInstallation = skill.installations.find((installation) => isAgentsSkillPath(installation.entryPath));
  const lock = skillsShLock(skill, skillLocks);
  if (skillsShInstallation && lock) {
    const detail = formatSourceDetail(lock.sourceUrl || lock.source || skillsShInstallation.entryPath);
    return {
      label: "skills.sh 安装",
      detail,
      owner: sourceOwner(detail),
      githubUrl: githubUrlFromDetail(detail)
    };
  }

  const pluginInstallation = skill.installations.find((installation) => pluginSourceDetail(installation.entryPath));
  if (pluginInstallation) {
    const detail = pluginSourceDetail(pluginInstallation.entryPath) ?? compactPath(pluginInstallation.entryPath);
    return {
      label: "Plugin 安装",
      detail,
      owner: sourceOwner(detail),
      githubUrl: githubUrlFromDetail(detail)
    };
  }

  const gitInstallation = skill.installations.find((installation) => installation.entryPath.includes("/.git/") || installation.rootPath.includes("/.git/"));
  if (gitInstallation) {
    const detail = compactPath(gitInstallation.entryPath);
    return {
      label: "Git 安装",
      detail,
      owner: sourceOwner(detail),
      githubUrl: githubUrlFromDetail(detail)
    };
  }

  const installation = firstValidInstallation(skill);
  const detail = compactPath(skill.canonicalPath ?? installation?.entryPath ?? skill.slug);
  return {
    label: "本地安装",
    detail,
    owner: sourceOwner(detail),
    githubUrl: githubUrlFromDetail(detail)
  };
}

function skillsShUpdateSource(skill: SkillRecord, skillLocks: Record<string, SkillLockEntry>) {
  const installation = skill.installations.find((item) => isAgentsSkillPath(item.entryPath));
  const lock = skillsShLock(skill, skillLocks);
  const sourceUrl = lock?.sourceUrl || lock?.source;
  if (!installation || !lock || !sourceUrl) return null;
  return { installation, lock, sourceUrl };
}

function skillsShLock(skill: SkillRecord, skillLocks: Record<string, SkillLockEntry>) {
  return skillLocks[skill.slug] ?? skillLocks[skill.displayName];
}

const AGENTS_SKILL_PATH_REGEX = /\/\.agents\/skills\/[^/]+$/;

function isAgentsSkillPath(path: string) {
  return AGENTS_SKILL_PATH_REGEX.test(path);
}

function failedUpdateCheck(reason: unknown): SkillUpdateCheck {
  return { status: "check-failed", message: String(reason) };
}

function pluginSourceDetail(path: string) {
  const claudeMarketplace = path.match(/\/\.claude\/plugins\/marketplaces\/([^/]+)/);
  if (claudeMarketplace) return marketplaceRepositoryLabel(claudeMarketplace[1]);

  const cursorMarketplace = path.match(/\/\.cursor\/plugins\/marketplaces\/([^/]+)/);
  if (cursorMarketplace) return marketplaceRepositoryLabel(cursorMarketplace[1]);

  const codexPlugin = path.match(/\/\.codex\/plugins\/cache\/([^/]+)\/([^/]+)/);
  if (codexPlugin) return codexPluginRepositoryLabel(codexPlugin[1], codexPlugin[2]);

  return null;
}

function marketplaceRepositoryLabel(name: string) {
  const repositories: Record<string, string> = {
    "anthropic-agent-skills": "github.com/anthropics/skills",
    "axton-obsidian-visual-skills": "github.com/axtonliu/axton-obsidian-visual-skills",
    "caicai-skills": "github.com/nextcaicai/caicai-skills",
    "claude-plugins-official": "github.com/anthropics/claude-plugins-official",
    "dontbesilent-skills": "github.com/dontbesilent2025/dbskill"
  };
  return repositories[name] ?? name;
}

function codexPluginRepositoryLabel(marketplace: string, name: string) {
  const repositories: Record<string, string> = {
    "build-ios-apps": "github.com/openai/plugins",
    browser: "openai-bundled/browser",
    chrome: "openai-bundled/chrome",
    hyperframes: "github.com/heygen-com/hyperframes",
    remotion: "github.com/remotion-dev/remotion"
  };
  return repositories[name] ?? `${marketplace}/${name}`;
}

function formatSourceDetail(value: string) {
  return compactPath(value.replace(/^https?:\/\//, "").replace(/^git@github\.com:/, "github.com/").replace(/\.git$/, ""));
}

function sourceOwner(detail: string) {
  const github = detail.match(/^github\.com\/([^/]+)/);
  if (github) return github[1];

  const bundled = detail.match(/^(openai-bundled|openai-curated)(?:\/|$)/);
  if (bundled) return bundled[1];

  return null;
}

function githubUrlFromDetail(detail: string) {
  return detail.startsWith("github.com/") ? `https://${detail}` : null;
}

function compactPath(path: string) {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

function projectSkillsForFolder(skills: SkillRecord[], folder: string | null): SkillRecord[] {
  if (!folder) return [];
  const projectSkills: SkillRecord[] = [];
  for (const skill of skills) {
    const installations = skill.installations.filter((installation) =>
      installation.scope === "project" && isPathInFolder(installation.rootPath, folder)
    );
    if (installations.length === 0) continue;
    projectSkills.push({
      ...skill,
      installations,
      missingAgents: []
    });
  }
  return projectSkills;
}

function projectName(folder: string) {
  const clean = folder.replace(/\/+$/, "");
  return clean.split("/").pop() || clean;
}

function projectStats(folder: string, skills: SkillRecord[]) {
  const projectSkills = projectSkillsForFolder(skills, folder);
  const agentLabels = projectSkills
    .flatMap((skill) => skill.installations.map((installation) => installation.agentLabel))
    .filter((label, index, labels) => labels.indexOf(label) === index);
  return {
    skillCount: projectSkills.length,
    agentLabels
  };
}

function isPathInFolder(path: string, folder: string) {
  const normalizedPath = path.replace(/\/+$/, "");
  const normalizedFolder = folder.replace(/\/+$/, "");
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

function agentSkillCount(agentId: string, skills: SkillRecord[]) {
  return skills.filter((skill) => skill.installations.some((installation) => installation.agentId === agentId)).length;
}

function agentSignalSummary(agent: AgentRecord) {
  const labels = agent.detectionSources.flatMap((source) => {
    if (source.kind === "cli") return ["CLI"];
    if (source.kind === "app") return ["App"];
    if (source.kind === "extension") return ["扩展"];
    if (source.kind === "plugin-installed") return ["插件"];
    return [];
  });
  return Array.from(new Set(labels)).join(" · ");
}

const demoAgents: AgentRecord[] = [
  demoAgent("amp", "AMP", "installed", 3, ["cli"]),
  demoAgent("antigravity", "Antigravity", "not-installed", 0, []),
  demoAgent("augment", "Augment", "not-installed", 0, []),
  demoAgent("claude-code", "Claude Code", "installed", 8, ["cli", "config"]),
  demoAgent("cline", "Cline", "installed", 2, ["extension"]),
  demoAgent("codebuddy", "CodeBuddy", "not-installed", 0, []),
  demoAgent("codex", "Codex", "installed", 12, ["cli", "plugin-installed"]),
  demoAgent("cursor", "Cursor", "installed", 4, ["app"]),
  demoAgent("gemini-cli", "Gemini CLI", "installed", 2, ["cli"]),
  demoAgent("github-copilot", "GitHub Copilot", "not-installed", 1, ["config"]),
  demoAgent("grok-cli", "Grok CLI", "not-installed", 0, []),
  demoAgent("hermes", "Hermes", "not-installed", 0, []),
  demoAgent("junie", "Junie", "not-installed", 0, []),
  demoAgent("kilo-code", "Kilo Code", "not-installed", 0, []),
  demoAgent("kimi", "Kimi", "not-installed", 0, []),
  demoAgent("kiro", "Kiro", "not-installed", 0, []),
  demoAgent("openclaw", "OpenClaw", "not-installed", 0, []),
  demoAgent("opencode", "OpenCode", "installed", 1, ["cli"]),
  demoAgent("pi", "Pi", "not-installed", 0, []),
  demoAgent("qoder", "Qoder", "not-installed", 0, []),
  demoAgent("qwen_code", "Qwen Code", "not-installed", 0, []),
  demoAgent("trae", "TRAE", "installed", 1, ["app"]),
  demoAgent("trae_cn", "TRAE CN", "not-installed", 0, []),
  demoAgent("warp", "Warp", "not-installed", 0, []),
  demoAgent("windsurf", "Windsurf", "installed", 3, ["app"]),
  demoAgent("workbuddy", "WorkBuddy", "not-installed", 0, []),
  demoAgent("zed", "Zed", "installed", 2, ["app"])
];

const demoInventory: InventorySnapshot = {
  agents: demoAgents,
  roots: [],
  skills: [
    demoSkill("browser", "Browser Control", "控制浏览器、截图和验证本地页面。", ["codex", "claude-code", "cursor"]),
    demoSkill("blog-translator", "Blog Translator", "抓取英文博客并整理成中文 Markdown。", ["codex", "amp"]),
    demoSkill("swiftui-patterns", "SwiftUI UI Patterns", "构建和重构 SwiftUI 界面结构。", ["codex", "windsurf", "claude-code"]),
    demoSkill("playwright", "Playwright", "自动化真实浏览器做 UI 验证。", ["codex", "gemini-cli"])
  ],
  issues: [],
  scannedAt: new Date().toISOString(),
  appDataPath: "/Users/example/Library/Application Support/oh-my-skills",
  libraryPath: "/Users/example/.oh-my-skills/library"
};

const demoSkillLocks: Record<string, SkillLockEntry> = {
  browser: {
    sourceType: "github",
    sourceUrl: "https://github.com/example/browser-skills.git"
  }
};

function demoAgent(id: string, label: string, status: string, count: number, kinds: string[]): AgentRecord {
  const installed = status === "installed";
  return {
    id,
    label,
    globalRoots: [`~/.${id}/skills`],
    projectRoots: [`.${id}/skills`],
    activeSignals: [`~/.${id}`],
    cliNames: installed ? [id] : [],
    appPaths: [],
    symlinkSupport: true,
    priority: 1,
    installed,
    status,
    detectionSources: kinds.map((kind) => ({
      kind,
      label: kind,
      path: kind === "app" ? `/Applications/${label}.app` : `/Users/example/.${id}`,
      exists: true
    })),
    skillRoots: [],
    skillEntryCount: count
  };
}

function demoSkill(id: string, name: string, description: string, agentIds: string[]): SkillRecord {
  const installations = agentIds.map((agentId) => {
    const agent = demoAgents.find((item) => item.id === agentId) ?? demoAgents[0];
    return {
      id: `${agentId}:${id}`,
      agentId,
      agentLabel: agent.label,
      scope: "global",
      rootPath: `/Users/example/.${agentId}/skills`,
      entryPath: `/Users/example/.${agentId}/skills/${id}`,
      isSymlink: agentId !== agentIds[0],
      brokenSymlink: false,
      status: agentId === agentIds[0] ? "installed" : "linked",
      issues: []
    } satisfies SkillInstallation;
  });

  return {
    id,
    slug: id,
    displayName: name,
    description,
    canonicalStatus: "imported",
    canonicalPath: `/Users/example/.oh-my-skills/library/${id}`,
    canonicalHash: "demo",
    installations,
    missingAgents: demoAgents.filter((agent) => agent.installed && !agentIds.includes(agent.id)).map((agent) => agent.id),
    issues: [],
    conflict: false
  };
}

function demoPlan(skill: SkillRecord, targets: AgentTarget[], kind: "adopt" | "sync" | "quick-migrate"): SyncPlan {
  const fallbackTargets = targets.length > 0 ? targets : [{ agentId: "codex", scope: "global" }];
  return {
    planId: `demo-${kind}-${Date.now()}`,
    kind,
    riskLevel: "low",
    preconditions: kind === "adopt" ? ["复制源 Skill 到中心库"] : ["确认目标 Agent 根目录存在"],
    blockedConflicts: [],
    createdAt: new Date().toISOString(),
    operations: [
      ...(kind === "adopt"
        ? [{
            id: "demo-copy",
            opType: "copy-to-library",
            status: "planned",
            sourcePath: firstValidInstallation(skill)?.entryPath,
            targetPath: `/Users/example/.oh-my-skills/library/${skill.slug}`,
            message: `导入 ${skill.displayName} 到中心库`,
            skillId: skill.id
          }]
        : []),
      ...fallbackTargets.map((target, index) => ({
        id: `demo-link-${index}`,
        opType: "create-symlink",
        status: "planned",
        sourcePath: `/Users/example/.oh-my-skills/library/${skill.slug}`,
        targetPath: `/Users/example/.${target.agentId}/skills/${skill.slug}`,
        message: `同步 ${skill.displayName} 到 ${target.agentId} ${target.scope ?? "global"}`,
        agentId: target.agentId,
        skillId: skill.id
      }))
    ]
  };
}
