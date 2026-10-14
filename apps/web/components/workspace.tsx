'use client';
import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import ReactMarkdown from 'react-markdown';
import {
  ArrowRight,
  ArrowUpRight,
  ArrowLeft,
  Bell,
  Check,
  CheckSquare,
  ChevronDown,
  FileText,
  Hash,
  Home,
  ImagePlus,
  Info,
  LoaderCircle,
  Lock,
  LogOut,
  Menu,
  MessageCircle,
  MessagesSquare,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smile,
  Upload,
  Users,
  X,
  Download,
  Paperclip,
} from 'lucide-react';
import { product } from '@mane/product-config';
import { AuthPanel, type Session } from './auth-panel';
import { Avatar, Badge, CheckBox, Empty, Field, Modal, request, stamp, type Request } from './ui';
import {
  demoActions,
  demoMeetings,
  demoMinutes,
  demoPosts,
  demoSpaces,
  demoUser,
  demoUsers,
  type Action,
  type Comment,
  type Meeting,
  type Message,
  type Notification,
  type Post,
  type Space,
  type Thread,
  type User,
} from './demo';
import { MeetingReview } from './meeting-review';
import { AdminPanel } from './admin-panel';

type View = 'feed' | 'meetings' | 'actions' | 'messages' | 'settings';
export function Workspace() {
  const [loaded, setLoaded] = useState(false),
    [demo, setDemo] = useState(false),
    [session, setSession] = useState<Session | null>(null),
    [setup, setSetup] = useState(false),
    [provider, setProvider] = useState('local');
  const [view, setView] = useState<View>('feed'),
    [spaceId, setSpaceId] = useState(''),
    [spaces, setSpaces] = useState<Space[]>([]),
    [posts, setPosts] = useState<Post[]>([]),
    [meetings, setMeetings] = useState<Meeting[]>([]),
    [actions, setActions] = useState<Action[]>([]),
    [users, setUsers] = useState<User[]>([]),
    [notifications, setNotifications] = useState<Notification[]>([]);
  const [modal, setModal] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [tab, setTab] = useState('all'),
    [draft, setDraft] = useState(''),
    [attachment, setAttachment] = useState<File | null>(null),
    [meetingId, setMeetingId] = useState('');
  const [threads, setThreads] = useState<Thread[]>([]),
    [threadId, setThreadId] = useState(''),
    [messages, setMessages] = useState<Message[]>([]),
    [message, setMessage] = useState(''),
    [typing, setTyping] = useState('');
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<{ id: string; type: string; text: string; parentId?: string }[]>([]),
    [searched, setSearched] = useState(false);
  const socket = useRef<Socket | null>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const api = useCallback<Request>(
    (path, method, body) => request(path, method, body, session?.csrfToken),
    [session?.csrfToken],
  );
  const notifyError = (e: unknown) =>
    setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const initialView = p.get('view');
    if (['meetings', 'actions', 'messages', 'settings'].includes(initialView || ''))
      setView(initialView as View);
    if (p.get('space')) setSpaceId(p.get('space')!);
    if (p.get('meeting')) {
      setMeetingId(p.get('meeting')!);
      setView('meetings');
    }
    if (p.get('thread')) {
      setThreadId(p.get('thread')!);
      setView('messages');
    }
    if (p.get('demo') === '1') {
      setDemo(true);
      setSession({ user: demoUser, org: { name: 'Acme Studio' }, csrfToken: '' });
      setSpaces(demoSpaces);
      setSpaceId('general');
      setUsers(demoUsers);
      setPosts(demoPosts);
      setMeetings(demoMeetings);
      setActions(demoActions);
      setThreads([{ id: 'thread-demo', participants: [demoUser, demoUsers[1]], unreadCount: 1 }]);
      setMessages([
        {
          id: 'msg1',
          senderId: 'demo-priya',
          senderName: 'Priya Sharma',
          body: 'The product sync minutes are ready. Would you give them a look before we publish?',
          createdAt: new Date().toISOString(),
        },
      ]);
      setThreadId('thread-demo');
      setNotifications([
        {
          id: 'n1',
          title: 'Minutes ready to review: Weekly product sync',
          kind: 'review',
          createdAt: new Date().toISOString(),
        },
      ]);
      try {
        const saved = JSON.parse(localStorage.getItem('mane-demo-v1') || 'null');
        if (saved) {
          setPosts(saved.posts || demoPosts);
          setActions(saved.actions || demoActions);
          setMeetings(saved.meetings || demoMeetings);
          setSpaces(saved.spaces || demoSpaces);
        }
      } catch {}
      setLoaded(true);
      return;
    }
    (async () => {
      try {
        const status = await request<{ setupRequired: boolean; authProvider: string }>('/auth/status');
        setSetup(status.setupRequired);
        setProvider(status.authProvider);
        if (!status.setupRequired) {
          try {
            setSession(await request<Session>('/auth/me'));
          } catch {
            /* Show sign-in for an absent or expired session. */
          }
        }
      } catch (e) {
        notifyError(e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);
  useEffect(() => {
    if (demo && loaded)
      localStorage.setItem('mane-demo-v1', JSON.stringify({ posts, actions, meetings, spaces }));
  }, [demo, loaded, posts, actions, meetings, spaces]);
  const refresh = useCallback(async () => {
    if (!session || demo) return;
    try {
      const [ss, mm, aa, uu, nn, tt] = await Promise.all([
        api<Space[]>('/spaces'),
        api<Meeting[]>('/meetings'),
        api<Action[]>('/action-items'),
        api<User[]>('/users'),
        api<Notification[]>('/notifications'),
        api<Thread[]>('/dm/threads'),
      ]);
      setSpaces(ss);
      setSpaceId((previous) => previous || ss[0]?.id || '');
      setMeetings(mm);
      setActions(aa);
      setUsers(uu);
      setNotifications(nn);
      setThreads(tt);
    } catch (e) {
      notifyError(e);
    }
  }, [api, session, demo]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const refreshPosts = useCallback(async () => {
    if (!session || demo || !spaceId) return;
    try {
      setPosts(await api<Post[]>(`/spaces/${spaceId}/posts`));
    } catch (e) {
      notifyError(e);
    }
  }, [api, session, demo, spaceId]);
  useEffect(() => {
    void refreshPosts();
  }, [refreshPosts]);
  useEffect(() => {
    if (demo || !session) return;
    const connection = io({
      path: '/socket.io',
      addTrailingSlash: false,
      transports: ['polling'],
      auth: { csrfToken: session.csrfToken },
    });
    socket.current = connection;
    connection.on('connect', () => {
      if (spaceId) connection.emit('subscribe', { spaceId });
      if (threadId) connection.emit('subscribe', { threadId });
    });
    for (const event of ['post', 'post.updated', 'post.deleted', 'comment', 'reaction'])
      connection.on(event, () => void refreshPosts());
    for (const event of ['meeting', 'notification', 'space']) connection.on(event, () => void refresh());
    connection.on('message', () => {
      if (threadId)
        void api<Message[]>(`/dm/threads/${threadId}/messages`)
          .then((m) => {
            setMessages(m.reverse());
            return api(`/dm/threads/${threadId}/read`, 'POST', {});
          })
          .catch(notifyError);
    });
    connection.on('read', () => {
      if (threadId)
        void api<Message[]>(`/dm/threads/${threadId}/messages`)
          .then((m) => setMessages(m.reverse()))
          .catch(notifyError);
    });
    connection.on('typing', (data: { userId: string; displayName?: string; threadId: string }) => {
      if (data.userId === session.user.id || data.threadId !== threadId) return;
      setTyping(data.displayName || 'Someone');
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => setTyping(''), 2500);
    });
    return () => {
      connection.disconnect();
      socket.current = null;
    };
  }, [session, demo, spaceId, threadId, api, refresh, refreshPosts]);
  useEffect(() => {
    if (demo || !threadId || !session) return;
    let current = true;
    api<Message[]>(`/dm/threads/${threadId}/messages`)
      .then((m) => {
        if (current) setMessages(m.reverse());
        return api(`/dm/threads/${threadId}/read`, 'POST', {});
      })
      .catch(notifyError);
    return () => {
      current = false;
    };
  }, [api, demo, session, threadId]);
  useEffect(() => {
    messageEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setModal('search');
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, []);
  const currentSpace = spaces.find((s) => s.id === spaceId);
  const user = session?.user;
  const filteredPosts = posts.filter((p) => p.spaceId === spaceId && (tab !== 'pinned' || p.pinned));
  const openActions = actions.filter((a) => a.status === 'open');
  function navigate(next: View) {
    setView(next);
    setTab('all');
    setMeetingId('');
    setError('');
    setNotice('');
    setMobile(false);
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }
  async function publish(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !user) return;
    await perform(async () => {
      let attachments: string[] = [];
      if (attachment) {
        if (demo)
          throw new Error('File uploads are available in your connected workspace. Demo posts support text.');
        const form = new FormData();
        form.append('file', attachment);
        const media = await api<{ id: string }>('/media', 'POST', form);
        attachments = [media.id];
      }
      const post = demo
        ? {
            id: crypto.randomUUID(),
            spaceId,
            authorId: user.id,
            authorName: user.displayName,
            body: draft,
            pinned: false,
            createdAt: new Date().toISOString(),
            commentCount: 0,
            reactions: [],
          }
        : await api<Post>(`/spaces/${spaceId}/posts`, 'POST', { body: draft, attachments });
      setPosts((p) => [post, ...p.filter((x) => x.id !== post.id)]);
      setDraft('');
      setAttachment(null);
    });
  }
  async function react(post: Post, emoji: string) {
    await perform(async () => {
      if (!demo) {
        await api('/reactions', 'POST', { targetType: 'post', targetId: post.id, emoji });
        await refreshPosts();
        return;
      }
      setPosts((all) =>
        all.map((p) => {
          if (p.id !== post.id) return p;
          const found = p.reactions.find((r) => r.emoji === emoji);
          return {
            ...p,
            reactions: found
              ? p.reactions
                  .map((r) =>
                    r.emoji === emoji ? { ...r, count: r.count + (r.mine ? -1 : 1), mine: !r.mine } : r,
                  )
                  .filter((r) => r.count > 0)
              : [...p.reactions, { emoji, count: 1, mine: true }],
          };
        }),
      );
    });
  }
  async function toggleAction(action: Action) {
    await perform(async () => {
      const status = action.status === 'done' ? 'open' : 'done';
      if (!demo) await api(`/action-items/${action.id}`, 'PATCH', { status });
      setActions((all) => all.map((a) => (a.id === action.id ? { ...a, status } : a)));
    });
  }
  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    await perform(async () => {
      setResults(
        demo
          ? posts
              .filter((p) => p.body.toLowerCase().includes(query.toLowerCase()))
              .map((p) => ({ id: p.id, type: 'post', text: p.body, parentId: p.spaceId }))
          : await api(`/search?q=${encodeURIComponent(query)}`),
      );
      setSearched(true);
    });
  }
  async function newSpace(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    await perform(async () => {
      const space = demo
        ? {
            id: crypto.randomUUID(),
            name: String(data.name),
            description: String(data.description),
            visibility: String(data.visibility),
            memberCount: 1,
          }
        : await api<Space>('/spaces', 'POST', data);
      setSpaces((a) => [...a, space]);
      setSpaceId(space.id);
      navigate('feed');
      setModal('');
    });
  }
  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!message.trim() || !threadId || !user) return;
    await perform(async () => {
      const m = demo
        ? {
            id: crypto.randomUUID(),
            senderId: user.id,
            senderName: user.displayName,
            body: message,
            createdAt: new Date().toISOString(),
          }
        : await api<Message>(`/dm/threads/${threadId}/messages`, 'POST', { body: message });
      setMessages((all) => [...all.filter((x) => x.id !== m.id), m]);
      setMessage('');
    });
  }
  if (!loaded)
    return (
      <main id="main" className="loading-page">
        <LoaderCircle className="spin" size={19} /> Opening your workspace…
      </main>
    );
  if (!session || !user)
    return (
      <AuthPanel
        setup={setup}
        provider={provider}
        initialError={error}
        onSuccess={(s) => {
          setSession(s);
          setError('');
        }}
      />
    );
  return (
    <div className="workspace">
      {mobile && <div className="sidebar-shade" onClick={() => setMobile(false)} />}
      <aside className={`sidebar ${mobile ? 'open' : ''}`} aria-label="Workspace navigation">
        <div className="sidebar-brand">
          <a href="/" className="wordmark">
            Mane<span>®</span>
          </a>
          <span className="local-label">
            <i className="status-dot" />
            {demo ? 'DEMO' : 'LOCAL'}
          </span>
        </div>
        <div className="sidebar-org">
          <strong>{session.org.name}</strong>
          <span>Your private workspace.</span>
        </div>
        <nav className="sidebar-nav">
          <button className={`nav-item ${view === 'feed' ? 'active' : ''}`} onClick={() => navigate('feed')}>
            <Home size={16} />
            <span>Home</span>
          </button>
          <button className="nav-item" onClick={() => setModal('search')}>
            <Search size={16} />
            <span>Search</span>
            <span style={{ fontSize: 8 }}>⌘ K</span>
          </button>
          <button
            className={`nav-item ${view === 'meetings' ? 'active' : ''}`}
            onClick={() => navigate('meetings')}
          >
            <FileText size={16} />
            <span>Meeting minutes</span>
            {meetings.filter((m) => m.status === 'review').length > 0 && (
              <span className="nav-count">{meetings.filter((m) => m.status === 'review').length}</span>
            )}
          </button>
          <button
            className={`nav-item ${view === 'actions' ? 'active' : ''}`}
            onClick={() => navigate('actions')}
          >
            <CheckSquare size={16} />
            <span>My action items</span>
            {openActions.length > 0 && <span className="nav-count">{openActions.length}</span>}
          </button>
          <div className="nav-label">
            SPACES
            <button aria-label="Create space" className="icon-button" onClick={() => setModal('space')}>
              <Plus size={13} />
            </button>
          </div>
          {spaces.map((s) => (
            <button
              key={s.id}
              className={`nav-item ${spaceId === s.id && view === 'feed' ? 'space-active' : ''}`}
              onClick={() => {
                setSpaceId(s.id);
                setTab('all');
                navigate('feed');
              }}
            >
              {s.visibility === 'private' ? <Lock size={14} /> : <Hash size={15} />}
              <span>{s.name}</span>
              {spaceId === s.id && view === 'feed' && <span>↗</span>}
            </button>
          ))}
          {product.flags['chat.dms'] && (
            <>
              <div className="nav-label">
                DIRECT MESSAGES
                <button
                  aria-label="New direct message"
                  className="icon-button"
                  onClick={() => setModal('dm')}
                >
                  <Plus size={13} />
                </button>
              </div>
              {threads.slice(0, 4).map((t) => (
                <button
                  className={`nav-item ${view === 'messages' && threadId === t.id ? 'active' : ''}`}
                  key={t.id}
                  onClick={() => {
                    setThreadId(t.id);
                    navigate('messages');
                  }}
                >
                  <span className="status-dot" />
                  <span>
                    {t.participants
                      ?.filter((p) => p.id !== user.id)
                      .map((p) => p.displayName)
                      .join(', ') || 'Conversation'}
                  </span>
                  {!!t.unreadCount && <span className="nav-count">{t.unreadCount}</span>}
                </button>
              ))}
              <button className="nav-item" onClick={() => navigate('messages')}>
                <MessagesSquare size={15} />
                <span>All messages</span>
              </button>
            </>
          )}
          {user.role === 'admin' && (
            <>
              <div className="nav-label">WORKSPACE</div>
              <button
                className={`nav-item ${view === 'settings' ? 'active' : ''}`}
                onClick={() => navigate('settings')}
              >
                <Settings size={15} />
                <span>Settings & people</span>
              </button>
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <Avatar name={user.displayName} dark />
          <div className="user-meta">
            <strong>{user.displayName}</strong>
            <span>{user.role === 'admin' ? 'Organisation admin' : 'Member'}</span>
          </div>
          <button
            className="icon-button"
            aria-label={demo ? 'Leave demo' : 'Sign out'}
            onClick={() =>
              void perform(async () => {
                if (!demo) await api('/auth/logout', 'POST', {});
                window.location.href = '/app';
              })
            }
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            <span>WORKSPACE</span>
            <span>/</span>
            <strong>
              {view === 'feed'
                ? 'MANE-CHAT'
                : view === 'meetings'
                  ? 'MANE-DOC'
                  : view === 'actions'
                    ? 'MY ACTION ITEMS'
                    : view === 'messages'
                      ? 'DIRECT MESSAGES'
                      : 'ADMINISTRATION'}
            </strong>
          </div>
          <div className="topbar-actions">
            <button className="search-trigger" onClick={() => setModal('search')}>
              <Search size={14} />
              <span>Find something</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="icon-button"
              aria-label="Notifications"
              onClick={() => setModal('notifications')}
            >
              <Bell size={18} />
              {notifications.some((n) => !n.readAt) && <span className="notification-dot" />}
            </button>
            <Avatar name={user.displayName} />
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <span>
              <strong>DEMO WORKSPACE</strong> · Sample people and meetings. Changes stay in this browser.
            </span>
            <a href="/app">Create your workspace ↗</a>
          </div>
        )}
        {!demo && session.license?.mode === 'evaluation' && (
          <div className="demo-banner">
            <span>
              <strong>14-DAY EVALUATION</strong> ·{' '}
              {session.license.expired
                ? 'Evaluation ended. Install a license to add people.'
                : 'Your private workspace is ready to explore.'}
            </span>
            {user.role === 'admin' && (
              <button
                className="text-link"
                style={{ marginTop: 0, border: 0, background: 'transparent' }}
                onClick={() => navigate('settings')}
              >
                Manage license ↗
              </button>
            )}
          </div>
        )}
        {!demo && session.license?.updatesAvailable === false && (
          <div className="notice" style={{ margin: '16px 38px' }}>
            Updates unavailable. Your existing accounts can still sign in. Ask your administrator to review
            the appliance license.
          </div>
        )}
        <main id="main" className="workspace-content">
          {error && (
            <div role="alert" className="notice error">
              {error}
              <button
                className="icon-button"
                style={{ float: 'right', height: 20 }}
                aria-label="Dismiss error"
                onClick={() => setError('')}
              >
                <X size={13} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
            </div>
          )}
          {view === 'feed' && (
            <>
              <div className="view-header">
                <div>
                  <div className="eyebrow">A PLACE FOR YOUR PEOPLE.</div>
                  <h1>
                    {currentSpace?.name || 'Your spaces'}
                    <span
                      style={{ fontFamily: 'var(--mono)', fontSize: 15, marginLeft: 12, color: '#879274' }}
                    >
                      ↙
                    </span>
                  </h1>
                  <p>{currentSpace?.description || 'Create a space to start your first conversation.'}</p>
                </div>
                <button className="button small" onClick={() => setModal('members')}>
                  <Users size={14} />
                  {currentSpace?.memberCount || 1} members
                </button>
              </div>
              <div className="feed-layout">
                <section>
                  <div className="feed-tabs">
                    <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
                      Conversation
                    </button>
                    <button
                      className={`tab ${tab === 'pinned' ? 'active' : ''}`}
                      onClick={() => setTab('pinned')}
                    >
                      <Pin size={11} style={{ display: 'inline', marginRight: 7 }} />
                      Pinned posts
                    </button>
                  </div>
                  {spaceId && (
                    <form className="composer" onSubmit={publish}>
                      <div className="composer-body">
                        <Avatar name={user.displayName} />
                        <textarea
                          aria-label="Write a post"
                          placeholder="What’s on your mind? Share it with your people."
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          required
                          maxLength={20000}
                        />
                      </div>
                      <div className="composer-footer">
                        <label className="icon-button" title="Attach an image" aria-label="Attach an image">
                          <ImagePlus size={17} />
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            style={{ display: 'none' }}
                            onChange={(e) => setAttachment(e.target.files?.[0] || null)}
                          />
                        </label>
                        <span>
                          {attachment ? attachment.name : 'MARKDOWN WELCOME. GOOD CONVERSATIONS TOO.'}
                        </span>
                        <button disabled={busy || !draft.trim()} className="button black small">
                          Post <ArrowUpRight size={14} />
                        </button>
                      </div>
                    </form>
                  )}
                  {filteredPosts.length === 0 ? (
                    <Empty title={tab === 'pinned' ? 'Nothing pinned yet.' : 'Start a conversation.'}>
                      {tab === 'pinned'
                        ? 'Pin a useful post to keep it close.'
                        : 'Share an update, ask a question, or introduce yourself.'}
                    </Empty>
                  ) : (
                    filteredPosts.map((post) => (
                      <PostCard
                        key={post.id}
                        post={post}
                        user={user}
                        demo={demo}
                        api={api}
                        onError={notifyError}
                        onReact={(emoji) => void react(post, emoji)}
                        onMeeting={() => {
                          setMeetingId(post.meetingId!);
                          setView('meetings');
                        }}
                        onPin={() =>
                          void perform(async () => {
                            if (!demo) await api(`/posts/${post.id}`, 'PATCH', { pinned: !post.pinned });
                            setPosts((all) =>
                              all.map((p) => (p.id === post.id ? { ...p, pinned: !p.pinned } : p)),
                            );
                          })
                        }
                      />
                    ))
                  )}
                </section>
                <aside className="feed-aside">
                  <div className="side-card">
                    <h2>
                      <Info size={14} />
                      ABOUT THIS SPACE
                    </h2>
                    <div className="side-card-content">
                      <p>{currentSpace?.description}</p>
                      <div className="member-stack">
                        {users.slice(0, 4).map((u) => (
                          <Avatar key={u.id} name={u.displayName} />
                        ))}
                      </div>
                      <p>{currentSpace?.memberCount || users.length} people. One shared space.</p>
                    </div>
                    <div className="side-card-footer">
                      <span>
                        {currentSpace?.visibility === 'private'
                          ? 'PRIVATE SPACE'
                          : 'OPEN TO YOUR ORGANISATION'}
                      </span>
                      {currentSpace?.visibility === 'private' ? (
                        <Lock size={12} />
                      ) : (
                        <ArrowUpRight size={13} />
                      )}
                    </div>
                  </div>
                  <div className="side-card">
                    <h2>
                      <CheckSquare size={14} />
                      ON YOUR LIST{' '}
                      <span style={{ marginLeft: 'auto', fontSize: 9 }}>{openActions.length}</span>
                    </h2>
                    <div className="side-card-content">
                      {openActions.length ? (
                        openActions.slice(0, 3).map((a) => (
                          <div key={a.id} className="action-row">
                            <CheckBox
                              checked={false}
                              onClick={() => void toggleAction(a)}
                              label={`Complete ${a.text}`}
                            />
                            <div>
                              <p>{a.text}</p>
                              <small>{a.dueDate ? `Due ${stamp(a.dueDate)}` : 'No due date'}</small>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p>Nothing waiting on you. A little space to focus.</p>
                      )}
                    </div>
                    <button
                      className="side-card-footer"
                      style={{
                        width: '100%',
                        background: 'transparent',
                        borderLeft: 0,
                        borderRight: 0,
                        borderBottom: 0,
                      }}
                      onClick={() => navigate('actions')}
                    >
                      ALL ACTION ITEMS <ArrowRight size={13} />
                    </button>
                  </div>
                  <div className="side-card dark">
                    <div className="side-card-content">
                      <span className="eyebrow">
                        <ShieldCheck size={12} /> YOUR NETWORK. YOUR RULES.
                      </span>
                      <h3>
                        GOOD WORK
                        <br />
                        STAYS CLOSE.
                      </h3>
                      <p>
                        Every message. Every decision.
                        <br />
                        Right here, where it belongs.
                      </p>
                      <a className="text-link" href="/docs#privacy">
                        Built for control <ArrowUpRight size={13} />
                      </a>
                    </div>
                  </div>
                </aside>
              </div>
            </>
          )}
          {view === 'meetings' &&
            (meetingId ? (
              <MeetingReview
                id={meetingId}
                demo={demo}
                meetings={meetings}
                api={api}
                user={user}
                onBack={() => setMeetingId('')}
                onError={notifyError}
                onPublished={(id, content) => {
                  if (demo) {
                    setMeetings((all) => all.map((m) => (m.id === id ? { ...m, status: 'published' } : m)));
                    const m = meetings.find((m) => m.id === id)!;
                    setPosts((all) => [
                      {
                        id: `published-${id}`,
                        spaceId: m.spaceId,
                        authorId: user.id,
                        authorName: user.displayName,
                        body: `## ${content.title}\n\n${content.summary}`,
                        pinned: false,
                        createdAt: new Date().toISOString(),
                        commentCount: 0,
                        reactions: [],
                        meetingId: id,
                      },
                      ...all.filter((p) => p.id !== `published-${id}`),
                    ]);
                  } else void refresh();
                  setNotice(
                    demo
                      ? 'Demo minutes published to the space.'
                      : 'Approved. The local worker is rendering your documents before publication.',
                  );
                }}
              />
            ) : (
              <>
                <div className="view-header">
                  <div>
                    <div className="eyebrow">FROM CONVERSATION TO CLARITY.</div>
                    <h1>Meeting minutes.</h1>
                    <p>The decisions you made. The things you’ll do next. All in one place.</p>
                  </div>
                  <button className="button black" onClick={() => setModal('upload')}>
                    <Upload size={15} />
                    Upload recording
                  </button>
                </div>
                <div className="feed-tabs">
                  {['all', 'review', 'published'].map((t) => (
                    <button className={`tab ${tab === t ? 'active' : ''}`} key={t} onClick={() => setTab(t)}>
                      {t === 'all' ? 'All meetings' : t === 'review' ? 'Needs review' : 'Published'}
                    </button>
                  ))}
                </div>
                {meetings.filter((m) => !['review', 'published'].includes(tab) || m.status === tab).length ? (
                  <div className="list-table">
                    <div className="table-row header">
                      <span>Meeting</span>
                      <span>Status</span>
                      <span>Space</span>
                      <span>Date</span>
                    </div>
                    {meetings
                      .filter((m) => !['review', 'published'].includes(tab) || m.status === tab)
                      .map((m) => (
                        <button key={m.id} className="table-row" onClick={() => setMeetingId(m.id)}>
                          <span className="table-title">
                            <FileText size={23} strokeWidth={1.2} />
                            <span>
                              <strong>{m.title}</strong>
                              <small>
                                {m.status === 'review'
                                  ? 'A draft, ready for your perspective.'
                                  : m.status === 'published'
                                    ? 'Reviewed, approved, and shared.'
                                    : 'Processing on your appliance.'}
                              </small>
                            </span>
                          </span>
                          <Badge status={m.status} />
                          <span>{m.spaceName || spaces.find((s) => s.id === m.spaceId)?.name}</span>
                          <span>{stamp(m.heldAt || m.createdAt)}</span>
                        </button>
                      ))}
                  </div>
                ) : (
                  <Empty title="Make the meeting count.">
                    Upload a recording to turn a conversation into clear, evidence-linked minutes.
                  </Empty>
                )}
              </>
            ))}
          {view === 'actions' && (
            <>
              <div className="view-header">
                <div>
                  <div className="eyebrow">GOOD INTENTIONS. REAL PROGRESS.</div>
                  <h1>My action items.</h1>
                  <p>Small steps that move the work forward.</p>
                </div>
                <span className="badge">{openActions.length} open</span>
              </div>
              <div className="feed-tabs">
                {['all', 'open', 'done'].map((t) => (
                  <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                    {t === 'all' ? 'Everything' : t === 'open' ? 'To do' : 'Completed'}
                  </button>
                ))}
              </div>
              <div className="review-sheet">
                {actions
                  .filter((a) => !['open', 'done'].includes(tab) || a.status === tab)
                  .map((a) => (
                    <div key={a.id} className={`action-row ${a.status === 'done' ? 'done' : ''}`}>
                      <CheckBox
                        checked={a.status === 'done'}
                        onClick={() => void toggleAction(a)}
                        label={`Toggle ${a.text}`}
                      />
                      <div style={{ flex: 1 }}>
                        <p>{a.text}</p>
                        <small>
                          {a.dueDate ? `Due ${stamp(a.dueDate)}` : 'No due date'} ·{' '}
                          {a.ownerText || user.displayName}
                        </small>
                      </div>
                      <button
                        className="icon-button"
                        aria-label={`View source for ${a.text}`}
                        onClick={() => {
                          setMeetingId(a.meetingId);
                          setView('meetings');
                        }}
                      >
                        <ArrowUpRight size={16} />
                      </button>
                    </div>
                  ))}
                {!actions.length && (
                  <Empty title="A clear list.">
                    Assigned actions will appear here when meeting minutes are published.
                  </Empty>
                )}
              </div>
            </>
          )}
          {view === 'messages' && (
            <>
              <div className="view-header">
                <div>
                  <div className="eyebrow">KEEP THE CONVERSATION CLOSE.</div>
                  <h1>Direct messages.</h1>
                  <p>A little room for a conversation.</p>
                </div>
                <button className="button black" onClick={() => setModal('dm')}>
                  <Plus size={15} />
                  New message
                </button>
              </div>
              <div className="dm-layout">
                <div className="dm-threads">
                  {threads.map((t) => (
                    <button
                      key={t.id}
                      className={`dm-thread ${threadId === t.id ? 'active' : ''}`}
                      onClick={() => setThreadId(t.id)}
                    >
                      <Avatar name={t.participants?.find((p) => p.id !== user.id)?.displayName || 'Team'} />
                      <span>
                        <strong>
                          {t.participants
                            ?.filter((p) => p.id !== user.id)
                            .map((p) => p.displayName)
                            .join(', ') || 'Conversation'}
                        </strong>
                        <small>Private conversation</small>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="dm-conversation">
                  {threadId ? (
                    <>
                      <div className="dm-messages">
                        {messages.map((m) => (
                          <div key={m.id} className={`dm-message ${m.senderId === user.id ? 'mine' : ''}`}>
                            <Avatar name={m.senderName || 'Member'} />
                            <div className="dm-message-body">
                              <small>
                                {m.senderName || 'Member'} ·{' '}
                                {new Date(m.createdAt).toLocaleTimeString('en-US', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </small>
                              {m.body}
                              {m.senderId === user.id && (
                                <small style={{ marginTop: 8 }}>{m.readCount ? 'Read' : 'Sent'}</small>
                              )}
                            </div>
                          </div>
                        ))}
                        {typing && <p className="form-hint">{typing} is typing…</p>}
                        <div ref={messageEnd} />
                      </div>
                      <form className="comment-form" onSubmit={sendMessage}>
                        <input
                          className="input"
                          value={message}
                          aria-label="Message"
                          placeholder="Write a message…"
                          required
                          onChange={(e) => {
                            setMessage(e.target.value);
                            socket.current?.emit('typing', { threadId });
                          }}
                        />
                        <button
                          className="button black small"
                          disabled={busy || !message.trim()}
                          aria-label="Send message"
                        >
                          <Send size={16} />
                        </button>
                      </form>
                    </>
                  ) : (
                    <Empty title="A conversation starts here.">
                      Choose someone from the list or start a new direct message.
                    </Empty>
                  )}
                </div>
              </div>
            </>
          )}
          {view === 'settings' && user.role === 'admin' && (
            <AdminPanel demo={demo} api={api} users={users} setUsers={setUsers} onError={notifyError} />
          )}
        </main>
      </div>
      {modal && (
        <Modal
          title={
            modal === 'space'
              ? 'A new space.'
              : modal === 'search'
                ? 'Find what matters.'
                : modal === 'upload'
                  ? 'Make the meeting count.'
                  : modal === 'notifications'
                    ? 'Your notifications.'
                    : modal === 'dm'
                      ? 'Start a conversation.'
                      : 'The people in this space.'
          }
          onClose={() => {
            setModal('');
            setError('');
          }}
        >
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {modal === 'space' && (
            <form onSubmit={newSpace}>
              <Field label="Space name">
                <input name="name" className="input" required maxLength={80} placeholder="e.g. Product" />
              </Field>
              <Field label="A little context">
                <textarea
                  name="description"
                  className="input"
                  maxLength={500}
                  placeholder="What brings people to this space?"
                />
              </Field>
              <Field label="Who can see this space?">
                <select name="visibility" className="input">
                  <option value="open">Open — everyone in your organisation</option>
                  <option value="private">Private — invited members only</option>
                </select>
              </Field>
              <div className="form-footer">
                <button className="button black" disabled={busy}>
                  Create space <ArrowUpRight size={16} />
                </button>
              </div>
            </form>
          )}
          {modal === 'search' && (
            <>
              <form className="comment-form" onSubmit={search}>
                <input
                  className="input"
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSearched(false);
                  }}
                  placeholder="Search conversations, decisions, and more"
                  aria-label="Search workspace"
                />
                <button className="button black small" disabled={busy}>
                  <Search size={15} />
                </button>
              </form>
              <p className="form-hint" style={{ marginTop: 15 }}>
                Only content you have access to appears here.
              </p>
              {results.map((r) => (
                <button
                  className="search-result"
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    background: 'transparent',
                    borderTop: 0,
                    borderLeft: 0,
                    borderRight: 0,
                  }}
                  key={r.id}
                  onClick={() => {
                    if (r.type === 'minutes' || r.type === 'transcript') {
                      setMeetingId(r.parentId || r.id);
                      setView('meetings');
                    } else if (r.type === 'message') {
                      setThreadId(r.parentId || '');
                      navigate('messages');
                    } else {
                      if (r.parentId) setSpaceId(r.parentId);
                      navigate('feed');
                    }
                    setModal('');
                  }}
                >
                  <small>{r.type} ↗</small>
                  {r.text.slice(0, 240)}
                </button>
              ))}
              {searched && !results.length && (
                <Empty title="Nothing found.">Try a different word or phrase.</Empty>
              )}
            </>
          )}
          {modal === 'upload' && (
            <UploadMeeting
              demo={demo}
              spaces={spaces}
              users={users}
              currentUser={user}
              api={api}
              onError={notifyError}
              onDone={(m) => {
                setMeetings((all) => [m, ...all]);
                setModal('');
                setMeetingId(m.id);
                setView('meetings');
              }}
              onDemo={() => {
                setModal('');
                setMeetingId('meeting-1');
                setView('meetings');
              }}
            />
          )}
          {modal === 'dm' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const ids = new FormData(e.currentTarget).getAll('userIds').map(String);
                if (ids.length < 1 || ids.length > 9) {
                  setError('Choose between 1 and 9 other people.');
                  return;
                }
                void perform(async () => {
                  const t = demo
                    ? {
                        id: crypto.randomUUID(),
                        participants: [user, ...users.filter((u) => ids.includes(u.id))],
                      }
                    : await api<Thread>('/dm/threads', 'POST', { userIds: ids });
                  setThreads((all) => [t, ...all]);
                  setThreadId(t.id);
                  if (demo) setMessages([]);
                  setModal('');
                  navigate('messages');
                  if (!demo) void refresh();
                });
              }}
            >
              <p className="form-hint" style={{ marginBottom: 20 }}>
                Choose up to 9 people. Conversations stay inside your organisation.
              </p>
              {users
                .filter((u) => u.id !== user.id)
                .map((u) => (
                  <label key={u.id} className="action-row" style={{ alignItems: 'center' }}>
                    <input type="checkbox" name="userIds" value={u.id} />
                    <Avatar name={u.displayName} />
                    <span>{u.displayName}</span>
                  </label>
                ))}
              <div className="form-footer">
                <button className="button black" disabled={busy}>
                  Start conversation <ArrowRight size={16} />
                </button>
              </div>
            </form>
          )}
          {modal === 'members' && (
            <SpaceMembers demo={demo} api={api} spaceId={spaceId} users={users} onError={notifyError} />
          )}
          {modal === 'notifications' && (
            <>
              {notifications.length ? (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    className="search-result"
                    style={{
                      background: 'transparent',
                      borderTop: 0,
                      borderLeft: 0,
                      borderRight: 0,
                      textAlign: 'left',
                      width: '100%',
                    }}
                    onClick={() => {
                      if (n.kind === 'review') {
                        navigate('meetings');
                        if (demo) setMeetingId('meeting-1');
                        else if (n.href?.startsWith('/app/meetings/')) setMeetingId(n.href.split('/')[3]);
                      } else if (n.kind === 'dm') {
                        navigate('messages');
                        if (n.href)
                          setThreadId(
                            new URL(n.href, window.location.origin).searchParams.get('thread') || '',
                          );
                      } else {
                        navigate('feed');
                        if (n.href?.startsWith('/app/spaces/')) setSpaceId(n.href.split('/')[3]);
                      }
                      setModal('');
                      if (!demo)
                        void api('/notifications/read', 'POST', { id: n.id })
                          .then(() => refresh())
                          .catch(notifyError);
                      else
                        setNotifications((all) =>
                          all.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
                        );
                    }}
                  >
                    <small>
                      {n.kind} · {stamp(n.createdAt)} {!n.readAt ? '• NEW' : ''}
                    </small>
                    {n.title} <ArrowUpRight size={13} style={{ display: 'inline' }} />
                  </button>
                ))
              ) : (
                <Empty title="All caught up.">
                  Replies, mentions, messages and review requests will appear here.
                </Empty>
              )}
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function PostCard({
  post,
  user,
  demo,
  api,
  onError,
  onReact,
  onMeeting,
  onPin,
}: {
  post: Post;
  user: User;
  demo: boolean;
  api: Request;
  onError: (e: unknown) => void;
  onReact: (s: string) => void;
  onMeeting: () => void;
  onPin: () => void;
}) {
  const [showComments, setShowComments] = useState(false),
    [comments, setComments] = useState<Comment[]>([]),
    [text, setText] = useState(''),
    [pending, setPending] = useState(false),
    [reactionPicker, setReactionPicker] = useState(false);
  async function toggleComments() {
    const next = !showComments;
    setShowComments(next);
    if (next && !demo)
      try {
        setComments(await api<Comment[]>(`/posts/${post.id}/comments`));
      } catch (e) {
        onError(e);
      }
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setPending(true);
    try {
      const c = demo
        ? {
            id: crypto.randomUUID(),
            authorName: user.displayName,
            body: text,
            createdAt: new Date().toISOString(),
          }
        : await api<Comment>(`/posts/${post.id}/comments`, 'POST', { body: text });
      setComments((all) => [...all, c]);
      setText('');
    } catch (e) {
      onError(e);
    } finally {
      setPending(false);
    }
  }
  return (
    <article className={`post-card ${post.pinned ? 'pinned' : ''}`}>
      <header className="post-header">
        <Avatar name={post.authorName} />
        <div className="post-meta">
          <div>
            <strong>{post.authorName}</strong>
            <small>
              {new Date(post.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </small>
          </div>
          <p>{post.meetingId ? 'Shared a meeting with the team' : 'Shared with the space'}</p>
        </div>
        {post.pinned && (
          <span className="pinned-label">
            <Pin size={10} />
            PINNED
          </span>
        )}
        {user.role === 'admin' && (
          <button
            className="icon-button"
            aria-label={post.pinned ? 'Unpin post' : 'Pin post'}
            onClick={onPin}
          >
            <Pin size={13} />
          </button>
        )}
      </header>
      <div className="post-body">
        <div className="markdown">
          <ReactMarkdown>{post.body}</ReactMarkdown>
        </div>
        {post.meetingId && (
          <div className="meeting-attachment">
            <div className="attachment-heading">
              <FileText size={25} strokeWidth={1.4} />
              <div>
                <strong>Meeting minutes</strong>
                <p>Decisions. Actions. A little more clarity.</p>
              </div>
              <span className="badge">MANE-DOC</span>
            </div>
            <div className="attachment-actions">
              <button onClick={onMeeting}>
                View minutes <ArrowUpRight size={12} />
              </button>
            </div>
          </div>
        )}
        {!demo && !!post.attachments?.length && (
          <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
            {post.attachments.map((a, i) => (
              <a className="text-link" style={{ marginTop: 0 }} href={`/api/media/${a}`} key={a} download>
                <Paperclip size={12} />
                Attachment {i + 1} <Download size={12} />
              </a>
            ))}
          </div>
        )}
      </div>
      <footer className="post-footer">
        {(post.reactions || []).map((r) => (
          <button
            key={r.emoji}
            aria-label={`React ${r.emoji}`}
            className={`reaction ${r.mine ? 'selected' : ''}`}
            onClick={() => onReact(r.emoji)}
          >
            {r.emoji}
            <span>{r.count}</span>
          </button>
        ))}
        <button
          className="icon-button"
          aria-label="Add reaction"
          onClick={() => setReactionPicker(!reactionPicker)}
        >
          <Smile size={14} />
        </button>
        <button className="comment-button" onClick={() => void toggleComments()}>
          <MessageCircle size={14} />
          {Math.max(post.commentCount || 0, comments.length)} replies
        </button>
      </footer>
      {reactionPicker && (
        <div style={{ padding: '10px 20px', display: 'flex', gap: 8 }}>
          {['👍', '❤️', '🎉', '👀', '✅', '💡'].map((e) => (
            <button
              className="reaction"
              key={e}
              onClick={() => {
                onReact(e);
                setReactionPicker(false);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
      {showComments && (
        <div className="comments">
          {comments.map((c) => (
            <div key={c.id} className="comment">
              <Avatar name={c.authorName} />
              <div>
                <strong>{c.authorName}</strong>
                <p>{c.body}</p>
              </div>
            </div>
          ))}
          {demo && !comments.length && (
            <p className="form-hint" style={{ marginBottom: 15 }}>
              Sample reply counts are illustrative. Add your own reply below.
            </p>
          )}
          <form onSubmit={add} className="comment-form">
            <input
              className="input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
              placeholder="Keep the conversation going…"
              aria-label="Write a reply"
            />
            <button className="button black small" disabled={pending} aria-label="Send reply">
              <ArrowUpRight size={14} />
            </button>
          </form>
        </div>
      )}
    </article>
  );
}
function UploadMeeting({
  demo,
  spaces,
  users,
  currentUser,
  api,
  onError,
  onDone,
  onDemo,
}: {
  demo: boolean;
  spaces: Space[];
  users: User[];
  currentUser: User;
  api: Request;
  onError: (e: unknown) => void;
  onDone: (m: Meeting) => void;
  onDemo: () => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [pending, setPending] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    const form = new FormData(e.currentTarget);
    setPending(true);
    try {
      if (demo) {
        onDemo();
        return;
      }
      const body = new FormData();
      body.append('file', file);
      const media = await api<{ id: string }>('/media', 'POST', body);
      const held = String(form.get('heldAt') || '');
      const result = await api<Meeting>('/meetings', 'POST', {
        title: form.get('title'),
        spaceId: form.get('spaceId'),
        reviewerId: form.get('reviewerId'),
        audioMediaId: media.id,
        heldAt: held ? new Date(held).toISOString() : null,
        languageHint: form.get('languageHint') || null,
      });
      onDone(result);
    } catch (e) {
      onError(e);
    } finally {
      setPending(false);
    }
  }
  if (demo)
    return (
      <>
        <p className="form-hint" style={{ fontSize: 12, lineHeight: 1.9 }}>
          In your connected workspace, upload audio to generate minutes with local AI. This demo includes an
          illustrative draft so you can explore editing, evidence, and approval.
        </p>
        <div className="form-footer">
          <button className="button black" onClick={onDemo}>
            Review sample minutes <ArrowUpRight size={16} />
          </button>
        </div>
      </>
    );
  return (
    <form onSubmit={submit}>
      <label className="upload-drop">
        <Upload size={26} strokeWidth={1.2} />
        <strong>{file ? file.name : 'Choose a meeting recording'}</strong>
        <small>M4A, MP3, WAV, WEBM, OR MP4 AUDIO</small>
        <input
          type="file"
          accept=".m4a,.mp3,.wav,.webm,.mp4"
          required
          aria-label="Meeting recording"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </label>
      <Field label="Meeting title">
        <input
          className="input"
          name="title"
          required
          placeholder="e.g. Weekly product sync"
          maxLength={200}
        />
      </Field>
      <div className="form-row">
        <Field label="Held at">
          <input className="input" type="datetime-local" name="heldAt" />
        </Field>
        <Field label="Publish to">
          <select className="input" name="spaceId" required>
            {spaces.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="form-row">
        <Field label="Reviewer">
          <select className="input" name="reviewerId" defaultValue={currentUser.id}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Language">
          <select className="input" name="languageHint">
            <option value="">Detect automatically</option>
            {product.flags['doc.languages'].supported.map((l) => (
              <option key={l} value={l}>
                {l === 'en' ? 'English' : l}
              </option>
            ))}
            {product.flags['doc.languages'].beta.map((l) => (
              <option key={l} value={l}>
                {l === 'hi' ? 'Hindi / Hinglish — beta' : `${l} — beta`}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="form-hint">
        The reviewer must belong to the selected space. Audio and AI processing stay on your appliance.
      </p>
      <div className="form-footer">
        <button className="button black" disabled={pending || !file}>
          {pending ? <LoaderCircle className="spin" size={16} /> : 'Upload & generate'}
          <ArrowUpRight size={16} />
        </button>
      </div>
    </form>
  );
}
function SpaceMembers({
  demo,
  api,
  spaceId,
  users,
  onError,
}: {
  demo: boolean;
  api: Request;
  spaceId: string;
  users: User[];
  onError: (e: unknown) => void;
}) {
  const [members, setMembers] = useState<User[]>(demo ? users : []),
    [selected, setSelected] = useState('');
  useEffect(() => {
    if (!demo && spaceId) api<User[]>(`/spaces/${spaceId}/members`).then(setMembers).catch(onError);
  }, [spaceId, demo, api]);
  return (
    <>
      {members.map((u) => (
        <div className="action-row" key={u.id} style={{ alignItems: 'center' }}>
          <Avatar name={u.displayName} />
          <div>
            <p>{u.displayName}</p>
            <small>{u.role}</small>
          </div>
        </div>
      ))}
      <form
        style={{ marginTop: 20 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (demo) {
            const u = users.find((u) => u.id === selected);
            if (u) setMembers((m) => [...m, u]);
            return;
          }
          void api(`/spaces/${spaceId}/members`, 'POST', { userId: selected })
            .then(() => api<User[]>(`/spaces/${spaceId}/members`))
            .then(setMembers)
            .catch(onError);
        }}
      >
        <Field label="Add a member (space owners)">
          <select className="input" value={selected} onChange={(e) => setSelected(e.target.value)} required>
            <option value="">Choose someone</option>
            {users
              .filter((u) => !members.some((m) => m.id === u.id))
              .map((u) => (
                <option value={u.id} key={u.id}>
                  {u.displayName}
                </option>
              ))}
          </select>
        </Field>
        <button className="button black small" disabled={!selected}>
          Add to space <Plus size={13} />
        </button>
      </form>
    </>
  );
}
