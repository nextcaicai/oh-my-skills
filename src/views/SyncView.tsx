import { AlertTriangle, ArrowRight, Check, ChevronLeft, ChevronRight, Copy, CopyCheck, FolderPlus, Globe2, Info, Link2, Plus, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AgentIcon } from "../components/shared";
import { agentSignalSummary, compactPath, firstValidInstallation, syncPlanSummary } from "../lib/skillUtils";
import type { AgentRecord, AgentTarget, ApplyResult, Settings as AppSettings, SkillRecord, SyncOperation, SyncPlan, SyncReplacement } from "../types";
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
  onChooseProject,
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
  onPreviewGlobal: (targets: AgentTarget[], replacements: SyncReplacement[]) => void;
  onPreviewProject: (targets: AgentTarget[], replacements: SyncReplacement[]) => void;
  onPreviewQuick: (method: QuickMigrationMethod, targets: AgentTarget[]) => void;
  onApply: () => void;
  onGoSkills: () => void;
  onChooseProject: () => Promise<string | null>;
  syncMode: SyncMode;
  onSyncModeChange: (mode: SyncMode) => void;
}) {
  const [quickMethod, setQuickMethod] = useState<QuickMigrationMethod>("copy");
  const [targetScope, setTargetScope] = useState<"global" | "project">("global");
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(null);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(() => new Set(agents.slice(0, 3).map((agent) => agent.id)));
  const [selectedReplacementKeys, setSelectedReplacementKeys] = useState<Set<string>>(() => new Set());
  const [selectedSkillScrollState, setSelectedSkillScrollState] = useState({ left: false, right: false });
  const [previewDraftKey, setPreviewDraftKey] = useState<string | null>(null);
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
  const targets = selectedTargets.map((agent) => ({
    agentId: agent.id,
    scope: targetScope,
    projectPath: targetScope === "project" ? selectedProjectPath ?? undefined : undefined
  }));
  const draftKey = [
    syncMode,
    quickMethod,
    targetScope,
    selectedProjectPath ?? "",
    queuedSkills.map((skill) => skill.id).sort().join("|"),
    selectedTargets.map((agent) => agent.id).sort().join("|"),
    [...selectedReplacementKeys].sort().join("|")
  ].join("::");
  const generatedPlan = Boolean(plan);
  const stalePlan = generatedPlan && previewDraftKey !== draftKey;
  const activePlan = stalePlan ? null : plan;
  const blocked = Boolean(activePlan?.blockedConflicts.length);
  const summary = activePlan ? syncPlanSummary(activePlan) : null;
  const missingProject = targetScope === "project" && !selectedProjectPath;
  const actionDisabled = selectedSkillCount === 0 || selectedTargets.length === 0 || missingProject || busy;
  const previewLabel = selectedSkillCount === 0
    ? "先选择 Skill 再生成预览"
    : missingProject
    ? "先选择项目"
    : syncMode === "quick"
    ? `生成 ${selectedSkillCount} 个快速同步预览`
    : `生成 ${selectedSkillCount} 个中心库同步预览`;
  const centralPath = selectedSkillCount === 1 && selectedSkill ? `${settings.libraryPath}/${selectedSkill.slug}` : settings.libraryPath;
  const confirmationText = activePlan
    ? planSummarySentence(activePlan, summary, selectedSkillCount)
    : draftPlanSentence(syncMode, quickMethod, selectedSkillCount, selectedTargets.length, targetScope, selectedProjectPath);
  const planDetails = activePlan ? buildPlanDetails(activePlan, agents) : null;

  const canShowBottomPreview =
    selectedSkillCount > 0 && selectedTargets.length > 0 && !missingProject;
  const bottomPreviewText = canShowBottomPreview
    ? getOperationPreview(
        selectedSkillCount,
        selectedTargets.length,
        targetScope,
        Boolean(activePlan),
        quickMethod,
        syncMode
      )
    : null;

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

  async function chooseProjectScope() {
    const projectPath = await onChooseProject();
    if (!projectPath) return;
    setSelectedProjectPath(projectPath);
    setTargetScope("project");
  }

  function previewPlan(replacementKeys = selectedReplacementKeys) {
    if (missingProject) return;
    const nextDraftKey = [
      syncMode,
      quickMethod,
      targetScope,
      selectedProjectPath ?? "",
      queuedSkills.map((skill) => skill.id).sort().join("|"),
      selectedTargets.map((agent) => agent.id).sort().join("|"),
      [...replacementKeys].sort().join("|")
    ].join("::");
    const replacements = [...replacementKeys].map(replacementFromKey);
    setPreviewDraftKey(nextDraftKey);
    if (syncMode === "quick") {
      onPreviewQuick(quickMethod, targets);
    } else if (targetScope === "project") {
      onPreviewProject(targets, replacements);
    } else {
      onPreviewGlobal(targets, replacements);
    }
  }

  function includeReplacement(operation: SyncOperation) {
    if (!operation.agentId || !operation.skillId || !operation.targetPath) return;
    const next = new Set(selectedReplacementKeys);
    next.add(replacementKey(operation.agentId, operation.skillId, operation.targetPath));
    setSelectedReplacementKeys(next);
    previewPlan(next);
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
                直接复制或创建软链接到目标 Agent，不使用中心库。有冲突的内容会在预览中被拦住，不会直接覆盖。
              </>
            ) : (
              <>
                <span className="mode-tag">长期管理</span>
                先复制到中心库，再用软链接分发到目标 Agent。有冲突的内容会在预览中被拦住，不会直接覆盖。
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
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                  {queuedSkills.length === 0 && <span className="selected-skill-empty">请至少选择 1 个 Skill。</span>}
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
                    <Copy size={20} />
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
              <div className="selected-target-row">
                {selectedTargets.length === 0 ? (
                  <span className="target-helper">请添加至少 1 个目标 Agent。</span>
                ) : (
                  selectedTargets.map((agent) => {
                    const pathPreview = targetPathPreview(agent, targetScope, selectedProjectPath);
                    const signal = agentSignalSummary(agent) || "Agent";
                    return (
                      <button className="selected-target-card active" key={agent.id} onClick={() => toggleTarget(agent.id)} title={pathPreview ? compactPath(pathPreview) : "移除目标"} type="button">
                        <AgentIcon agent={agent} />
                        <span className="target-card-main">
                          <strong>{agent.label}</strong>
                          <small>{signal}</small>
                        </span>
                        <span className="target-card-check" aria-hidden="true">
                          <Check size={14} />
                        </span>
                      </button>
                    );
                  })
                )}
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
                <button className={`choice-card ${targetScope === "project" ? "active" : ""}`} onClick={() => void chooseProjectScope()} type="button">
                  <FolderPlus size={21} />
                  <span>
                    <strong>项目</strong>
                    <small>{selectedProjectPath ? compactPath(selectedProjectPath) : "选择本地项目并同步进去"}</small>
                  </span>
                </button>
              </div>
              {targetScope === "project" && (
                <div className={`project-target-note ${selectedProjectPath ? "" : "empty"}`}>
                  <span>
                    <strong>{selectedProjectPath ? projectDisplayName(selectedProjectPath) : "未选择项目"}</strong>
                    <small title={selectedProjectPath ?? ""}>{selectedProjectPath ? compactPath(selectedProjectPath) : "点击“项目”选择一个本地项目"}</small>
                  </span>
                  <button className="secondary-button compact" onClick={() => void chooseProjectScope()} type="button">
                    {selectedProjectPath ? "更换" : "选择"}
                  </button>
                </div>
              )}
            </SyncSection>
            <aside className="sync-confirm-pane">
            <div className="pane-title">
              <div>
                <h1>执行前确认</h1>
                <p>预览前不会写入任何内容。</p>
              </div>
              <ShieldCheck size={24} />
            </div>

            {blocked && activePlan && (
              <div className="banner warning">
                <AlertTriangle size={17} />
                <span>{activePlan.blockedConflicts.join(" · ")}</span>
              </div>
            )}

            </aside>
          </section>
        </div>

        <div className="sync-action-bar">
          {applyResult ? (
            <div className={`apply-result ${applyResult.errors.length ? "error" : "success"}`} role="status">
              <strong>{applyResult.errors.length ? "执行完成，但有错误" : "执行完成"}</strong>
              <span>{activePlan && summary ? applyResultSummary(activePlan, summary, selectedSkillCount, applyResult) : `${applyResult.appliedOperations.length} 已执行 · ${applyResult.skippedOperations.length} 已跳过`}</span>
              {applyResult.errors.map((item) => <code key={item}>{item}</code>)}
            </div>
          ) : activePlan ? (
            <div className="plan-status-wrap">
              <div className={`plan-status-pill ${blocked ? "blocked" : ""}`}>
                {blocked ? <AlertTriangle size={14} /> : <Check size={14} />}
                <span>{confirmationText}</span>
              </div>
              {planDetails && (
                <div className="plan-info-wrap">
                  <button className="plan-info-button" type="button" aria-label="查看同步明细">
                    <Info size={14} />
                  </button>
                  <PlanDetailPanel details={planDetails} onIncludeReplacement={includeReplacement} busy={busy} />
                </div>
              )}
            </div>
          ) : bottomPreviewText ? (
            <div className="action-preview">
              <span className="preview-label">操作预览</span>
              <span className="preview-sep"> · </span>
              {bottomPreviewText}
            </div>
          ) : null}
          <div className="action-buttons-end">
            {generatedPlan ? (
              <div className="button-pair">
                <button className="secondary-button large" disabled={actionDisabled} onClick={() => previewPlan()}>
                  重新生成预览
                </button>
                <button className="primary-button large" disabled={!activePlan || blocked || busy || Boolean(applyResult)} onClick={onApply}>
                  <CopyCheck size={16} />
                  {applyResult ? "执行完成" : "执行同步计划"}
                </button>
              </div>
            ) : (
              <button className="primary-button large" disabled={actionDisabled} onClick={() => previewPlan()}>
                {previewLabel}
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function SyncSection({ number, title, action, children }: { number?: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="sync-section">
      <div className="sync-section-title">
        <div>
          {number && <span className="sync-section-number">{number}</span>}
          <strong>{title}</strong>
          {action}
        </div>
      </div>
      {children}
    </section>
  );
}

function targetPathPreview(agent: AgentRecord, scope: "global" | "project", projectPath: string | null) {
  if (scope === "project") {
    const root = agent.projectRoots[0];
    if (!projectPath || !root) return undefined;
    return joinPath(projectPath, root);
  }
  return agent.globalRoots[0];
}

function draftPlanSentence(
  mode: SyncMode,
  method: QuickMigrationMethod,
  skillCount: number,
  targetCount: number,
  scope: "global" | "project",
  projectPath: string | null
) {
  if (skillCount === 0) return "请先选择至少 1 个 Skill。";
  if (targetCount === 0) return "请选择至少 1 个目标 Agent。";
  if (scope === "project" && !projectPath) return "请选择要同步的本地项目。";
  const scopeText = scope === "project" ? `到项目 ${projectDisplayName(projectPath ?? "")}` : "到全局";
  if (mode === "managed") {
    return `导入中心库 ${skillCount} 个 Skill，并为 ${targetCount} 个 Agent ${scopeText}创建软链接。`;
  }
  return method === "copy"
    ? `复制 ${skillCount} 个 Skill ${scopeText}的 ${targetCount} 个 Agent 技能目录`
    : `为 ${skillCount} 个 Skill ${scopeText}的 ${targetCount} 个 Agent 创建软链接`;
}

function joinPath(base: string, relative: string) {
  return `${base.replace(/\/+$/, "")}/${relative.replace(/^\/+/, "")}`;
}

function projectDisplayName(path: string) {
  const clean = path.replace(/\/+$/, "");
  return clean.split("/").pop() || clean;
}

function planSummarySentence(plan: SyncPlan, summary: ReturnType<typeof syncPlanSummary> | null, skillCount: number) {
  if (!summary) return "同步预览已生成。";
  const prefix = skillCount > 1 ? `${skillCount} 个 Skills：` : "";
  if (plan.blockedConflicts.length > 0) {
    if (summary.contentConflict > 0 && summary.invalidEntry === 0) {
      return `${prefix}发现 ${summary.contentConflict} 个内容冲突，需处理后再执行`;
    }
    if (summary.invalidEntry > 0 && summary.contentConflict === 0) {
      return `${prefix}发现 ${summary.invalidEntry} 个无效入口，需处理后再执行`;
    }
    return `${prefix}发现 ${plan.blockedConflicts.length} 个问题，需处理后再执行`;
  }
  const { actionParts, stateParts } = summaryParts(summary);
  if (actionParts.length > 0 && stateParts.length > 0) {
    return `${prefix}将${actionParts.join("，")}，${stateParts.join("，")}`;
  }
  if (actionParts.length > 0) {
    return `${prefix}将${actionParts.join("，")}`;
  }
  return `${prefix}${stateParts.join("，") || "无需变更"}`;
}

function applyResultSummary(
  plan: SyncPlan,
  summary: ReturnType<typeof syncPlanSummary>,
  skillCount: number,
  applyResult: ApplyResult
) {
  if (applyResult.errors.length > 0) {
    return `失败 ${applyResult.errors.length} 项，已停止后续操作`;
  }
  const preview = planSummarySentence(plan, summary, skillCount);
  return preview.startsWith(`${skillCount} 个 Skills：将`)
    ? preview.replace(`${skillCount} 个 Skills：将`, `${skillCount} 个 Skills：已`)
    : preview.startsWith("将")
    ? preview.replace("将", "已")
    : preview;
}

function summaryParts(summary: ReturnType<typeof syncPlanSummary>) {
  const actionParts = [];
  const stateParts = [];
  if (summary.createRoot > 0) actionParts.push(`创建 ${summary.createRoot} 个 Skills 目录`);
  if (summary.importLibrary > 0) actionParts.push(`导入中心库 ${summary.importLibrary} 个 Skill`);
  if (summary.repair > 0) actionParts.push(`修复 ${summary.repair} 个失效链接`);
  if (summary.symlink > 0) actionParts.push(`新增 ${summary.symlink} 个软链接`);
  if (summary.copy > 0) actionParts.push(`复制 ${summary.copy} 个 Skill 副本`);
  if (summary.replace > 0) actionParts.push(`备份后替换 ${summary.replace} 个同名 Skill`);
  if (summary.sameContent > 0) stateParts.push(`${summary.sameContent} 个已有相同内容`);
  if (summary.noop > 0) stateParts.push(`${summary.noop} 个无需变更`);
  return { actionParts, stateParts };
}

type PlanDetail = {
  kind: "blocked" | "attention";
  title: string;
  body: string;
  label: string;
  skillId: string;
  agentLabel: string;
  path?: string;
  backupPath?: string;
  operation?: SyncOperation;
  canIncludeReplacement?: boolean;
};

function PlanDetailPanel({
  details,
  onIncludeReplacement,
  busy
}: {
  details: PlanDetail[];
  onIncludeReplacement: (operation: SyncOperation) => void;
  busy: boolean;
}) {
  const blockedItems = details.filter((item) => item.kind === "blocked");
  const attentionItems = details.filter((item) => item.kind === "attention");
  const hasDetails = details.length > 0;

  return (
    <div className="plan-detail-panel" role="tooltip">
      {!hasDetails ? (
        <div className="plan-detail-empty">
          <strong>本次没有异常项</strong>
          <span>所有目标都可以按预览执行。</span>
        </div>
      ) : (
        <>
          {blockedItems.length > 0 && (
            <PlanDetailGroup title="需要处理" items={blockedItems} onIncludeReplacement={onIncludeReplacement} busy={busy} />
          )}
          {attentionItems.length > 0 && (
            <PlanDetailGroup title="需注意" items={attentionItems} onIncludeReplacement={onIncludeReplacement} busy={busy} />
          )}
        </>
      )}
    </div>
  );
}

function PlanDetailGroup({
  title,
  items,
  onIncludeReplacement,
  busy
}: {
  title: string;
  items: PlanDetail[];
  onIncludeReplacement: (operation: SyncOperation) => void;
  busy: boolean;
}) {
  const grouped = groupDetailsBySkill(items);
  return (
    <div className="plan-detail-group">
      <strong className="plan-detail-group-title">{title}</strong>
      {grouped.map(([skillId, skillItems]) => (
        <div className="plan-detail-skill" key={`${title}-${skillId}`}>
          <div className="plan-detail-skill-title">{skillId}</div>
          <div className="plan-detail-items">
            {skillItems.map((item) => (
              <div className={`plan-detail-item ${item.kind}`} key={`${item.kind}-${item.agentLabel}-${item.skillId}-${item.label}-${item.path ?? ""}`}>
                <div className="plan-detail-item-main">
                  <div className="plan-detail-item-head">
                    <strong>{item.title}</strong>
                    <span>{item.label}</span>
                  </div>
                  <p>{item.body}</p>
                  {item.path && <code title={item.path}>{compactPath(item.path)}</code>}
                  {item.backupPath && <code title={item.backupPath}>备份到 {compactPath(item.backupPath)}</code>}
                </div>
                {item.canIncludeReplacement && item.operation && (
                  <button className="secondary-button compact" disabled={busy} type="button" onClick={() => onIncludeReplacement(item.operation!)}>
                    统一为中心库软链接
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function groupDetailsBySkill(items: PlanDetail[]) {
  const groups = new Map<string, PlanDetail[]>();
  for (const item of items) {
    groups.set(item.skillId, [...(groups.get(item.skillId) ?? []), item]);
  }
  return Array.from(groups.entries());
}

function buildPlanDetails(plan: SyncPlan, agents: AgentRecord[]): PlanDetail[] {
  const agentLabels = new Map(agents.map((agent) => [agent.id, agent.label]));
  const canIncludeReplacement = plan.kind.includes("sync");
  const details = plan.operations.flatMap((operation): PlanDetail[] => {
    const agentLabel = operation.agentId ? agentLabels.get(operation.agentId) ?? operation.agentId : "目标";
    const skillId = operation.skillId ?? "Skill";
    if (operation.opType === "content-conflict") {
      return [{
        kind: "blocked",
        title: `${agentLabel} 里已有同名 Skill，但内容和来源不同`,
        body: "为避免覆盖你的修改，本次不会执行。",
        label: "内容冲突",
        skillId,
        agentLabel,
        path: operation.targetPath,
        operation
      }];
    }
    if (operation.opType === "invalid-entry") {
      return [{
        kind: "blocked",
        title: `${agentLabel} 的目标入口无效或不可读取`,
        body: "本次不会执行，请先检查目标位置。",
        label: "无效入口",
        skillId,
        agentLabel,
        path: operation.targetPath,
        operation
      }];
    }
    if (operation.opType === "same-content-existing") {
      return [{
        kind: "attention",
        title: `${agentLabel} 里已有同名 Skill，内容相同`,
        body: canIncludeReplacement
          ? "已保留原入口，不会替换为中心库软链接。"
          : "已保留原入口，不会替换为软链接。",
        label: "已有相同内容",
        skillId,
        agentLabel,
        path: operation.targetPath,
        operation,
        canIncludeReplacement
      }];
    }
    if (operation.opType === "backup-existing") {
      return [{
        kind: "attention",
        title: `${agentLabel} 里的同名 Skill 将备份后替换`,
        body: "会先移到 Oh My Skills 的备份目录，再替换为中心库软链接。",
        label: "备份后替换",
        skillId,
        agentLabel,
        path: operation.targetPath,
        backupPath: operation.backupPath,
        operation
      }];
    }
    if (operation.opType === "remove-existing") {
      return [{
        kind: "attention",
        title: `${agentLabel} 里的目标位置是失效软链接`,
        body: "将移除旧入口并重新创建。",
        label: "修复失效链接",
        skillId,
        agentLabel,
        path: operation.targetPath,
        operation
      }];
    }
    if (operation.opType === "create-root") {
      return [{
        kind: "attention",
        title: `${agentLabel} 的目标 Skills 目录不存在`,
        body: "将先创建目录，再同步这个 Skill。",
        label: "创建目录",
        skillId,
        agentLabel,
        path: operation.targetPath,
        operation
      }];
    }
    return [];
  });
  const hasBlockedDetail = details.some((item) => item.kind === "blocked");
  if (plan.blockedConflicts.length > 0 && !hasBlockedDetail) {
    return [
      ...details,
      ...plan.blockedConflicts.map((message, index) => ({
        kind: "blocked" as const,
        title: message,
        body: "本次不会执行，请先处理这个问题。",
        label: "不可执行",
        skillId: `问题 ${index + 1}`,
        agentLabel: "目标"
      }))
    ];
  }
  return details;
}

function replacementKey(agentId: string, skillId: string, targetPath: string) {
  return [agentId, skillId, targetPath].join("\u0000");
}

function replacementFromKey(key: string): SyncReplacement {
  const [agentId, skillId, targetPath] = key.split("\u0000");
  return { agentId, skillId, targetPath };
}

function getOperationPreview(
  skillCount: number,
  targetCount: number,
  scope: "global" | "project",
  isGenerated: boolean,
  quickMethod: QuickMigrationMethod,
  syncMode: SyncMode
): string {
  const dir = scope === "project" ? "项目目录" : "全局目录";

  if (syncMode === "managed") {
    return isGenerated
      ? `导入中心库并用软链接分发 ${skillCount} 个 Skill 到 ${targetCount} 个 Agent 的${dir}`
      : `导入中心库后，用软链接分发 ${skillCount} 个 Skill 到 ${targetCount} 个 Agent 的${dir}`;
  }

  if (quickMethod === "symlink") {
    return isGenerated
      ? `为 ${skillCount} 个 Skill 在 ${targetCount} 个 Agent 的${dir}创建软链接`
      : `将为 ${skillCount} 个 Skill 在 ${targetCount} 个 Agent 的${dir}创建软链接`;
  }

  // quick + copy
  return isGenerated
    ? `复制 ${skillCount} 个 Skill 到 ${targetCount} 个 Agent 的${dir}`
    : `将复制 ${skillCount} 个 Skill 到 ${targetCount} 个 Agent 的${dir}`;
}
