import type { AgentRecord, InstallationRef, SkillInstallation, SkillLockEntry, SkillRecord, SkillUpdateCheck, SyncPlan } from "../types";

export function syncPlanSummary(plan: SyncPlan) {
  const replacementTargets = new Set(
    plan.operations
      .filter((operation) => operation.opType === "backup-existing" && operation.targetPath)
      .map((operation) => operation.targetPath)
  );
  const repairTargets = new Set(
    plan.operations
      .filter((operation) => operation.opType === "remove-existing" && operation.targetPath)
      .map((operation) => operation.targetPath)
  );

  return plan.operations.reduce(
    (summary, operation) => {
      if (operation.opType === "create-root") summary.createRoot += 1;
      if (operation.opType === "copy-to-library") summary.importLibrary += 1;
      if (operation.opType === "copy-to-target") summary.copy += 1;
      if (operation.opType === "remove-existing") summary.repair += 1;
      if (operation.opType === "backup-existing") summary.replace += 1;
      if (operation.opType === "same-content-existing") summary.sameContent += 1;
      if (operation.opType === "content-conflict") summary.contentConflict += 1;
      if (operation.opType === "invalid-entry") summary.invalidEntry += 1;
      if (operation.opType === "create-symlink") {
        if (!operation.targetPath || (!replacementTargets.has(operation.targetPath) && !repairTargets.has(operation.targetPath))) {
          summary.symlink += 1;
        }
      }
      if ((operation.opType === "noop" || operation.status === "noop") && operation.opType !== "same-content-existing") summary.noop += 1;
      return summary;
    },
    {
      createRoot: 0,
      importLibrary: 0,
      symlink: 0,
      copy: 0,
      replace: 0,
      repair: 0,
      sameContent: 0,
      contentConflict: 0,
      invalidEntry: 0,
      noop: 0
    }
  );
}

export function firstValidInstallation(skill: SkillRecord): SkillInstallation | null {
  return skill.installations.find((installation) => installation.status !== "invalid" && !installation.brokenSymlink) ?? null;
}

export function aggregateSkillsBySlug(skills: SkillRecord[]): SkillRecord[] {
  const grouped = new Map<string, SkillRecord[]>();

  for (const skill of skills) {
    for (const fragment of skillIdentityFragments(skill)) {
      const identity = skillIdentity(fragment);
      const key = `${fragment.slug}\u0000${identity}`;
      grouped.set(key, [...(grouped.get(key) ?? []), fragment]);
    }
  }

  return Array.from(grouped.values()).map((group) => {
    if (group.length === 1) return group[0];

    const primary = group.find((skill) => skill.canonicalStatus === "imported") ?? group[0];
    const installations = dedupeBy(group.flatMap((skill) => skill.installations), (installation) => installation.id);
    const issues = dedupeBy(group.flatMap((skill) => skill.issues), (issue) =>
      [issue.code, issue.severity, issue.message, issue.path ?? "", issue.agentId ?? ""].join("\u0000")
    );
    const hashes = new Set([
      ...group.flatMap((skill) => skill.canonicalHash ? [skill.canonicalHash] : []),
      ...installations.flatMap((installation) => installation.hash ? [installation.hash] : [])
    ]);
    const installedAgentIds = new Set(installations.map((installation) => installation.agentId));
    const knownAgentIds = new Set([
      ...installedAgentIds,
      ...group.flatMap((skill) => skill.missingAgents)
    ]);
    const conflict = group.some((skill) => skill.conflict) || hashes.size > 1;

    return {
      ...primary,
      id: groupId(primary, skillIdentity(primary), group.length),
      displayName: primary.displayName,
      description: primary.description ?? group.find((skill) => skill.description)?.description,
      canonicalStatus: group.some((skill) => skill.canonicalStatus === "imported") ? "imported" : primary.canonicalStatus,
      canonicalPath: group.find((skill) => skill.canonicalPath)?.canonicalPath,
      canonicalHash: group.find((skill) => skill.canonicalHash)?.canonicalHash,
      installations,
      missingAgents: Array.from(knownAgentIds).filter((agentId) => !installedAgentIds.has(agentId)),
      issues,
      conflict
    };
  });
}

function skillIdentityFragments(skill: SkillRecord): SkillRecord[] {
  const installationGroups = new Map<string, SkillInstallation[]>();
  for (const installation of skill.installations) {
    const identity = installationIdentity(installation);
    installationGroups.set(identity, [...(installationGroups.get(identity) ?? []), installation]);
  }

  if (installationGroups.size <= 1) {
    return [{
      ...skill,
      issues: skill.issues.filter((issue) => issue.code !== "content-conflict")
    }];
  }

  return Array.from(installationGroups.entries()).map(([identity, installations]) => {
    const firstFrontmatter = installations.find((installation) => installation.frontmatter)?.frontmatter;
    const canonicalMatches = skill.canonicalHash ? identity === `hash:${skill.canonicalHash}` : false;
    return {
      ...skill,
      id: groupId(skill, identity, installationGroups.size),
      displayName: firstFrontmatter?.name ?? skill.displayName,
      description: firstFrontmatter?.description ?? skill.description,
      canonicalStatus: canonicalMatches ? skill.canonicalStatus : "not-imported",
      canonicalPath: canonicalMatches ? skill.canonicalPath : undefined,
      canonicalHash: canonicalMatches ? skill.canonicalHash : undefined,
      installations,
      issues: dedupeBy(installations.flatMap((installation) => installation.issues), (issue) =>
        [issue.code, issue.severity, issue.message, issue.path ?? "", issue.agentId ?? ""].join("\u0000")
      ),
      conflict: false
    };
  });
}

function skillIdentity(skill: SkillRecord) {
  if (skill.canonicalHash) return `hash:${skill.canonicalHash}`;
  const installation = skill.installations.find((item) => item.hash) ?? skill.installations[0];
  if (installation) return installationIdentity(installation);
  if (skill.canonicalPath) return `path:${pathIdentity(skill.canonicalPath)}`;
  return `id:${skill.id}`;
}

function installationIdentity(installation: SkillInstallation) {
  if (installation.hash) return `hash:${installation.hash}`;
  return `path:${pathIdentity(installation.realPath ?? installation.entryPath)}`;
}

function groupId(skill: SkillRecord, identity: string, groupCount: number) {
  if (groupCount <= 1) return skill.id;
  return `${skill.slug}@${shortHash(identity)}`;
}

function shortHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8);
}

export function syncSourcesForSkills(skills: SkillRecord[]): InstallationRef[] {
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

export function quickMigrationSourcesForSkills(skills: SkillRecord[]): InstallationRef[] {
  return skills.map((skill) => {
    const installation = firstValidInstallation(skill);
    return {
      installationId: installation?.id ?? "",
      entryPath: installation?.entryPath ?? skill.canonicalPath ?? "",
      slug: skill.slug
    };
  });
}

export function skillListStatus(
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

export function skillSourceSummary(skill: SkillRecord, skillLocks: Record<string, SkillLockEntry>) {
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

  const gitInstallation = skill.installations.find((installation) => normalizedPath(installation.entryPath).includes("/.git/") || normalizedPath(installation.rootPath).includes("/.git/"));
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

export function skillsShUpdateSource(skill: SkillRecord, skillLocks: Record<string, SkillLockEntry>) {
  const installation = skill.installations.find((item) => isAgentsSkillPath(item.entryPath));
  const lock = skillsShLock(skill, skillLocks);
  const sourceUrl = lock?.sourceUrl || lock?.source;
  if (!installation || !lock || !sourceUrl) return null;
  return { installation, lock, sourceUrl };
}

export function centralLibraryReferenceSummary(skill: SkillRecord) {
  return skill.installations.reduce(
    (summary, installation) => {
      if (!isCentralLibraryReference(skill, installation)) return summary;
      summary.total += 1;
      if (installation.scope === "project") summary.project += 1;
      else if (installation.scope === "global") summary.global += 1;
      return summary;
    },
    { total: 0, global: 0, project: 0 }
  );
}

export function isCentralLibraryReference(skill: SkillRecord, installation: SkillInstallation) {
  if (!skill.canonicalPath || !installation.isSymlink) return false;

  const canonicalPath = skill.canonicalPath;
  const linkParent = parentPath(installation.entryPath);
  const candidates = [
    installation.realPath,
    installation.symlinkTarget,
    installation.symlinkTarget && linkParent ? resolvePath(linkParent, installation.symlinkTarget) : undefined
  ].filter((path): path is string => Boolean(path));

  return candidates.some((path) => samePath(path, canonicalPath));
}

function dedupeBy<T>(items: T[], keyOf: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function skillsShLock(skill: SkillRecord, skillLocks: Record<string, SkillLockEntry>) {
  return skillLocks[skill.slug] ?? skillLocks[skill.displayName];
}

const AGENTS_SKILL_PATH_REGEX = /(?:^|\/)\.agents\/skills\/[^/]+$/;

function isAgentsSkillPath(path: string) {
  return AGENTS_SKILL_PATH_REGEX.test(normalizedPath(path));
}

export function failedUpdateCheck(reason: unknown): SkillUpdateCheck {
  return { status: "check-failed", message: String(reason) };
}

function pluginSourceDetail(path: string) {
  const cleanPath = normalizedPath(path);
  const claudeMarketplace = cleanPath.match(/\/\.claude\/plugins\/marketplaces\/([^/]+)/);
  if (claudeMarketplace) return marketplaceRepositoryLabel(claudeMarketplace[1]);

  const cursorMarketplace = cleanPath.match(/\/\.cursor\/plugins\/marketplaces\/([^/]+)/);
  if (cursorMarketplace) return marketplaceRepositoryLabel(cursorMarketplace[1]);

  const codexPlugin = cleanPath.match(/\/\.codex\/plugins\/cache\/([^/]+)\/([^/]+)/);
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

export function compactPath(path: string) {
  const cleanPath = normalizedPath(path);
  return cleanPath
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^[A-Za-z]:\/Users\/[^/]+/, "~");
}

export function samePath(left: string, right: string) {
  return pathIdentity(left) === pathIdentity(right);
}

export function projectSkillsForFolder(skills: SkillRecord[], folder: string | null): SkillRecord[] {
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

export function projectName(folder: string) {
  const clean = normalizedPath(folder).replace(/\/+$/, "");
  return clean.split("/").pop() || clean;
}

export function projectStats(folder: string, skills: SkillRecord[]) {
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
  const child = pathIdentity(path);
  const parent = pathIdentity(folder);
  return child === parent || child.startsWith(`${parent}/`);
}

function parentPath(path: string) {
  const clean = normalizedPath(path).replace(/\/+$/, "");
  const index = clean.lastIndexOf("/");
  if (index <= 0) return null;
  return clean.slice(0, index);
}

function resolvePath(base: string, target: string) {
  const cleanTarget = normalizedPath(target);
  if (cleanTarget.startsWith("/") || /^[a-z]:\//i.test(cleanTarget)) return cleanTarget;

  const segments = [...normalizedPath(base).split("/"), ...cleanTarget.split("/")];
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return normalizedPath(base).startsWith("/") ? `/${resolved.join("/")}` : resolved.join("/");
}

function normalizedPath(path: string) {
  return path.replace(/\\/g, "/");
}

function pathIdentity(path: string) {
  const cleanPath = normalizedPath(path).replace(/\/+$/, "");
  return /^[a-z]:\//i.test(cleanPath) ? cleanPath.toLowerCase() : cleanPath;
}

export function agentSkillCount(agentId: string, skills: SkillRecord[]) {
  return skills.filter((skill) => skill.installations.some((installation) => installation.agentId === agentId)).length;
}

export function agentSignalSummary(agent: AgentRecord) {
  const labels = agent.detectionSources.flatMap((source) => {
    if (source.kind === "cli") return ["CLI"];
    if (source.kind === "app") return ["APP"];
    if (source.kind === "extension") return ["插件"];
    if (source.kind === "plugin-installed") return ["插件"];
    return [];
  });
  return Array.from(new Set(labels)).join(" · ");
}
