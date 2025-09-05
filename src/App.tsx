import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from '@supabase/supabase-js';

// ---------------------------
// Supabase Setup & Types
// ---------------------------
// You must replace these with your actual Supabase URL and Anon Key.
// You can find them in your Supabase project settings under 'API'.
const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseAnonKey = 'YOUR_SUPABASE_ANON_KEY';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type User = {
  id: string;
  name: string;
  handle: string;
  avatar?: string;
  bio?: string;
  links?: string[];
};

export type Post = {
  id: string;
  userId: string;
  text: string;
  media: string[];
  likes: number;
  recasts: number;
  comments: number;
  createdAt: string; // Storing as ISO string to be friendly with Supabase
};

export type Story = {
  id: string;
  userId: string;
  url: string;
  createdAt: string;
  expiresAt: string;
};

// State types remain similar, but the data will be fetched from Supabase
type Tab = "forYou" | "following" | "latest";
type Route = { name: "feed" } | { name: "profile"; userId: string };

type AppState = {
  me: User | null; // Use null to handle loading state
  following: string[];
  users: Record<string, User>;
  stories: Story[];
  posts: Post[];
  likes: Record<string, boolean>;
  recasts: Record<string, boolean>;
};

// ---------------------------
// Helpers
// ---------------------------
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10);

const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(n, min), max);

const formatCount = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : String(n);

const placeholderImg = (seed = "U") => {
  const bg = encodeURIComponent("#232736");
  const txt = encodeURIComponent(seed[0] || "U");
  return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400'><rect width='100%' height='100%' fill='${bg}'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='white' font-size='120' font-family='system-ui'>${txt}</text></svg>`;
};

const timeAgo = (ts: string) => {
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  const days = Math.floor(d / 86400);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString();
};

const safeLinkProps = { target: "_blank", rel: "noopener noreferrer" } as const;

// ---------------------------
// App
// ---------------------------
export default function App() {
  const [state, setState] = useState<AppState>({
    me: null, // Start with null to show loading
    following: [],
    users: {},
    stories: [],
    posts: [],
    likes: {},
    recasts: {},
  });
  const [theme, setTheme] = useState<string>(
    () =>
      localStorage.getItem("fuse/theme") ||
      (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
  );
  const [route, setRoute] = useState<Route>({ name: "feed" });
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("forYou");
  const [tick, setTick] = useState(0); // drive timeAgo refresh

  // Fetch initial data from Supabase
  useEffect(() => {
    async function fetchData() {
      // For this example, we'll assume a single user 'u1' is logged in
      const { data: me, error: meError } = await supabase
        .from('users')
        .select('*')
        .eq('id', 'u1')
        .single();
      if (meError) console.error("Error fetching user data:", meError);

      const { data: users, error: usersError } = await supabase.from('users').select('*');
      if (usersError) console.error("Error fetching users:", usersError);

      const { data: posts, error: postsError } = await supabase.from('posts').select('*').order('createdAt', { ascending: false });
      if (postsError) console.error("Error fetching posts:", postsError);

      const { data: stories, error: storiesError } = await supabase.from('stories').select('*').order('createdAt', { ascending: false });
      if (storiesError) console.error("Error fetching stories:", storiesError);

      const { data: likes } = await supabase.from('likes').select('*').eq('userId', me?.id);
      const { data: recasts } = await supabase.from('recasts').select('*').eq('userId', me?.id);

      if (me) {
        setState((s) => ({
          ...s,
          me: me as User,
          users: users?.reduce(
            (acc: Record<string, User>, u: User) => ({ ...acc, [u.id]: u }),
            {}
          ) || s.users,
          posts: (posts as Post[]) || s.posts,
          stories: (stories as Story[]) || s.stories,
          likes: likes?.reduce(
            (acc: Record<string, boolean>, l: { postId: string }) => ({ ...acc, [l.postId]: true }),
            {}
          ) || s.likes,
          recasts: recasts?.reduce(
            (acc: Record<string, boolean>, r: { postId: string }) => ({ ...acc, [r.postId]: true }),
            {}
          ) || s.recasts,
        }));
      }
    }
    fetchData();
  }, []);

  // Theme
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("fuse/theme", theme);
  }, [theme]);

  // timeAgo auto-refresh
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Prune expired stories periodically
  useEffect(() => {
    const prune = () =>
      setState((s) => ({
        ...s,
        stories: s.stories.filter((st) => new Date(st.expiresAt).getTime() > Date.now()),
      }));
    prune();
    const id = setInterval(prune, 60_000);
    return () => clearInterval(id);
  }, []);

  // Navigation handlers
  const openProfile = useCallback(
    (userId: string) => setRoute({ name: "profile", userId }),
    []
  );
  const openFeed = useCallback(() => setRoute({ name: "feed" }), []);

  // silence `tick` usage (forces refresh)
  void tick;

  if (!state.me) {
    return (
      <div className="min-h-dvh grid place-items-center bg-zinc-50 dark:bg-zinc-950">
        <div className="text-xl font-bold animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Topbar
        onThemeToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        onSearch={setSearch}
        onHome={openFeed}
        onProfile={() => openProfile(state.me!.id)}
      />

      <div className="max-w-3xl mx-auto p-4">
        {route.name === "feed" ? (
          <FeedScreen
            state={state}
            setState={setState}
            search={search}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onOpenProfile={openProfile}
            me={state.me}
          />
        ) : (
          <ProfileScreen
            state={state}
            setState={setState}
            userId={route.userId}
            onBack={openFeed}
            onOpenProfile={openProfile}
            me={state.me}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------
// Topbar
// ---------------------------
function Topbar({
  onThemeToggle,
  onSearch,
  onHome,
  onProfile,
}: {
  onThemeToggle: () => void;
  onSearch: (q: string) => void;
  onHome: () => void;
  onProfile: () => void;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200/50 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-950/70 backdrop-blur">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
        <button
          onClick={onHome}
          className="flex items-center gap-2 font-bold tracking-tight"
          aria-label="Go home"
        >
          <div className="w-7 h-7 rounded-lg grid place-items-center text-zinc-900 dark:text-zinc-950 bg-gradient-to-br from-blue-400 via-emerald-300 to-zinc-200 shadow">
            ƒ
          </div>
          <span>Fuse</span>
        </button>
        <div className="flex-1" />
        <div className="hidden sm:flex items-center gap-2 flex-1 max-w-md">
          <div className="flex items-center gap-2 w-full rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 px-3 py-2">
            <svg
              className="w-4 h-4 opacity-70"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M10.5 19a8.5 8.5 0 1 1 6.02-2.48l4.48 4.49-1.42 1.41-4.48-4.48A8.46 8.46 0 0 1 10.5 19Zm0-2a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z" />
            </svg>
            <input
              aria-label="Search"
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search (people, posts, #tags)"
              className="bg-transparent outline-none text-sm w-full placeholder:text-zinc-400"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onThemeToggle}
            className="px-3 py-2 rounded-full border border-zinc-200 dark:border-zinc-800"
            aria-pressed={false}
          >
            Theme
          </button>
          <button
            onClick={onProfile}
            className="px-3 py-2 rounded-full border border-zinc-200 dark:border-zinc-800"
          >
            Profile
          </button>
        </div>
      </div>
    </header>
  );
}

---

### Corrected FeedScreen Component

I've fixed the `_s` unused variable issue and added a null check for `state.users` to prevent an error if the user data hasn't loaded yet.

```jsx
// ---------------------------
// Feed Screen
// ---------------------------
function FeedScreen({
  state,
  setState,
  search,
  activeTab,
  setActiveTab,
  onOpenProfile,
  me,
}: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  search: string;
  activeTab: Tab;
  setActiveTab: (t: Tab) => void;
  onOpenProfile: (id: string) => void;
  me: User;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const score = useCallback((_s: AppState, p: Post) => {
    const ageH = (Date.now() - new Date(p.createdAt).getTime()) / 3_600_000;
    const engagement = p.likes * 2 + p.recasts * 3 + p.comments;
    return engagement + clamp(12 - ageH, 0, 12);
  }, []);

  const filtered = useMemo(() => {
    let items: Post[] = [...state.posts];
    if (activeTab === "following") {
      const fset = new Set(state.following);
      items = items.filter(
        (p) => fset.has(p.userId) || p.userId === me.id
      );
    }
    if (activeTab === "latest") items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (activeTab === "forYou")
      items.sort((a, b) => score(state, b) - score(state, a));
    const q = search.trim().toLowerCase();
    if (q)
      items = items.filter(
        (p) =>
          p.text.toLowerCase().includes(q) ||
          state.users[p.userId]?.name?.toLowerCase().includes(q)
      );
    return items;
  }, [state, search, activeTab, score, me]);

  async function onSelectFiles(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files).slice(0, 4);
    const urls: string[] = [];
    for (const f of list) {
      urls.push(await readAsDataURL(f));
    }
    setImages(urls);
  }

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    await onSelectFiles(files);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  async function publish(kind: "post" | "story") {
    if (!text.trim() && images.length === 0)
      return alert("Write something or add a photo.");

    const newPost = {
      id: `p_${uid()}`,
      userId: me.id,
      text: text.slice(0, 500),
      media: images,
      likes: 0,
      recasts: 0,
      comments: 0,
      createdAt: new Date().toISOString(),
    };

    const { error: postError } = await supabase.from('posts').insert([newPost]);
    if (postError) {
      console.error("Error publishing post:", postError);
      return;
    }

    if (kind === "story" && images.length > 0) {
      const newStory = {
        id: `s_${uid()}`,
        userId: me.id,
        url: images[0] || placeholderImg("You"),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      };
      const { error: storyError } = await supabase.from('stories').insert([newStory]);
      if (storyError) console.error("Error adding story:", storyError);
    }

    setState((s) => ({
      ...s,
      posts: [newPost as Post, ...s.posts],
      stories: kind === "story" && images.length > 0
        ? [{
          id: `s_${uid()}`,
          userId: me.id,
          url: images[0] || placeholderImg("You"),
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        }, ...s.stories]
        : s.stories,
    }));
    setText("");
    setImages([]);
  }

  async function toggle(postId: string, act: "like" | "recast" | "comment") {
    try {
      const post = state.posts.find((p) => p.id === postId);
      if (!post) return;

      if (act === "like") {
        const willLike = !state.likes[postId];
        const newLikes = willLike ? post.likes + 1 : post.likes - 1;
        const { error } = await supabase.from('posts').update({ likes: newLikes }).eq('id', postId);
        if (error) throw error;
        setState(prev => ({
          ...prev,
          posts: prev.posts.map(p => p.id === postId ? { ...p, likes: newLikes } : p),
          likes: { ...prev.likes, [postId]: willLike },
        }));
      } else if (act === "recast") {
        const willRecast = !state.recasts[postId];
        const newRecasts = willRecast ? post.recasts + 1 : post.recasts - 1;
        const { error } = await supabase.from('posts').update({ recasts: newRecasts }).eq('id', postId);
        if (error) throw error;
        setState(prev => ({
          ...prev,
          posts: prev.posts.map(p => p.id === postId ? { ...p, recasts: newRecasts } : p),
          recasts: { ...prev.recasts, [postId]: willRecast },
        }));
      } else if (act === "comment") {
        const { error } = await supabase.from('posts').update({ comments: post.comments + 1 }).eq('id', postId);
        if (error) throw error;
        setState(prev => ({
          ...prev,
          posts: prev.posts.map(p => p.id === postId ? { ...p, comments: p.comments + 1 } : p),
        }));
      }
    } catch (e) {
      console.error("Error updating post:", e);
    }
  }

  const overLimit = text.length > 500;

  return (
    <div>
      {/* Tabs */}
      <div className="flex justify-center gap-2 py-3">
        {(["forYou", "following", "latest"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 rounded-full border text-sm ${
              activeTab === t
                ? "bg-blue-600 text-white border-transparent"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
            aria-pressed={activeTab === t}
          >
            {t === "forYou" ? "For you" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Composer */}
      <div
        className={`bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-dashed ${
          isDragging
            ? "border-blue-500"
            : "border-zinc-200 dark:border-zinc-800"
        } p-4`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        aria-label="Composer"
      >
        <div className="flex gap-3">
          <Avatar user={me} onClick={() => onOpenProfile(me.id)} />
          <div className="flex-1">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Share a thought or drop a photo…"
              className="w-full bg-transparent outline-none resize-y min-h-[64px]"
              aria-label="Compose a post"
            />
            {images.length > 0 && (
              <div className="flex gap-2 flex-wrap mt-2">
                {images.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt="preview"
                    className="max-h-40 rounded-xl border border-zinc-200 dark:border-zinc-800"
                    loading="lazy"
                  />
                ))}
              </div>
            )}
            <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="cursor-pointer px-3 py-2 rounded-full border border-zinc-300 dark:border-zinc-700">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => onSelectFiles(e.target.files)}
                  />
                  Add photo
                </label>
                <span
                  className={`text-xs ${
                    overLimit ? "text-red-500" : "text-zinc-500"
                  }`}
                >
                  {Math.min(text.length, 999)}/500
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => publish("story")}
                  className="px-3 py-2 rounded-full border border-zinc-300 dark:border-zinc-700"
                >
                  Add to Story
                </button>
                <button
                  onClick={() => publish("post")}
                  className="px-4 py-2 rounded-full bg-blue-600 text-white"
                  disabled={overLimit}
                >
                  Post
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stories */}
      <StoriesTray state={state} onOpenProfile={onOpenProfile} />

      {/* Feed */}
      <div className="mt-4">
        {filtered.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            user={state.users[p.userId] || { id: p.userId, name: "Unknown", handle: "@unknown" }}
            me={me}
            liked={!!state.likes[p.id]}
            recasted={!!state.recasts[p.id]}
            onToggle={(act) => toggle(p.id, act)}
            onOpenProfile={onOpenProfile}
          />
        ))}
      </div>
    </div>
  );
}

---

### Corrected ProfileScreen Component

I've fixed the unused variable issues and added a check for `state.me` to prevent potential errors.

```jsx
// ---------------------------
// Profile Screen
// ---------------------------
function ProfileScreen({
  state,
  setState,
  userId,
  onBack,
  _onOpenProfile,
  _me,
}: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  userId: string;
  onBack: () => void;
  onOpenProfile: (id: string) => void;
  me: User;
}) {
  const user: User = state.users[userId] || { id: userId, name: "User", handle: "@user" };
  const isMe = userId === state.me?.id;
  const bio = user.bio || "";
  const links: string[] = user.links || [];
  const posts: Post[] = state.posts.filter((p: Post) => p.userId === userId);

  const [editing, setEditing] = useState(false);
  const [draftBio, setDraftBio] = useState(bio);
  const [draftLinks, setDraftLinks] = useState(links.join("\n"));

  async function saveProfile() {
    const nextBio = draftBio.slice(0, 200);
    const nextLinks = draftLinks.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
    
    const { error } = await supabase
      .from('users')
      .update({ bio: nextBio, links: nextLinks })
      .eq('id', userId);
    
    if (error) {
      console.error("Error saving profile:", error);
      return;
    }

    setState((prev) => ({
      ...prev,
      users: {
        ...prev.users,
        [userId]: { ...prev.users[userId], bio: nextBio, links: nextLinks },
      },
      me: { ...prev.me, bio: nextBio, links: nextLinks } as User,
    }));
    setEditing(false);
  }

  async function toggleFollow() {
    if (isMe) return;

    const isFollowing = state.following.includes(userId);
    const updatedFollowing = isFollowing
      ? state.following.filter(id => id !== userId)
      : [...state.following, userId];

    setState((prev) => ({
      ...prev,
      following: updatedFollowing,
    }));
  }

  const followingMe = state.following.includes(userId);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={onBack}
          className="px-3 py-2 rounded-full border border-zinc-300 dark:border-zinc-700"
          aria-label="Back to feed"
        >
          ← Back
        </button>
        <div className="text-sm text-zinc-500">Profile</div>
      </div>

      {/* Header */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-6">
        <div className="flex items-center gap-4">
          <Avatar user={user} onClick={() => console.log('Profile opened from ProfileScreen')} />
          <div className="flex-1">
            <div className="text-xl font-semibold">{user.name}</div>
            <div className="text-zinc-500">{user.handle}</div>
          </div>
          {isMe ? (
            <button
              onClick={() => setEditing((e) => !e)}
              className="px-4 py-2 rounded-full border border-zinc-300 dark:border-zinc-700"
            >
              {editing ? "Cancel" : "Edit profile"}
            </button>
          ) : (
            <button
              onClick={toggleFollow}
              className={`px-4 py-2 rounded-full ${
                followingMe
                  ? "border border-zinc-300 dark:border-zinc-700"
                  : "bg-blue-600 text-white"
              }`}
            >
              {followingMe ? "Following" : "Follow"}
            </button>
          )}
        </div>

        {!editing ? (
          <div className="mt-4 space-y-2">
            {bio && (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {bio}
              </p>
            )}
            {links.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {links.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    {...safeLinkProps}
                    className="text-sm underline break-all"
                  >
                    {url}
                  </a>
                ))}
              </div>
            )}
            <div className="flex gap-4 text-sm text-zinc-500 pt-1">
              <span>
                <b>{posts.length}</b> posts
              </span>
              <span>
                <b>{Math.max(3, Math.floor(posts.length * 3.2))}</b> followers
              </span>
              <span>
                Joined{" "}
                {new Date(
                  Math.min(...posts.map((p) => new Date(p.createdAt).getTime()), Date.now())
                ).toLocaleDateString()}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block">
              <div className="text-sm text-zinc-500 mb-1">Bio (200 chars)</div>
              <textarea
                value={draftBio}
                onChange={(e) => setDraftBio(e.target.value)}
                className="w-full bg-transparent rounded-xl border border-zinc-300 dark:border-zinc-700 p-3"
                rows={3}
              />
            </label>
            <label className="block">
              <div className="text-sm text-zinc-500 mb-1">
                Links (one per line, up to 3)
              </div>
              <textarea
                value={draftLinks}
                onChange={(e) => setDraftLinks(e.target.value)}
                className="w-full bg-transparent rounded-xl border border-zinc-300 dark:border-zinc-700 p-3"
                rows={3}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditing(false)}
                className="px-4 py-2 rounded-full border border-zinc-300 dark:border-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={saveProfile}
                className="px-4 py-2 rounded-full bg-blue-600 text-white"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Story Highlights (fun mock) */}
      <div className="mt-6">
        <div className="font-medium mb-2">Highlights</div>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {["Day One", "Walks", "Build", "IRL"].map((label, i) => (
            <div key={i} className="flex-shrink-0 text-center">
              <div className="w-20 h-20 rounded-full border-4 border-zinc-200 dark:border-zinc-800 grid place-items-center bg-zinc-100 dark:bg-zinc-900 text-2xl">
                {label[0]}
              </div>
              <div className="text-xs mt-1 text-zinc-500">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Posts grid */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <div className="font-medium">Posts</div>
          <div className="flex gap-2 text-sm">
            <button className="px-3 py-1 rounded-full border border-zinc-300 dark:border-zinc-700">
              Grid
            </button>
            <button className="px-3 py-1 rounded-full border border-zinc-300 dark:border-zinc-700">
              List
            </button>
          </div>
        </div>
        {posts.length === 0 ? (
          <div className="text-sm text-zinc-500">No posts yet.</div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {posts.map((p) => (
              <div
                key={p.id}
                className="aspect-square rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900"
              >
                {p.media?.[0] ? (
                  <img
                    src={p.media[0]}
                    alt="post"
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-zinc-500 text-sm p-2 text-center">
                    {p.text.slice(0, 60) || "Post"}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

---

### Corrected StoriesTray Component

I've fixed the `s` and `stories` unused variable issues in this component.

```jsx
// ---------------------------
// Stories Tray
// ---------------------------
function StoriesTray({
  state,
  onOpenProfile,
}: {
  state: AppState;
  onOpenProfile: (id: string) => void;
}) {
  const stories: Story[] = useMemo(
    () => state.stories.filter((_s: Story) => new Date(_s.expiresAt).getTime() > Date.now()),
    [state.stories]
  );

  return (
    <div className="flex gap-3 overflow-x-auto py-3">
      {[
        {
          id: "self",
          userId: state.me!.id,
          url: "",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        } as Story,
        ...stories,
      ].map((s, i) => (
        <button
          key={s.id + String(i)}
          className="text-center flex-shrink-0"
          onClick={() => onOpenProfile(s.userId)}
          aria-label={`Open ${
            s.userId === state.me!.id
              ? "your"
              : state.users[s.userId]?.name || "user"
          } profile`}
        >
          <div className="w-[70px] h-[70px] rounded-full p-[3px] bg-gradient-to-tr from-emerald-400 via-blue-400 to-pink-400">
            <div className="w-full h-full rounded-full bg-white dark:bg-zinc-950 border-2 border-white dark:border-zinc-950 overflow-hidden grid place-items-center">
              {s.url ? (
                <img
                  src={s.url}
                  alt="story"
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="text-xl">
                  {(state.users[s.userId]?.name || "U")[0]}
                </span>
              )}
            </div>
          </div>
          <div className="text-xs text-zinc-500 mt-1 w-[70px] truncate">
            {s.userId === state.me!.id
              ? "Your story"
              : state.users[s.userId]?.name}
          </div>
        </button>
      ))}
    </div>
  );
}

---

### Other Components & Utils

The rest of the components and utility functions are unchanged, but I've included them for completeness.

```jsx
// ---------------------------
// Post Card
// ---------------------------
function PostCard({
  post,
  user,
  _me,
  liked,
  recasted,
  onToggle,
  onOpenProfile,
}: {
  post: Post;
  user: User;
  me: User;
  liked: boolean;
  recasted: boolean;
  onToggle: (act: "like" | "recast" | "comment") => void;
  onOpenProfile: (id: string) => void;
}) {
  return (
    <article className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-4 my-4">
      <div className="flex items-center gap-3">
        <Avatar user={user} onClick={() => onOpenProfile(user.id)} />
        <div className="leading-tight">
          <div className="font-medium">{user.name}</div>
          <div className="text-xs text-zinc-500">
            {user.handle} · {timeAgo(post.createdAt)}
          </div>
        </div>
      </div>
      <div className="mt-3 whitespace-pre-wrap">{linkify(post.text)}</div>
      {post.media?.length > 0 && (
        <div className="flex gap-2 flex-wrap mt-3">
          {post.media.map((src, i) => (
            <img
              key={i}
              src={src}
              alt="media"
              className="max-h-80 rounded-xl border border-zinc-200 dark:border-zinc-800"
              loading="lazy"
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 text-sm text-zinc-500 mt-3">
        <button
          onClick={() => onToggle("like")}
          className={`px-2 py-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            liked ? "text-pink-600" : ""
          }`}
          aria-pressed={liked}
          aria-label="Like"
        >
          ❤️ <span className="ml-1">{formatCount(post.likes)}</span>
        </button>
        <button
          onClick={() => onToggle("recast")}
          className={`px-2 py-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            recasted ? "text-emerald-600" : ""
          }`}
          aria-pressed={recasted}
          aria-label="Recast"
        >
          🔁 <span className="ml-1">{formatCount(post.recasts)}</span>
        </button>
        <button
          onClick={() => onToggle("comment")}
          className="px-2 py-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Comment"
        >
          💬 <span className="ml-1">{formatCount(post.comments)}</span>
        </button>
        <div className="ml-auto text-xs">ID {post.id.slice(-4)}</div>
      </div>
    </article>
  );
}

function Avatar({
  user,
  onClick,
  size = 44,
}: {
  user: User;
  onClick?: () => void;
  size?: number;
}) {
  const sizeClass = `w-[${size}px] h-[${size}px]`;
  const innerSize = size - 6;
  const innerSizeClass = `w-[${innerSize}px] h-[${innerSize}px]`;

  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full grid place-items-center font-bold text-zinc-900 ${sizeClass}`}
      aria-label={`Open ${user.name} profile`}
    >
      <div
        className={`rounded-full grid place-items-center bg-gradient-to-br from-blue-400 to-emerald-300 ${sizeClass}`}
      >
        <div
          className={`rounded-full grid place-items-center bg-white/90 dark:bg-zinc-950/90 overflow-hidden ${innerSizeClass}`}
        >
          {user.avatar ? (
            <img
              src={user.avatar}
              alt={user.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <span>{user.name?.[0] || "U"}</span>
          )}
        </div>
      </div>
    </button>
  );
}

// ---------------------------
// Utils
// ---------------------------
function linkify(text: string) {
  const parts = text.split(/(https?:\/\/\S+|#[\p{L}0-9_]+)/gu);
  return (
    <>
      {parts.map((p, i) => {
        if (/^https?:\/\//.test(p))
          return (
            <a
              key={i}
              href={p}
              {...safeLinkProps}
              className="underline break-all"
            >
              {p}
            </a>
          );
        if (/^#[\p{L}0-9_]+$/u.test(p))
          return (
            <span
              key={i}
              className="px-2 py-0.5 rounded-full border text-xs ml-1"
            >
              {p}
            </span>
          );
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}
function readAsDataURL(file: File) {
  return new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}
