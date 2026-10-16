import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import type { ShelterLiveStatus, VolunteerTask } from '../types';

interface TaskNode extends VolunteerTask {
  children: TaskNode[];
}

function buildTaskTree(tasks: VolunteerTask[]): TaskNode[] {
  const nodes = new Map<number, TaskNode>();
  tasks.forEach((task) => nodes.set(task.task_id, { ...task, children: [] }));

  const roots: TaskNode[] = [];
  nodes.forEach((node) => {
    const parent = node.parent_task_id === null ? undefined : nodes.get(node.parent_task_id);
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  const sortChildren = (node: TaskNode) => {
    node.children.sort((left, right) => left.task_id - right.task_id);
    node.children.forEach(sortChildren);
  };
  roots.sort((left, right) => left.task_id - right.task_id).forEach(sortChildren);
  return roots;
}

function TaskBranch({ task }: { task: TaskNode }) {
  return (
    <li className="task-tree-item">
      <div className="task-tree-card">
        <div>
          <strong>{task.description}</strong>
          <small>Task {String(task.task_id).padStart(3, '0')}</small>
        </div>
        <span className={`task-status is-${task.status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{task.status}</span>
      </div>
      {task.children.length > 0 && (
        <ul className="task-tree-children">
          {task.children.map((child) => <TaskBranch key={child.task_id} task={child} />)}
        </ul>
      )}
    </li>
  );
}

export default function VolunteerTaskTree() {
  const [shelters, setShelters] = useState<ShelterLiveStatus[]>([]);
  const [shelterId, setShelterId] = useState('');
  const [tasks, setTasks] = useState<VolunteerTask[]>([]);
  const [loadingShelters, setLoadingShelters] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [error, setError] = useState('');
  const [retryNumber, setRetryNumber] = useState(0);
  const tree = useMemo(() => buildTaskTree(tasks), [tasks]);

  useEffect(() => {
    let active = true;
    api.get<ShelterLiveStatus[]>('/shelters')
      .then((response) => {
        if (!active) return;
        setShelters(response.data);
        setShelterId(response.data[0] ? String(response.data[0].shelter_id) : '');
      })
      .catch((requestError) => {
        console.error('Failed to fetch shelters for tasks', requestError);
        if (active) setError('Shelters are temporarily unavailable. Try again in a moment.');
      })
      .finally(() => { if (active) setLoadingShelters(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!shelterId) {
      setTasks([]);
      setLoadingTasks(false);
      return;
    }

    let active = true;
    setLoadingTasks(true);
    setTasks([]);
    setError('');
    api.get<VolunteerTask[]>(`/shelters/${shelterId}/tasks`)
      .then((response) => { if (active) setTasks(response.data); })
      .catch((requestError) => {
        console.error('Failed to fetch volunteer tasks', requestError);
        if (active) setError('Task data is temporarily unavailable. Try refreshing.');
      })
      .finally(() => { if (active) setLoadingTasks(false); });
    return () => { active = false; };
  }, [retryNumber, shelterId]);

  if (loadingShelters) return <div className="loading-state"><span className="loading-mark" />Loading shelters…</div>;
  if (error && shelters.length === 0) return <div className="empty-state" role="alert"><span className="eyebrow">CONNECTION ISSUE</span><p>{error}</p><button className="secondary-button" onClick={() => window.location.reload()}>Try again</button></div>;

  const selectedShelter = shelters.find((shelter) => String(shelter.shelter_id) === shelterId);

  return (
    <div className="module-content">
      <div className="module-heading task-tree-heading">
        <div>
          <p className="eyebrow">VOLUNTEER OPERATIONS</p>
          <h2>Task dependency tree</h2>
          <p>Follow parent tasks and their follow-up work at each shelter.</p>
        </div>
        <label className="allocation-field task-shelter-select">
          <span>Choose a shelter</span>
          <select value={shelterId} onChange={(event) => setShelterId(event.target.value)} disabled={shelters.length === 0}>
            {shelters.map((shelter) => <option key={shelter.shelter_id} value={shelter.shelter_id}>{shelter.name}</option>)}
          </select>
        </label>
      </div>

      {error ? (
        <div className="empty-state" role="alert"><span className="eyebrow">CONNECTION ISSUE</span><p>{error}</p><button className="secondary-button" onClick={() => setRetryNumber((value) => value + 1)}>Try again</button></div>
      ) : loadingTasks ? (
        <div className="loading-state"><span className="loading-mark" />Loading tasks…</div>
      ) : tree.length === 0 ? (
        <div className="empty-state"><span className="eyebrow">{shelters.length === 0 ? 'NO SHELTERS YET' : 'NO TASKS YET'}</span><p>{selectedShelter ? `No volunteer tasks are recorded for ${selectedShelter.name}.` : 'No shelters are available to select.'}</p></div>
      ) : (
        <ul className="task-tree" aria-label={`Volunteer tasks for ${selectedShelter?.name ?? 'selected shelter'}`}>
          {tree.map((task) => <TaskBranch key={task.task_id} task={task} />)}
        </ul>
      )}
    </div>
  );
}
