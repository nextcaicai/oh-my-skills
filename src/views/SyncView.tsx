import { AlertTriangle, ArrowRight, Check, ChevronLeft, ChevronRight, CopyCheck, FolderPlus, Globe2, Link2, Plus, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AgentIcon, InfoBlock } from "../components/shared";
import { compactPath, firstValidInstallation, syncPlanSummary } from "../lib/skillUtils";
import type { AgentRecord, AgentTarget, ApplyResult, Settings as AppSettings, SkillRecord, SyncPlan } from "../types";
import type { QuickMigrationMethod, SyncMode } from "../uiTypes";

export function SyncView({
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
  const [selectedSkillScrollState, setSelectedSkillScrollState] = useState({ left: false, right: false });
  const targetMenuRef = useRef<HTMLDivElement>(null);
  const selectedSkillBarRef = useRef<HTMLDivElement>(null);
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

  const updateSelectedSkillScrollState = () => {
    const element = selectedSkillBarRef.current;
    if (!element) {
      setSelectedSkillScrollState({ left: false, right: false });
      return;
    }

    const maxScroll = element.scrollWidth - element.clientWidth;
    setSelectedSkillScrollState({
      left: element.scrollLeft > 2,
      right: element.scrollLeft < maxScroll - 2
    });
  };

  useEffect(() => {
    window.requestAnimationFrame(updateSelectedSkillScrollState);
  }, [queuedSkills.length]);

  useEffect(() => {
    window.addEventListener("resize", updateSelectedSkillScrollState);
    return () => window.removeEventListener("resize", updateSelectedSkillScrollState);
  }, []);

  const selectedTargets = agents.filter((agent) => selectedTargetIds.has(agent.id));
  const availableTargets = agents.filter((agent) => !selectedTargetIds.has(agent.id));
  const targets = selectedTargets.map((agent) => ({ agentId: agent.id, scope: targetScope }));
  const blocked = Boolean(plan?.blockedConflicts.length);
  const summary = plan ? syncPlanSummary(plan) : null;
  const actionDisabled = selectedSkillCount === 0 || selectedTargets.length === 0 || busy;
  const previewLabel = selectedSkillCount === 0
    ? "先选择 Skill 再生成预览"
    : syncMode === "quick"
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

  function scrollSelectedSkillBar(direction: "left" | "right") {
    const element = selectedSkillBarRef.current;
    if (!element) return;
    element.scrollBy({
      left: direction === "left" ? -520 : 520,
      behavior: "smooth"
    });
    window.setTimeout(updateSelectedSkillScrollState, 260);
  }

  return (
    <div className="sync-page">
      <section className="sync-main-pane">
        <div className="sync-mode-header">
          <div className="sync-toolbar">
            <div className="scope-tabs sync-mode-tabs" role="tablist" aria-label="同步模式">
              <button
                className={syncMode === "quick" ? "active" : ""}
                onClick={() => onSyncModeChange("quick")}
                role="tab"
                type="button"
                aria-selected={syncMode === "quick"}
              >
                快速同步
              </button>
              <button
                className={syncMode === "managed" ? "active" : ""}
                onClick={() => onSyncModeChange("managed")}
                role="tab"
                type="button"
                aria-selected={syncMode === "managed"}
              >
                导入中心库并同步
              </button>
            </div>
          </div>

          <div className="sync-mode-desc">
            {syncMode === "quick" ? (
              <>
                <span className="mode-tag">最快完成</span>
                直接复制或创建软链接到目标 Agent，不使用中心库
              </>
            ) : (
              <>
                <span className="mode-tag">长期管理</span>
                先复制到中心库，再用软链接分发到目标 Agent
              </>
            )}
          </div>
        </div>

        <div className="sync-work-grid">
          <section className="sync-form-pane">
            <SyncSection
              number="1"
              title="已选 Skill"
              action={(
                <button className="sync-section-icon-action" onClick={onGoSkills} title="选择 Skill" type="button">
                  <Plus size={16} />
                </button>
              )}
            >
              <div className={`selected-skill-shell ${queuedSkills.length === 0 ? "empty" : ""}`}>
                {selectedSkillScrollState.left && (
                  <button
                    className="selected-skill-scroll left"
                    onClick={() => scrollSelectedSkillBar("left")}
                    title="向左滑动"
                    type="button"
                  >
                    <ChevronLeft size={16} />
                  </button>
                )}
                <div
                  className="selected-skill-list"
                  onScroll={updateSelectedSkillScrollState}
                  ref={selectedSkillBarRef}
                >
                  {queuedSkills.map((skill) => {
                    const selectedSource = firstValidInstallation(skill);
                    const sourcePath = selectedSource?.entryPath ?? skill.canonicalPath ?? "";
                    return (
                      <div className="selected-skill-card" key={skill.id}>
                        <span>
                          <strong>{skill.displayName}</strong>
                          <small title={sourcePath || skill.slug}>
                            {sourcePath ? compactPath(sourcePath) : skill.slug}
                          </small>
                        </span>
                        <button className="selected-skill-remove" onClick={() => onRemoveSkill(skill.id)} title="取消选择" type="button">
                          <XCircle size={14} />
                        </button>
                      </div>
                    );
                  })}
                  {queuedSkills.length === 0 && <span className="selected-skill-empty">还没有选择 Skill。</span>}
                </div>
                {selectedSkillScrollState.right && (
                  <button
                    className="selected-skill-scroll right"
                    onClick={() => scrollSelectedSkillBar("right")}
                    title="向右滑动"
                    type="button"
                  >
                    <ChevronRight size={16} />
                  </button>
                )}
              </div>
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

            <SyncSection
              number="3"
              title="目标 Agent（可多选）"
              action={(
                <div className="target-add-wrap title-add" ref={targetMenuRef}>
                  <button className="sync-section-icon-action" onClick={() => setTargetPickerOpen((open) => !open)} title="添加目标 Agent" type="button">
                    <Plus size={16} />
                  </button>
                  {targetPickerOpen && (
                    <div className="target-add-menu" role="menu">
                      {availableTargets.map((agent) => (
                        <button key={agent.id} onClick={() => addTarget(agent.id)} type="button">
                          <AgentIcon agent={agent} />
                          <strong>{agent.label}</strong>
                        </button>
                      ))}
                      {availableTargets.length === 0 && <span className="target-empty">所有 Agent 已添加</span>}
                    </div>
                  )}
                </div>
              )}
            >
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
                </div>
                {selectedTargets.length === 0 && <span className="target-helper">请添加至少 1 个目标 Agent。</span>}
              </div>
            </SyncSection>

            <SyncSection number="4" title="生效范围">
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
              <div className="summary-body">
                <strong>{confirmationText}</strong>
                {!plan && selectedTargets.length > 0 && selectedSkillCount > 0 && (
                  <span className="summary-sub">点击下方按钮生成详细预览</span>
                )}
              </div>
            </div>

            {selectedTargets.length > 0 && (
              <div className="destinations-preview">
                <div className="dest-label">将同步到这些位置</div>
                <div className="dest-list">
                  {selectedTargets.map((agent) => {
                    const destPath = targetPathPreview(agent, targetScope);
                    const isSymlink = syncMode === "quick" && quickMethod === "symlink";
                    return (
                      <div className="dest-item" key={agent.id}>
                        <AgentIcon agent={agent} />
                        <div className="dest-text">
                          <span className="dest-agent">{agent.label}</span>
                          <span className="dest-scope">{targetScope === "project" ? "项目" : "全局"}</span>
                          {destPath && (
                            <code className="dest-path" title={destPath}>{compactPath(destPath)}</code>
                          )}
                        </div>
                        <span className="dest-action" title={isSymlink ? "创建软链接" : syncMode === "managed" ? "软链接分发" : "完整复制"}>
                          {isSymlink ? "软链接" : syncMode === "managed" ? "软链接" : "复制"}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="dest-hint">
                  每个 Skill 会在以上目录下创建对应子文件夹{quickMethod === "symlink" && syncMode === "quick" ? "（软链接指向源文件）" : "（完整副本）"}。
                </div>
              </div>
            )}

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

            <div className="confirm-note">
              <span>
                {syncMode === "managed"
                  ? "先放进中心库统一管理，再通过软链接分发。"
                  : quickMethod === "copy"
                  ? "直接复制完整文件夹到目标 Agent。"
                  : "在目标 Agent 里创建指向源 Skill 的软链接。"}
              </span>
              <span>有冲突的内容会在预览中被拦住，不会直接覆盖。</span>
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

            {applyResult && (
              <div className={`apply-result ${applyResult.errors.length ? "error" : "success"}`}>
                <strong>{applyResult.errors.length ? "执行完成，但有错误" : "执行完成"}</strong>
                <span>{applyResult.appliedOperations.length} 已执行 · {applyResult.skippedOperations.length} 已跳过</span>
                {applyResult.errors.map((item) => <code key={item}>{item}</code>)}
              </div>
            )}
            </aside>
          </section>
        </div>

        <div className="sync-action-bar">
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

function SyncSection({ number, title, action, children }: { number: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="sync-section">
      <div className="sync-section-title">
        <div>
          <span>{number}</span>
          <strong>{title}</strong>
          {action}
        </div>
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
    return `导入中心库 ${skillCount} 个 Skill，并为 ${targetCount} 个 Agent 创建软链接。`;
  }
  return method === "copy"
    ? `复制 ${skillCount} 个 Skill 到 ${targetCount} 个 Agent 的技能目录`
    : `为 ${skillCount} 个 Skill 在 ${targetCount} 个 Agent 中创建软链接`;
}

function planSummarySentence(plan: SyncPlan, summary: ReturnType<typeof syncPlanSummary> | null) {
  if (!summary) return "同步预览已生成。";
  if (plan.blockedConflicts.length > 0) return `发现 ${plan.blockedConflicts.length} 个阻塞，请先处理后再执行。`;
  const parts = [];
  if (summary.create > 0) parts.push(`新增 ${summary.create} 项`);
  if (summary.symlink > 0) parts.push(`${summary.symlink} 个软链接`);
  if (summary.backup > 0) parts.push(`备份 ${summary.backup} 项`);
  if (summary.overwrite > 0) parts.push(`覆盖 ${summary.overwrite} 项`);
  if (summary.noop > 0) parts.push(`跳过 ${summary.noop} 项`);
  const action = parts.join("，") || "无需变更";
  return `${action}，可安全执行。`;
}
