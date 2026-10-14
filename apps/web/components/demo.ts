import type { Minutes } from '@mane/shared';
export interface User {
  id: string;
  displayName: string;
  email: string;
  role: string;
  isActive?: boolean;
}
export interface Space {
  id: string;
  name: string;
  description: string;
  visibility: string;
  memberCount?: number;
}
export interface Post {
  id: string;
  spaceId: string;
  authorId: string;
  authorName: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  commentCount: number;
  reactions: { emoji: string; count: number; mine: boolean }[];
  meetingId?: string;
  attachments?: string[];
}
export interface Comment {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
}
export interface Meeting {
  id: string;
  title: string;
  status: string;
  spaceId: string;
  spaceName?: string;
  reviewerId: string;
  createdAt: string;
  heldAt?: string | null;
}
export interface Action {
  id: string;
  text: string;
  status: string;
  ownerText?: string;
  dueDate?: string;
  meetingId: string;
}
export interface Thread {
  id: string;
  name?: string;
  participants?: User[];
  unreadCount?: number;
}
export interface Message {
  readCount?: number;
  id: string;
  senderId: string;
  senderName?: string;
  body: string;
  createdAt: string;
}
export interface Notification {
  id: string;
  title: string;
  kind: string;
  href?: string;
  readAt?: string | null;
  createdAt: string;
}
export interface MeetingDetail {
  meeting: Meeting;
  minutes: { content: Minutes; version?: number } | null;
  transcript: { segments: { start_s: number; end_s: number; text: string; speaker: string | null }[] } | null;
  audio: { id: string } | null;
  jobs?: { kind: string; status: string; error?: string }[];
  actionItems?: Action[];
}
export const demoUser: User = {
  id: 'demo-alex',
  displayName: 'Alex Morgan',
  email: 'alex@acme.local',
  role: 'admin',
};
export const demoUsers: User[] = [
  demoUser,
  { id: 'demo-priya', displayName: 'Priya Sharma', email: 'priya@acme.local', role: 'member' },
  { id: 'demo-daniel', displayName: 'Daniel Kim', email: 'daniel@acme.local', role: 'member' },
  { id: 'demo-maya', displayName: 'Maya Chen', email: 'maya@acme.local', role: 'member' },
];
const date = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();
export const demoSpaces: Space[] = [
  {
    id: 'general',
    name: 'General',
    description: 'The place for team updates, shared wins, and the conversations that bring us together.',
    visibility: 'open',
    memberCount: 12,
  },
  {
    id: 'product',
    name: 'Product',
    description: 'Building things that matter. Ideas, decisions, and the details in between.',
    visibility: 'open',
    memberCount: 8,
  },
  {
    id: 'engineering',
    name: 'Engineering',
    description: 'Architecture, implementation, and everything under the hood.',
    visibility: 'open',
    memberCount: 6,
  },
  {
    id: 'design',
    name: 'Design',
    description: 'A shared eye for the details.',
    visibility: 'open',
    memberCount: 4,
  },
];
export const demoPosts: Post[] = [
  {
    id: 'welcome',
    spaceId: 'general',
    authorId: 'demo-alex',
    authorName: 'Alex Morgan',
    body: '**A little less noise. A lot more focus.**\n\nWelcome to our space. This is where we share what’s happening, think out loud, and keep the important things close.\n\nSame people. A better place to work together.',
    pinned: true,
    createdAt: date(4),
    commentCount: 2,
    reactions: [
      { emoji: '👋', count: 8, mine: false },
      { emoji: '🖤', count: 4, mine: false },
    ],
  },
  {
    id: 'planning',
    spaceId: 'general',
    authorId: 'demo-priya',
    authorName: 'Priya Sharma',
    body: 'Good conversations deserve more than a forgotten recording.\n\nThe minutes from our product sync are ready to review. A clear direction, three decisions, and a few things to move forward. Take a look before we publish.',
    pinned: false,
    createdAt: date(1),
    commentCount: 3,
    reactions: [
      { emoji: '🙌', count: 5, mine: false },
      { emoji: '✓', count: 2, mine: true },
    ],
    meetingId: 'meeting-1',
  },
  {
    id: 'small-things',
    spaceId: 'general',
    authorId: 'demo-daniel',
    authorName: 'Daniel Kim',
    body: 'A small win for the week: the new onboarding flow is ready for a first look. Fewer steps, a little more clarity.\n\nI’ve shared the thinking in **#product**. Would love your perspective.',
    pinned: false,
    createdAt: date(2),
    commentCount: 1,
    reactions: [{ emoji: '🔥', count: 3, mine: false }],
  },
  {
    id: 'product-1',
    spaceId: 'product',
    authorId: 'demo-daniel',
    authorName: 'Daniel Kim',
    body: '**Onboarding, with less friction.**\n\nThe proposed flow starts with a single meaningful question: what are you here to do?\n\n- Bring the team together\n- Find decisions from a meeting\n- Get a project moving\n\nEach answer gets a clear next step. Feedback welcome.',
    pinned: false,
    createdAt: date(3),
    commentCount: 0,
    reactions: [],
  },
];
export const demoMeetings: Meeting[] = [
  {
    id: 'meeting-1',
    title: 'Weekly product sync',
    spaceId: 'general',
    spaceName: 'General',
    status: 'review',
    reviewerId: 'demo-alex',
    createdAt: date(1),
    heldAt: date(2),
  },
  {
    id: 'meeting-2',
    title: 'Design direction / September',
    spaceId: 'design',
    spaceName: 'Design',
    status: 'published',
    reviewerId: 'demo-maya',
    createdAt: date(24),
    heldAt: date(25),
  },
  {
    id: 'meeting-3',
    title: 'Engineering standup',
    spaceId: 'engineering',
    spaceName: 'Engineering',
    status: 'published',
    reviewerId: 'demo-daniel',
    createdAt: date(48),
    heldAt: date(49),
  },
];
export const demoActions: Action[] = [
  {
    id: 'a1',
    text: 'Share the updated onboarding flow',
    status: 'open',
    ownerText: 'Alex Morgan',
    dueDate: '2026-09-18',
    meetingId: 'meeting-1',
  },
  {
    id: 'a2',
    text: 'Review the first-run experience',
    status: 'open',
    ownerText: 'Alex Morgan',
    dueDate: '2026-09-20',
    meetingId: 'meeting-1',
  },
  {
    id: 'a3',
    text: 'Document the design principles',
    status: 'done',
    ownerText: 'Alex Morgan',
    dueDate: '2026-09-15',
    meetingId: 'meeting-2',
  },
];
export const demoMinutes: Minutes = {
  title: 'Weekly product sync',
  held_at: date(2),
  attendees: demoUsers.map((u) => ({ name: u.displayName, matched_user_id: null })),
  summary:
    'The team reviewed progress on the onboarding experience and aligned on a simpler first-run flow. The initial release will focus on helping new members find their team and join a conversation. Design and engineering agreed to test the revised flow together before expanding scope. The next review will focus on feedback from the first walkthrough.',
  agenda: ['Onboarding experience', 'Design and engineering alignment', 'Next steps and review'],
  decisions: [
    {
      text: 'Start onboarding with a single question about what the new member wants to do.',
      evidence: [{ start_s: 15, end_s: 28 }],
    },
    {
      text: 'Keep the initial release focused on joining the team and starting a conversation.',
      evidence: [{ start_s: 31, end_s: 48 }],
    },
  ],
  action_items: [
    {
      text: 'Share the updated onboarding flow',
      owner: 'Alex Morgan',
      due_date: '2026-09-18',
      evidence: [{ start_s: 52, end_s: 61 }],
    },
    {
      text: 'Schedule a joint design and engineering walkthrough',
      owner: 'Priya Sharma',
      due_date: null,
      evidence: [{ start_s: 64, end_s: 78 }],
    },
  ],
  open_questions: ['Which onboarding path should be the default for returning members?'],
  risks: ['Feedback from the first walkthrough may change the release scope.'],
  next_meeting: 'Review the first walkthrough together next week.',
  confidence_notes: ['Illustrative demo minutes. No recording was processed.'],
};
export const demoTranscript = [
  {
    start_s: 15,
    end_s: 28,
    speaker: 'Priya Sharma',
    text: 'Let’s start with one question: what are you here to do? That gives people a useful next step.',
  },
  {
    start_s: 31,
    end_s: 48,
    speaker: 'Daniel Kim',
    text: 'Agreed. The first release should help you find your team and join a conversation. We can expand from there.',
  },
  {
    start_s: 52,
    end_s: 61,
    speaker: 'Alex Morgan',
    text: 'I’ll share the updated onboarding flow by Friday, September eighteenth.',
  },
  {
    start_s: 64,
    end_s: 78,
    speaker: 'Priya Sharma',
    text: 'I’ll set up a walkthrough with design and engineering so we can get feedback together.',
  },
];
