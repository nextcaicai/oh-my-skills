import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  CopyCheck,
  FileText,
  FolderPlus,
  Globe2,
  Layers3,
  Link2,
  Loader2,
  MonitorCheck,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { agentIconAsset } from "./agentIconRegistry";
import type {
  AgentRecord,
  AgentTarget,
  ApplyResult,
  InventorySnapshot,
  Settings as AppSettings,
  SkillContent,
  SkillInstallation,
  SkillIssue,
  SkillRecord,
  SyncPlan
} from "./types";

type View = "agents" | "skills" | "sync";
type ScopeFilter = "all" | "global" | "project";
type AgentViewFilter = "all" | "installed";

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
  const [view, setView] = useState<View>("agents");
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [skillContent, setSkillContent] = useState<SkillContent | null>(null);
  const [syncPlan, setSyncPlan] = useState<SyncPlan | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState("启动中");
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("theme-light-preview");
    document.body.classList.add("theme-light-preview");
    return () => {
      document.documentElement.classList.remove("theme-light-preview");
      document.body.classList.remove("theme-light-preview");
    };
  }, []);

  useEffect(() => {
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

  useEffect(() => {
    if (agentFilter !== "all" && !installedAgentIds.has(agentFilter)) {
      setAgentFilter("all");
    }
  }, [agentFilter, installedAgentIds]);

  const filteredSkills = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return allSkills.filter((skill) => {
      if (agentFilter !== "all" && !skill.installations.some((item) => item.agentId === agentFilter)) {
        return false;
      }

      if (scopeFilter !== "all" && !skill.installations.some((item) => item.scope === scopeFilter)) {
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
  }, [agentFilter, allSkills, query, scopeFilter]);

  const selectedSkill = useMemo(
    () => allSkills.find((skill) => skill.id === selectedSkillId) ?? filteredSkills[0] ?? null,
    [allSkills, filteredSkills, selectedSkillId]
  );

  const queuedSkills = useMemo(
    () => allSkills.filter((skill) => selectedSkillIds.has(skill.id)),
    [allSkills, selectedSkillIds]
  );

  useEffect(() => {
    if (!selectedSkill) {
      setSkillContent(null);
      return;
    }
    setSelectedSkillId(selectedSkill.id);
    void loadSkillContent(selectedSkill);
  }, [selectedSkill?.id]);

  async function boot() {
    setBusy("读取设置");
    setError(null);
    if (!isTauriRuntime()) {
      setSettings(defaultSettings);
      setDraftSettings(defaultSettings);
      setInventory(demoInventory);
      setSelectedSkillId(demoInventory.skills[0]?.id ?? null);
      setBusy("");
      return;
    }
    try {
      const loaded = await invoke<AppSettings>("get_settings");
      setSettings(loaded);
      setDraftSettings(loaded);
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
      const next = await invoke<InventorySnapshot>("scan_inventory", {
        options: { includeOrphaned: false }
      });
      setInventory(next);
      setSelectedSkillId((current) => {
        if (current && next.skills.some((skill) => skill.id === current)) return current;
        return next.skills[0]?.id ?? null;
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

  async function loadSkillContent(skill: SkillRecord) {
    const path = skill.canonicalPath ?? firstValidInstallation(skill)?.entryPath;
    if (!path) {
      setSkillContent(null);
      return;
    }

    if (!isTauriRuntime()) {
      setSkillContent({
        path,
        title: skill.displayName,
        frontmatter: {
          name: skill.displayName,
          description: skill.description,
          allowedTools: [],
          metadata: {}
        },
        content: `---\nname: ${skill.displayName}\ndescription: ${skill.description ?? skill.slug}\n---\n\n# ${skill.displayName}\n\n${skill.description ?? "Demo skill content for browser preview."}\n\nThis preview data is only used outside the Tauri runtime.`,
        markdownBody: `# ${skill.displayName}\n\n${skill.description ?? ""}`
      });
      return;
    }

    try {
      const content = await invoke<SkillContent>("read_skill_content", {
        skillRef: { skillId: skill.id, installationId: null, path }
      });
      setSkillContent(content);
    } catch {
      setSkillContent(null);
    }
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
            skillId: skill.id,
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

  async function addProjectFolder() {
    const selected = await open({ directory: true, multiple: false, title: "添加项目目录" });
    if (typeof selected !== "string") return;
    setDraftSettings((current) => ({
      ...current,
      projectFolders: Array.from(new Set([...current.projectFolders, selected]))
    }));
  }

  function openAgentSkills(agent: AgentRecord) {
    setAgentFilter(agent.id);
    setScopeFilter("all");
    setQuery("");
    setView("skills");
    const firstSkill = allSkills.find((skill) => skill.installations.some((item) => item.agentId === agent.id));
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

  return (
    <main className="app-shell">
      <header className="top-nav">
        <button className="logo-entry" onClick={() => setSettingsOpen(true)} title="设置、关于和更新">
          <span className="logo-mark">
            <Sparkles size={18} />
          </span>
          <span>Oh My Skills</span>
        </button>

        <nav className="tab-bar" aria-label="主导航">
          <TabButton active={view === "agents"} onClick={() => setView("agents")} icon={<MonitorCheck size={17} />}>
            发现 Agent
          </TabButton>
          <TabButton active={view === "skills"} onClick={() => setView("skills")} icon={<Layers3 size={17} />}>
            发现 Skills
          </TabButton>
          <TabButton active={view === "sync"} onClick={() => setView("sync")} icon={<ShieldCheck size={17} />}>
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
          />
        )}

        {view === "skills" && (
          <SkillsView
            agents={installedAgents}
            skills={filteredSkills}
            allSkills={allSkills}
            selectedSkill={selectedSkill}
            selectedSkillIds={selectedSkillIds}
            skillContent={skillContent}
            query={query}
            agentFilter={agentFilter}
            scopeFilter={scopeFilter}
            settings={settings}
            onQuery={setQuery}
            onAgentFilter={setAgentFilter}
            onScopeFilter={setScopeFilter}
            onSelectSkill={setSelectedSkillId}
            onToggleSkill={toggleSkill}
            onAdopt={previewAdopt}
            onSelectForSync={selectForSync}
          />
        )}

        {view === "sync" && (
          <SyncView
            agents={installedAgents.length ? installedAgents : agents}
            queuedSkills={queuedSkills}
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
          onAddProjectFolder={() => void addProjectFolder()}
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
  icon,
  children,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={`tab-button ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

function AgentsView({
  agents,
  skills,
  installedCount,
  busy,
  onAgentClick
}: {
  agents: AgentRecord[];
  skills: SkillRecord[];
  installedCount: number;
  busy: string;
  onAgentClick: (agent: AgentRecord) => void;
}) {
  const [agentViewFilter, setAgentViewFilter] = useState<AgentViewFilter>("all");
  const visibleAgents = agentViewFilter === "installed" ? agents.filter((agent) => agent.installed) : agents;
  const summary = agentViewFilter === "all"
    ? `内置 ${agents.length} 个 Agent 的自动检测识别`
    : busy || `已发现 Agent ${installedCount} 个 · Skills ${skills.length} 个`;

  return (
    <div className="agents-page">
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
      </section>
    </div>
  );
}

function SkillsView({
  agents,
  skills,
  allSkills,
  selectedSkill,
  selectedSkillIds,
  skillContent,
  query,
  agentFilter,
  scopeFilter,
  settings,
  onQuery,
  onAgentFilter,
  onScopeFilter,
  onSelectSkill,
  onToggleSkill,
  onAdopt,
  onSelectForSync
}: {
  agents: AgentRecord[];
  skills: SkillRecord[];
  allSkills: SkillRecord[];
  selectedSkill: SkillRecord | null;
  selectedSkillIds: Set<string>;
  skillContent: SkillContent | null;
  query: string;
  agentFilter: string;
  scopeFilter: ScopeFilter;
  settings: AppSettings;
  onQuery: (value: string) => void;
  onAgentFilter: (value: string) => void;
  onScopeFilter: (value: ScopeFilter) => void;
  onSelectSkill: (id: string) => void;
  onToggleSkill: (id: string) => void;
  onAdopt: (skill: SkillRecord) => void;
  onSelectForSync: (skill: SkillRecord) => void;
}) {
  return (
    <div className="skills-page">
      <aside className="filter-rail">
        <div className="rail-title">Skills 范围</div>
        <button className={agentFilter === "all" ? "active" : ""} onClick={() => onAgentFilter("all")}>
          <span>全部 Skills</span>
          <strong>{allSkills.length}</strong>
        </button>
        {agents.map((agent) => (
          <button className={agentFilter === agent.id ? "active" : ""} key={agent.id} onClick={() => onAgentFilter(agent.id)}>
            <span>{agent.label}</span>
            <strong>{agentSkillCount(agent.id, allSkills)}</strong>
          </button>
        ))}
      </aside>

      <section className="skill-list-pane">
        <div className="pane-header">
          <div className="searchbox">
            <Search size={17} />
            <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜索 Skill、简介或 Agent" />
          </div>
          <div className="segmented">
            {(["all", "global", "project"] as ScopeFilter[]).map((scope) => (
              <button
                className={scopeFilter === scope ? "active" : ""}
                key={scope}
                onClick={() => onScopeFilter(scope)}
              >
                {scope === "all" ? "全部" : scope === "global" ? "全局" : "项目"}
              </button>
            ))}
          </div>
        </div>

        <div className="skill-list">
          {skills.map((skill) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              active={selectedSkill?.id === skill.id}
              checked={selectedSkillIds.has(skill.id)}
              onSelect={() => onSelectSkill(skill.id)}
              onToggle={() => onToggleSkill(skill.id)}
            />
          ))}
          {skills.length === 0 && (
            <div className="empty-list">
              <FileText size={28} />
              <strong>没有匹配的 Skills</strong>
              <span>试试切回全部范围或清空搜索。</span>
            </div>
          )}
        </div>
      </section>

      <aside className="detail-pane">
        {selectedSkill ? (
          <SkillDetail
            skill={selectedSkill}
            content={skillContent}
            settings={settings}
            selected={selectedSkillIds.has(selectedSkill.id)}
            onToggle={() => onToggleSkill(selectedSkill.id)}
            onAdopt={() => onAdopt(selectedSkill)}
            onSelectForSync={() => onSelectForSync(selectedSkill)}
          />
        ) : (
          <div className="empty-detail">
            <FileText size={34} />
            <strong>选择一个 Skill</strong>
            <span>这里会显示 SKILL.md、安装位置和同步入口。</span>
          </div>
        )}
      </aside>
    </div>
  );
}

function SkillRow({
  skill,
  active,
  checked,
  onSelect,
  onToggle
}: {
  skill: SkillRecord;
  active: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  return (
    <article className={`skill-row ${active ? "active" : ""}`}>
      <button className={`select-dot ${checked ? "checked" : ""}`} onClick={onToggle} title="选择同步">
        {checked ? <Check size={14} /> : <Circle size={13} />}
      </button>
      <button className="skill-row-main" onClick={onSelect}>
        <strong>{skill.displayName}</strong>
        <span>{skill.description || skill.slug}</span>
      </button>
      <div className="skill-row-meta">
        <Coverage skill={skill} />
        <SkillState skill={skill} />
      </div>
    </article>
  );
}

function SkillDetail({
  skill,
  content,
  settings,
  selected,
  onToggle,
  onAdopt,
  onSelectForSync
}: {
  skill: SkillRecord;
  content: SkillContent | null;
  settings: AppSettings;
  selected: boolean;
  onToggle: () => void;
  onAdopt: () => void;
  onSelectForSync: () => void;
}) {
  const currentPath = skill.canonicalPath ?? firstValidInstallation(skill)?.entryPath ?? "";
  const canAdopt = skill.canonicalStatus !== "imported" && Boolean(firstValidInstallation(skill));

  return (
    <div className="skill-detail">
      <div className="detail-title">
        <span className="detail-icon">
          <FileText size={22} />
        </span>
        <div>
          <h2>{skill.displayName}</h2>
          <p>{skill.slug}</p>
        </div>
      </div>

      <div className="detail-actions">
        <button className={`secondary-button ${selected ? "selected" : ""}`} onClick={onToggle}>
          <CheckCircle2 size={16} />
          {selected ? "已加入同步" : "选择"}
        </button>
        <button className="secondary-button" disabled={!canAdopt} onClick={onAdopt}>
          <Layers3 size={16} />
          导入中心库
        </button>
        <button className="primary-button" onClick={onSelectForSync}>
          <ArrowRight size={16} />
          去同步
        </button>
      </div>

      <div className="mini-grid">
        <InfoBlock label="状态" value={skill.conflict ? "内容冲突" : skill.canonicalStatus === "imported" ? "已导入" : "外部来源"} />
        <InfoBlock label="安装位置" value={`${skill.installations.length} 个 Agent`} />
      </div>

      <section className="detail-section">
        <h3>安装在</h3>
        <div className="install-list">
          {skill.installations.map((installation) => (
            <div className="install-row" key={installation.id}>
              <AgentBadge label={installation.agentLabel} status={installation.status} />
              <span>{installation.scope === "global" ? "全局" : installation.scope}</span>
              {installation.isSymlink && <Link2 size={14} />}
              {settings.showRawPaths && <code>{installation.entryPath}</code>}
            </div>
          ))}
          {skill.installations.length === 0 && <span className="muted">没有检测到安装入口。</span>}
        </div>
      </section>

      {skill.issues.length > 0 && (
        <section className="detail-section">
          <h3>问题</h3>
          <IssueList issues={skill.issues} />
        </section>
      )}

      <section className="detail-section">
        <h3>SKILL.md</h3>
        {currentPath && <code className="path-code">{currentPath}</code>}
        {content ? <pre className="markdown-preview">{content.content}</pre> : <p className="muted">没有可读取的 SKILL.md。</p>}
      </section>
    </div>
  );
}

function SyncView({
  agents,
  queuedSkills,
  plan,
  applyResult,
  busy,
  onRemoveSkill,
  onPreviewGlobal,
  onPreviewProject,
  onApply,
  onGoSkills
}: {
  agents: AgentRecord[];
  queuedSkills: SkillRecord[];
  plan: SyncPlan | null;
  applyResult: ApplyResult | null;
  busy: boolean;
  onRemoveSkill: (id: string) => void;
  onPreviewGlobal: (targets: AgentTarget[]) => void;
  onPreviewProject: (targets: AgentTarget[]) => void;
  onApply: () => void;
  onGoSkills: () => void;
}) {
  const [targetAgentId, setTargetAgentId] = useState("all");

  const globalTargets = targetAgentId === "all"
    ? agents.map((agent) => ({ agentId: agent.id, scope: "global" }))
    : [{ agentId: targetAgentId, scope: "global" }];
  const projectTargets = targetAgentId === "all"
    ? agents.filter((agent) => agent.projectRoots.length > 0).map((agent) => ({ agentId: agent.id, scope: "project" }))
    : [{ agentId: targetAgentId, scope: "project" }];
  const blocked = Boolean(plan?.blockedConflicts.length);

  return (
    <div className="sync-page">
      <section className="queue-pane">
        <div className="pane-title">
          <div>
            <h1>同步队列</h1>
            <p>从“发现 Skills”选中的项目会先进入这里，预览后才会写入。</p>
          </div>
          <button className="secondary-button" onClick={onGoSkills}>
            <Layers3 size={16} />
            选择 Skills
          </button>
        </div>

        <div className="queued-list">
          {queuedSkills.map((skill) => (
            <div className="queued-skill" key={skill.id}>
              <FileText size={18} />
              <span>
                <strong>{skill.displayName}</strong>
                <small>{skill.slug}</small>
              </span>
              <button className="icon-button subtle" onClick={() => onRemoveSkill(skill.id)} title="移除">
                <XCircle size={16} />
              </button>
            </div>
          ))}
          {queuedSkills.length === 0 && (
            <div className="empty-list">
              <ShieldCheck size={28} />
              <strong>还没有要同步的 Skills</strong>
              <span>回到发现 Skills，选择一个或多个 Skill。</span>
            </div>
          )}
        </div>

        <div className="sync-controls">
          <label className="field">
            <span>目标 Agent</span>
            <select value={targetAgentId} onChange={(event) => setTargetAgentId(event.target.value)}>
              <option value="all">全部已检测 Agent</option>
              {agents.map((agent) => (
                <option value={agent.id} key={agent.id}>{agent.label}</option>
              ))}
            </select>
          </label>
          <div className="button-pair">
            <button className="primary-button" disabled={queuedSkills.length === 0} onClick={() => onPreviewGlobal(globalTargets)}>
              <Globe2 size={16} />
              同步到全局
            </button>
            <button className="secondary-button" disabled={queuedSkills.length === 0} onClick={() => onPreviewProject(projectTargets)}>
              <FolderPlus size={16} />
              同步到项目
            </button>
          </div>
        </div>
      </section>

      <section className="plan-pane">
        <div className="pane-title">
          <div>
            <h1>同步预览</h1>
            <p>dry-run 结果会列出复制、备份、创建软链接等操作。</p>
          </div>
          <button className="primary-button" disabled={!plan || blocked || busy} onClick={onApply}>
            <CopyCheck size={16} />
            执行计划
          </button>
        </div>

        {!plan && (
          <div className="empty-detail">
            <ShieldCheck size={36} />
            <strong>等待生成同步计划</strong>
            <span>预览前不会写入任何内容。</span>
          </div>
        )}

        {plan && (
          <>
            {blocked && (
              <div className="banner warning">
                <AlertTriangle size={17} />
                <span>{plan.blockedConflicts.join(" · ")}</span>
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
          </>
        )}

        {applyResult && (
          <div className={`apply-result ${applyResult.errors.length ? "error" : "success"}`}>
            <strong>{applyResult.errors.length ? "执行完成，但有错误" : "执行完成"}</strong>
            <span>{applyResult.appliedOperations.length} 已执行 · {applyResult.skippedOperations.length} 已跳过</span>
            {applyResult.errors.map((item) => <code key={item}>{item}</code>)}
          </div>
        )}
      </section>
    </div>
  );
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
            <h1>Logo 入口</h1>
            <p>先放设置，后续可以接关于和更新。</p>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭">
            <XCircle size={17} />
          </button>
        </div>

        <label className="field">
          <span>中心库</span>
          <input value={settings.libraryPath} onChange={(event) => onChange({ ...settings, libraryPath: event.target.value })} />
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
  const iconStyle = icon ? ({ "--agent-icon-size": `${icon.size ?? 30}px` } as CSSProperties) : undefined;

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
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}

function firstValidInstallation(skill: SkillRecord): SkillInstallation | null {
  return skill.installations.find((installation) => installation.status !== "invalid" && !installation.brokenSymlink) ?? null;
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

function demoPlan(skill: SkillRecord, targets: AgentTarget[], kind: "adopt" | "sync"): SyncPlan {
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
