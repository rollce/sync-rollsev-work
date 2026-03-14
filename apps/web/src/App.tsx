import AddIcon from '@mui/icons-material/Add';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import CircleIcon from '@mui/icons-material/Circle';
import HistoryIcon from '@mui/icons-material/History';
import LogoutIcon from '@mui/icons-material/Logout';
import SendIcon from '@mui/icons-material/Send';
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Tooltip,
  Typography
} from '@mui/material';
import { formatDistanceToNow } from 'date-fns';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import { v4 as uuid } from 'uuid';
import { PROTOCOL_VERSION, ServerEvent, serverEventSchema } from '@sync/shared';
import {
  API_URL,
  createBoard,
  createWorkspace,
  fetchBoard,
  fetchHistory,
  fetchWorkspaces,
  login,
  register,
  restoreSnapshot,
  setApiToken
} from './lib/api';
import { ActivityEvent, BoardState, RoomUser, Snapshot, WorkspaceSummary } from './lib/types';

const WS_URL = import.meta.env.VITE_WS_URL ?? API_URL;

const SOCKET_EVENT = 'client_event';
const SERVER_EVENT = 'server_event';
const DRAWER_WIDTH = 320;

type ConnectionState = 'connected' | 'connecting' | 'disconnected';
type SyncState = 'synced' | 'pending' | 'offline';

type AuthMode = 'login' | 'register';
type User = {
  id: string;
  name: string;
  email: string;
};

type ClientMutationEvent =
  | {
      protocolVersion: typeof PROTOCOL_VERSION;
      type: 'CARD_CREATED';
      boardId: string;
      mutationId: string;
      payload: { listId: string; title: string; description?: string };
    }
  | {
      protocolVersion: typeof PROTOCOL_VERSION;
      type: 'CARD_UPDATED';
      boardId: string;
      mutationId: string;
      payload: { cardId: string; title?: string; description?: string };
    }
  | {
      protocolVersion: typeof PROTOCOL_VERSION;
      type: 'CARD_MOVED';
      boardId: string;
      mutationId: string;
      payload: { cardId: string; fromListId: string; toListId: string; toOrder: number };
    }
  | {
      protocolVersion: typeof PROTOCOL_VERSION;
      type: 'COMMENT_ADDED';
      boardId: string;
      mutationId: string;
      payload: { cardId: string; content: string };
    };

function loadStoredUser(): User | null {
  const raw = localStorage.getItem('sync_user');
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

function loadStoredToken(): string | null {
  return localStorage.getItem('sync_token');
}

function loadSessionId(): string {
  const stored = localStorage.getItem('sync_socket_session');
  if (stored) {
    return stored;
  }

  const next = uuid();
  localStorage.setItem('sync_socket_session', next);
  return next;
}

function upsertCard(cards: BoardState['cards'], incoming: BoardState['cards'][number]) {
  const index = cards.findIndex((card) => card.id === incoming.id);
  if (index === -1) {
    return [...cards, incoming];
  }

  const clone = [...cards];
  clone[index] = incoming;
  return clone;
}

function upsertComment(comments: BoardState['comments'], incoming: BoardState['comments'][number]) {
  const index = comments.findIndex((comment) => comment.id === incoming.id);
  if (index === -1) {
    return [...comments, incoming];
  }

  const clone = [...comments];
  clone[index] = incoming;
  return clone;
}

function reorderCards(cards: BoardState['cards']): BoardState['cards'] {
  return [...cards].sort((a, b) => {
    if (a.listId === b.listId) {
      return a.order - b.order;
    }

    return a.listId.localeCompare(b.listId);
  });
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => loadStoredToken());
  const [user, setUser] = useState<User | null>(() => loadStoredUser());
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authForm, setAuthForm] = useState({
    name: '',
    email: 'demo@rollsev.work',
    password: 'demo12345'
  });
  const [authLoading, setAuthLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [boardRole, setBoardRole] = useState<string | null>(null);
  const [boardState, setBoardState] = useState<BoardState | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [syncState, setSyncState] = useState<SyncState>('synced');
  const [roomUsers, setRoomUsers] = useState<RoomUser[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [commentInput, setCommentInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const pendingMutationsRef = useRef<Map<string, ClientMutationEvent>>(new Map());
  const queuedMutationsRef = useRef<ClientMutationEvent[]>([]);
  const lastSeqRef = useRef<number>(0);
  const cursorThrottleRef = useRef<number>(0);
  const sessionId = useMemo(() => loadSessionId(), []);

  const canEdit = boardRole === 'OWNER' || boardRole === 'EDITOR';
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
  const selectedCard = useMemo(() => {
    if (!selectedCardId || !boardState) {
      return null;
    }

    return boardState.cards.find((card) => card.id === selectedCardId) ?? null;
  }, [selectedCardId, boardState]);

  const selectedCardComments = useMemo(() => {
    if (!selectedCardId || !boardState) {
      return [];
    }

    return boardState.comments.filter((comment) => comment.cardId === selectedCardId);
  }, [selectedCardId, boardState]);

  const setPendingState = useCallback(() => {
    const hasPending = pendingMutationsRef.current.size > 0 || queuedMutationsRef.current.length > 0;
    if (!hasPending) {
      setSyncState(connectionState === 'connected' ? 'synced' : 'offline');
      return;
    }

    setSyncState(connectionState === 'connected' ? 'pending' : 'offline');
  }, [connectionState]);

  const sendClientEvent = useCallback(
    (event: Record<string, unknown>) => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        return false;
      }

      socket.emit(SOCKET_EVENT, event);
      return true;
    },
    []
  );

  const requestSnapshot = useCallback((boardId: string) => {
    sendClientEvent({
      protocolVersion: PROTOCOL_VERSION,
      type: 'REQUEST_SNAPSHOT',
      boardId
    });
  }, [sendClientEvent]);

  const applyLiveEvent = useCallback(
    (event: Extract<ServerEvent, { type: 'LIVE_EVENT' }>) => {
      if (!boardState || event.boardId !== boardState.board.id) {
        return;
      }

      const isSequenced = ['CARD_CREATED', 'CARD_UPDATED', 'CARD_MOVED', 'COMMENT_ADDED', 'SNAPSHOT_AVAILABLE'].includes(
        event.eventType
      );

      if (isSequenced) {
        if (event.seq <= lastSeqRef.current) {
          return;
        }

        if (event.seq > lastSeqRef.current + 1) {
          requestSnapshot(event.boardId);
          return;
        }

        lastSeqRef.current = event.seq;
      }

      if (event.eventType === 'CARD_CREATED') {
        const payload = event.payload as { card: BoardState['cards'][number] };
        setBoardState((current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            board: {
              ...current.board,
              seq: Math.max(current.board.seq, event.seq)
            },
            cards: reorderCards(upsertCard(current.cards, payload.card))
          };
        });
        return;
      }

      if (event.eventType === 'CARD_UPDATED') {
        const payload = event.payload as { card: BoardState['cards'][number] };
        setBoardState((current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            board: {
              ...current.board,
              seq: Math.max(current.board.seq, event.seq)
            },
            cards: reorderCards(upsertCard(current.cards, payload.card))
          };
        });
        return;
      }

      if (event.eventType === 'CARD_MOVED') {
        const payload = event.payload as { card: BoardState['cards'][number] };
        setBoardState((current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            board: {
              ...current.board,
              seq: Math.max(current.board.seq, event.seq)
            },
            cards: reorderCards(upsertCard(current.cards, payload.card))
          };
        });
        return;
      }

      if (event.eventType === 'COMMENT_ADDED') {
        const payload = event.payload as { comment: BoardState['comments'][number] };
        setBoardState((current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            board: {
              ...current.board,
              seq: Math.max(current.board.seq, event.seq)
            },
            comments: upsertComment(current.comments, payload.comment)
          };
        });
      }
    },
    [boardState, requestSnapshot]
  );

  const flushMutationQueue = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      return;
    }

    const queue = [...queuedMutationsRef.current];
    queuedMutationsRef.current = [];

    for (const mutation of queue) {
      socket.emit(SOCKET_EVENT, mutation);
    }

    setPendingState();
  }, [setPendingState]);

  const emitMutation = useCallback(
    (event: ClientMutationEvent) => {
      pendingMutationsRef.current.set(event.mutationId, event);

      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        queuedMutationsRef.current.push(event);
        setPendingState();
        return;
      }

      socket.emit(SOCKET_EVENT, event);
      setPendingState();
    },
    [setPendingState]
  );

  const applyOptimistic = useCallback((event: ClientMutationEvent) => {
    setBoardState((current) => {
      if (!current) {
        return current;
      }

      if (event.type === 'CARD_UPDATED') {
        return {
          ...current,
          cards: current.cards.map((card) =>
            card.id === event.payload.cardId
              ? {
                  ...card,
                  title: event.payload.title ?? card.title,
                  description: event.payload.description ?? card.description,
                  lastEditedBy: user?.id ?? card.lastEditedBy,
                  lastEditedAt: new Date().toISOString()
                }
              : card
          )
        };
      }

      if (event.type === 'CARD_MOVED') {
        return {
          ...current,
          cards: reorderCards(
            current.cards.map((card) =>
              card.id === event.payload.cardId
                ? {
                    ...card,
                    listId: event.payload.toListId,
                    order: event.payload.toOrder,
                    lastEditedBy: user?.id ?? card.lastEditedBy,
                    lastEditedAt: new Date().toISOString()
                  }
                : card
            )
          )
        };
      }

      if (event.type === 'CARD_CREATED') {
        return {
          ...current,
          cards: reorderCards([
            ...current.cards,
            {
              id: `temp-${event.mutationId}`,
              boardId: event.boardId,
              listId: event.payload.listId,
              title: event.payload.title,
              description: event.payload.description ?? null,
              order: current.cards.filter((card) => card.listId === event.payload.listId).length,
              lastEditedBy: user?.id ?? 'me',
              lastEditedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ])
        };
      }

      if (event.type === 'COMMENT_ADDED') {
        return {
          ...current,
          comments: [
            ...current.comments,
            {
              id: `temp-${event.mutationId}`,
              boardId: event.boardId,
              cardId: event.payload.cardId,
              userId: user?.id ?? 'me',
              authorName: user?.name ?? 'You',
              content: event.payload.content,
              mentions: null,
              createdAt: new Date().toISOString()
            }
          ]
        };
      }

      return current;
    });
  }, [user]);

  const loadWorkspaces = useCallback(async () => {
    const next = await fetchWorkspaces();
    setWorkspaces(next);

    const firstWorkspaceId = next[0]?.id ?? null;
    const firstBoardId = next[0]?.boards[0]?.id ?? null;

    setSelectedWorkspaceId((current) => current ?? firstWorkspaceId);
    setSelectedBoardId((current) => current ?? firstBoardId);
  }, []);

  const loadBoard = useCallback(async (boardId: string) => {
    setLoadingBoard(true);
    setErrorMessage(null);

    try {
      const response = await fetchBoard(boardId);
      setBoardRole(response.role);
      setBoardState(response.state);
      lastSeqRef.current = response.state.board.seq;
      setSelectedCardId((current) => current ?? response.state.cards[0]?.id ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load board';
      setErrorMessage(message);
    } finally {
      setLoadingBoard(false);
    }
  }, []);

  useEffect(() => {
    setApiToken(token);
  }, [token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    void loadWorkspaces().catch((error) => {
      const message = error instanceof Error ? error.message : 'Failed to load workspaces';
      setErrorMessage(message);
    });
  }, [token, loadWorkspaces]);

  useEffect(() => {
    if (!token) {
      setConnectionState('disconnected');
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    setConnectionState('connecting');
    const socket = io(WS_URL, {
      path: '/ws',
      transports: ['websocket'],
      auth: {
        token,
        sessionId
      }
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionState('connected');
      flushMutationQueue();
      if (selectedBoardId) {
        socket.emit(SOCKET_EVENT, {
          protocolVersion: PROTOCOL_VERSION,
          type: 'JOIN_BOARD',
          boardId: selectedBoardId,
          lastServerSeq: lastSeqRef.current
        });
      }
    });

    socket.on('disconnect', () => {
      setConnectionState('disconnected');
      setPendingState();
    });

    socket.on(SERVER_EVENT, (raw: unknown) => {
      const parsed = serverEventSchema.safeParse(raw);
      if (!parsed.success) {
        return;
      }

      const event = parsed.data;

      if (event.type === 'ERROR') {
        setErrorMessage(event.message);
        return;
      }

      if (event.type === 'PING') {
        socket.emit(SOCKET_EVENT, {
          protocolVersion: PROTOCOL_VERSION,
          type: 'PONG'
        });
        return;
      }

      if (event.type === 'SYNC_STATE') {
        if (!selectedBoardId || event.boardId !== selectedBoardId) {
          return;
        }

        const snapshot = event.snapshot as BoardState;
        setBoardState(snapshot);
        lastSeqRef.current = event.seq;
        return;
      }

      if (event.type === 'ROOM_USERS') {
        if (!selectedBoardId || event.boardId !== selectedBoardId) {
          return;
        }

        setRoomUsers(event.activeUsers);
        return;
      }

      if (event.type === 'MUTATION_ACK') {
        if (event.boardId === 'system') {
          return;
        }

        pendingMutationsRef.current.delete(event.mutationId);

        if (event.status === 'REJECTED') {
          setErrorMessage(event.reason ?? 'Mutation rejected by server');
          requestSnapshot(event.boardId);
        }

        if (event.status === 'DUPLICATE') {
          requestSnapshot(event.boardId);
        }

        setPendingState();
        return;
      }

      if (event.type === 'LIVE_EVENT') {
        applyLiveEvent(event);
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, selectedBoardId, applyLiveEvent, flushMutationQueue, setPendingState, sessionId, requestSnapshot]);

  useEffect(() => {
    setPendingState();
  }, [connectionState, setPendingState]);

  useEffect(() => {
    if (!selectedBoardId || !token) {
      return;
    }

    void loadBoard(selectedBoardId);

    if (socketRef.current?.connected) {
      socketRef.current.emit(SOCKET_EVENT, {
        protocolVersion: PROTOCOL_VERSION,
        type: 'JOIN_BOARD',
        boardId: selectedBoardId,
        lastServerSeq: lastSeqRef.current
      });
    }

    return () => {
      if (socketRef.current?.connected) {
        socketRef.current.emit(SOCKET_EVENT, {
          protocolVersion: PROTOCOL_VERSION,
          type: 'LEAVE_BOARD',
          boardId: selectedBoardId
        });
      }

      setRoomUsers([]);
    };
  }, [selectedBoardId, token, loadBoard]);

  const submitAuth = useCallback(async () => {
    setAuthLoading(true);
    setErrorMessage(null);

    try {
      const response =
        authMode === 'login'
          ? await login(authForm.email, authForm.password)
          : await register(authForm.name, authForm.email, authForm.password);

      setToken(response.token);
      setUser(response.user);
      localStorage.setItem('sync_token', response.token);
      localStorage.setItem('sync_user', JSON.stringify(response.user));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed';
      setErrorMessage(message);
    } finally {
      setAuthLoading(false);
    }
  }, [authForm.email, authForm.name, authForm.password, authMode]);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setWorkspaces([]);
    setSelectedWorkspaceId(null);
    setSelectedBoardId(null);
    setBoardState(null);
    localStorage.removeItem('sync_token');
    localStorage.removeItem('sync_user');
  }, []);

  const handleCreateWorkspace = useCallback(async () => {
    const name = window.prompt('Workspace name', 'New Workspace');
    if (!name || !token) {
      return;
    }

    try {
      await createWorkspace(name);
      await loadWorkspaces();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cannot create workspace';
      setErrorMessage(message);
    }
  }, [token, loadWorkspaces]);

  const handleCreateBoard = useCallback(async () => {
    if (!selectedWorkspaceId || !token) {
      return;
    }

    const title = window.prompt('Board title', 'New Board');
    if (!title) {
      return;
    }

    try {
      const board = await createBoard(selectedWorkspaceId, title);
      await loadWorkspaces();
      setSelectedBoardId(board.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cannot create board';
      setErrorMessage(message);
    }
  }, [selectedWorkspaceId, token, loadWorkspaces]);

  const handleCardDrop = useCallback(
    (cardId: string, fromListId: string, toListId: string) => {
      if (!boardState || !selectedBoardId || !canEdit) {
        return;
      }

      if (fromListId === toListId) {
        return;
      }

      const toOrder = boardState.cards.filter((card) => card.listId === toListId).length;

      const mutation: ClientMutationEvent = {
        protocolVersion: PROTOCOL_VERSION,
        type: 'CARD_MOVED',
        boardId: selectedBoardId,
        mutationId: uuid(),
        payload: {
          cardId,
          fromListId,
          toListId,
          toOrder
        }
      };

      applyOptimistic(mutation);
      emitMutation(mutation);
    },
    [applyOptimistic, boardState, canEdit, emitMutation, selectedBoardId]
  );

  const handleAddCard = useCallback(
    (listId: string) => {
      if (!selectedBoardId || !canEdit) {
        return;
      }

      const title = window.prompt('Card title', 'New task');
      if (!title) {
        return;
      }

      const mutation: ClientMutationEvent = {
        protocolVersion: PROTOCOL_VERSION,
        type: 'CARD_CREATED',
        boardId: selectedBoardId,
        mutationId: uuid(),
        payload: {
          listId,
          title
        }
      };

      applyOptimistic(mutation);
      emitMutation(mutation);
    },
    [selectedBoardId, canEdit, applyOptimistic, emitMutation]
  );

  const handleSaveCard = useCallback(() => {
    if (!selectedBoardId || !selectedCardId || !selectedCard || !canEdit) {
      return;
    }

    const nextTitle = window.prompt('Edit title', selectedCard.title);
    if (!nextTitle || nextTitle === selectedCard.title) {
      return;
    }

    const mutation: ClientMutationEvent = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'CARD_UPDATED',
      boardId: selectedBoardId,
      mutationId: uuid(),
      payload: {
        cardId: selectedCardId,
        title: nextTitle
      }
    };

    applyOptimistic(mutation);
    emitMutation(mutation);
  }, [selectedBoardId, selectedCardId, selectedCard, canEdit, applyOptimistic, emitMutation]);

  const handleSendComment = useCallback(() => {
    if (!selectedBoardId || !selectedCardId || !commentInput.trim() || !canEdit) {
      return;
    }

    const mutation: ClientMutationEvent = {
      protocolVersion: PROTOCOL_VERSION,
      type: 'COMMENT_ADDED',
      boardId: selectedBoardId,
      mutationId: uuid(),
      payload: {
        cardId: selectedCardId,
        content: commentInput.trim()
      }
    };

    applyOptimistic(mutation);
    emitMutation(mutation);
    setCommentInput('');

    sendClientEvent({
      protocolVersion: PROTOCOL_VERSION,
      type: 'TYPING_STATUS',
      boardId: selectedBoardId,
      payload: {
        cardId: selectedCardId,
        active: false
      }
    });
  }, [selectedBoardId, selectedCardId, commentInput, canEdit, applyOptimistic, emitMutation, sendClientEvent]);

  const openHistory = useCallback(async () => {
    if (!selectedBoardId) {
      return;
    }

    setHistoryOpen(true);
    setHistoryLoading(true);

    try {
      const data = await fetchHistory(selectedBoardId);
      setSnapshots(data.snapshots);
      setActivity(data.activity);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load history';
      setErrorMessage(message);
    } finally {
      setHistoryLoading(false);
    }
  }, [selectedBoardId]);

  const runRestore = useCallback(
    async (snapshotId: string) => {
      if (!selectedBoardId || !canEdit) {
        return;
      }

      try {
        await restoreSnapshot(selectedBoardId, snapshotId);
        requestSnapshot(selectedBoardId);
        setHistoryOpen(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Restore failed';
        setErrorMessage(message);
      }
    },
    [selectedBoardId, canEdit, requestSnapshot]
  );

  const handleBoardPointer = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!selectedBoardId || connectionState !== 'connected') {
        return;
      }

      const now = Date.now();
      if (now - cursorThrottleRef.current < 50) {
        return;
      }

      cursorThrottleRef.current = now;
      const target = event.currentTarget.getBoundingClientRect();
      const x = (event.clientX - target.left) / Math.max(target.width, 1);
      const y = (event.clientY - target.top) / Math.max(target.height, 1);

      sendClientEvent({
        protocolVersion: PROTOCOL_VERSION,
        type: 'CURSOR_MOVED',
        boardId: selectedBoardId,
        payload: {
          x,
          y,
          viewport: 'board'
        }
      });
    },
    [selectedBoardId, connectionState, sendClientEvent]
  );

  if (!token || !user) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          p: 2
        }}
      >
        <Paper sx={{ width: 420, p: 3 }} className="fade-in">
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Sync Rollsev Work
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Realtime kanban collaboration with presence, cursors, comments and snapshot history.
          </Typography>

          <Tabs value={authMode} onChange={(_, next) => setAuthMode(next)} sx={{ mb: 2 }}>
            <Tab value="login" label="Login" />
            <Tab value="register" label="Register" />
          </Tabs>

          <Stack spacing={2}>
            {authMode === 'register' && (
              <TextField
                label="Name"
                value={authForm.name}
                onChange={(event) => setAuthForm((current) => ({ ...current, name: event.target.value }))}
              />
            )}
            <TextField
              label="Email"
              value={authForm.email}
              onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
            />
            <TextField
              label="Password"
              type="password"
              value={authForm.password}
              onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
            />
            <Button variant="contained" size="large" disabled={authLoading} onClick={() => void submitAuth()}>
              {authLoading ? <CircularProgress size={20} color="inherit" /> : authMode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
            <Typography variant="caption" color="text.secondary">
              Demo account: `demo@rollsev.work` / `demo12345`
            </Typography>
          </Stack>

          {errorMessage && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setErrorMessage(null)}>
              {errorMessage}
            </Alert>
          )}
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>
            Sync Rollsev Work
          </Typography>

          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              size="small"
              label={connectionState.toUpperCase()}
              color={connectionState === 'connected' ? 'success' : connectionState === 'connecting' ? 'warning' : 'default'}
            />
            <Chip
              size="small"
              label={syncState === 'synced' ? 'Synced' : syncState === 'pending' ? 'Unsaved changes' : 'Offline queue'}
              color={syncState === 'synced' ? 'success' : 'warning'}
            />
            <Chip size="small" icon={<CircleIcon sx={{ fontSize: '0.7rem !important' }} />} label={user.name} />
            <Tooltip title="Logout">
              <IconButton color="inherit" onClick={logout}>
                <LogoutIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box'
          }
        }}
      >
        <Toolbar />
        <Box sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
            <Select
              size="small"
              value={selectedWorkspaceId ?? ''}
              displayEmpty
              fullWidth
              onChange={(event) => {
                const workspaceId = event.target.value;
                setSelectedWorkspaceId(workspaceId || null);
                const workspace = workspaces.find((item) => item.id === workspaceId);
                setSelectedBoardId(workspace?.boards[0]?.id ?? null);
              }}
            >
              {workspaces.map((workspace) => (
                <MenuItem key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </MenuItem>
              ))}
            </Select>
            <Tooltip title="Create workspace">
              <IconButton onClick={() => void handleCreateWorkspace()}>
                <AddIcon />
              </IconButton>
            </Tooltip>
          </Stack>

          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Boards
            </Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={() => void handleCreateBoard()}>
              New
            </Button>
          </Stack>

          <List dense>
            {selectedWorkspace?.boards.map((board) => (
              <ListItem key={board.id} disablePadding>
                <ListItemButton selected={selectedBoardId === board.id} onClick={() => setSelectedBoardId(board.id)}>
                  <ListItemText
                    primary={board.title}
                    secondary={formatDistanceToNow(new Date(board.updatedAt), { addSuffix: true })}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Box>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: 2 }}>
        <Toolbar />

        {connectionState !== 'connected' && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Realtime disconnected. Changes are queued and replayed after reconnect.
          </Alert>
        )}

        {errorMessage && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage(null)}>
            {errorMessage}
          </Alert>
        )}

        {loadingBoard && <CircularProgress />}

        {!loadingBoard && !boardState && (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h6">Select a board from the sidebar</Typography>
          </Paper>
        )}

        {boardState && (
          <Stack spacing={2}>
            <Paper sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Typography variant="h5" fontWeight={700}>
                  {boardState.board.title}
                </Typography>
                <Typography color="text.secondary">{boardState.board.description ?? 'Realtime collaboration board'}</Typography>
              </Box>

              <Stack direction="row" spacing={1} alignItems="center">
                {roomUsers.slice(0, 5).map((participant) => (
                  <Chip
                    key={participant.userId}
                    avatar={<Avatar>{participant.name.slice(0, 1).toUpperCase()}</Avatar>}
                    label={participant.typing?.active ? `${participant.name} is typing` : participant.name}
                    variant="outlined"
                  />
                ))}
                <Button startIcon={<HistoryIcon />} variant="outlined" onClick={() => void openHistory()}>
                  History
                </Button>
                <Button
                  startIcon={<AutorenewIcon />}
                  variant="outlined"
                  onClick={() => requestSnapshot(boardState.board.id)}
                >
                  Re-sync
                </Button>
              </Stack>
            </Paper>

            <Stack direction="row" spacing={2} alignItems="stretch">
              <Box
                className="board-canvas"
                sx={{
                  flexGrow: 1,
                  minHeight: 560,
                  borderRadius: 2,
                  p: 2,
                  position: 'relative',
                  overflowX: 'auto'
                }}
                onMouseMove={handleBoardPointer}
              >
                {roomUsers
                  .filter((participant) => participant.cursor)
                  .map((participant, index) => (
                    <Box
                      key={`${participant.userId}-cursor`}
                      className="cursor-dot"
                      sx={{
                        left: `${Math.min(Math.max((participant.cursor?.x ?? 0) * 100, 0), 100)}%`,
                        top: `${Math.min(Math.max((participant.cursor?.y ?? 0) * 100, 0), 100)}%`,
                        backgroundColor: `hsl(${(index * 67) % 360}deg 75% 45%)`
                      }}
                      title={participant.name}
                    />
                  ))}

                <Stack direction="row" spacing={2}>
                  {boardState.lists
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((list) => {
                      const cards = boardState.cards
                        .filter((card) => card.listId === list.id)
                        .sort((a, b) => a.order - b.order);

                      return (
                        <Paper
                          key={list.id}
                          sx={{
                            width: 320,
                            flexShrink: 0,
                            p: 1.5,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 1,
                            minHeight: 420
                          }}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            const cardId = event.dataTransfer.getData('cardId');
                            const fromListId = event.dataTransfer.getData('fromListId');
                            if (cardId && fromListId) {
                              handleCardDrop(cardId, fromListId, list.id);
                            }
                          }}
                        >
                          <Typography variant="subtitle1" fontWeight={700}>
                            {list.title}
                          </Typography>

                          <Stack spacing={1} sx={{ minHeight: 250 }}>
                            {cards.map((card) => (
                              <Card
                                key={card.id}
                                draggable={canEdit}
                                onDragStart={(event) => {
                                  event.dataTransfer.setData('cardId', card.id);
                                  event.dataTransfer.setData('fromListId', card.listId);
                                }}
                                onClick={() => setSelectedCardId(card.id)}
                                sx={{
                                  cursor: 'pointer',
                                  border: selectedCardId === card.id ? '1px solid #0f766e' : '1px solid transparent',
                                  backgroundColor: selectedCardId === card.id ? 'rgba(15, 118, 110, 0.06)' : undefined
                                }}
                              >
                                <CardContent sx={{ pb: '16px !important' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>
                                    {card.title}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    edited {formatDistanceToNow(new Date(card.lastEditedAt), { addSuffix: true })}
                                  </Typography>
                                </CardContent>
                              </Card>
                            ))}
                          </Stack>

                          {canEdit && (
                            <Button size="small" startIcon={<AddIcon />} onClick={() => handleAddCard(list.id)}>
                              Add card
                            </Button>
                          )}
                        </Paper>
                      );
                    })}
                </Stack>
              </Box>

              <Paper sx={{ width: 360, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Typography variant="h6">Comments</Typography>
                <Divider />
                {selectedCard ? (
                  <>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="subtitle1" fontWeight={700}>
                        {selectedCard.title}
                      </Typography>
                      {canEdit && (
                        <Button size="small" onClick={handleSaveCard}>
                          Edit title
                        </Button>
                      )}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {selectedCard.description ?? 'No description'}
                    </Typography>
                    <Divider />

                    <Stack spacing={1} sx={{ maxHeight: 280, overflowY: 'auto' }}>
                      {selectedCardComments.map((comment) => (
                        <Paper key={comment.id} variant="outlined" sx={{ p: 1 }}>
                          <Typography variant="caption" color="text.secondary">
                            {comment.authorName} · {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                          </Typography>
                          <Typography variant="body2" dangerouslySetInnerHTML={{ __html: comment.content }} />
                        </Paper>
                      ))}

                      {selectedCardComments.length === 0 && (
                        <Typography variant="body2" color="text.secondary">
                          No comments yet.
                        </Typography>
                      )}
                    </Stack>

                    <TextField
                      multiline
                      minRows={3}
                      placeholder="Write a comment. Use @username mention."
                      value={commentInput}
                      onChange={(event) => {
                        setCommentInput(event.target.value);
                        if (selectedBoardId && selectedCardId) {
                          sendClientEvent({
                            protocolVersion: PROTOCOL_VERSION,
                            type: 'TYPING_STATUS',
                            boardId: selectedBoardId,
                            payload: {
                              cardId: selectedCardId,
                              active: event.target.value.trim().length > 0
                            }
                          });
                        }
                      }}
                    />
                    <Button
                      variant="contained"
                      endIcon={<SendIcon />}
                      disabled={!commentInput.trim() || !canEdit}
                      onClick={handleSendComment}
                    >
                      Send
                    </Button>
                  </>
                ) : (
                  <Typography color="text.secondary">Select a card to view comments.</Typography>
                )}
              </Paper>
            </Stack>
          </Stack>
        )}
      </Box>

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Revision History</DialogTitle>
        <DialogContent dividers>
          {historyLoading ? (
            <CircularProgress />
          ) : (
            <Stack direction="row" spacing={2}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                  Snapshots
                </Typography>
                <Stack spacing={1}>
                  {snapshots.map((snapshot) => (
                    <Paper key={snapshot.id} variant="outlined" sx={{ p: 1.5 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Box>
                          <Typography variant="body2" fontWeight={700}>
                            Seq #{snapshot.seq}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatDistanceToNow(new Date(snapshot.createdAt), { addSuffix: true })}
                          </Typography>
                        </Box>
                        {canEdit && (
                          <Button size="small" onClick={() => void runRestore(snapshot.id)}>
                            Restore
                          </Button>
                        )}
                      </Stack>
                    </Paper>
                  ))}

                  {snapshots.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No snapshots yet.
                    </Typography>
                  )}
                </Stack>
              </Box>

              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                  Activity Feed
                </Typography>
                <Stack spacing={1}>
                  {activity.map((item) => (
                    <Paper key={item.id} variant="outlined" sx={{ p: 1.5 }}>
                      <Typography variant="body2" fontWeight={600}>
                        #{item.seq} · {item.eventType}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        by {item.actor.name} · {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                      </Typography>
                    </Paper>
                  ))}

                  {activity.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No activity yet.
                    </Typography>
                  )}
                </Stack>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
