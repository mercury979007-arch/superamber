import { useState } from 'react';
import type { SavedCustomScheme, SchemeRuleConfig } from '../types';
import { RULE_TEMPLATES, defaultRuleConfigs } from '../utils/customScheme';
import './CustomSchemeEditor.css';

interface Props {
  existing?: SavedCustomScheme;
  onSave: (scheme: SavedCustomScheme) => void;
  onCancel: () => void;
}

const GROUPS = [...new Set(RULE_TEMPLATES.map((t) => t.group))];

export default function CustomSchemeEditor({ existing, onSave, onCancel }: Props) {
  const [name, setName] = useState(existing?.name ?? '');
  const [rules, setRules] = useState<SchemeRuleConfig[]>(
    defaultRuleConfigs().map((rule) => ({ ...rule, ...existing?.rules.find((saved) => saved.templateId === rule.templateId) }))
  );
  const [error, setError] = useState('');

  function getRule(templateId: string): SchemeRuleConfig {
    return rules.find((r) => r.templateId === templateId)!;
  }

  function updateRule(templateId: string, patch: Partial<SchemeRuleConfig>) {
    setRules((prev) =>
      prev.map((r) => (r.templateId === templateId ? { ...r, ...patch } : r))
    );
  }

  function handleSave() {
    if (!name.trim()) { setError('请给方案起个名字'); return; }
    const hasAny = rules.some((r) => r.enabled);
    if (!hasAny) { setError('请至少启用一条规则'); return; }
    setError('');
    const scheme: SavedCustomScheme = {
      id: existing?.id ?? `custom_${Date.now()}`,
      name: name.trim(),
      rules,
      createdAt: existing?.createdAt ?? Date.now(),
    };
    onSave(scheme);
  }

  return (
    <div className="cse-wrap">
      <div className="cse-header">
        <div className="cse-name-row">
          <input
            className="input-field cse-name-input"
            placeholder="方案名称（例如：Week2标准）"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <p className="cse-hint">勾选要计入的规则，设置对应 MP 值；带「阈值」的规则可调整分数线（0–100%）。重复环节准确率默认不开启，避免与词王准确率意外叠加。</p>
      </div>

      <div className="cse-rules">
        {GROUPS.map((group) => {
          const templates = RULE_TEMPLATES.filter((t) => t.group === group);
          return (
            <div key={group} className="cse-group">
              <div className="cse-group-title">{group}</div>
              {templates.map((t) => {
                const rule = getRule(t.id);
                return (
                  <label key={t.id} className={`cse-rule-row ${rule.enabled ? 'enabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => updateRule(t.id, { enabled: e.target.checked })}
                    />
                    <span className="cse-rule-label">{t.label}</span>
                    <div className="cse-rule-controls">
                      <span className="cse-rule-unit">+</span>
                      <input
                        className="cse-num-input"
                        type="number"
                        step="0.05"
                        min="0"
                        value={rule.amount}
                        disabled={!rule.enabled}
                        onChange={(e) => updateRule(t.id, { amount: parseFloat(e.target.value) || 0 })}
                      />
                      <span className="cse-rule-unit">MP</span>
                      {t.hasThreshold && (
                        <>
                          <span className="cse-rule-unit cse-threshold-sep">阈值</span>
                          <input
                            className="cse-num-input"
                            type="number"
                            step="5"
                            min="0"
                            max="100"
                            value={Math.round(rule.threshold * 100)}
                            disabled={!rule.enabled}
                            onChange={(e) =>
                              updateRule(t.id, { threshold: (parseFloat(e.target.value) || 0) / 100 })
                            }
                          />
                          <span className="cse-rule-unit">%</span>
                        </>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>

      {error && <p className="cse-error">{error}</p>}

      <div className="cse-actions">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>取消</button>
        <button className="btn btn-primary btn-sm" onClick={handleSave}>完成逐项编辑</button>
      </div>
    </div>
  );
}
