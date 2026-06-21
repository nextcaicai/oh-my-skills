import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CopyCheck,
  FileText,
  FolderOpen,
  FolderPlus,
  Github,
  Globe2,
  Home,
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
  InstallationRef,
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

type View = "skills" | "sync";
type SkillWorkspace = "global" | "project";
type SyncMode = "quick" | "managed";
type QuickMigrationMethod = "copy" | "symlink";

const defaultSettings: AppSettings = {
  libraryPath: "",
  projectFolders: [],
  customRoots: [],
  showRawPaths: false,
  language: "zh-CN"
};

const appLogo = new URL("../oms_logo.svg", import.meta.url).href;

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [draftSettings, setDraftSettings] = useState<AppSettings>(defaultSettings);
  const [inventory, setInventory] = useState<InventorySnapshot | null>(null);
  const [skillLocks, setSkillLocks] = useState<Record<string, SkillLockEntry>>({});
  const [view, setView] = useState<View>("skills");
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
  const [syncMode, setSyncMode] = useState<SyncMode>("quick");
  const [busy, setBusy] = useState("启动中");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [previouslyScanned, setPreviouslyScanned] = useState(false);
  const bootStartedRef = useRef(false);
  const discoveryRunRef = useRef(0);

  useEffect(() => {
    if (bootStartedRef.current) return;
    bootStartedRef.current = true;
    void boot();
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
    setBusy("读取上次扫描");
    setError(null);
    if (!isTauriRuntime()) {
      setSettings(defaultSettings);
      setDraftSettings(defaultSettings);
      setSkillLocks(demoSkillLocks);
      setInventory(demoInventory);
      setHasScanned(false);
      const hadDemoData = (demoInventory?.agents?.length ?? 0) > 0 || (demoInventory?.skills?.length ?? 0) > 0;
      setPreviouslyScanned(hadDemoData);
      setSelectedSkillId(null);
      setBusy("");
      return;
    }
    try {
      const [loaded, locks, cachedInventory] = await Promise.all([
        invoke<AppSettings>("get_settings"),
        readSkillLocks(),
        readInventoryCache()
      ]);
      setSettings(loaded);
      setDraftSettings(loaded);
      setSkillLocks(locks);
      setInventory(cachedInventory);
      setHasScanned(false);
      const hadData = (cachedInventory?.agents?.length ?? 0) > 0 || (cachedInventory?.skills?.length ?? 0) > 0;
      setPreviouslyScanned(hadData);
      setSelectedSkillId((current) => {
        if (current && cachedInventory?.skills.some((skill) => skill.id === current)) return current;
        return null;
      });
      setSelectedSkillIds((current) => {
        if (!cachedInventory) return new Set();
        const valid = new Set(cachedInventory.skills.map((skill) => skill.id));
        return new Set([...current].filter((id) => valid.has(id)));
      });
      setBusy("");
    } catch (reason) {
      setError(String(reason));
      setBusy("");
    }
  }

  async function refreshInventory() {
    setBusy("扫描本机 Agent 与 Skills");
    setError(null);
    if (!isTauriRuntime()) {
      setInventory(demoInventory);
      setSkillLocks(demoSkillLocks);
      setSkillUpdateChecks({});
      setHasScanned(true);
      setPreviouslyScanned(true);
      setBusy("");
      return;
    }
    try {
      const [locks, next] = await Promise.all([
        readSkillLocks(),
        invoke<InventorySnapshot>("scan_inventory", {
          options: { includeOrphaned: false }
        })
      ]);
      setSkillLocks(locks);
      setInventory(next);
      setSkillUpdateChecks({});
      setHasScanned(true);
      setPreviouslyScanned(true);
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
    setSkillLocks(await readSkillLocks());
  }

  async function readSkillLocks() {
    if (!isTauriRuntime()) {
      return demoSkillLocks;
    }
    return invoke<Record<string, SkillLockEntry>>("read_skill_lock");
  }

  async function readInventoryCache() {
    if (!isTauriRuntime()) {
      return demoInventory;
    }
    return invoke<InventorySnapshot | null>("read_inventory_cache");
  }

  async function previewSkillsSync(skills = queuedSkills, targets: AgentTarget[] = []) {
    const sources = syncSourcesForSkills(skills);
    if (sources.length === 0) return;
    setBusy("生成同步预览");
    setError(null);
    setApplyResult(null);
    if (!isTauriRuntime()) {
      setSyncPlan(demoBatchPlan(skills, targets, "batch-sync"));
      setView("sync");
      setBusy("");
      return;
    }
    try {
      const plan = await invoke<SyncPlan>("preview_batch_sync", {
        sources,
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
    const sources = quickMigrationSourcesForSkills(skills);
    if (sources.length === 0) return;
    setBusy("生成同步预览");
    setError(null);
    setApplyResult(null);
    if (!isTauriRuntime()) {
      setSyncPlan(demoBatchPlan(skills, targets, "batch-quick-migrate"));
      setView("sync");
      setBusy("");
      return;
    }
    try {
      const plan = await invoke<SyncPlan>("preview_batch_quick_migration", {
        sources,
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
    const valid = await validateProjectWorkspacePath(path);
    if (!valid) {
      setToast("该项目没有 skills，暂时无法添加");
      return;
    }

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

  async function validateProjectWorkspacePath(path: string) {
    if (settings.projectFolders.some((folder) => samePath(folder, path))) return true;
    if (!isTauriRuntime()) return true;

    setBusy("检查项目 Skills");
    setError(null);
    try {
      const candidates = await invoke<ProjectWorkspaceCandidate[]>("discover_project_workspaces", {
        basePath: path
      });
      return candidates.some((candidate) => samePath(candidate.path, path) && candidate.skillCount > 0);
    } catch (reason) {
      setError(String(reason));
      return false;
    } finally {
      setBusy("");
    }
  }

  async function addProjectWorkspace() {
    const selected = await open({ directory: true, multiple: false, title: "关联项目工作区" });
    if (typeof selected !== "string") return;
    await addProjectPath(selected);
  }

  async function discoverProjectWorkspaces() {
    const selected = await open({ directory: true, multiple: false, title: "扫描发现项目工作区" });
    if (typeof selected !== "string") return;
    const runId = discoveryRunRef.current + 1;
    discoveryRunRef.current = runId;
    setBusy("扫描发现项目工作区");
    setError(null);
    setSkillWorkspace("project");
    setView("skills");
    setDiscoveryBasePath(selected);
    try {
      if (!isTauriRuntime()) {
        if (discoveryRunRef.current !== runId) return;
        setDiscoveredProjects([]);
        setDiscoveryBasePath(null);
        setToast("该项目没有 skills，暂时无法添加");
        return;
      }
      const candidates = await invoke<ProjectWorkspaceCandidate[]>("discover_project_workspaces", {
        basePath: selected
      });
      if (discoveryRunRef.current !== runId) return;
      if (candidates.length === 0) {
        setDiscoveredProjects([]);
        setDiscoveryBasePath(null);
        setToast("该项目没有 skills，暂时无法添加");
        return;
      }
      setDiscoveredProjects(candidates);
    } catch (reason) {
      if (discoveryRunRef.current === runId) {
        setError(String(reason));
      }
    } finally {
      if (discoveryRunRef.current === runId) {
        setBusy("");
      }
    }
  }

  function closeProjectDiscovery() {
    discoveryRunRef.current += 1;
    setDiscoveredProjects([]);
    setDiscoveryBasePath(null);
    setBusy((current) => current === "扫描发现项目工作区" ? "" : current);
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

  function toggleSkill(id: string) {
    setSelectedSkillIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openSelectedSkillsSync(mode: SyncMode) {
    if (selectedSkillIds.size === 0) return;
    setView("sync");
    setSyncMode(mode);
  }

  function clearSelectedSkills() {
    setSelectedSkillIds(new Set());
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
        <div className="tab-bar" aria-label="主导航">
          <button
            className="nav-avatar"
            onClick={() => setSettingsOpen(true)}
            title="设置"
            type="button"
          >
            <img src={appLogo} alt="Oh My Skills" />
          </button>
          <TabButton active={view === "skills"} onClick={() => setView("skills")}>
            发现 Skills
          </TabButton>
          <TabButton active={view === "sync"} onClick={() => setView("sync")}>
            同步 Skills
          </TabButton>
        </div>

        <div className="top-actions">
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

      {toast && <div className="toast" role="status">{toast}</div>}

      <section className="content-frame">
        {view === "skills" && !hasScanned ? (
          <div className="agents-page empty-state-page">
            <AgentDiscoveryEmptyState
              busy={busy}
              previouslyScanned={previouslyScanned}
              onScan={() => void refreshInventory()}
              onSkip={() => setHasScanned(true)}
            />
          </div>
        ) : view === "skills" ? (
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
            onAdoptSelected={() => openSelectedSkillsSync("managed")}
            onQuickSyncSelected={() => openSelectedSkillsSync("quick")}
            onClearSelection={clearSelectedSkills}
            onRefresh={() => void refreshInventory()}
            onAddProject={() => void addProjectWorkspace()}
            onDiscoverProjects={() => void discoverProjectWorkspaces()}
            onCloseDiscovery={closeProjectDiscovery}
            onLinkDiscoveredProject={(path) => void addProjectPath(path)}
            onRemoveProject={(folder) => void removeProjectWorkspace(folder)}
          />
        ) : null}

        {view === "sync" && (
          <SyncView
            agents={installedAgents.length ? installedAgents : agents}
            queuedSkills={queuedSkills}
            settings={settings}
            plan={syncPlan}
            applyResult={applyResult}
            busy={Boolean(busy)}
            syncMode={syncMode}
            onSyncModeChange={setSyncMode}
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
          agents={installedAgents}
          skills={allSkills}
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

const emptyStateAgentIds = [
  "codex",
  "claude-code",
  "cursor",
  "windsurf",
  "gemini-cli",
  "qwen_code",
  "opencode"
];

function AgentDiscoveryEmptyState({
  busy,
  previouslyScanned = false,
  onScan,
  onSkip,
}: {
  busy: string;
  previouslyScanned?: boolean;
  onScan: () => void;
  onSkip?: () => void;
}) {
  const isFirstUse = !previouslyScanned;

  return (
    <section className="agent-empty-state" aria-label="发现 Skills 空状态">
      <div className="agent-empty-visual" aria-hidden="true">
        {emptyStateAgentIds.map((agentId, index) => {
          const icon = agentIconAsset(agentId);
          if (!icon) return null;
          const style = {
            "--slot-index": index,
            "--agent-icon-size": `${icon.size ?? 25}px`
          } as CSSProperties;

          return (
            <span className={`agent-empty-logo logo-${index + 1}`} key={agentId} style={style}>
              <img alt="" src={icon.src} />
            </span>
          );
        })}
      </div>

      <div className="agent-empty-copy">
        {isFirstUse ? (
          <strong>先扫描这台电脑，看看有哪些 Skills 可用</strong>
        ) : (
          <span>本地可用 Skills 可能发生了变化，可以重新扫描或直接跳过</span>
        )}
      </div>

      {isFirstUse ? (
        <button
          className="agent-empty-button"
          disabled={Boolean(busy)}
          onClick={onScan}
          type="button"
        >
          {busy ? <Loader2 className="spin" size={16} /> : null}
          <span>开始扫描</span>
        </button>
      ) : (
        <div className="empty-actions">
          <button
            className="agent-empty-button"
            disabled={Boolean(busy)}
            onClick={onScan}
            type="button"
          >
            {busy ? <Loader2 className="spin" size={16} /> : null}
            <span>重新扫描</span>
          </button>
          {onSkip && (
            <button
              className="secondary-button"
              disabled={Boolean(busy)}
              onClick={onSkip}
              type="button"
            >
              直接跳过
            </button>
          )}
        </div>
      )}
    </section>
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
  onAdoptSelected,
  onQuickSyncSelected,
  onClearSelection,
  onRefresh,
  onAddProject,
  onDiscoverProjects,
  onCloseDiscovery,
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
  onAdoptSelected: () => void;
  onQuickSyncSelected: () => void;
  onClearSelection: () => void;
  onRefresh: () => void;
  onAddProject: () => void;
  onDiscoverProjects: () => void;
  onCloseDiscovery: () => void;
  onLinkDiscoveredProject: (path: string) => void;
  onRemoveProject: (folder: string) => void;
}) {
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [projectScrollState, setProjectScrollState] = useState({ left: false, right: false });
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const projectBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!agentMenuOpen) return undefined;
    const onDocClick = (e: MouseEvent) => {
      if (agentMenuRef.current && !agentMenuRef.current.contains(e.target as Node)) {
        setAgentMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAgentMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [agentMenuOpen]);

  const updateProjectScrollState = () => {
    const element = projectBarRef.current;
    if (!element) {
      setProjectScrollState({ left: false, right: false });
      return;
    }

    const maxScroll = element.scrollWidth - element.clientWidth;
    setProjectScrollState({
      left: element.scrollLeft > 2,
      right: element.scrollLeft < maxScroll - 2
    });
  };

  useEffect(() => {
    window.requestAnimationFrame(updateProjectScrollState);
  }, [projectFolders, selectedProjectFolder, workspace]);

  useEffect(() => {
    window.addEventListener("resize", updateProjectScrollState);
    return () => window.removeEventListener("resize", updateProjectScrollState);
  }, []);

  function scrollProjectBar(direction: "left" | "right") {
    const element = projectBarRef.current;
    if (!element) return;
    element.scrollBy({
      left: direction === "left" ? -340 : 340,
      behavior: "smooth"
    });
    window.setTimeout(updateProjectScrollState, 260);
  }

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
  const isProjectNoWorkspace = isProjectWorkspace && !hasProjectWorkspaces;
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
  const selectedSkills = selectedSkillsInOrder(selectedSkillIds, allSkills);
  const selectedCount = selectedSkills.length;
  const recentSelectedSkills = selectedSkills.slice(-2);
  const extraSelectedCount = Math.max(0, selectedCount - recentSelectedSkills.length);

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
            <div className="agent-menu-wrap" ref={agentMenuRef}>
              <button
                className={`agent-menu-trigger ${agentMenuOpen ? "open" : ""}`}
                onClick={() => {
                  setSearchOpen(false);
                  setAgentMenuOpen((open) => !open);
                }}
                type="button"
              >
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
                    <span className="check-col">{agentFilter === "all" && <Check size={13} />}</span>
                    <span className="menu-label">全部 Agent</span>
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
                      <span className="check-col">{agentFilter === agent.id && <Check size={13} />}</span>
                      <span className="menu-label">{agent.label}</span>
                      <strong>{agentSkillCount(agent.id, sourceSkills)}</strong>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        {!isProjectNoWorkspace && (
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
        )}

        {isProjectWorkspace && (discovering || discoveryBasePath || discoveredProjects.length > 0) && (
          <section className="discovery-panel">
            <div className="discovery-heading">
              <span>
                <strong>扫描发现</strong>
                {discoveryBasePath && <small>{discoveryBasePath}</small>}
              </span>
              <button className="icon-button plain" onClick={onCloseDiscovery} title="关闭扫描发现" type="button">
                <XCircle size={18} />
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
            </div>
          </section>
        )}

        {isProjectWorkspace && hasProjectWorkspaces && (
          <div className="project-workspace-shell">
            {projectScrollState.left && (
              <button
                className="project-scroll-button left"
                onClick={() => scrollProjectBar("left")}
                title="向左滑动"
                type="button"
              >
                <ChevronLeft size={17} />
              </button>
            )}
            <div
              className="project-workspace-bar"
              aria-label="已关联项目工作区"
              onScroll={updateProjectScrollState}
              ref={projectBarRef}
            >
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
                    <em>{stats.skillCount} Skills</em>
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
            {projectScrollState.right && (
              <button
                className="project-scroll-button right"
                onClick={() => scrollProjectBar("right")}
                title="向右滑动"
                type="button"
              >
                <ChevronRight size={17} />
              </button>
            )}
          </div>
        )}

        {!isProjectNoWorkspace && (
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
                </div>
              )}
            </div>
          </div>
        )}

        {isProjectNoWorkspace && !(discovering || discoveryBasePath || discoveredProjects.length > 0) && (
          <ProjectWorkspaceEmptyState onAddProject={onAddProject} onDiscoverProjects={onDiscoverProjects} />
        )}
      </section>

      {selectedCount > 0 && (
        <div className="selection-action-bar" role="region" aria-label="已选 Skills 操作">
          <div className="selection-summary">
            <div className="selection-names">
              {recentSelectedSkills.map((skill) => (
                <span className="selection-name-chip" key={skill.id} title={skill.displayName}>
                  {skill.displayName}
                </span>
              ))}
              {extraSelectedCount > 0 && <span className="selection-extra">+{extraSelectedCount}</span>}
            </div>
            <button className="selection-clear" onClick={onClearSelection} type="button">
              取消全选
            </button>
          </div>
          <div className="selection-actions">
            <button className="secondary-button large" onClick={onAdoptSelected} type="button">
              导入中心库 {selectedCount} 个
            </button>
            <button className="primary-button large" onClick={onQuickSyncSelected} type="button">
              快速同步 {selectedCount} 个
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectWorkspaceEmptyState({
  onAddProject,
  onDiscoverProjects
}: {
  onAddProject: () => void;
  onDiscoverProjects: () => void;
}) {
  return (
    <section className="project-empty-state" aria-label="项目工作区空状态">
      <div className="project-empty-visual" aria-hidden="true">
        <div className="project-empty-card card-back">
          <span className="project-empty-icon small"><Home size={18} /></span>
          <span className="project-empty-lines">
            <i />
            <i className="short" />
          </span>
        </div>
        <div className="project-empty-card card-front">
          <span className="project-empty-icon"><Home size={26} /></span>
          <span className="project-empty-lines">
            <i />
            <i className="short" />
          </span>
        </div>
        <div className="project-empty-card card-low">
          <span className="project-empty-icon small"><Home size={18} /></span>
          <span className="project-empty-lines">
            <i />
            <i className="short" />
          </span>
        </div>
      </div>

      <div className="agent-empty-copy project-empty-copy">
        <strong>尚未关联项目工作区</strong>
        <span>关联项目根目录后，这里会显示该项目内各 Agent 生效的 Skills。</span>
      </div>

      <div className="empty-actions project-empty-actions">
        <button
          className="agent-empty-button"
          onClick={onAddProject}
          title="手动选择一个包含 Skills 的项目目录"
          type="button"
        >
          <span>关联项目</span>
        </button>
        <button
          className="secondary-button"
          onClick={onDiscoverProjects}
          title="从上级目录自动查找一个或多个包含 Skills 的项目"
          type="button"
        >
          扫描发现
        </button>
      </div>
    </section>
  );
}

function selectedSkillsInOrder(selectedSkillIds: Set<string>, skills: SkillRecord[]) {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  return [...selectedSkillIds].map((id) => byId.get(id)).filter((skill): skill is SkillRecord => Boolean(skill));
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
  skillLocks
}: {
  skill: SkillRecord;
  settings: AppSettings;
  skillLocks: Record<string, SkillLockEntry>;
}) {
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
  onGoSkills,
  syncMode,
  onSyncModeChange
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
  syncMode: SyncMode;
  onSyncModeChange: (mode: SyncMode) => void;
}) {
  const [quickMethod, setQuickMethod] = useState<QuickMigrationMethod>("copy");
  const [targetScope, setTargetScope] = useState<"global" | "project">("global");
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(() => new Set(agents.slice(0, 3).map((agent) => agent.id)));
  const targetMenuRef = useRef<HTMLDivElement>(null);
  const selectedSkill = queuedSkills[0] ?? null;
  const selectedSkillCount = queuedSkills.length;

  useEffect(() => {
    setSelectedTargetIds((current) => {
      const validIds = new Set(agents.map((agent) => agent.id));
      const next = new Set([...current].filter((id) => validIds.has(id)));
      if (next.size > 0) return next;
      return new Set(agents.slice(0, 3).map((agent) => agent.id));
    });
  }, [agents]);

  useEffect(() => {
    if (!targetPickerOpen) return undefined;
    const onDocClick = (e: MouseEvent) => {
      if (targetMenuRef.current && !targetMenuRef.current.contains(e.target as Node)) {
        setTargetPickerOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTargetPickerOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [targetPickerOpen]);

  const selectedTargets = agents.filter((agent) => selectedTargetIds.has(agent.id));
  const availableTargets = agents.filter((agent) => !selectedTargetIds.has(agent.id));
  const targets = selectedTargets.map((agent) => ({ agentId: agent.id, scope: targetScope }));
  const blocked = Boolean(plan?.blockedConflicts.length);
  const summary = plan ? syncPlanSummary(plan) : null;
  const groups = plan ? groupedOperations(plan.operations, agents) : [];
  const actionDisabled = selectedSkillCount === 0 || selectedTargets.length === 0 || busy;
  const previewLabel = syncMode === "quick"
    ? `生成 ${selectedSkillCount} 个快速同步预览`
    : `生成 ${selectedSkillCount} 个中心库同步预览`;
  const generatedPlan = Boolean(plan);
  const centralPath = selectedSkillCount === 1 && selectedSkill ? `${settings.libraryPath}/${selectedSkill.slug}` : settings.libraryPath;
  const confirmationText = plan
    ? planSummarySentence(plan, summary)
    : draftPlanSentence(syncMode, quickMethod, selectedSkillCount, selectedTargets.length);

  function toggleTarget(agentId: string) {
    setSelectedTargetIds((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  function addTarget(agentId: string) {
    setSelectedTargetIds((current) => new Set(current).add(agentId));
    setTargetPickerOpen(false);
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
          <button className={`sync-mode-card ${syncMode === "quick" ? "active" : ""}`} onClick={() => onSyncModeChange("quick")} type="button">
            <CopyCheck size={24} />
            <span>
              <strong>快速同步 <em>最快完成</em></strong>
              <small>直接复制或创建软链接到目标 Agent，不使用中心库</small>
            </span>
          </button>
          <button className={`sync-mode-card ${syncMode === "managed" ? "active" : ""}`} onClick={() => onSyncModeChange("managed")} type="button">
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
              {queuedSkills.length > 0 ? (
                <div className="selected-skill-list">
                  {queuedSkills.map((skill) => {
                    const selectedSource = firstValidInstallation(skill);
                    const sourcePath = selectedSource?.entryPath ?? skill.canonicalPath ?? "";
                    return (
                      <div className="selected-skill-card" key={skill.id}>
                        <FileText size={22} />
                        <span>
                          <strong>{skill.displayName}</strong>
                          <small>
                            来源 Agent {selectedSource?.agentLabel ?? "中心库"} <i /> 来源路径 {sourcePath ? compactPath(sourcePath) : skill.slug}
                          </small>
                        </span>
                        <button className="icon-button subtle" onClick={() => onRemoveSkill(skill.id)} title="移除">
                          <XCircle size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-inline">
                  <ShieldCheck size={20} />
                  <span>还没有要同步的 Skill，请先回到发现 Skills 选择。</span>
                </div>
              )}
            </SyncSection>

            {syncMode === "quick" ? (
              <SyncSection number="2" title="同步方式">
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
              <div className="target-picker">
                <div className="selected-target-row">
                  {selectedTargets.map((agent) => {
                    const pathPreview = targetPathPreview(agent, targetScope);
                    return (
                      <button className="selected-target-chip" key={agent.id} onClick={() => toggleTarget(agent.id)} title={pathPreview ? compactPath(pathPreview) : "移除目标"} type="button">
                        <Check size={15} />
                        <AgentIcon agent={agent} />
                        <strong>{agent.label}</strong>
                      </button>
                    );
                  })}
                  <div className="target-add-wrap" ref={targetMenuRef}>
                    <button className="target-add-button" onClick={() => setTargetPickerOpen((open) => !open)} type="button">
                      <FolderPlus size={16} />
                      添加
                    </button>
                    {targetPickerOpen && (
                      <div className="target-add-menu" role="menu">
                        {availableTargets.map((agent) => {
                          const pathPreview = targetPathPreview(agent, targetScope);
                          return (
                            <button key={agent.id} onClick={() => addTarget(agent.id)} type="button">
                              <AgentIcon agent={agent} />
                              <span>
                                <strong>{agent.label}</strong>
                                <small>{pathPreview ? compactPath(pathPreview) : "暂无项目路径"}</small>
                              </span>
                            </button>
                          );
                        })}
                        {availableTargets.length === 0 && <span className="target-empty">所有 Agent 已添加</span>}
                      </div>
                    )}
                  </div>
                </div>
                {selectedTargets.length === 0 && <span className="target-helper">请添加至少 1 个目标 Agent。</span>}
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
              <span>{syncMode === "managed" ? "先复制到中心库，再用软链接分发到目标 Agent。" : "快速同步不使用中心库，可选择复制副本或创建软链接。"}</span>
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

function draftPlanSentence(mode: SyncMode, method: QuickMigrationMethod, skillCount: number, targetCount: number) {
  if (skillCount === 0) return "请先选择至少 1 个 Skill。";
  if (targetCount === 0) return "请选择至少 1 个目标 Agent。";
  if (mode === "managed") {
    return `将导入中心库 ${skillCount} 个 Skill，并创建 ${skillCount * targetCount} 个软链接。`;
  }
  return method === "copy"
    ? `将复制 ${skillCount} 个 Skill 到 ${targetCount} 个 Agent。`
    : `将在 ${targetCount} 个 Agent 中为 ${skillCount} 个 Skill 创建软链接。`;
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
  agents = [],
  skills = [],
  onChange,
  onClose,
  onSave,
  onAddProjectFolder
}: {
  settings: AppSettings;
  inventory: InventorySnapshot | null;
  agents?: AgentRecord[];
  skills?: SkillRecord[];
  onChange: (settings: AppSettings) => void;
  onClose: () => void;
  onSave: () => void;
  onAddProjectFolder: () => void;
}) {
  const [settingsTab, setSettingsTab] = useState<"general" | "agents">("general");

  const installedCount = agents.length;
  const skillsForCount = skills.length ? skills : (inventory?.skills ?? []);

  // Close on backdrop click (blank area) and Esc
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <aside className="settings-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <div className="settings-tabs" role="tablist" aria-label="设置分类">
            <button
              role="tab"
              aria-selected={settingsTab === "general"}
              className={settingsTab === "general" ? "active" : ""}
              onClick={() => setSettingsTab("general")}
              type="button"
            >
              通用
            </button>
            <button
              role="tab"
              aria-selected={settingsTab === "agents"}
              className={settingsTab === "agents" ? "active" : ""}
              onClick={() => setSettingsTab("agents")}
              type="button"
            >
              Agent
            </button>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭" type="button">
            <XCircle size={17} />
          </button>
        </div>

        <div className="settings-content">
          {settingsTab === "general" && (
            <>
              <section className="settings-section">
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
                  <span>显示原始文件路径</span>
                </label>
              </section>

              <section className="settings-section">
                <div className="section-heading">
                  <h2>项目目录</h2>
                  <button className="secondary-button" onClick={onAddProjectFolder}>
                    <FolderPlus size={16} />
                    添加
                  </button>
                </div>
                <div className="settings-path-list">
                  {settings.projectFolders.map((folder) => (
                    <div className="path-row" key={folder}>
                      <code title={folder}>{folder}</code>
                      <button
                        className="icon-button subtle"
                        onClick={() => onChange({ ...settings, projectFolders: settings.projectFolders.filter((item) => item !== folder) })}
                        title="移除项目目录"
                      >
                        <XCircle size={16} />
                      </button>
                    </div>
                  ))}
                  {settings.projectFolders.length === 0 && <p className="muted">还没有添加项目目录。</p>}
                </div>
              </section>

              <section className="settings-section">
                <h2>应用数据</h2>
                <code className="path-code" title={inventory?.appDataPath || undefined}>{inventory?.appDataPath || "尚未扫描"}</code>
              </section>
            </>
          )}

          {settingsTab === "agents" && (
            <div className="settings-agents-pane">
              {installedCount > 0 ? (
                <div className="settings-agent-list">
                  {agents.map((agent) => {
                    const count = agentSkillCount(agent.id, skillsForCount);
                    const signal = agentSignalSummary(agent);
                    return (
                      <div className="settings-agent-row rich" key={agent.id}>
                        <AgentIcon agent={agent} />
                        <span className="agent-main">
                          <strong>{agent.label}</strong>
                          {signal && <small>{signal}</small>}
                        </span>
                        <span className="agent-count">
                          <strong>{count}</strong>
                          <small>Skills</small>
                        </span>
                        <StatusPill status={agent.status} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="settings-agent-empty">
                  暂未发现本地有可用Agent
                </div>
              )}
              <p className="settings-agent-hint">
                已发现 {installedCount} 个已安装 Agent。
              </p>
            </div>
          )}
        </div>

        <div className="sheet-actions">
          {settingsTab === "general" ? (
            <>
              <button className="secondary-button" onClick={onClose} type="button">取消</button>
              <button className="primary-button" onClick={onSave} type="button">
                <Check size={16} />
                保存
              </button>
            </>
          ) : (
            <button className="primary-button" onClick={onClose} type="button">关闭</button>
          )}
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

function syncSourcesForSkills(skills: SkillRecord[]): InstallationRef[] {
  return skills.map((skill) => {
    if (skill.canonicalStatus === "imported") {
      return {
        installationId: "",
        entryPath: "",
        slug: skill.slug
      };
    }

    const installation = firstValidInstallation(skill);
    return {
      installationId: installation?.id ?? "",
      entryPath: installation?.entryPath ?? "",
      slug: skill.slug
    };
  });
}

function quickMigrationSourcesForSkills(skills: SkillRecord[]): InstallationRef[] {
  return skills.map((skill) => {
    const installation = firstValidInstallation(skill);
    return {
      installationId: installation?.id ?? "",
      entryPath: installation?.entryPath ?? skill.canonicalPath ?? "",
      slug: skill.slug
    };
  });
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

function samePath(left: string, right: string) {
  return left.replace(/\/+$/, "") === right.replace(/\/+$/, "");
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

function demoBatchPlan(skills: SkillRecord[], targets: AgentTarget[], kind: "batch-sync" | "batch-quick-migrate"): SyncPlan {
  const plans = skills.map((skill) => demoPlan(skill, targets, kind === "batch-sync" ? "sync" : "quick-migrate"));
  return {
    planId: `demo-${kind}-${Date.now()}`,
    kind,
    riskLevel: plans.some((plan) => plan.riskLevel === "medium") ? "medium" : "low",
    preconditions: Array.from(new Set(plans.flatMap((plan) => plan.preconditions))),
    blockedConflicts: plans.flatMap((plan) => plan.blockedConflicts),
    createdAt: new Date().toISOString(),
    operations: plans.flatMap((plan, planIndex) =>
      plan.operations.map((operation) => ({
        ...operation,
        id: `${operation.id}-${planIndex}`
      }))
    )
  };
}
