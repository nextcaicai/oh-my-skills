import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AgentDiscoveryEmptyState } from "./components/AgentDiscoveryEmptyState";
import { SettingsSheet } from "./components/SettingsSheet";
import { TabButton } from "./components/TabButton";
import { demoBatchPlan, demoInventory, demoSkillLocks } from "./lib/demoData";
import { isTauriRuntime } from "./lib/runtime";
import { aggregateSkillsBySlug, failedUpdateCheck, projectSkillsForFolder, quickMigrationSourcesForSkills, samePath, skillsShUpdateSource, syncSourcesForSkills } from "./lib/skillUtils";
import type { QuickMigrationMethod, SkillWorkspace, SyncMode, View } from "./uiTypes";
import { SkillsView } from "./views/SkillsView";
import { SyncView } from "./views/SyncView";
import type {
  AgentTarget,
  ApplyResult,
  InventorySnapshot,
  ProjectWorkspaceCandidate,
  Settings as AppSettings,
  SkillLockEntry,
  SkillRecord,
  SkillUpdateCheck,
  SyncPlan,
  SyncReplacement
} from "./types";

const defaultSettings: AppSettings = {
  libraryPath: "",
  projectFolders: [],
  customRoots: [],
  showRawPaths: false,
  language: "zh-CN"
};

const appLogo = new URL("../oms_logo.svg", import.meta.url).href;
const selectionKeySeparator = "\u0000";

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
  const [syncQueuedSkillIds, setSyncQueuedSkillIds] = useState<Set<string>>(new Set());
  const [skillUpdateChecks, setSkillUpdateChecks] = useState<Record<string, SkillUpdateCheck>>({});
  const [updatingSkillIds, setUpdatingSkillIds] = useState<Set<string>>(new Set());
  const [syncPlan, setSyncPlan] = useState<SyncPlan | null>(null);
  const [syncPlanProjectFolders, setSyncPlanProjectFolders] = useState<string[]>([]);
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
  const allSkills = useMemo(() => aggregateSkillsBySlug(inventory?.skills ?? []), [inventory?.skills]);
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

  const librarySkills = useMemo(
    () => allSkills.filter((skill) => skill.canonicalStatus === "imported"),
    [allSkills]
  );

  const visibleSourceSkills = skillWorkspace === "project"
    ? projectSkills
    : skillWorkspace === "library"
      ? librarySkills
      : globalSkills;

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

  const scopedSelectedSkillIds = useMemo(
    () => new Set(
      visibleSourceSkills
        .filter((skill) => selectedSkillIds.has(selectionKeyFor(skillWorkspace, selectedProjectFolder, skill.id)))
        .map((skill) => skill.id)
    ),
    [selectedProjectFolder, selectedSkillIds, skillWorkspace, visibleSourceSkills]
  );

  const selectedSkills = useMemo(
    () => selectedSkillsForKeys(selectedSkillIds, allSkills, globalSkills, projectFolders, librarySkills),
    [allSkills, globalSkills, librarySkills, projectFolders, selectedSkillIds]
  );

  const queuedSkills = useMemo(
    () => selectedSkillsForKeys(syncQueuedSkillIds, allSkills, globalSkills, projectFolders, librarySkills),
    [allSkills, globalSkills, librarySkills, projectFolders, syncQueuedSkillIds]
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
        return filterValidSelectionKeys(current, aggregateSkillsBySlug(cachedInventory.skills), loaded.projectFolders);
      });
      setSyncQueuedSkillIds((current) => {
        if (!cachedInventory) return new Set();
        return filterValidSelectionKeys(current, aggregateSkillsBySlug(cachedInventory.skills), loaded.projectFolders);
      });
      setBusy("");
    } catch (reason) {
      setError(String(reason));
      setBusy("");
    }
  }

  async function refreshInventory(projectFoldersForSelection = settings.projectFolders) {
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
        return filterValidSelectionKeys(current, aggregateSkillsBySlug(next.skills), projectFoldersForSelection);
      });
      setSyncQueuedSkillIds((current) => {
        return filterValidSelectionKeys(current, aggregateSkillsBySlug(next.skills), projectFoldersForSelection);
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

  async function previewSkillsSync(skills = queuedSkills, targets: AgentTarget[] = [], replacements: SyncReplacement[] = []) {
    const sources = syncSourcesForSkills(skills);
    if (sources.length === 0) return;
    const plannedProjectFolders = projectFoldersFromTargets(targets);
    setBusy("生成同步预览");
    setError(null);
    setApplyResult(null);
    if (!isTauriRuntime()) {
      setSyncPlan(demoBatchPlan(skills, targets, "batch-sync"));
      setSyncPlanProjectFolders(plannedProjectFolders);
      setView("sync");
      setBusy("");
      return;
    }
    try {
      const plan = await invoke<SyncPlan>("preview_batch_sync", {
        sources,
        targets,
        replacements
      });
      setSyncPlan(plan);
      setSyncPlanProjectFolders(plannedProjectFolders);
      setView("sync");
    } catch (reason) {
      setSyncPlanProjectFolders([]);
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function previewQuickMigration(skills = queuedSkills, method: QuickMigrationMethod, targets: AgentTarget[] = []) {
    const sources = quickMigrationSourcesForSkills(skills);
    if (sources.length === 0) return;
    const plannedProjectFolders = projectFoldersFromTargets(targets);
    setBusy("生成同步预览");
    setError(null);
    setApplyResult(null);
    if (!isTauriRuntime()) {
      setSyncPlan(demoBatchPlan(skills, targets, "batch-quick-migrate"));
      setSyncPlanProjectFolders(plannedProjectFolders);
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
      setSyncPlanProjectFolders(plannedProjectFolders);
      setView("sync");
    } catch (reason) {
      setSyncPlanProjectFolders([]);
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function applyPlan() {
    if (!syncPlan) return;
    const projectFoldersToRegister = syncPlanProjectFolders;
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
      let projectFoldersForRefresh = settings.projectFolders;
      if (result.errors.length === 0 && projectFoldersToRegister.length > 0) {
        const nextProjectFolders = mergeProjectFolders(settings.projectFolders, projectFoldersToRegister);
        if (nextProjectFolders.length !== settings.projectFolders.length) {
          const saved = await invoke<AppSettings>("save_settings", {
            settings: {
              ...settings,
              projectFolders: nextProjectFolders
            }
          });
          setSettings(saved);
          setDraftSettings(saved);
          projectFoldersForRefresh = saved.projectFolders;
          setToast(`已关联 ${nextProjectFolders.length - settings.projectFolders.length} 个项目工作区`);
        }
      }
      if (result.inventoryRefreshRecommended && result.errors.length === 0) {
        await refreshInventory(projectFoldersForRefresh);
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
      await refreshInventory(saved.projectFolders);
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
      await refreshInventory(nextSettings.projectFolders);
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
    switchSkillWorkspace("project");
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

  async function chooseSyncProject() {
    if (!isTauriRuntime()) {
      return "/Users/example/Projects/demo-project";
    }

    const selected = await open({ directory: true, multiple: false, title: "选择要同步的项目" });
    return typeof selected === "string" ? selected : null;
  }

  async function discoverProjectWorkspaces() {
    const selected = await open({ directory: true, multiple: false, title: "扫描发现项目工作区" });
    if (typeof selected !== "string") return;
    const runId = discoveryRunRef.current + 1;
    discoveryRunRef.current = runId;
    setBusy("扫描发现项目工作区");
    setError(null);
    switchSkillWorkspace("project");
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

  function toggleSkill(id: string) {
    const selectionKey = selectionKeyFor(skillWorkspace, selectedProjectFolder, id);
    setSelectedSkillIds((current) => {
      const next = new Set(current);
      if (next.has(selectionKey)) next.delete(selectionKey);
      else next.add(selectionKey);
      return next;
    });
  }

  function openSelectedSkillsSync(mode: SyncMode) {
    if (selectedSkillIds.size === 0) return;
    setSyncQueuedSkillIds((current) => new Set([...current, ...selectedSkillIds]));
    setView("sync");
    setSyncMode(mode);
  }

  function clearSelectedSkills() {
    setSelectedSkillIds(new Set());
  }

  function switchSkillWorkspace(workspace: SkillWorkspace) {
    if (skillWorkspace !== workspace) {
      setSelectedSkillIds(new Set());
    }
    setSkillWorkspace(workspace);
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
            selectedSkillIds={scopedSelectedSkillIds}
            selectedSkills={selectedSkills}
            query={query}
            agentFilter={agentFilter}
            settings={settings}
            onQuery={setQuery}
            onAgentFilter={setAgentFilter}
            onWorkspace={(workspace) => {
              switchSkillWorkspace(workspace);
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
              setSyncQueuedSkillIds((current) => {
                const next = new Set(current);
                next.delete(id);
                if (next.size === current.size) {
                  for (const key of current) {
                    if (selectionSkillId(key) === id) next.delete(key);
                  }
                }
                return next;
              });
            }}
            onPreviewGlobal={(targets, replacements) => void previewSkillsSync(queuedSkills, targets, replacements)}
            onPreviewProject={(targets, replacements) => void previewSkillsSync(queuedSkills, targets, replacements)}
            onPreviewQuick={(method, targets) => void previewQuickMigration(queuedSkills, method, targets)}
            onChooseProject={chooseSyncProject}
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
        />
      )}
    </main>
  );
}

function selectionKeyFor(workspace: SkillWorkspace, projectPath: string | null, skillId: string) {
  return [
    workspace,
    workspace === "project" ? projectPath ?? "" : "",
    skillId
  ].join(selectionKeySeparator);
}

function selectionParts(key: string) {
  const [workspace, projectPath, skillId] = key.split(selectionKeySeparator);
  return {
    workspace: workspace as SkillWorkspace | undefined,
    projectPath: projectPath || null,
    skillId: skillId ?? key
  };
}

function selectionSkillId(key: string) {
  return selectionParts(key).skillId;
}

function projectFoldersFromTargets(targets: AgentTarget[]) {
  return mergeProjectFolders(
    [],
    targets
      .filter((target) => target.scope === "project")
      .map((target) => target.projectPath?.trim() ?? "")
      .filter(Boolean)
  );
}

function mergeProjectFolders(current: string[], additions: string[]) {
  const next = [...current];
  for (const path of additions) {
    const trimmed = path.trim();
    if (!trimmed) continue;
    if (!next.some((existing) => samePath(existing, trimmed))) {
      next.push(trimmed);
    }
  }
  return next;
}

function selectedSkillsForKeys(
  keys: Set<string>,
  allSkills: SkillRecord[],
  globalSkills: SkillRecord[],
  projectFolders: string[],
  librarySkills: SkillRecord[]
) {
  const selected: SkillRecord[] = [];

  for (const key of keys) {
    const { workspace, projectPath, skillId } = selectionParts(key);
    const skill = skillForSelection(workspace, projectPath, skillId, allSkills, globalSkills, projectFolders, librarySkills);
    if (skill) selected.push({ ...skill, selectionKey: key });
  }

  return selected;
}

function filterValidSelectionKeys(keys: Set<string>, allSkills: SkillRecord[], projectFolders: string[]) {
  const globalSkills = allSkills.filter((skill) => skill.installations.some((item) => item.scope === "global"));
  const librarySkills = allSkills.filter((skill) => skill.canonicalStatus === "imported");
  const valid = new Set<string>();

  for (const key of keys) {
    const { workspace, projectPath, skillId } = selectionParts(key);
    if (skillForSelection(workspace, projectPath, skillId, allSkills, globalSkills, projectFolders, librarySkills)) {
      valid.add(key);
    }
  }

  return valid;
}

function skillForSelection(
  workspace: SkillWorkspace | undefined,
  projectPath: string | null,
  skillId: string,
  allSkills: SkillRecord[],
  globalSkills: SkillRecord[],
  projectFolders: string[],
  librarySkills: SkillRecord[]
) {
  if (workspace === "global") {
    return globalSkills.find((skill) => skill.id === skillId) ?? null;
  }

  if (workspace === "library") {
    return librarySkills.find((skill) => skill.id === skillId) ?? null;
  }

  if (workspace === "project" && projectPath && projectFolders.includes(projectPath)) {
    return projectSkillsForFolder(allSkills, projectPath).find((skill) => skill.id === skillId) ?? null;
  }

  return null;
}
