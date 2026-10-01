import type { ClassInfo } from '../types';
import { buttonLabel, type TodoAction, type TodoItem } from '../services/welcomeTodoRules';

interface Props {
  classes: ClassInfo[];
  enabled: boolean;
  storageUnavailable?: boolean;
  weeklyDone: boolean;
  weeklyClass: string;
  weeklyNote: string;
  items: TodoItem[];
  pendingCount: number;
  onEnabledChange: (enabled: boolean) => void;
  onWeeklyClassChange: (value: string) => void;
  onWeeklyNoteChange: (value: string) => void;
  onWeeklyConfirm: () => void;
  onToggleDone: (item: TodoItem) => void;
  onOpenAction: (action: TodoAction) => void;
}

export default function WelcomeTodoPanel({
  classes,
  enabled,
  storageUnavailable,
  weeklyDone,
  weeklyClass,
  weeklyNote,
  items,
  pendingCount,
  onEnabledChange,
  onWeeklyClassChange,
  onWeeklyNoteChange,
  onWeeklyConfirm,
  onToggleDone,
  onOpenAction,
}: Props) {
  return (
    <aside className="welcome-todo-panel card">
      {storageUnavailable && (
        <p role="status">本机存储暂不可用，新的待办勾选暂未保存；已有座位表和备注未清理。</p>
      )}
      <div className="welcome-todo-header">
        <div>
          <div className="welcome-todo-kicker">Today To Do</div>
          <h2>我的待办</h2>
        </div>
        <label className="welcome-todo-switch">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onEnabledChange(event.target.checked)}
          />
          <span>{enabled ? '已开启' : '未开启'}</span>
        </label>
      </div>

      {!enabled ? (
        <div className="welcome-todo-empty">打开后，这里会按今天的班级安排生成真正可勾选的 To do。</div>
      ) : (
        <>
          <details className="welcome-todo-weekly"><summary>本周额外提醒{weeklyDone ? ' · 已确认' : ' · 待确认'}</summary>
            <div className="welcome-todo-block-title">
              <strong>本周额外提醒</strong>
              <span>{weeklyDone ? '本周已确认' : '本周首次登录必看'}</span>
            </div>
            <p className="welcome-todo-weekly-copy">学段资料包都查看了吗？确认后可以顺手挂到某个班，上课当天会再次进入 To do。</p>
            <select value={weeklyClass} onChange={(event) => onWeeklyClassChange(event.target.value)}>
              <option value="">选择班级（可不选）</option>
              {classes.map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
            <textarea
              value={weeklyNote}
              onChange={(event) => onWeeklyNoteChange(event.target.value)}
              placeholder="例如：J413 发书；K218 发资料要领讲义"
            />
            <button className="btn btn-primary btn-sm" onClick={onWeeklyConfirm}>
              {weeklyDone ? '更新本周提醒' : '确认并记录'}
            </button>
          </details>

          <div className="welcome-todo-list-wrap">
            <div className="welcome-todo-block-title">
              <strong>今天待办</strong>
              <span>{pendingCount} 条未完成</span>
            </div>

            {items.length === 0 ? (
              <div className="welcome-todo-empty">今天没有自动待办；你仍然可以在本周提醒里给某个班挂事项。</div>
            ) : (
              <div className="welcome-todo-list">
                {items.map((item) => (
                  <article key={item.key} className={`welcome-todo-item${item.done ? ' is-done' : ''}`}>
                    <div className="welcome-todo-item-top">
                      <div>
                        <div className="welcome-todo-item-title">{item.title}</div>
                        {item.detail && <div className="welcome-todo-item-detail">{item.detail}</div>}
                      </div>
                      <button className="btn btn-ghost btn-sm" onClick={() => onToggleDone(item)}>
                        {item.done ? '取消完成' : '完成'}
                      </button>
                    </div>
                    <div className="welcome-todo-actions">
                      {item.actions.map((action) => {
                        return (
                          <button
                            key={`${item.key}:${action.classCode}:${action.target}`}
                            className="btn btn-ghost btn-sm"
                            onClick={() => onOpenAction(action)}
                          >
                            {buttonLabel(action, item.actions.length === 1)}
                          </button>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
