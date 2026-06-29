import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronDown, ChevronLeft, ChevronRight, FolderOpen, FolderPlus, Github, RefreshCw, Search, XCircle } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { AgentEmptyVisual, ProjectEmptyVisual } from "../components/EmptyStateVisuals";
import { AgentBadge, AgentIcon, Coverage, IssueList, SkillState } from "../components/shared";
import { demoAgent } from "../lib/demoData";
import { isTauriRuntime } from "../lib/runtime";
import { agentSkillCount, compactPath, projectName, projectStats, samePath, skillListStatus, skillSourceSummary } from "../lib/skillUtils";
import type { AgentRecord, ProjectWorkspaceCandidate, Settings as AppSettings, SkillLockEntry, SkillRecord, SkillUpdateCheck } from "../types";
import type { SkillWorkspace } from "../uiTypes";

export function SkillsView({
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
  const isFiltered = Boolean(query.trim()) || agentFilter !== "all";
  const emptyTitle = isFiltered
    ? "没有找到匹配的 Skills"
    : isProjectWorkspace
      ? hasProjectWorkspaces
        ? "这个项目还没有项目级 Skills"
        : "尚未关联项目工作区"
      : "还没有全局 Skills";
  const emptyBody = isFiltered
    ? "换个关键词试试"
    : isProjectWorkspace
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
            <span className="skills-summary-text">{tabSummary}</span>
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
                <SkillsListEmptyState
                  title={emptyTitle}
                  body={emptyBody}
                  workspace={workspace}
                  isFiltered={isFiltered}
                  onClearFilters={() => {
                    onQuery("");
                    onAgentFilter("all");
                  }}
                />
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

function SkillsListEmptyState({
  title,
  body,
  workspace,
  isFiltered,
  onClearFilters
}: {
  title: string;
  body: string;
  workspace: SkillWorkspace;
  isFiltered: boolean;
  onClearFilters: () => void;
}) {
  return (
    <section className="agent-empty-state" aria-label="Skills 列表空状态">
      {isFiltered || workspace === "project" ? <ProjectEmptyVisual /> : <AgentEmptyVisual />}
      <div className="agent-empty-copy">
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
      {isFiltered && (
        <button className="secondary-button" onClick={onClearFilters} type="button">
          清空搜索条件
        </button>
      )}
    </section>
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
      <ProjectEmptyVisual />

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
  const uniqueAgents = Array.from(
    new Map(skill.installations.map((installation) => {
      const agent = agents.find((item) => item.id === installation.agentId);
      return [
        installation.agentId,
        agent ?? demoAgent(installation.agentId, installation.agentLabel, installation.status, 0, [])
      ] as const;
    })).values()
  );
  const knownAgents = uniqueAgents.slice(0, 5);
  const extra = Math.max(0, uniqueAgents.length - knownAgents.length);

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
  const localPaths = skillLocalPaths(skill);

  return (
    <div className="skill-detail">
      {localPaths.length > 0 && (
        <DetailField label="本地路径">
          <div className="detail-path-list">
            {localPaths.map((item) => (
              <div className="detail-path-row" key={item.id}>
                <code title={item.path}>{settings.showRawPaths ? item.path : compactPath(item.path)}</code>
                <button
                  className="meta-icon-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void openPath(item.path);
                  }}
                  title="打开本地路径"
                  type="button"
                >
                  <FolderOpen size={15} />
                </button>
              </div>
            ))}
          </div>
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

function skillLocalPaths(skill: SkillRecord) {
  const paths: { id: string; path: string }[] = [];

  if (skill.canonicalPath) {
    paths.push({
      id: `library:${skill.canonicalPath}`,
      path: skill.canonicalPath
    });
  }

  for (const installation of skill.installations) {
    if (!installation.entryPath) continue;
    if (paths.some((item) => samePath(item.path, installation.entryPath))) continue;
    paths.push({
      id: installation.id,
      path: installation.entryPath
    });
  }

  return paths;
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
