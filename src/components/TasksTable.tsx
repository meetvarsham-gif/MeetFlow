import { useState } from 'react';
import type { ExtractedTask } from '../types';
import { formatDeadlineDisplay } from '../services/validation';

interface TasksTableProps {
  tasks: ExtractedTask[];
  onUpdateField: (taskId: string, field: 'owner' | 'deadline', value: string) => string | null;
}

function EditableCell({
  value,
  placeholder,
  onCommit,
}: {
  value: string | null;
  placeholder: string;
  onCommit: (value: string) => string | null;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function commit() {
    const result = onCommit(draft);
    if (result) {
      setError(result);
      return;
    }
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={`cell-edit-trigger ${value ? '' : 'cell-edit-trigger--empty'}`}
        onClick={() => {
          setDraft(value ?? '');
          setError(null);
          setEditing(true);
        }}
      >
        {value ?? placeholder}
      </button>
    );
  }

  return (
    <div className="cell-edit-wrap">
      <input
        autoFocus
        className={`cell-input ${error ? 'cell-input--error' : ''}`}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setError(null);
            setEditing(false);
          }
        }}
      />
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

const STATUS_LABEL: Record<ExtractedTask['status'], string> = {
  done: 'Done',
  ongoing: 'Ongoing',
  pending: 'Pending',
};

export default function TasksTable({ tasks, onUpdateField }: TasksTableProps) {
  const openCount = tasks.filter((t) => t.needsClarification).length;

  return (
    <section className="tasks-section">
      <div className="section__header">
        <div className="section__heading">
          <span className="eyebrow">Action Items</span>
          <h2>Tasks &amp; Owners</h2>
        </div>
        <span className="hint-text">
          {tasks.length} total{openCount > 0 ? ` · ${openCount} need clarification` : ''}
        </span>
      </div>

      {tasks.length === 0 ? (
        <p className="hint-text">No action items were detected in this transcript.</p>
      ) : (
        <div className="table-wrap">
          <table className="tasks-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Owner</th>
                <th>Deadline</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className={task.needsClarification ? 'row--ambiguous' : ''}>
                  <td className="task-desc-cell">{task.description}</td>
                  <td>
                    <EditableCell
                      value={task.owner}
                      placeholder="Unassigned"
                      onCommit={(v) => onUpdateField(task.id, 'owner', v)}
                    />
                  </td>
                  <td>
                    <EditableCell
                      value={formatDeadlineDisplay(task.deadline)}
                      placeholder="No deadline"
                      onCommit={(v) => onUpdateField(task.id, 'deadline', v)}
                    />
                  </td>
                  <td>
                    <div className="status-pill-group">
                      <span className={`status-pill status-pill--${task.status}`}>
                        <span className="status-pill__dot" />
                        {STATUS_LABEL[task.status]}
                      </span>
                      {task.needsClarification && (
                        <span className="status-pill status-pill--warn">
                          <span className="status-pill__dot" />
                          Needs info
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
