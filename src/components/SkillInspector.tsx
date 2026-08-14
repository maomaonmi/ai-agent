'use client';

// Why: Phase3 程序性记忆——Skill 胶囊查看器。列表展示 + 点击展开详情
// （标准步骤 / 必要参数 / 校验规则 / 成功失败计数），供用户审计沉淀的经验。
// 决策 1：自动沉淀的 Skill 默认 pending（不参与匹配注入），
// 必须在此经人工「上架」确认后才进入 Skill 市场（published）。
import { useCallback, useEffect, useState } from 'react';
import { deleteSkill, getSkills, setSkillStatus, type SkillCapsule } from '../lib/api';

const SKILL_TYPE_LABEL: Record<SkillCapsule['skill_type'], string> = {
  code_pattern: '代码模式',
  task_flow: '任务流程',
  fix_template: '修复模板',
  instruction: '指令',
};

const STATUS_BADGE: Record<SkillCapsule['status'], { label: string; className: string }> = {
  pending: { label: '待确认', className: 'bg-amber-100 text-amber-700' },
  published: { label: '已上架', className: 'bg-emerald-100 text-emerald-700' },
};

function formatTime(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false });
}

export default function SkillInspector() {
  const [skills, setSkills] = useState<SkillCapsule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [mutatingId, setMutatingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSkills();
      setSkills(res.skills);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载 Skill 失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Why 手动纠偏: 阈值沉淀可能积累错误/过期胶囊并持续参与匹配注入，
  // 行级删除是唯一的人工回收入口（后端无自动清理，全局资产不按会话隔离）。
  const handleDelete = useCallback(
    async (skillId: number) => {
      if (!window.confirm('确定删除该 Skill 胶囊？删除后不再参与匹配。')) return;
      try {
        await deleteSkill(skillId);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '删除 Skill 失败');
      }
    },
    [load],
  );

  // Why 人工确认上架（决策 1）：pending 一律不参与匹配，用户审计后才 published；
  // 「下架」软回 pending（数据保留，可再上架），「丢弃/删除」才是硬回收。
  const handleSetStatus = useCallback(
    async (skillId: number, status: SkillCapsule['status']) => {
      setMutatingId(skillId);
      setError(null);
      try {
        await setSkillStatus(skillId, status);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '更新 Skill 状态失败');
      } finally {
        setMutatingId(null);
      }
    },
    [load],
  );

  const pendingSkills = skills.filter((s) => s.status === 'pending');
  const publishedSkills = skills.filter((s) => s.status === 'published');

  const renderSkillCard = (skill: SkillCapsule) => {
    const isOpen = expandedId === skill.skill_id;
    const isPending = skill.status === 'pending';
    const badge = STATUS_BADGE[skill.status] ?? STATUS_BADGE.published;
    const busy = mutatingId === skill.skill_id;
    return (
      <li
        key={skill.skill_id}
        className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => setExpandedId(isOpen ? null : skill.skill_id)}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded text-left hover:bg-slate-50"
          >
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-slate-800">
                {skill.skill_name}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                <span className="rounded bg-slate-100 px-1.5 py-0.5">
                  {SKILL_TYPE_LABEL[skill.skill_type] ?? skill.skill_type}
                </span>
                <span className={`rounded px-1.5 py-0.5 ${badge.className}`}>{badge.label}</span>
                <span>
                  成功 {skill.success_count} · 失败 {skill.failure_count}
                </span>
              </div>
            </div>
            <span className="text-xs text-slate-400">{isOpen ? '▾' : '▸'}</span>
          </button>

          {isPending && (
            <div className="flex flex-shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSetStatus(skill.skill_id, 'published')}
                className="rounded border border-emerald-200 bg-white px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              >
                ✓ 上架
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDelete(skill.skill_id)}
                className="rounded border border-red-200 bg-white px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                ✗ 丢弃
              </button>
            </div>
          )}
        </div>

        {isOpen && (
          <div className="space-y-3 border-t border-slate-100 px-3 py-3 text-xs text-slate-700">
            <div>
              <div className="mb-1 font-semibold text-slate-800">触发条件</div>
              <div className="rounded bg-slate-50 px-2 py-1.5 leading-relaxed">
                {skill.trigger_condition}
              </div>
            </div>

            {skill.trigger_keywords.length > 0 && (
              <div>
                <div className="mb-1 font-semibold text-slate-800">触发关键词</div>
                <div className="flex flex-wrap gap-1">
                  {skill.trigger_keywords.map((kw) => (
                    <span
                      key={kw}
                      className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-1 font-semibold text-slate-800">标准步骤</div>
              <ol className="list-inside list-decimal space-y-1 leading-relaxed text-slate-600">
                {skill.standard_steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>

            {skill.required_params.length > 0 && (
              <div>
                <div className="mb-1 font-semibold text-slate-800">必要参数</div>
                <div className="rounded bg-slate-50 px-2 py-1.5 leading-relaxed">
                  {skill.required_params.join('、')}
                </div>
              </div>
            )}

            {skill.validation_rules.length > 0 && (
              <div>
                <div className="mb-1 font-semibold text-slate-800">校验规则</div>
                <ul className="list-inside list-disc space-y-1 leading-relaxed text-slate-600">
                  {skill.validation_rules.map((rule, i) => (
                    <li key={i}>{rule}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>创建 {formatTime(skill.created_at)}</span>
              <span className="flex items-center gap-2">
                更新 {formatTime(skill.updated_at)}
                {!isPending && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSetStatus(skill.skill_id, 'pending')}
                    className="rounded border border-amber-200 bg-white px-1.5 py-0.5 text-[10px] text-amber-600 hover:bg-amber-50 disabled:opacity-50"
                  >
                    下架
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDelete(skill.skill_id)}
                  className="rounded border border-red-200 bg-white px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  删除
                </button>
              </span>
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">Skill 胶囊</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">
            {skills.length} 个{pendingSkills.length > 0 ? ` · ${pendingSkills.length} 待确认` : ''}
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
          >
            刷新
          </button>
        </div>
      </div>

      {loading && <div className="py-6 text-center text-xs text-slate-400">加载中...</div>}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && skills.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm leading-6 text-slate-500">
          暂无沉淀的 Skill 胶囊。
          <br />
          同一类任务连续成功 2 次后会自动沉淀为 Skill，需在此确认上架后才参与匹配。
        </div>
      )}

      {pendingSkills.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-amber-700">
              待确认（{pendingSkills.length}）
            </span>
            <span className="text-[11px] text-slate-400">
              自动沉淀的产物，人工上架后才进入 Skill 市场参与匹配注入
            </span>
          </div>
          <ul className="space-y-2">{pendingSkills.map(renderSkillCard)}</ul>
        </>
      )}

      {publishedSkills.length > 0 && (
        <>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs font-semibold text-emerald-700">
              已上架（{publishedSkills.length}）
            </span>
            <span className="text-[11px] text-slate-400">
              参与匹配注入，可在运行设置按会话挂载/卸载
            </span>
          </div>
          <ul className="space-y-2">{publishedSkills.map(renderSkillCard)}</ul>
        </>
      )}
    </div>
  );
}
