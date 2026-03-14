import axios from 'axios';
import { BoardState, WorkspaceSummary } from './types';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 15000
});

export function setApiToken(token: string | null) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

export type LoginResponse = {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
};

export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/v1/auth/login', { email, password });
  return response.data;
}

export async function register(name: string, email: string, password: string): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/v1/auth/register', { name, email, password });
  return response.data;
}

export async function fetchWorkspaces(): Promise<WorkspaceSummary[]> {
  const response = await api.get<{ workspaces: WorkspaceSummary[] }>('/v1/workspaces');
  return response.data.workspaces;
}

export async function createWorkspace(name: string): Promise<WorkspaceSummary> {
  const response = await api.post<{ workspace: WorkspaceSummary }>('/v1/workspaces', { name });
  return response.data.workspace;
}

export async function createBoard(workspaceId: string, title: string, description?: string) {
  const response = await api.post(`/v1/workspaces/${workspaceId}/boards`, {
    title,
    description
  });
  return response.data.board as { id: string; title: string };
}

export async function fetchBoard(boardId: string): Promise<{ role: string; state: BoardState }> {
  const response = await api.get<{ role: string; state: BoardState }>(`/v1/boards/${boardId}`);
  return response.data;
}

export async function fetchHistory(boardId: string): Promise<{
  snapshots: Array<{ id: string; seq: number; createdAt: string }>;
  activity: Array<{ id: string; seq: number; eventType: string; createdAt: string; actor: { id: string; name: string } }>;
}> {
  const response = await api.get(`/v1/boards/${boardId}/history?limit=50`);
  return response.data;
}

export async function restoreSnapshot(boardId: string, snapshotId: string): Promise<void> {
  await api.post(`/v1/boards/${boardId}/restore/${snapshotId}`);
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await api.post(`/v1/notifications/${notificationId}/read`);
}
