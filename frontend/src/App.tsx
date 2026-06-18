import { useEffect, useState } from 'react'
import { Brain, Trash2, Send, Plus, Bell, Layers, AlertCircle, RefreshCw, User as UserIcon, Clock, Filter } from 'lucide-react'

interface User {
  id: number
  username: string
  role: 'admin' | 'pm' | 'developer' | 'qa'
  skills: string | null
}

interface Task {
  id: number
  project_id: number
  parent_id: number | null
  title: string
  description: string | null
  status: 'todo' | 'in_progress' | 'qa_review' | 'done' | 'blocked'
  task_type: 'epic' | 'feature' | 'task' | 'subtask'
  phase: 'planning' | 'design' | 'development' | 'testing' | 'deployment'
  start_date: string | null
  due_date: string | null
  assigned_to_id: number | null
  assigned_to: User | null
  dependencies: string | null // JSON string of IDs
  estimated_hours: number | null
  actual_hours: number | null
  subtasks?: Task[]
}

interface Project {
  id: number
  name: string
  description: string | null
  created_at: string
  tasks: Task[]
}

interface Notification {
  id: number
  task_id: number | null
  message: string
  created_at: string
  is_read: boolean
}

function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [activeUser, setActiveUser] = useState<User | null>(null)
  const [filterMyTasks, setFilterMyTasks] = useState(false)
  
  const isTaskBelongingToRole = (task: Task, user: User | null): boolean => {
    if (!user) return true;
    if (user.role === 'admin' || user.role === 'pm') return true;
    
    // QA Review tasks always belong to QA
    if (user.role === 'qa' && task.status === 'qa_review') return true;
    
    // If the task has an assignee, it must match the active user exactly
    if (task.assigned_to_id !== null) {
      return task.assigned_to_id === user.id;
    }
    
    // If unassigned, show it if it matches their general role type
    const isQaTask = task.phase === 'testing' || 
                     ['qa', 'testing', 'test', 'review'].some(kw => 
                       task.title?.toLowerCase().includes(kw) || 
                       (task.description && task.description.toLowerCase().includes(kw))
                     );
                     
    if (user.role === 'qa') {
      return isQaTask;
    }
    if (user.role === 'developer') {
      return !isQaTask;
    }
    return true;
  }
  
  // Views Tab: 'kanban' | 'tree' | 'gantt' | 'calendar' | 'health' | 'hr' | 'agents'
  const [viewMode, setViewMode] = useState<'kanban' | 'tree' | 'gantt' | 'calendar' | 'health' | 'hr' | 'agents'>('kanban')


  // HR User Management State
  const [editingHRUser, setEditingHRUser] = useState<Partial<User> | null>(null)
  const [hrUsername, setHRUsername] = useState('')
  const [hrRole, setHRRole] = useState<'admin' | 'pm' | 'developer' | 'qa'>('developer')
  const [hrSkills, setHRSkills] = useState('')
  const [isHRSaving, setIsHRSaving] = useState(false)

  // Agents Configuration State
  interface AgentConfig {
    id: number
    key: string
    name: string
    description: string
    system_prompt: string
  }
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [selectedAgent, setSelectedAgent] = useState<AgentConfig | null>(null)
  const [agentDescription, setAgentDescription] = useState('')
  const [agentPrompt, setAgentPrompt] = useState('')
  const [isSavingAgent, setIsSavingAgent] = useState(false)
  const [chatForcedAgent, setChatForcedAgent] = useState<string>('supervisor')

  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [editingTask, setEditingTask] = useState<Partial<Task>>({})
  const [isDraftingReport, setIsDraftingReport] = useState(false)
  const [draftSuggestions, setDraftSuggestions] = useState<string[]>([])
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)

  const getStaticSuggestions = (status: string | undefined): string[] => {
    switch (status) {
      case 'in_progress':
        return ["Started working on task.", "Began development.", "In progress."];
      case 'qa_review':
        return ["Ready for QA review.", "Submitted for testing.", "QA validation needed."];
      case 'done':
        return ["Completed task successfully.", "Finished all requirements.", "Task complete."];
      case 'blocked':
        return ["Work is blocked.", "Pending external dependencies.", "Encountered blockers."];
      default:
        return ["Status updated.", "Progressing on task."];
    }
  }

  const handleGenerateDraftReport = async () => {
    if (draftSuggestions.length > 0) {
      setStatusReportText(draftSuggestions[0]);
      return;
    }
    if (!editingTask.id) return;
    setIsDraftingReport(true);
    try {
      const res = await fetch(`/api/tasks/${editingTask.id}/draft-report?target_status=${editingTask.status || ''}`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setStatusReportText(data.draft);
        if (data.suggestions) {
          setDraftSuggestions(data.suggestions);
        }
      } else {
        alert("Failed to generate draft report.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsDraftingReport(false);
    }
  }
  
  // Create project form
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDesc, setNewProjectDesc] = useState('')
  
  // Agent Chat
  const [chatMessage, setChatMessage] = useState('')
  const [chatHistory, setChatHistory] = useState<{ sender: 'user' | 'agent'; text: string; agentName?: string }[]>([
    { sender: 'agent', text: 'AI Coordinator is ready. Enter your request, e.g. "update status of task DB Design to done" or "task Frontend Login is blocked".' }
  ])
  const [isChatLoading, setIsChatLoading] = useState(false)


  // Status Indicators
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Status Report & Transition Modal
  const [isTransitionModalOpen, setIsTransitionModalOpen] = useState(false)
  const [statusReportText, setStatusReportText] = useState('')
  const [aiRecommendation, setAiRecommendation] = useState<{
    recommendation: string;
    action_type: string;
    suggested_title?: string;
    suggested_desc?: string;
    suggested_phase?: string;
  } | null>(null)

  // Project Health State
  const [healthData, setHealthData] = useState<{
    health_score: number;
    overdue_tasks: number;
    blocked_tasks: number;
    bottlenecks: string[];
    ai_assessment: string;
  } | null>(null)
  const [isHealthLoading, setIsHealthLoading] = useState(false)

  // Task Comments State
  interface TaskComment {
    id: number;
    task_id: number;
    sender: 'user' | 'ai_coordinator';
    content: string;
    created_at: string;
  }
  const [taskComments, setTaskComments] = useState<TaskComment[]>([])
  const [isCommentsLoading, setIsCommentsLoading] = useState(false)
  const [newCommentText, setNewCommentText] = useState('')

  const loadAgentsData = async () => {
    try {
      const res = await fetch('/api/agents/');
      if (res.ok) {
        const data = await res.json();
        setAgents(data);
        if (data.length > 0) {
          setSelectedAgent(prev => {
            if (prev) {
              const current = data.find((a: any) => a.key === prev.key);
              return current || data[0];
            }
            return data[0];
          });
        }
      }
    } catch (err) {
      console.error("Error loading agent configurations:", err);
    }
  };

  useEffect(() => {
    if (selectedAgent) {
      setAgentDescription(selectedAgent.description);
      setAgentPrompt(selectedAgent.system_prompt);
    }
  }, [selectedAgent]);

  // Load data from API
  const loadData = async () => {
    setIsRefreshing(true)
    try {
      // Fetch users
      const usersRes = await fetch('/api/users/')
      if (usersRes.ok) {
        const uData = await usersRes.json()
        setUsers(uData)
        // Select default user
        if (uData.length > 0 && !activeUser) {
          const defaultUser = uData.find((u: User) => u.role === 'pm') || uData[0]
          setActiveUser(defaultUser)
        }
      }

      const projRes = await fetch('/api/projects/')
      if (projRes.ok) {
        const pData = await projRes.json()
        setProjects(pData)
        
        if (activeProject) {
          const updated = pData.find((p: Project) => p.id === activeProject.id)
          if (updated) setActiveProject(updated)
        } else if (pData.length > 0) {
          setActiveProject(pData[0])
        }
      }

      const notifRes = await fetch('/api/notifications/')
      if (notifRes.ok) {
        const nData = await notifRes.json()
        setNotifications(nData)
      }

      await loadAgentsData()
    } catch (err) {
      console.error("Error fetching dashboard data:", err)
    } finally {
      setIsRefreshing(false)
    }
  }


  const loadHealthData = async () => {
    if (!activeProject) return
    setIsHealthLoading(true)
    try {
      const res = await fetch(`/api/projects/${activeProject.id}/health`)
      if (res.ok) {
        const hData = await res.json()
        setHealthData(hData)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsHealthLoading(false)
    }
  }

  const loadTaskComments = async (taskId: number) => {
    setIsCommentsLoading(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`)
      if (res.ok) {
        const cData = await res.json()
        setTaskComments(cData)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsCommentsLoading(false)
    }
  }

  const handleSendComment = async (e?: React.FormEvent, customMsg?: string) => {
    if (e) e.preventDefault()
    const textToSend = customMsg || newCommentText
    if (!textToSend.trim() || !editingTask.id) return

    setNewCommentText('')
    
    // Optimistic UI Comment
    const tempComment: TaskComment = {
      id: Date.now(),
      task_id: editingTask.id,
      sender: 'user',
      content: textToSend,
      created_at: new Date().toISOString()
    }
    setTaskComments(prev => [...prev, tempComment])
    setIsCommentsLoading(true)

    try {
      const res = await fetch(`/api/tasks/${editingTask.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: textToSend })
      })
      if (res.ok) {
        await loadTaskComments(editingTask.id)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsCommentsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (viewMode === 'health') {
      loadHealthData()
    }
  }, [viewMode, activeProject?.id])

  useEffect(() => {
    if (viewMode === 'agents') {
      loadAgentsData()
    }
  }, [viewMode])


  useEffect(() => {
    if (isTransitionModalOpen && editingTask.id) {
      const statics = getStaticSuggestions(editingTask.status);
      setDraftSuggestions(statics);
      
      const fetchSuggestions = async () => {
        setIsLoadingSuggestions(true);
        try {
          const res = await fetch(`/api/tasks/${editingTask.id}/draft-report?target_status=${editingTask.status || ''}`, {
            method: 'POST'
          });
          if (res.ok) {
            const data = await res.json();
            if (data.suggestions && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
              setDraftSuggestions(data.suggestions);
            }
          }
        } catch (err) {
          console.error("Error fetching AI suggestions:", err);
        } finally {
          setIsLoadingSuggestions(false);
        }
      };
      fetchSuggestions();
    } else {
      setDraftSuggestions([]);
    }
  }, [isTransitionModalOpen, editingTask.id, editingTask.status]);

  useEffect(() => {
    let interval: any
    if (activeProject?.id) {
      interval = setInterval(async () => {
        const projRes = await fetch('/api/projects/')
        if (projRes.ok) {
          const pData = await projRes.json()
          setProjects(pData)
          const updated = pData.find((p: Project) => p.id === activeProject.id)
          if (updated) setActiveProject(updated)
        }
        const notifRes = await fetch('/api/notifications/')
        if (notifRes.ok) {
          const nData = await notifRes.json()
          setNotifications(nData)
        }
      }, 5000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [activeProject?.id])

  // Handle create project
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProjectName.trim()) return
    
    try {
      const res = await fetch('/api/projects/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName, description: newProjectDesc })
      })
      if (res.ok) {
        const newProj = await res.json()
        setNewProjectName('')
        setNewProjectDesc('')
        setProjects([...projects, newProj])
        setActiveProject(newProj)
        
        setChatHistory([
          { sender: 'agent', text: `Decomposing project "${newProj.name}" using AI. Please wait a few seconds and click Sync...` }
        ])
        
        setTimeout(loadData, 5000)
      }
    } catch (err) {
      console.error(err)
    }
  }

  // Handle delete project
  const handleDeleteProject = async (id: number) => {
    if (!confirm("Are you sure you want to delete this project?")) return
    try {
      await fetch(`/api/projects/${id}`, { method: 'DELETE' })
      const filtered = projects.filter(p => p.id !== id)
      setProjects(filtered)
      if (activeProject?.id === id) {
        setActiveProject(filtered.length > 0 ? filtered[0] : null)
      }
    } catch (err) {
      console.error(err)
    }
  }

  // HR User Management Actions
  const handleSaveHRUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hrUsername.trim()) return;
    setIsHRSaving(true);
    
    const payload = {
      username: hrUsername.trim(),
      role: hrRole,
      skills: hrSkills.trim() || null
    };

    try {
      let res;
      if (editingHRUser && editingHRUser.id) {
        res = await fetch(`/api/users/${editingHRUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch('/api/users/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      if (res.ok) {
        const usersRes = await fetch('/api/users/');
        if (usersRes.ok) {
          const uData = await usersRes.json();
          setUsers(uData);
          if (editingHRUser && editingHRUser.id === activeUser?.id) {
            const updated = uData.find((u: User) => u.id === activeUser.id);
            if (updated) setActiveUser(updated);
          }
        }
        setEditingHRUser(null);
        setHRUsername('');
        setHRRole('developer');
        setHRSkills('');
      } else {
        const err = await res.json();
        alert(`Error: ${err.detail || "Failed to save user"}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsHRSaving(false);
    }
  };

  const handleDeleteHRUser = async (userId: number) => {
    if (!confirm("Are you sure you want to delete this user? This may affect assigned tasks.")) return;
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        const usersRes = await fetch('/api/users/');
        if (usersRes.ok) {
          const uData = await usersRes.json();
          setUsers(uData);
          if (activeUser?.id === userId) {
            setActiveUser(uData[0] || null);
          }
        }
      } else {
        alert("Failed to delete user.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleStartEditHRUser = (user: User) => {
    setEditingHRUser(user);
    setHRUsername(user.username);
    setHRRole(user.role);
    setHRSkills(user.skills || '');
  };

  // Handle chat with agent
  const handleSendChat = async (e?: React.FormEvent, customMsg?: string) => {
    if (e) e.preventDefault()
    const textToSend = customMsg || chatMessage
    if (!textToSend.trim() || !activeProject) return

    setChatMessage('')
    setChatHistory(prev => [...prev, { sender: 'user', text: textToSend }])
    setIsChatLoading(true)

    try {
      const res = await fetch(`/api/projects/${activeProject.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: textToSend, 
          role: activeUser?.role || 'pm',
          forced_agent: chatForcedAgent 
        })
      })
      if (res.ok) {
        const data = await res.json()
        setChatHistory(prev => [...prev, { 
          sender: 'agent', 
          text: data.response,
          agentName: data.selected_agent 
        }])
        loadData()
      } else {
        setChatHistory(prev => [...prev, { sender: 'agent', text: 'Failed to connect to API server.' }])
      }
    } catch (err) {
      setChatHistory(prev => [...prev, { sender: 'agent', text: 'Error contacting AI agent.' }])
    } finally {
      setIsChatLoading(false)
    }

  }

  // Mark notification as read
  const handleReadNotification = async (id: number) => {
    try {
      await fetch(`/api/notifications/${id}/read`, { method: 'PUT' })
      loadData()
    } catch (err) {
      console.error(err)
    }
  }

  // Open modal for task creation
  const handleOpenCreateModal = (parent_id?: number) => {
    if (activeUser?.role !== 'pm' && activeUser?.role !== 'admin') {
      alert("Only PM or Admin has permission to create tasks.")
      return
    }
    setModalMode('create')
    setEditingTask({
      project_id: activeProject?.id,
      parent_id: parent_id || null,
      title: '',
      description: '',
      status: 'todo',
      task_type: parent_id ? 'subtask' : 'task',
      phase: 'development',
      start_date: new Date().toISOString().substring(0, 16),
      due_date: new Date(Date.now() + 86400000 * 2).toISOString().substring(0, 16),
      assigned_to_id: null,
      estimated_hours: 8.0,
      actual_hours: 0.0,
      dependencies: '[]'
    })
    setIsModalOpen(true)
  }

  // Open modal for editing
  const handleOpenEditModal = (task: Task) => {
    setModalMode('edit')
    setEditingTask({
      ...task,
      start_date: task.start_date ? new Date(task.start_date).toISOString().substring(0, 16) : null,
      due_date: task.due_date ? new Date(task.due_date).toISOString().substring(0, 16) : null
    })
    setTaskComments([])
    loadTaskComments(task.id)
    setIsModalOpen(true)
  }

  // Drag and Drop Event Handlers
  const handleDragStart = (e: React.DragEvent, taskId: number) => {
    e.dataTransfer.setData("text/plain", taskId.toString());
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetStatus: 'todo' | 'in_progress' | 'qa_review' | 'done' | 'blocked') => {
    e.preventDefault();
    const taskIdStr = e.dataTransfer.getData("text/plain");
    if (!taskIdStr || !activeProject) return;
    const taskId = parseInt(taskIdStr, 10);
    const draggedTask = activeProject.tasks.find(t => t.id === taskId);
    if (!draggedTask) return;

    if (draggedTask.status === targetStatus) return;

    // Block developers from setting status to done
    if (activeUser?.role === 'developer' && targetStatus === 'done') {
      alert("Developers are not allowed to change task status to Done. Only PM or QA can complete tasks.");
      return;
    }

    // Block developers from changing status of completed tasks
    if (activeUser?.role === 'developer' && draggedTask.status === 'done') {
      alert("Developers are not allowed to change status of completed tasks.");
      return;
    }

    setEditingTask({ 
      ...draggedTask, 
      status: targetStatus,
      start_date: draggedTask.start_date ? new Date(draggedTask.start_date).toISOString().substring(0, 16) : null,
      due_date: draggedTask.due_date ? new Date(draggedTask.due_date).toISOString().substring(0, 16) : null
    });
    setModalMode('edit');
    setStatusReportText('');
    setAiRecommendation(null);
    setIsTransitionModalOpen(true);
  };

  // Save task (create or edit)
  const handleSaveTask = async () => {
    if (!editingTask.title?.trim() || !activeProject) return
    
    // Block developers from setting status to done
    if (activeUser?.role === 'developer' && editingTask.status === 'done') {
      alert("Developers are not allowed to change task status to Done. Only PM or QA can complete tasks.");
      return;
    }

    // Block developers from changing status of completed tasks
    if (modalMode === 'edit') {
      const originalTask = activeProject.tasks.find(t => t.id === editingTask.id);
      if (originalTask && originalTask.status === 'done' && editingTask.status !== 'done' && activeUser?.role === 'developer') {
        alert("Developers are not allowed to change status of completed tasks.");
        return;
      }
    }
    
    // Check permissions
    if (modalMode === 'create') {
      if (activeUser?.role !== 'pm' && activeUser?.role !== 'admin') return
    }
    
    // Check if status changed in edit mode
    if (modalMode === 'edit') {
      const originalTask = activeProject.tasks.find(t => t.id === editingTask.id);
      if (originalTask && originalTask.status !== editingTask.status) {
        setStatusReportText('');
        setAiRecommendation(null);
        setIsTransitionModalOpen(true);
        return;
      }
    }
    
    const bodyData = {
      ...editingTask,
      start_date: editingTask.start_date ? new Date(editingTask.start_date).toISOString() : null,
      due_date: editingTask.due_date ? new Date(editingTask.due_date).toISOString() : null
    }

    try {
      let res
      if (modalMode === 'create') {
        res = await fetch(`/api/projects/${activeProject.id}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyData)
        })
      } else {
        res = await fetch(`/api/tasks/${editingTask.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyData)
        })
      }

      if (res.ok) {
        setIsModalOpen(false)
        loadData()
      } else {
        const errData = await res.json()
        alert(`Error: ${errData.detail || 'Failed to save task'}`)
      }
    } catch (err) {
      console.error(err)
    }
  }

  // Submit status update report & fetch AI recommendations
  const handleStatusReportSubmit = async () => {
    if (!statusReportText.trim() || !editingTask.id || !activeProject) return;
    
    // Block developers from setting status to done
    if (activeUser?.role === 'developer' && editingTask.status === 'done') {
      alert("Developers are not allowed to change task status to Done. Only PM or QA can complete tasks.");
      return;
    }

    // Block developers from changing status of completed tasks
    if (activeUser?.role === 'developer') {
      const originalTask = activeProject.tasks.find(t => t.id === editingTask.id);
      if (originalTask && originalTask.status === 'done' && editingTask.status !== 'done') {
        alert("Developers are not allowed to change status of completed tasks.");
        return;
      }
    }
    
    try {
      const res = await fetch(`/api/tasks/${editingTask.id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: editingTask.status,
          report: statusReportText
        })
      });
      if (res.ok) {
        const data = await res.json();
        setAiRecommendation(data.ai_recommendation);
        
        // Append AI recommendation to Chat History
        const rec = data.ai_recommendation;
        let aiMsg = `AI Coordinator: Task status updated to ${editingTask.status?.toUpperCase()}.\nRecommendation: ${rec.recommendation}`;
        if (rec.action_type === 'create_task') {
          aiMsg += `\n\nSuggested Task: "${rec.suggested_title}"\nPhase: ${rec.suggested_phase}\nDescription: ${rec.suggested_desc}`;
        }
        setChatHistory(prev => [...prev, { sender: 'agent', text: aiMsg }]);
        
        // Reload data to reflect status change
        loadData();
      } else {
        alert("Failed to submit status update report.");
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Delete task
  const handleDeleteTask = async (taskId: number) => {
    if (activeUser?.role !== 'pm' && activeUser?.role !== 'admin') {
      alert("Only PM or Admin has permission to delete tasks.")
      return
    }
    if (!confirm("Are you sure you want to delete this task and all its subtasks?")) return
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
      if (res.ok) {
        setIsModalOpen(false)
        loadData()
      }
    } catch (err) {
      console.error(err)
    }
  }

  // Categorize tasks for Kanban
  const getTasksByStatus = (status: Task['status']) => {
    return activeProject?.tasks?.filter(t => t.status === status) || []
  }

  // Render Gantt Timeline helpers
  const getProjectTimelineBounds = () => {
    if (!activeProject || activeProject.tasks.length === 0) {
      return { start: new Date(), end: new Date() }
    }
    const dates = activeProject.tasks
      .flatMap(t => [t.start_date ? new Date(t.start_date) : null, t.due_date ? new Date(t.due_date) : null])
      .filter((d): d is Date => d !== null)
    
    if (dates.length === 0) {
      const start = new Date()
      const end = new Date()
      end.setDate(end.getDate() + 7)
      return { start, end }
    }
    
    const min = new Date(Math.min(...dates.map(d => d.getTime())))
    const max = new Date(Math.max(...dates.map(d => d.getTime())))
    
    // Add 1 day padding
    min.setDate(min.getDate() - 1)
    max.setDate(max.getDate() + 2)
    return { start: min, end: max }
  }

  const getGanttCoordinates = (task: Task, bounds: { start: Date, end: Date }) => {
    if (!task.start_date || !task.due_date) return { left: 0, width: 0 }
    const start = new Date(task.start_date).getTime()
    const end = new Date(task.due_date).getTime()
    
    const totalDuration = bounds.end.getTime() - bounds.start.getTime() || 1
    
    const left = Math.max(0, ((start - bounds.start.getTime()) / totalDuration) * 100)
    const width = Math.max(2, ((end - start) / totalDuration) * 100)
    return { left, width }
  }

  // Render recursive tree helpers
  const renderTreeTask = (task: Task, depth: number = 0) => {
    const typeColors = {
      epic: '#f43f5e',
      feature: '#3b82f6',
      task: '#818cf8',
      subtask: '#0d9488'
    }
    
    return (
      <div key={task.id} style={{ marginLeft: `${depth * 22}px`, marginTop: '8px', opacity: filterMyTasks && !isTaskBelongingToRole(task, activeUser) ? 0.25 : 1, transition: 'opacity 0.3s ease' }}>
        <div 
          onClick={() => handleOpenEditModal(task)}
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '12px', 
            padding: '10px 14px', 
            background: '#ffffff', 
            border: '1px solid rgba(0,0,0,0.06)', 
            borderRadius: '8px',
            cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            transition: 'all 0.15s'
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(79, 70, 229, 0.25)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(0,0,0,0.06)'}
        >
          <span style={{ 
            fontSize: '0.62rem', 
            fontWeight: 800, 
            padding: '2px 6px', 
            borderRadius: '4px', 
            background: typeColors[task.task_type] || '#475569', 
            color: '#ffffff',
            textTransform: 'uppercase'
          }}>
            {task.task_type}
          </span>
          
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1e293b' }}>{task.title}</span>
            <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Phase: <span style={{ textTransform: 'capitalize' }}>{task.phase}</span></span>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {task.estimated_hours && (
              <span style={{ fontSize: '0.7rem', color: '#475569', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                <Clock size={11} /> {task.estimated_hours}h
              </span>
            )}
            {task.assigned_to && (
              <span style={{ fontSize: '0.7rem', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', color: '#475569', fontWeight: 500 }}>
                @{task.assigned_to.username}
              </span>
            )}
            <span style={{ 
              fontSize: '0.7rem', 
              fontWeight: 600, 
              padding: '2px 8px', 
              borderRadius: '9999px', 
              background: task.status === 'done' ? 'rgba(16,185,129,0.08)' : task.status === 'in_progress' ? 'rgba(79,70,229,0.08)' : 'rgba(148,163,184,0.1)',
              color: task.status === 'done' ? '#10b981' : task.status === 'in_progress' ? '#4f46e5' : '#475569'
            }}>
              {task.status.toUpperCase()}
            </span>
          </div>
        </div>
        
        {task.subtasks && task.subtasks.map(sub => renderTreeTask(sub, depth + 1))}
      </div>
    )
  }

  // Render Calendar view days
  const renderCalendarDays = () => {
    if (!activeProject) return null
    const days = []
    
    // Get project bounds or current month bounds
    const baseDate = new Date()
    const year = baseDate.getFullYear()
    const month = baseDate.getMonth()
    
    // First day of month
    const firstDay = new Date(year, month, 1)
    const startOffset = firstDay.getDay()
    
    // Total days in month
    const totalDays = new Date(year, month + 1, 0).getDate()
    
    // Add empty cell offsets
    for (let i = 0; i < startOffset; i++) {
      days.push(<div key={`offset-${i}`} style={{ background: '#f8fafc', border: '1px solid rgba(0,0,0,0.03)' }}></div>)
    }

    for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
      const curDate = new Date(year, month, dayNum)
      curDate.setHours(0,0,0,0)
      
      // Filter tasks falling on this day
      const dayTasks = activeProject.tasks.filter(t => {
        if (!t.start_date || !t.due_date) return false
        const s = new Date(t.start_date)
        s.setHours(0,0,0,0)
        const d = new Date(t.due_date)
        d.setHours(23,59,59,999)
        return curDate >= s && curDate <= d
      })

      days.push(
        <div key={dayNum} style={{ minHeight: '90px', padding: '6px', background: '#ffffff', border: '1px solid rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>{dayNum}</span>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {dayTasks.map(t => (
              <div 
                key={t.id}
                onClick={() => handleOpenEditModal(t)}
                style={{ 
                  fontSize: '0.62rem', 
                  fontWeight: 600, 
                  padding: '2px 4px', 
                  borderRadius: '3px', 
                  background: t.status === 'done' ? 'rgba(16,185,129,0.1)' : t.status === 'in_progress' ? 'rgba(79,70,229,0.1)' : 'rgba(100,116,139,0.1)',
                  color: t.status === 'done' ? '#10b981' : t.status === 'in_progress' ? '#4f46e5' : '#475569',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                  opacity: filterMyTasks && !isTaskBelongingToRole(t, activeUser) ? 0.25 : 1,
                  transition: 'opacity 0.3s ease'
                }}
              >
                {t.title}
              </div>
            ))}
          </div>
        </div>
      )
    }
    return days
  }

  const parseBoldText = (text: string) => {
    const parts = text.split('**');
    return parts.map((part, index) => {
      if (index % 2 === 1) {
        return <strong key={index} style={{ fontWeight: 700, color: '#0f172a' }}>{part}</strong>;
      }
      return part;
    });
  };

  const renderMarkdown = (text: string) => {
    if (!text) return null;
    
    // Split text by markdown code block formatting
    const parts = text.split(/(```[\s\S]*?```)/g);
    
    return parts.map((part, index) => {
      if (part.startsWith('```')) {
        const lines = part.split('\n');
        const lang = lines[0].replace('```', '').trim() || 'code';
        const codeContent = lines.slice(1, -1).join('\n');
        
        return (
          <div key={index} style={{ 
            background: '#1e293b', 
            borderRadius: '6px', 
            margin: '10px 0', 
            overflow: 'hidden', 
            border: '1px solid rgba(255,255,255,0.1)',
            position: 'relative'
          }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              background: '#0f172a', 
              padding: '6px 12px', 
              fontSize: '0.68rem', 
              color: '#94a3b8', 
              fontWeight: 600,
              textTransform: 'uppercase',
              borderBottom: '1px solid rgba(255,255,255,0.05)'
            }}>
              <span>{lang}</span>
              <button 
                onClick={(e) => {
                  navigator.clipboard.writeText(codeContent);
                  const btn = e.currentTarget as HTMLButtonElement;
                  const oldText = btn.innerText;
                  btn.innerText = 'Copied!';
                  btn.style.color = '#10b981';
                  setTimeout(() => {
                    btn.innerText = oldText;
                    btn.style.color = '#94a3b8';
                  }, 2000);
                }}
                className="tactile-btn"
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: '#94a3b8', 
                  cursor: 'pointer', 
                  fontSize: '0.65rem', 
                  fontWeight: 700,
                  outline: 'none'
                }}
              >
                Copy
              </button>
            </div>
            <pre style={{ 
              margin: 0, 
              padding: '12px', 
              fontSize: '0.75rem', 
              color: '#f8fafc', 
              fontFamily: 'Consolas, Monaco, "Courier New", monospace', 
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}>
              <code>{codeContent}</code>
            </pre>
          </div>
        );
      } else {
        return part.split('\n').map((line, i) => {
          let trimmed = line.trim();
          if (trimmed.startsWith('### ')) {
            return <h4 key={`${index}-${i}`} style={{ margin: '12px 0 6px 0', fontSize: '0.85rem', fontWeight: 700, color: '#1e293b' }}>{trimmed.slice(4)}</h4>;
          }
          if (trimmed.startsWith('## ')) {
            return <h3 key={`${index}-${i}`} style={{ margin: '16px 0 8px 0', fontSize: '0.9rem', fontWeight: 700, color: '#0f172a', borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '4px' }}>{trimmed.slice(3)}</h3>;
          }
          if (trimmed.startsWith('# ')) {
            return <h2 key={`${index}-${i}`} style={{ margin: '20px 0 10px 0', fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>{trimmed.slice(2)}</h2>;
          }
          if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
            const bulletText = trimmed.slice(2);
            return (
              <li key={`${index}-${i}`} style={{ marginLeft: '16px', fontSize: '0.75rem', color: '#334155', marginBottom: '4px', lineHeight: '1.4' }}>
                {parseBoldText(bulletText)}
              </li>
            );
          }
          if (trimmed.match(/^\d+\.\s/)) {
            const numText = trimmed.replace(/^\d+\.\s/, '');
            return (
              <div key={`${index}-${i}`} style={{ display: 'flex', gap: '6px', marginLeft: '12px', fontSize: '0.75rem', color: '#334155', marginBottom: '6px', lineHeight: '1.4' }}>
                <span style={{ fontWeight: 700, color: '#4f46e5' }}>{trimmed.match(/^\d+/)![0]}.</span>
                <div>{parseBoldText(numText)}</div>
              </div>
            );
          }
          if (!trimmed) return <div key={`${index}-${i}`} style={{ height: '8px' }} />;
          return <p key={`${index}-${i}`} style={{ margin: '0 0 8px 0', fontSize: '0.75rem', color: '#334155', lineHeight: '1.5' }}>{parseBoldText(trimmed)}</p>;
        });
      }
    });
  };

  // Filter root tasks (no parent) for Tree View
  const rootTasks = activeProject?.tasks?.filter(t => t.parent_id === null) || []


  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: '100vh', background: '#f8fafc', color: '#0f172a' }}>
      
      {/* 1. Navigation Header */}
      <header style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        padding: '0 2rem', 
        height: '68px',
        background: '#ffffff', 
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        position: 'sticky',
        top: 0,
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ background: '#4f46e5', padding: '6px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Layers size={18} color="#ffffff" strokeWidth={2.5} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.05rem', margin: 0, fontWeight: 700, letterSpacing: '-0.3px', color: '#0f172a' }}>
              Antigravity Coordinator
            </h1>
            <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '-2px' }}>AI-Driven Project StateGraph</span>
          </div>
        </div>

        {/* User Role Switcher & System Statuses */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          {users.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <UserIcon size={14} color="#64748b" />
              <select 
                value={activeUser?.id || ''} 
                onChange={e => {
                  const u = users.find(usr => usr.id === parseInt(e.target.value))
                  if (u) setActiveUser(u)
                }}
                style={{
                  background: '#ffffff',
                  border: '1px solid rgba(0,0,0,0.08)',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: '#4f46e5',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.username} ({u.role.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>
          )}

          <button 
            onClick={loadData} 
            disabled={isRefreshing}
            className="tactile-btn"
            style={{ 
              background: '#ffffff', 
              border: '1px solid rgba(0,0,0,0.08)', 
              borderRadius: '6px',
              padding: '6px 12px',
              color: '#475569', 
              cursor: 'pointer', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px',
              fontSize: '0.8rem',
              fontWeight: 500,
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
            }}
          >
            <RefreshCw size={13} className={isRefreshing ? 'spin' : ''} style={{ transition: 'transform 0.5s' }} />
            <span>Sync</span>
          </button>

          {activeProject && (
            <button 
              onClick={async () => {
                try {
                  const res = await fetch(`/api/projects/${activeProject.id}/undo`, { method: 'POST' });
                  if (res.ok) {
                    alert("Reverted last change!");
                    loadData();
                  } else {
                    const err = await res.json();
                    alert(err.detail || "Nothing to undo.");
                  }
                } catch (e) {
                  console.error(e);
                }
              }}
              className="tactile-btn"
              style={{ 
                background: '#ffffff', 
                border: '1px solid rgba(239,68,68,0.15)', 
                borderRadius: '6px',
                padding: '6px 12px',
                color: '#ef4444', 
                cursor: 'pointer', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                boxShadow: '0 1px 2px rgba(239,68,68,0.05)'
              }}
            >
              <span>Undo Last Change</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Layout Grid */}
      <div style={{ display: 'flex', flex: 1, minHeight: 'calc(100vh - 68px)' }}>
        
        {/* 2. Left Sidebar (Projects & Controls) */}
        <aside style={{ width: '280px', background: '#f1f5f9', borderRight: '1px solid rgba(0,0,0,0.06)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.8rem' }}>
          
          {/* Create Project Form */}
          <div style={{ background: '#ffffff', padding: '1.2rem', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <h3 style={{ margin: '0 0 0.8rem 0', fontSize: '0.85rem', fontWeight: 700, color: '#4f46e5', display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '0.3px', textTransform: 'uppercase' }}>
              <Plus size={14} strokeWidth={2.5} /> Create Project
            </h3>
            <form onSubmit={handleCreateProject} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input 
                type="text" 
                placeholder="Project Name..." 
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                style={{ background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', color: '#0f172a', fontSize: '0.8rem', outline: 'none' }}
              />
              <textarea 
                placeholder="Project Description..." 
                value={newProjectDesc}
                onChange={e => setNewProjectDesc(e.target.value)}
                rows={3}
                style={{ background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', color: '#0f172a', fontSize: '0.8rem', resize: 'none', outline: 'none' }}
              />
              <button 
                type="submit" 
                className="tactile-btn"
                style={{ background: '#4f46e5', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', boxShadow: '0 2px 4px rgba(79, 70, 229, 0.15)' }}
              >
                Decompose with AI Agent
              </button>
            </form>
          </div>

          {/* Projects List */}
          <div>
            <h3 style={{ margin: '0 0 0.8rem 0', fontSize: '0.8rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.3px', textTransform: 'uppercase' }}>Projects</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '280px', overflowY: 'auto' }}>
              {projects.map(p => (
                <div 
                  key={p.id} 
                  onClick={() => setActiveProject(p)}
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    padding: '8px 10px', 
                    borderRadius: '6px', 
                    background: activeProject?.id === p.id ? 'rgba(79, 70, 229, 0.05)' : 'transparent',
                    border: activeProject?.id === p.id ? '1px solid rgba(79, 70, 229, 0.12)' : '1px solid transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  <div style={{ overflow: 'hidden', flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: activeProject?.id === p.id ? '#4f46e5' : '#1e293b', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                      {p.name}
                    </div>
                    <span style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'Geist Mono' }}>{p.tasks?.length || 0} tasks</span>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDeleteProject(p.id) }} 
                    style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '4px' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {projects.length === 0 && (
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>No projects created yet.</span>
              )}
            </div>
          </div>
        </aside>

        {/* 3. Central Working Area */}
        <main style={{ flex: 1, padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.8rem', overflowY: 'auto' }}>
          {activeProject ? (
            <>
              {/* Project Header Info */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.3px' }}>{activeProject.name}</h2>
                  <p style={{ margin: '4px 0 0 0', color: '#475569', fontSize: '0.85rem', maxWidth: '65ch' }}>{activeProject.description || "No project description."}</p>
                </div>
              </div>

              {/* View Switcher Controls */}
              <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid rgba(0,0,0,0.08)', paddingBottom: '12px', alignItems: 'center' }}>
                {(['kanban', 'tree', 'gantt', 'calendar', 'health', 'hr', 'agents'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className="tactile-btn"
                    style={{
                      padding: '6px 14px',
                      borderRadius: '6px',
                      border: '1px solid rgba(0,0,0,0.06)',
                      background: viewMode === mode ? '#4f46e5' : '#ffffff',
                      color: viewMode === mode ? '#ffffff' : '#475569',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
                    }}
                  >
                    {mode.toUpperCase()}
                  </button>
                ))}


                {activeUser && (
                  <button
                    onClick={() => setFilterMyTasks(!filterMyTasks)}
                    className="tactile-btn"
                    style={{
                      padding: '6px 14px',
                      borderRadius: '6px',
                      border: '1px solid rgba(0,0,0,0.06)',
                      background: filterMyTasks ? '#d97706' : '#ffffff',
                      color: filterMyTasks ? '#ffffff' : '#475569',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Filter size={14} />
                    {filterMyTasks ? `Focusing @${activeUser.username}'s Role` : "Filter My Tasks & Role"}
                  </button>
                )}
                
                {(activeUser?.role === 'pm' || activeUser?.role === 'admin') && (
                  <button
                    onClick={() => handleOpenCreateModal()}
                    className="tactile-btn"
                    style={{
                      marginLeft: 'auto',
                      padding: '6px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      background: '#10b981',
                      color: '#ffffff',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      boxShadow: '0 2px 4px rgba(16,185,129,0.1)'
                    }}
                  >
                    <Plus size={14} /> Add Task
                  </button>
                )}
              </div>

              {/* View Rendering Logic */}
              {viewMode === 'kanban' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', flex: 1, minHeight: '450px' }}>
                  {(['todo', 'in_progress', 'qa_review', 'done'] as const).map(status => {
                    const statusColors = {
                      todo: { bg: 'rgba(148,163,184,0.02)', border: 'rgba(148,163,184,0.08)', dot: '#94a3b8', title: 'TODO' },
                      in_progress: { bg: 'rgba(79, 70, 229, 0.02)', border: 'rgba(79, 70, 229, 0.08)', dot: '#4f46e5', title: 'IN PROGRESS' },
                      qa_review: { bg: 'rgba(234,179,8,0.02)', border: 'rgba(234,179,8,0.08)', dot: '#eab308', title: 'QA REVIEW' },
                      done: { bg: 'rgba(16,185,129,0.02)', border: 'rgba(16,185,129,0.08)', dot: '#10b981', title: 'DONE' }
                    }
                    const config = statusColors[status]
                    const colTasks = getTasksByStatus(status)

                    return (
                      <div 
                        key={status} 
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, status)}
                        style={{ background: config.bg, border: `1px solid ${config.border}`, borderRadius: '8px', padding: '1rem 0.8rem', display: 'flex', flexDirection: 'column', gap: '12px' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,0.04)', paddingBottom: '8px', margin: '0 4px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: config.dot }}></span>
                            <span style={{ fontWeight: 700, fontSize: '0.75rem', color: '#475569', letterSpacing: '0.5px' }}>{config.title}</span>
                          </div>
                          <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(0,0,0,0.03)', color: '#64748b', fontFamily: 'Geist Mono' }}>
                            {colTasks.length}
                          </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflowY: 'auto' }}>
                          {colTasks.map(t => (
                            <div 
                              key={t.id}
                              draggable={true}
                              onDragStart={(e) => handleDragStart(e, t.id)}
                              className="glass-panel interactive-card"
                              style={{ 
                                borderRadius: '8px', 
                                padding: '8px 12px 12px 12px', 
                                opacity: filterMyTasks && !isTaskBelongingToRole(t, activeUser) ? 0.25 : 1, 
                                transition: 'opacity 0.3s ease',
                                position: 'relative'
                              }}
                            >
                              {/* Drag Handle (Black Outline & Move Cursor) */}
                              <div 
                                style={{
                                  height: '18px',
                                  border: '1.5px solid #000000',
                                  borderRadius: '4px',
                                  background: '#ffffff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '0.58rem',
                                  fontWeight: 800,
                                  color: '#000000',
                                  cursor: 'move',
                                  marginBottom: '6px',
                                  userSelect: 'none',
                                  letterSpacing: '0.5px'
                                }}
                                onMouseEnter={e => {
                                  e.currentTarget.style.background = '#000000';
                                  e.currentTarget.style.color = '#ffffff';
                                }}
                                onMouseLeave={e => {
                                  e.currentTarget.style.background = '#ffffff';
                                  e.currentTarget.style.color = '#000000';
                                }}
                              >
                                ✥ MOVE TASK
                              </div>

                              {/* Clickable inner content */}
                              <div 
                                onClick={() => handleOpenEditModal(t)}
                                style={{ cursor: 'pointer' }}
                              >
                                <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                                  <span style={{ fontSize: '0.55rem', fontWeight: 700, padding: '1px 4px', borderRadius: '3px', background: 'rgba(79,70,229,0.1)', color: '#4f46e5', textTransform: 'uppercase' }}>
                                    {t.task_type}
                                  </span>
                                  <span style={{ fontSize: '0.55rem', fontWeight: 700, padding: '1px 4px', borderRadius: '3px', background: 'rgba(100,116,139,0.1)', color: '#475569', textTransform: 'uppercase' }}>
                                    {t.phase}
                                  </span>
                                </div>
                                <h4 style={{ margin: '0 0 6px 0', fontSize: '0.8rem', fontWeight: 600, color: '#0f172a', lineHeight: '1.3' }}>{t.title}</h4>
                                <p style={{ margin: 0, fontSize: '0.75rem', color: '#475569', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '1.4' }}>
                                  {t.description || "No detailed description."}
                                </p>
                                
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                                  <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontFamily: 'Geist Mono' }}>ID: #{t.id}</span>
                                  {t.assigned_to && (
                                    <span style={{ fontSize: '0.65rem', color: '#4f46e5', fontWeight: 600 }}>@{t.assigned_to.username}</span>
                                  )}
                                  {t.due_date && (
                                    <span style={{ fontSize: '0.65rem', color: '#991b1b', background: '#fef2f2', padding: '1px 4px', borderRadius: '3px', fontWeight: 500 }}>
                                      Due: {new Date(t.due_date).toLocaleDateString()}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Blocked Tasks Panel */}
                <div style={{ 
                  marginTop: '1.5rem', 
                  background: 'rgba(239, 68, 68, 0.02)', 
                  border: '1px solid rgba(239, 68, 68, 0.08)', 
                  borderRadius: '8px', 
                  padding: '1.2rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.8rem'
                }}>
                  <h3 style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, color: '#ef4444', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    <span className="pulse-glow" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }}></span>
                    Blocked Tasks ({getTasksByStatus('blocked').length})
                  </h3>
                  
                  <div 
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, 'blocked')}
                    style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'repeat(4, 1fr)', 
                      gap: '1rem', 
                      maxHeight: '290px', 
                      overflowY: 'auto',
                      padding: '4px'
                    }}
                  >
                    {getTasksByStatus('blocked').length > 0 ? (
                      getTasksByStatus('blocked').map(t => (
                        <div 
                          key={t.id}
                          draggable={true}
                          onDragStart={(e) => handleDragStart(e, t.id)}
                          className="glass-panel interactive-card"
                          style={{ 
                            borderRadius: '8px', 
                            padding: '8px 12px 12px 12px', 
                            border: '1px solid rgba(239, 68, 68, 0.15)',
                            background: '#fff8f8',
                            opacity: filterMyTasks && !isTaskBelongingToRole(t, activeUser) ? 0.25 : 1, 
                            transition: 'opacity 0.3s ease',
                            position: 'relative'
                          }}
                        >
                          {/* Drag Handle */}
                          <div 
                            style={{
                              height: '18px',
                              border: '1.5px solid #ef4444',
                              borderRadius: '4px',
                              background: '#ffffff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '0.58rem',
                              fontWeight: 800,
                              color: '#ef4444',
                              cursor: 'move',
                              marginBottom: '6px',
                              userSelect: 'none',
                              letterSpacing: '0.5px'
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = '#ef4444';
                              e.currentTarget.style.color = '#ffffff';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = '#ffffff';
                              e.currentTarget.style.color = '#ef4444';
                            }}
                          >
                            ✥ MOVE BLOCKED TASK
                          </div>

                          {/* Clickable inner content */}
                          <div 
                            onClick={() => handleOpenEditModal(t)}
                            style={{ cursor: 'pointer' }}
                          >
                            <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                              <span style={{ fontSize: '0.55rem', fontWeight: 700, padding: '1px 4px', borderRadius: '3px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', textTransform: 'uppercase' }}>
                                {t.task_type}
                              </span>
                              <span style={{ fontSize: '0.55rem', fontWeight: 700, padding: '1px 4px', borderRadius: '3px', background: 'rgba(100,116,139,0.1)', color: '#475569', textTransform: 'uppercase' }}>
                                {t.phase}
                              </span>
                            </div>
                            <h4 style={{ margin: '0 0 6px 0', fontSize: '0.8rem', fontWeight: 600, color: '#991b1b', lineHeight: '1.3' }}>{t.title}</h4>
                            <p style={{ margin: 0, fontSize: '0.75rem', color: '#7f1d1d', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '1.4' }}>
                              {t.description || "No detailed description."}
                            </p>
                            
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(239,68,68,0.08)' }}>
                              <span style={{ fontSize: '0.65rem', color: '#ef4444', fontFamily: 'Geist Mono', fontWeight: 600 }}>ID: #{t.id}</span>
                              {t.assigned_to && (
                                <span style={{ fontSize: '0.65rem', color: '#b91c1c', fontWeight: 600 }}>@{t.assigned_to.username}</span>
                              )}
                              {t.due_date && (
                                <span style={{ fontSize: '0.65rem', color: '#991b1b', background: '#fee2e2', padding: '1px 4px', borderRadius: '3px', fontWeight: 500 }}>
                                  Due: {new Date(t.due_date).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div style={{ gridColumn: 'span 4', textAlign: 'center', color: '#94a3b8', fontSize: '0.75rem', padding: '1.5rem 0', background: '#ffffff', borderRadius: '8px', border: '1px dashed rgba(0,0,0,0.06)' }}>
                        No blocked tasks. Drag a task here to block it.
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

              {viewMode === 'tree' && (
                <div style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '8px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 700 }}>Task Hierarchy</h3>
                  {rootTasks.length > 0 ? (
                    rootTasks.map(t => renderTreeTask(t, 0))
                  ) : (
                    <div style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem 0' }}>No root tasks found.</div>
                  )}
                </div>
              )}

              {viewMode === 'gantt' && (() => {
                const bounds = getProjectTimelineBounds()
                
                return (
                  <div style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '8px', padding: '1.5rem', overflowX: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                    <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 700 }}>Project Gantt Chart</h3>
                    <div style={{ minWidth: '700px' }}>
                      {/* Timeline Header Bounds */}
                      <div style={{ display: 'flex', borderBottom: '2px solid rgba(0,0,0,0.06)', paddingBottom: '8px', marginBottom: '8px', fontWeight: 700, fontSize: '0.72rem', color: '#64748b' }}>
                        <div style={{ width: '220px' }}>TASK NAME</div>
                        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', padding: '0 10px' }}>
                          <span>{bounds.start.toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</span>
                          <span>Timeline Duration</span>
                          <span>{bounds.end.toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</span>
                        </div>
                      </div>
                      
                      {activeProject.tasks.map(t => {
                        const { left, width } = getGanttCoordinates(t, bounds)
                        
                        const typeColors = {
                          epic: '#f43f5e',
                          feature: '#3b82f6',
                          task: '#4f46e5',
                          subtask: '#0d9488'
                        }
                        const barColor = typeColors[t.task_type] || '#64748b'

                        return (
                          <div 
                            key={t.id}
                            onClick={() => handleOpenEditModal(t)}
                            style={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              height: '42px', 
                              borderBottom: '1px solid rgba(0,0,0,0.04)', 
                              cursor: 'pointer', 
                              opacity: filterMyTasks && !isTaskBelongingToRole(t, activeUser) ? 0.25 : 1, 
                              transition: 'opacity 0.3s ease' 
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <div style={{ width: '220px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: barColor }}></span>
                              {t.title}
                            </div>
                            <div style={{ flex: 1, position: 'relative', height: '18px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                              {t.start_date && t.due_date && (
                                <div style={{ 
                                  position: 'absolute', 
                                  left: `${left}%`, 
                                  width: `${width}%`, 
                                  height: '100%', 
                                  background: barColor, 
                                  borderRadius: '3px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  paddingLeft: '8px',
                                  color: '#ffffff',
                                  fontSize: '0.6rem',
                                  fontWeight: 700,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden'
                                }}>
                                  {t.status.toUpperCase()} ({t.estimated_hours || 0}h)
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {viewMode === 'calendar' && (
                <div style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '8px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 700 }}>Project Calendar</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', overflow: 'hidden' }}>
                    {/* Header days */}
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                      <div key={d} style={{ padding: '8px 0', textAlign: 'center', fontWeight: 700, fontSize: '0.75rem', background: '#f1f5f9', borderBottom: '1px solid rgba(0,0,0,0.08)', color: '#475569' }}>
                        {d}
                      </div>
                    ))}
                    {/* Calendar cells */}
                    {renderCalendarDays()}
                  </div>
                </div>
              )}

              {viewMode === 'agents' && (
                <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '2rem', flex: 1 }}>
                  {/* Left Column: Agents list */}
                  <div style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '10px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '1rem', height: 'fit-content' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a', borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px' }}>
                      🤖 System Sub-Agents ({agents.length})
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {agents.map(a => (
                        <div 
                          key={a.key}
                          onClick={() => {
                            setSelectedAgent(a);
                          }}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            padding: '12px',
                            borderRadius: '8px',
                            background: selectedAgent?.key === a.key ? 'rgba(79, 70, 229, 0.04)' : '#f8fafc',
                            border: selectedAgent?.key === a.key ? '1px solid #4f46e5' : '1px solid rgba(0,0,0,0.04)',
                            cursor: 'pointer',
                            transition: 'all 0.15s'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a' }}>{a.name}</span>
                            <span style={{ fontSize: '0.6rem', padding: '2px 5px', borderRadius: '4px', background: a.key === 'supervisor' ? '#e0e7ff' : '#f1f5f9', color: a.key === 'supervisor' ? '#4338ca' : '#475569', fontWeight: 700, textTransform: 'uppercase' }}>
                              {a.key}
                            </span>
                          </div>
                          <span style={{ fontSize: '0.7rem', color: '#64748b', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '1.3' }}>
                            {a.description}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right Column: Prompt & Config Editor */}
                  {selectedAgent ? (
                    <div style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '10px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                      <div style={{ borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
                          ✏️ Configure Agent: {selectedAgent.name}
                        </h3>
                        <span style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: 'Geist Mono' }}>key: {selectedAgent.key}</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569' }}>DESCRIPTION (Used by Supervisor for auto-routing)</label>
                        <input 
                          type="text"
                          value={agentDescription}
                          onChange={e => setAgentDescription(e.target.value)}
                          style={{ width: '100%', background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', outline: 'none' }}
                        />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569' }}>SYSTEM PROMPT / BEHAVIOR INSTRUCTIONS</label>
                        <textarea 
                          value={agentPrompt}
                          onChange={e => setAgentPrompt(e.target.value)}
                          rows={12}
                          style={{ width: '100%', background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '10px', fontSize: '0.8rem', outline: 'none', fontFamily: 'Geist Mono', resize: 'vertical', minHeight: '220px' }}
                        />
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '12px' }}>
                        <button 
                          onClick={async () => {
                            setIsSavingAgent(true);
                            try {
                              const res = await fetch(`/api/agents/${selectedAgent.key}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ description: agentDescription, system_prompt: agentPrompt })
                              });
                              if (res.ok) {
                                const updated = await res.json();
                                setAgents(prev => prev.map(a => a.key === updated.key ? updated : a));
                                setSelectedAgent(updated);
                                alert("Agent configuration saved successfully!");
                              } else {
                                alert("Failed to save agent configuration.");
                              }
                            } catch (err) {
                              console.error(err);
                            } finally {
                              setIsSavingAgent(false);
                            }
                          }}
                          disabled={isSavingAgent}
                          style={{ background: '#4f46e5', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '8px 20px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', opacity: isSavingAgent ? 0.7 : 1 }}
                        >
                          {isSavingAgent ? "Saving..." : "Save Agent Configuration"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#ffffff', border: '1px dashed rgba(0,0,0,0.08)', borderRadius: '10px', color: '#94a3b8', fontSize: '0.85rem' }}>
                      Select an agent from the left column to view or edit prompt.
                    </div>
                  )}
                </div>
              )}


              {viewMode === 'health' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {isHealthLoading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px', flexDirection: 'column', gap: '10px' }}>
                      <RefreshCw className="animate-spin" size={24} color="#4f46e5" />
                      <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Analyzing project health with AI...</span>
                    </div>
                  ) : healthData ? (
                    <>
                      {/* Metric cards grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                        
                        {/* Overall health score */}
                        <div style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '10px', padding: '1.2rem', display: 'flex', alignItems: 'center', gap: '15px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                          <div style={{ 
                            width: '54px', 
                            height: '54px', 
                            borderRadius: '50%', 
                            border: `4px solid ${healthData.health_score >= 80 ? '#10b981' : healthData.health_score >= 50 ? '#eab308' : '#ef4444'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.95rem',
                            fontWeight: 800,
                            color: healthData.health_score >= 80 ? '#10b981' : healthData.health_score >= 50 ? '#eab308' : '#ef4444'
                          }}>
                            {healthData.health_score}%
                          </div>
                          <div>
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>PROJECT HEALTH</div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                              {healthData.health_score >= 80 ? 'Excellent' : healthData.health_score >= 50 ? 'Warning' : 'Critical'}
                            </div>
                          </div>
                        </div>

                        {/* Overdue tasks */}
                        <div style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '10px', padding: '1.2rem', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                          <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
                            <Clock size={20} />
                          </div>
                          <div>
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>OVERDUE TASKS</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: healthData.overdue_tasks > 0 ? '#ef4444' : '#0f172a', marginTop: '2px' }}>{healthData.overdue_tasks} tasks</div>
                          </div>
                        </div>

                        {/* Blocked tasks */}
                        <div style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '10px', padding: '1.2rem', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                          <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d97706' }}>
                            <AlertCircle size={20} />
                          </div>
                          <div>
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>BLOCKED TASKS</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: healthData.blocked_tasks > 0 ? '#d97706' : '#0f172a', marginTop: '2px' }}>{healthData.blocked_tasks} tasks</div>
                          </div>
                        </div>

                        {/* Bottleneck developers */}
                        <div style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '10px', padding: '1.2rem', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                          <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a' }}>
                            <UserIcon size={20} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>BOTTLENECKS</div>
                            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', marginTop: '2px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                              {healthData.bottlenecks.length > 0 ? healthData.bottlenecks.map(b => `@${b}`).join(', ') : 'None'}
                            </div>
                          </div>
                        </div>

                      </div>

                      {/* AI health assessment detail */}
                      <div style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '10px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px', marginBottom: '5px' }}>
                          <Brain size={18} color="#4f46e5" />
                          <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>AI Coordinator Health Assessment</h3>
                          <button 
                            onClick={loadHealthData} 
                            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 600 }}
                          >
                            <RefreshCw size={12} /> Refresh
                          </button>
                        </div>
                        <div style={{ maxHeight: '500px', overflowY: 'auto', paddingRight: '8px' }}>
                          {renderMarkdown(healthData.ai_assessment)}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '200px', color: '#94a3b8' }}>
                      No health data. Please select a project.
                    </div>
                  )}
                </div>
              ) }

              {viewMode === 'hr' && (
                <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: '2rem', flex: 1 }}>
                  
                  {/* Left Column: Users List */}
                  <div style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '10px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '1rem', height: 'fit-content' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a', borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px' }}>
                      👥 Team Members ({users.length})
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '500px', overflowY: 'auto', paddingRight: '4px' }}>
                      {users.map(u => (
                        <div key={u.id} style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: '6px', 
                          padding: '12px', 
                          borderRadius: '8px', 
                          background: editingHRUser?.id === u.id ? 'rgba(79, 70, 229, 0.04)' : '#f8fafc',
                          border: editingHRUser?.id === u.id ? '1px solid #4f46e5' : '1px solid rgba(0,0,0,0.04)',
                          transition: 'all 0.15s'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a' }}>@{u.username}</span>
                            <span style={{ 
                              fontSize: '0.62rem', 
                              fontWeight: 700, 
                              padding: '2px 6px', 
                              borderRadius: '4px', 
                              background: u.role === 'admin' ? '#fee2e2' : u.role === 'pm' ? '#e0e7ff' : u.role === 'qa' ? '#fef3c7' : '#ecfdf5',
                              color: u.role === 'admin' ? '#991b1b' : u.role === 'pm' ? '#4338ca' : u.role === 'qa' ? '#b45309' : '#047857',
                              textTransform: 'uppercase'
                            }}>
                              {u.role}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                            <strong>Skills:</strong> {u.skills || "None specified"}
                          </div>
                          
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px', borderTop: '1px solid rgba(0,0,0,0.03)', paddingTop: '6px' }}>
                            <button 
                              onClick={() => handleStartEditHRUser(u)}
                              style={{ background: 'none', border: 'none', color: '#4f46e5', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', padding: '2px 6px' }}
                            >
                              Edit
                            </button>
                            <button 
                              onClick={() => handleDeleteHRUser(u.id)}
                              disabled={u.username === 'pm_alice' || activeUser?.id === u.id}
                              style={{ 
                                background: 'none', 
                                border: 'none', 
                                color: (u.username === 'pm_alice' || activeUser?.id === u.id) ? '#cbd5e1' : '#ef4444', 
                                fontSize: '0.72rem', 
                                fontWeight: 600, 
                                cursor: (u.username === 'pm_alice' || activeUser?.id === u.id) ? 'not-allowed' : 'pointer', 
                                padding: '2px 6px' 
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right Column: Add/Edit User Form */}
                  <div style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '10px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '1.2rem', height: 'fit-content' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a', borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: '10px' }}>
                      {editingHRUser ? `✏️ Edit User: @${editingHRUser.username}` : "➕ Add New Team Member"}
                    </h3>
                    
                    <form onSubmit={handleSaveHRUser} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569' }}>USERNAME</label>
                        <input 
                          type="text" 
                          placeholder="e.g. dev_sarah" 
                          value={hrUsername}
                          onChange={e => setHRUsername(e.target.value)}
                          required
                          style={{ width: '100%', background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', outline: 'none' }}
                        />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569' }}>ROLE</label>
                        <select 
                          value={hrRole}
                          onChange={e => setHRRole(e.target.value as any)}
                          style={{ width: '100%', background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', outline: 'none' }}
                        >
                          <option value="developer">Developer</option>
                          <option value="qa">QA / Tester</option>
                          <option value="pm">Project Manager (PM)</option>
                          <option value="admin">Administrator</option>
                        </select>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569' }}>SKILLS & TECH STACK</label>
                        <input 
                          type="text" 
                          placeholder="e.g. React, TypeScript, Python, SQL" 
                          value={hrSkills}
                          onChange={e => setHRSkills(e.target.value)}
                          style={{ width: '100%', background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', outline: 'none' }}
                        />
                        <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Enter skills separated by commas. These will be analyzed by the AI Coordinator for auto-allocation.</span>
                      </div>

                      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '12px', marginTop: '4px' }}>
                        {editingHRUser && (
                          <button 
                            type="button"
                            onClick={() => {
                              setEditingHRUser(null);
                              setHRUsername('');
                              setHRRole('developer');
                              setHRSkills('');
                            }}
                            style={{ background: '#f1f5f9', color: '#475569', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '6px', padding: '8px 16px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                          >
                            Cancel
                          </button>
                        )}
                        <button 
                          type="submit" 
                          disabled={isHRSaving}
                          style={{ background: '#4f46e5', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '8px 20px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', opacity: isHRSaving ? 0.7 : 1 }}
                        >
                          {isHRSaving ? "Saving..." : editingHRUser ? "Update Member" : "Add Member"}
                        </button>
                      </div>
                    </form>
                  </div>

                </div>
              )}


            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#94a3b8' }}>
              <Layers size={40} strokeWidth={1.5} style={{ marginBottom: '0.8rem' }} />
              <h3 style={{ fontSize: '0.95rem', fontWeight: 500 }}>Select or create a project to start</h3>
            </div>
          )}
        </main>

        {/* 4. Right Sidebar (Chat Agent & Active Warnings) */}
        <aside style={{ width: '340px', background: '#f1f5f9', borderLeft: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
          
          {/* Notifications / Alerts Panel */}
          <div style={{ padding: '1.2rem', borderBottom: '1px solid rgba(0,0,0,0.06)', maxHeight: '220px', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 0.8rem 0', fontSize: '0.75rem', fontWeight: 700, color: '#ef4444', display: 'flex', alignItems: 'center', gap: '6px', letterSpacing: '0.3px', textTransform: 'uppercase' }}>
              <Bell size={13} /> Delay Warnings & Rollup
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {notifications.filter(n => !n.is_read).map(n => (
                <div 
                  key={n.id}
                  style={{ 
                    display: 'flex', 
                    alignItems: 'flex-start', 
                    gap: '8px', 
                    background: '#fef2f2', 
                    border: '1px solid rgba(239,68,68,0.12)', 
                    padding: '8px 10px', 
                    borderRadius: '6px' 
                  }}
                >
                  <AlertCircle size={14} color="#ef4444" style={{ marginTop: '2px', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.75rem', color: '#991b1b', lineHeight: '1.3', fontWeight: 500 }}>{n.message}</div>
                    <button 
                      onClick={() => handleReadNotification(n.id)}
                      className="tactile-btn"
                      style={{ marginTop: '6px', background: 'none', border: 'none', color: '#ef4444', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                    >
                      Mark as read
                    </button>
                  </div>
                </div>
              ))}
              {notifications.filter(n => !n.is_read).length === 0 && (
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>All tasks are on schedule.</span>
              )}
            </div>
          </div>

          {/* AI Project Manager Chat Panel */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1.2rem' }}>
            <h3 style={{ margin: '0 0 0.8rem 0', fontSize: '0.75rem', fontWeight: 700, color: '#4f46e5', display: 'flex', alignItems: 'center', gap: '6px', letterSpacing: '0.3px', textTransform: 'uppercase' }}>
              <Brain size={13} /> AI Coordinator
            </h3>
            
             {/* Active Routing Selector */}
             <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '6px', padding: '6px 8px' }}>
               <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Routing:</span>
               <select
                 value={chatForcedAgent}
                 onChange={e => setChatForcedAgent(e.target.value)}
                 style={{
                   flex: 1,
                   background: 'none',
                   border: 'none',
                   fontSize: '0.72rem',
                   fontWeight: 600,
                   color: '#4f46e5',
                   outline: 'none',
                   cursor: 'pointer'
                 }}
               >
                 <option value="supervisor">🤖 Auto-route (Supervisor)</option>
                 <option value="decomposer">Project Decomposer</option>
                 <option value="allocator">Task Allocator</option>
                 <option value="delay_shifter">Delay Shifter</option>
                 <option value="health_analyst">Health Analyst</option>
                 <option value="general_chat">General Chat</option>
               </select>
             </div>

             {/* Messages box */}
             <div style={{ 
               flex: 1, 
               background: '#ffffff', 
               border: '1px solid rgba(0,0,0,0.06)', 
               borderRadius: '6px', 
               padding: '10px', 
               display: 'flex', 
               flexDirection: 'column', 
               gap: '10px', 
               overflowY: 'auto', 
               marginBottom: '10px', 
               maxHeight: '320px' 
             }}>
               {chatHistory.map((chat, idx) => (
                 <div 
                   key={idx} 
                   style={{ 
                     alignSelf: chat.sender === 'user' ? 'flex-end' : 'flex-start',
                     background: chat.sender === 'user' ? '#4f46e5' : '#f8fafc',
                     color: chat.sender === 'user' ? '#ffffff' : '#0f172a',
                     border: chat.sender === 'user' ? 'none' : '1px solid rgba(0,0,0,0.05)',
                     fontWeight: chat.sender === 'user' ? 500 : 400,
                     padding: '8px 10px',
                     borderRadius: '6px',
                     maxWidth: '85%',
                     fontSize: '0.78rem',
                     lineHeight: '1.4'
                   }}
                 >
                   {chat.sender === 'agent' && chat.agentName && (
                     <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#4f46e5', textTransform: 'uppercase', marginBottom: '4px', borderBottom: '1px solid rgba(0,0,0,0.03)', paddingBottom: '2px' }}>
                       ⚙️ Sub-Agent: {chat.agentName}
                     </div>
                   )}
                   {chat.sender === 'agent' ? (
                     <div style={{ overflowX: 'auto' }}>{renderMarkdown(chat.text)}</div>
                   ) : (
                     chat.text
                   )}
                 </div>
               ))}

              {isChatLoading && (
                <div style={{ alignSelf: 'flex-start', color: '#64748b', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Brain size={12} className="pulse-glow" /> AI thinking...
                </div>
              )}
            </div>

            {/* Quick Agent Actions */}
            {activeProject && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                <button 
                  onClick={() => handleSendChat(undefined, "Please assign the most suitable tasks to developers based on skills")} 
                  className="tactile-btn"
                  style={{ fontSize: '0.68rem', padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(79,70,229,0.15)', background: '#ffffff', color: '#4f46e5', cursor: 'pointer', fontWeight: 600 }}
                >
                  ✨ Auto Allocate
                </button>
                <button 
                  onClick={() => handleSendChat(undefined, `Warning: Task ${activeProject.tasks[0]?.id || 1} is delayed by 2 days`)}
                  className="tactile-btn"
                  style={{ fontSize: '0.68rem', padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(239,68,68,0.15)', background: '#ffffff', color: '#ef4444', cursor: 'pointer', fontWeight: 600 }}
                >
                  ⚠️ Report Delay
                </button>
              </div>
            )}

            {/* Input field */}
            <form onSubmit={handleSendChat} style={{ display: 'flex', gap: '6px' }}>
              <input 
                type="text" 
                placeholder="e.g. assign task 2 to dev..." 
                value={chatMessage}
                onChange={e => setChatMessage(e.target.value)}
                disabled={!activeProject || isChatLoading}
                style={{ flex: 1, background: '#ffffff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', color: '#0f172a', fontSize: '0.8rem', outline: 'none' }}
              />
              <button 
                type="submit" 
                className="tactile-btn"
                disabled={!activeProject || isChatLoading}
                style={{ background: '#4f46e5', color: '#ffffff', border: 'none', borderRadius: '6px', width: '34px', height: '34px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 4px rgba(79, 70, 229, 0.15)' }}
              >
                <Send size={13} strokeWidth={2.5} />
              </button>
            </form>
          </div>

        </aside>

      </div>

      {/* 5. Create / Edit Task Modal */}
      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ 
            background: '#ffffff', 
            borderRadius: '12px', 
            width: modalMode === 'edit' ? '850px' : '500px', 
            maxWidth: '100%', 
            padding: '1.8rem', 
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', 
            display: 'flex', 
            flexDirection: 'row', 
            gap: '1.5rem' 
          }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
                {modalMode === 'create' ? 'Create New Task' : 'Update Task'}
              </h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}>
                
                <div>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>TASK TITLE</label>
                  <input 
                    type="text" 
                    value={editingTask.title || ''} 
                    disabled={modalMode === 'edit' && activeUser?.role !== 'pm' && activeUser?.role !== 'admin'}
                    onChange={e => setEditingTask({...editingTask, title: e.target.value})}
                    style={{ width: '100%', background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', outline: 'none' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>DESCRIPTION</label>
                  <textarea 
                    value={editingTask.description || ''} 
                    disabled={modalMode === 'edit' && activeUser?.role !== 'pm' && activeUser?.role !== 'admin'}
                    onChange={e => setEditingTask({...editingTask, description: e.target.value})}
                    rows={2}
                    style={{ width: '100%', background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', resize: 'none', outline: 'none' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>STATUS</label>
                    <select 
                      value={editingTask.status || 'todo'} 
                      disabled={modalMode === 'edit' && activeUser?.role === 'developer' && activeProject?.tasks.find(t => t.id === editingTask.id)?.status === 'done'}
                      onChange={e => setEditingTask({...editingTask, status: e.target.value as any})}
                      style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', outline: 'none' }}
                    >
                      <option value="todo">TODO</option>
                      <option value="in_progress">IN PROGRESS</option>
                      <option value="qa_review">QA Review</option>
                      <option value="done" disabled={activeUser?.role === 'developer'} style={{ opacity: activeUser?.role === 'developer' ? 0.35 : 1 }}>
                        DONE {activeUser?.role === 'developer' ? "(PM/QA ONLY)" : ""}
                      </option>
                      <option value="blocked">BLOCKED</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>TYPE</label>
                    <select 
                      value={editingTask.task_type || 'task'} 
                      disabled={modalMode === 'edit' && activeUser?.role !== 'pm' && activeUser?.role !== 'admin'}
                      onChange={e => setEditingTask({...editingTask, task_type: e.target.value as any})}
                      style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', outline: 'none' }}
                    >
                      <option value="epic">Epic</option>
                      <option value="feature">Feature</option>
                      <option value="task">Task</option>
                      <option value="subtask">Subtask</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>PHASE</label>
                    <select 
                      value={editingTask.phase || 'development'} 
                      disabled={modalMode === 'edit' && activeUser?.role !== 'pm' && activeUser?.role !== 'admin'}
                      onChange={e => setEditingTask({...editingTask, phase: e.target.value as any})}
                      style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', outline: 'none' }}
                    >
                      <option value="planning">Planning</option>
                      <option value="design">Design</option>
                      <option value="development">Development</option>
                      <option value="testing">Testing</option>
                      <option value="deployment">Deployment</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>ASSIGNEE</label>
                    <select 
                      value={editingTask.assigned_to_id || ''} 
                      disabled={modalMode === 'edit' && activeUser?.role !== 'pm' && activeUser?.role !== 'admin'}
                      onChange={e => setEditingTask({...editingTask, assigned_to_id: e.target.value ? parseInt(e.target.value) : null})}
                      style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', outline: 'none' }}
                    >
                      <option value="">Unassigned</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>@{u.username} ({u.role.toUpperCase()})</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>START DATE</label>
                    <input 
                      type="datetime-local" 
                      value={editingTask.start_date || ''} 
                      disabled={modalMode === 'edit' && activeUser?.role !== 'pm' && activeUser?.role !== 'admin'}
                      onChange={e => setEditingTask({...editingTask, start_date: e.target.value})}
                      style={{ width: '100%', background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', outline: 'none' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>DUE DATE</label>
                    <input 
                      type="datetime-local" 
                      value={editingTask.due_date || ''} 
                      disabled={modalMode === 'edit' && activeUser?.role !== 'pm' && activeUser?.role !== 'admin'}
                      onChange={e => setEditingTask({...editingTask, due_date: e.target.value})}
                      style={{ width: '100%', background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', outline: 'none' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>ESTIMATED HOURS</label>
                    <input 
                      type="number" 
                      value={editingTask.estimated_hours || 0} 
                      disabled={modalMode === 'edit' && activeUser?.role !== 'pm' && activeUser?.role !== 'admin'}
                      onChange={e => setEditingTask({...editingTask, estimated_hours: parseFloat(e.target.value) || 0})}
                      style={{ width: '100%', background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', outline: 'none' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>ACTUAL HOURS</label>
                    <input 
                      type="number" 
                      value={editingTask.actual_hours || 0} 
                      onChange={e => setEditingTask({...editingTask, actual_hours: parseFloat(e.target.value) || 0})}
                      style={{ width: '100%', background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', outline: 'none' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>PARENT TASK ID</label>
                    <select 
                      value={editingTask.parent_id || ''} 
                      disabled={modalMode === 'edit' && activeUser?.role !== 'pm' && activeUser?.role !== 'admin'}
                      onChange={e => setEditingTask({...editingTask, parent_id: e.target.value ? parseInt(e.target.value) : null})}
                      style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', outline: 'none' }}
                    >
                      <option value="">None</option>
                      {activeProject?.tasks?.filter(t => t.id !== editingTask.id).map(t => (
                        <option key={t.id} value={t.id}>#{t.id} - {t.title}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '4px' }}>DEPENDS ON TASK ID</label>
                    <input 
                      type="text" 
                      placeholder="e.g. [1, 2]"
                      value={editingTask.dependencies || '[]'} 
                      disabled={modalMode === 'edit' && activeUser?.role !== 'pm' && activeUser?.role !== 'admin'}
                      onChange={e => setEditingTask({...editingTask, dependencies: e.target.value})}
                      style={{ width: '100%', background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', outline: 'none' }}
                    />
                  </div>
                </div>

              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                {modalMode === 'edit' && (activeUser?.role === 'pm' || activeUser?.role === 'admin') && (
                  <button 
                    onClick={() => handleDeleteTask(editingTask.id!)}
                    style={{ background: '#ef4444', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Delete Task
                  </button>
                )}
                <button 
                  onClick={() => setIsModalOpen(false)}
                  style={{ marginLeft: 'auto', background: '#f1f5f9', color: '#475569', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '6px', padding: '8px 16px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSaveTask}
                  style={{ background: '#4f46e5', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 4px rgba(79, 70, 229, 0.15)' }}
                >
                  Save
                </button>
              </div>
            </div>

            {modalMode === 'edit' && (
              <div style={{ width: '320px', borderLeft: '1px solid rgba(0,0,0,0.08)', paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '10px', height: '480px' }}>
                <h4 style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, color: '#4f46e5', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Brain size={13} /> Discussion & AI Assistant
                </h4>
                
                {/* Comments List */}
                <div style={{ flex: 1, overflowY: 'auto', background: '#f8fafc', borderRadius: '6px', border: '1px solid rgba(0,0,0,0.05)', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '340px' }}>
                  {taskComments.map(c => (
                    <div key={c.id} style={{ 
                      alignSelf: c.sender === 'user' ? 'flex-end' : 'flex-start',
                      background: c.sender === 'user' ? '#4f46e5' : '#ffffff',
                      color: c.sender === 'user' ? '#ffffff' : '#0f172a',
                      border: c.sender === 'user' ? 'none' : '1px solid rgba(0,0,0,0.06)',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      maxWidth: '90%',
                      fontSize: '0.75rem',
                      lineHeight: '1.4',
                      boxShadow: c.sender === 'user' ? 'none' : '0 1px 2px rgba(0,0,0,0.02)'
                    }}>
                      {c.sender === 'ai_coordinator' ? (
                        <div style={{ overflowX: 'auto' }}>{renderMarkdown(c.content)}</div>
                      ) : (
                        c.content
                      )}
                    </div>
                  ))}
                  {isCommentsLoading && (
                    <div style={{ alignSelf: 'flex-start', color: '#64748b', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Brain size={10} className="pulse-glow" /> AI typing...
                    </div>
                  )}
                </div>

                {/* Quick Actions */}
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  <button 
                    onClick={() => handleSendComment(undefined, "Decompose this task into detailed subtasks.")}
                    className="tactile-btn"
                    style={{ fontSize: '0.62rem', padding: '3px 6px', borderRadius: '4px', border: '1px solid rgba(79,70,229,0.12)', background: '#ffffff', color: '#4f46e5', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Decompose
                  </button>
                  <button 
                    onClick={() => handleSendComment(undefined, "Suggest code boilerplate / source code template for this task.")}
                    className="tactile-btn"
                    style={{ fontSize: '0.62rem', padding: '3px 6px', borderRadius: '4px', border: '1px solid rgba(79,70,229,0.12)', background: '#ffffff', color: '#4f46e5', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Boilerplate
                  </button>
                </div>

                {/* Input Form */}
                <form onSubmit={handleSendComment} style={{ display: 'flex', gap: '4px' }}>
                  <input 
                    type="text" 
                    placeholder="Ask AI or discuss..." 
                    value={newCommentText}
                    onChange={e => setNewCommentText(e.target.value)}
                    style={{ flex: 1, background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '6px 8px', fontSize: '0.75rem', outline: 'none' }}
                  />
                  <button 
                    type="submit" 
                    className="tactile-btn"
                    style={{ background: '#4f46e5', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '0 10px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Send
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. Status Transition Modal */}
      {isTransitionModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.4)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: '#ffffff', borderRadius: '12px', width: '450px', maxWidth: '100%', padding: '1.8rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
              Confirm Status Transition
            </h3>
            
            {activeProject && editingTask.id && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '15px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.03)' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', background: 'rgba(100,116,139,0.1)', padding: '3px 8px', borderRadius: '4px' }}>
                  {activeProject.tasks.find(t => t.id === editingTask.id)?.status.replace('_', ' ')}
                </span>
                <span style={{ fontSize: '1rem', color: '#4f46e5', fontWeight: 800 }}>➔</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#10b981', textTransform: 'uppercase', background: 'rgba(16,185,129,0.1)', padding: '3px 8px', borderRadius: '4px' }}>
                  {editingTask.status?.replace('_', ' ')}
                </span>
              </div>
            )}

            {!aiRecommendation ? (
              <>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569' }}>
                      PROGRESS REPORT / COMMENTS
                    </label>
                    <button
                      onClick={handleGenerateDraftReport}
                      disabled={isDraftingReport || !editingTask.id}
                      style={{
                        background: 'rgba(79, 70, 229, 0.08)',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '2px 8px',
                        color: '#4f46e5',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      {isDraftingReport ? 'Drafting...' : '✨ AI Quick Draft'}
                    </button>
                  </div>
                  <textarea
                    placeholder="Describe what you completed, any blockers, or why you are changing the status..."
                    value={statusReportText}
                    onChange={e => setStatusReportText(e.target.value)}
                    rows={4}
                    style={{ width: '100%', background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '8px 10px', fontSize: '0.8rem', outline: 'none', resize: 'none' }}
                  />
                  {draftSuggestions.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b' }}>
                          💡 CLICK TO FILL REPORT (AI/QUICK):
                        </span>
                        {isLoadingSuggestions && (
                          <span style={{ fontSize: '0.62rem', color: '#4f46e5', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <span className="pulse-glow" style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4f46e5', display: 'inline-block' }}></span>
                            AI drafting...
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {draftSuggestions.map((sug, idx) => (
                          <button
                            key={idx}
                            onClick={() => setStatusReportText(sug)}
                            style={{
                              textAlign: 'left',
                              background: statusReportText === sug ? 'rgba(79, 70, 229, 0.08)' : '#ffffff',
                              border: statusReportText === sug ? '1px solid #4f46e5' : '1px solid rgba(0,0,0,0.06)',
                              borderRadius: '6px',
                              padding: '6px 10px',
                              fontSize: '0.72rem',
                              color: statusReportText === sug ? '#4f46e5' : '#475569',
                              cursor: 'pointer',
                              fontWeight: statusReportText === sug ? 700 : 500,
                              transition: 'all 0.15s ease',
                              outline: 'none'
                            }}
                          >
                            {sug}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                  <button 
                    onClick={() => setIsTransitionModalOpen(false)}
                    style={{ marginLeft: 'auto', background: '#f1f5f9', color: '#475569', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '6px', padding: '8px 16px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleStatusReportSubmit}
                    disabled={!statusReportText.trim()}
                    style={{ background: '#4f46e5', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', opacity: statusReportText.trim() ? 1 : 0.6 }}
                  >
                    Submit & Update
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '14px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <h4 style={{ margin: 0, fontSize: '0.8rem', color: '#166534', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    💡 AI RECOMMENDED ACTION
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: '#1e3a1e', lineHeight: '1.4' }}>
                    {aiRecommendation.recommendation}
                  </p>
                  
                  {aiRecommendation.action_type === 'create_task' && aiRecommendation.suggested_title && (
                    <div style={{ background: '#ffffff', border: '1px solid rgba(22,101,52,0.1)', padding: '8px', borderRadius: '6px', marginTop: '6px' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#166534' }}>Suggested Follow-up Task:</div>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0f172a', margin: '2px 0' }}>{aiRecommendation.suggested_title}</div>
                      <div style={{ fontSize: '0.7rem', color: '#475569' }}>{aiRecommendation.suggested_desc}</div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                  {aiRecommendation.action_type === 'create_task' && aiRecommendation.suggested_title && activeProject && (
                    <button 
                      onClick={async () => {
                        try {
                          const createRes = await fetch(`/api/projects/${activeProject.id}/tasks`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              title: aiRecommendation.suggested_title,
                              description: aiRecommendation.suggested_desc || '',
                              task_type: 'task',
                              phase: aiRecommendation.suggested_phase || 'development',
                              estimated_hours: 4.0,
                              status: 'todo'
                            })
                          });
                          if (createRes.ok) {
                            alert("Created follow-up task!");
                            setIsTransitionModalOpen(false);
                            loadData();
                          }
                        } catch (e) {
                          console.error(e);
                        }
                      }}
                      style={{ background: '#166534', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Apply Action
                    </button>
                  )}
                  <button 
                    onClick={() => setIsTransitionModalOpen(false)}
                    style={{ marginLeft: 'auto', background: '#f1f5f9', color: '#475569', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '6px', padding: '8px 16px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  )
}

export default App


