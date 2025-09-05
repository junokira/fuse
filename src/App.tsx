import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, User as SupabaseUser } from "@supabase/supabase-js";

// Supabase configuration
const SUPABASE_URL = "YOUR_SUPABASE_URL_HERE";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY_HERE";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------
// Types (TypeScript)
// ---------------------------
export type User = {
  id: string;
  name: string;
  handle: string;
  avatar_url?: string;
  bio?: string;
  links?: string[];
};
export type Post = {
  id: string;
  author_id: string;
  text: string;
  media_urls: string[];
  likes: number;
  recasts: number;
  comments: number;
  created_at: string;
};
export type Story = {
  id: string;
  author_id: string;
  media_url: string;
  expires_at?: string;
  created_at: string;
};

type Tab = "forYou" | "following" | "latest";
type Route = { name: "feed" } | { name: "profile"; userId: string };

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
  const [users, setUsers] = useState<User[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [likedPosts, setLikedPosts] = useState<string[]>([]);
  const [recastedPosts, setRecastedPosts] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [theme, setTheme] = useState<string>(
    () =>
      localStorage.getItem("fuse/theme") ||
      (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
  );
  const [route, setRoute] = useState<Route>({ name: "feed" });
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("forYou");
  const [tick, setTick] = useState(0);

  // Auth and data fetch
  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);

      const { data: authData } = await supabase.auth.signInAnonymously();

      // Fetch users
      const { data: userData } = await supabase.from("profiles").select("*");
      if (userData) {
        setUsers(userData);
        const myProfile = userData.find((u: User) => u.id === authData.user?.id);
        if (myProfile) {
          setMe(myProfile);
        } else {
          // Create new user if not found
          const newUser = {
            id: authData.user?.id || "",
            name: "You",
            handle: `@you${Math.floor(Math.random() * 1000)}`,
          };
          const { data: newUserData } = await supabase
            .from("profiles")
            .insert(newUser)
            .select()
            .single();
          if (newUserData) {
            setMe(newUserData);
            setUsers([...userData, newUserData]);
          }
        }
      }

      // Fetch posts, stories, etc.
      const { data: postsData } = await supabase.from("posts").select("*");
      if (postsData) setPosts(postsData);

      const { data: storiesData } = await supabase.from("stories").select("*");
      if (storiesData) setStories(storiesData);

      if (authData.user) {
        const { data: followingData } = await supabase
          .from("following")
          .select("followed_id")
          .eq("follower_id", authData.user.id);
        if (followingData)
          setFollowingIds(followingData.map((f: { followed_id: string }) => f.followed_id));

        const { data: likesData } = await supabase
          .from("post_likes")
          .select("post_id")
          .eq("user_id", authData.user.id);
        if (likesData) setLikedPosts(likesData.map((l: { post_id: string }) => l.post_id));

        const { data: recastsData } = await supabase
          .from("post_recasts")
          .select("post_id")
          .eq("user_id", authData.user.id);
        if (recastsData) setRecastedPosts(recastsData.map((r: { post_id: string }) => r.post_id));
      }

      setIsLoading(false);
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
  void tick; // silence usage

  // Navigation handlers
  const openProfile = useCallback(
    (userId: string) => setRoute({ name: "profile", userId }),
    []
  );
  const openFeed = useCallback(() => setRoute({ name: "feed" }), []);

  if (isLoading || !me) {
    return (
      <div className="min-h-dvh grid place-items-center bg-zinc-50 dark:bg-zinc-950">
        <div className="text-lg animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Topbar
        onThemeToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        onSearch={setSearch}
        onHome={openFeed}
        onProfile={() => openProfile(me.id)}
      />
      <div className="max-w-3xl mx-auto p-4">
        {route.name === "feed" ? (
          <FeedScreen
            me={me}
            users={users}
            posts={posts}
            stories={stories}
            followingIds={followingIds}
            likedPosts={likedPosts}
            recastedPosts={recastedPosts}
            setPosts={setPosts}
            setStories={setStories}
            setFollowingIds={setFollowingIds}
            setLikedPosts={setLikedPosts}
            setRecastedPosts={setRecastedPosts}
            search={search}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onOpenProfile={openProfile}
          />
        ) : (
          <ProfileScreen
            me={me}
            users={users}
            posts={posts}
            followingIds={followingIds}
            setUsers={setUsers}
            setFollowingIds={setFollowingIds}
            userId={route.userId}
            onBack={openFeed}
            onOpenProfile={onOpenProfile}
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

// ---------------------------
// Feed Screen
// ---------------------------
function FeedScreen({
  me,
  users,
  posts,
  stories,
  followingIds,
  likedPosts,
  recastedPosts,
  setPosts,
  setStories,
  setFollowingIds,
  setLikedPosts,
  setRecastedPosts,
  search,
  activeTab,
  setActiveTab,
  onOpenProfile,
}: {
  me: User;
  users: User[];
  posts: Post[];
  stories: Story[];
  followingIds: string[];
  likedPosts: string[];
  recastedPosts: string[];
  setPosts: React.Dispatch<React.SetStateAction<Post[]>>;
  setStories: React.Dispatch<React.SetStateAction<Story[]>>;
  setFollowingIds: React.Dispatch<React.SetStateAction<string[]>>;
  setLikedPosts: React.Dispatch<React.SetStateAction<string[]>>;
  setRecastedPosts: React.Dispatch<React.SetStateAction<string[]>>;
  search: string;
  activeTab: Tab;
  setActiveTab: (t: Tab) => void;
  onOpenProfile: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

  const score = useCallback((p: Post) => {
    const ageH = (new Date().getTime() - new Date(p.created_at).getTime()) / 3_600_000;
    const engagement = p.likes * 2 + p.recasts * 3 + p.comments;
    return engagement + clamp(12 - ageH, 0, 12);
  }, []);

  const usersMap = useMemo(() => {
    return users.reduce<Record<string, User>>((acc, user) => {
      acc[user.id] = user;
      return acc;
    }, {});
  }, [users]);

  const filtered = useMemo(() => {
    let items: Post[] = [...posts];
    if (activeTab === "following") {
      const fset = new Set(followingIds);
      items = items.filter((p) => fset.has(p.author_id) || p.author_id === me.id);
    }
    if (activeTab === "latest") items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (activeTab === "forYou") items.sort((a, b) => score(b) - score(a));
    const q = search.trim().toLowerCase();
    if (q)
      items = items.filter(
        (p) =>
          p.text.toLowerCase().includes(q) ||
          usersMap[p.author_id]?.name.toLowerCase().includes(q)
      );
    return items;
  }, [posts, search, activeTab, score, usersMap, followingIds, me]);

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
    if (!text.trim() && images.length === 0) return;
    if (kind === "post") {
      const newPost = {
        author_id: me.id,
        text: text.slice(0, 500),
        media_urls: images,
      };
      const { data } = await supabase.from("posts").insert(newPost).select();
      if (data) setPosts((p) => [...data, ...p]);
    } else {
      const newStory = {
        author_id: me.id,
        media_url: images[0] || placeholderImg(me.name),
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      };
      const { data } = await supabase.from("stories").insert(newStory).select();
      if (data) setStories((s) => [...data, ...s]);
    }
    setText("");
    setImages([]);
  }

  async function toggleLike(postId: string) {
    if (likedPosts.includes(postId)) {
      await supabase.from("post_likes").delete().match({ user_id: me.id, post_id: postId });
      setLikedPosts(likedPosts.filter((id) => id !== postId));
      const postToUpdate = posts.find((p) => p.id === postId);
      if (postToUpdate) {
        await supabase.from("posts").update({ likes: postToUpdate.likes - 1 }).eq("id", postId);
        setPosts(posts.map((p) => (p.id === postId ? { ...p, likes: p.likes - 1 } : p)));
      }
    } else {
      await supabase.from("post_likes").insert({ user_id: me.id, post_id: postId });
      setLikedPosts([...likedPosts, postId]);
      const postToUpdate = posts.find((p) => p.id === postId);
      if (postToUpdate) {
        await supabase.from("posts").update({ likes: postToUpdate.likes + 1 }).eq("id", postId);
        setPosts(posts.map((p) => (p.id === postId ? { ...p, likes: p.likes + 1 } : p)));
      }
    }
  }

  async function toggleRecast(postId: string) {
    if (recastedPosts.includes(postId)) {
      await supabase.from("post_recasts").delete().match({ user_id: me.id, post_id: postId });
      setRecastedPosts(recastedPosts.filter((id) => id !== postId));
      const postToUpdate = posts.find((p) => p.id === postId);
      if (postToUpdate) {
        await supabase.from("posts").update({ recasts: postToUpdate.recasts - 1 }).eq("id", postId);
        setPosts(posts.map((p) => (p.id === postId ? { ...p, recasts: p.recasts - 1 } : p)));
      }
    } else {
      await supabase.from("post_recasts").insert({ user_id: me.id, post_id: postId });
      setRecastedPosts([...recastedPosts, postId]);
      const postToUpdate = posts.find((p) => p.id === postId);
      if (postToUpdate) {
        await supabase.from("posts").update({ recasts: postToUpdate.recasts + 1 }).eq("id", postId);
        setPosts(posts.map((p) => (p.id === postId ? { ...p, recasts: p.recasts + 1 } : p)));
      }
    }
  }

  const toggle = useCallback(
    (postId: string, act: "like" | "recast" | "comment") => {
      if (act === "like") toggleLike(postId);
      if (act === "recast") toggleRecast(postId);
      // comment logic not implemented in this demo
    },
    [likedPosts, recastedPosts, toggleLike, toggleRecast]
  );

  const overLimit = text.length > 500;

  const seedDatabase = async () => {
    setIsSeeding(true);
    const seedUsers = [
      { id: uid(), name: "Ari", handle: "@ari", bio: "Tiny UI experiments." },
      { id: uid(), name: "Noor", handle: "@noor", bio: "Behavioral science + product." },
      { id: uid(), name: "Leo", handle: "@leo", bio: "Street photos and synths." },
    ];
    await supabase.from("profiles").insert(seedUsers);
    
    const seedPosts = [
      { author_id: seedUsers[0].id, text: "Building in public. Today: micro-interactions ✨", media_urls: [], likes: 3, recasts: 1, comments: 0, created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString() },
      { author_id: seedUsers[1].id, text: "Morning sunlight > afternoon coffee.", media_urls: [], likes: 12, recasts: 2, comments: 3, created_at: new Date(Date.now() - 1000 * 60 * 90).toISOString() },
      { author_id: seedUsers[2].id, text: "Shot on phone 📸", media_urls: [], likes: 7, recasts: 0, comments: 1, created_at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString() },
    ];
    await supabase.from("posts").insert(seedPosts);

    const seedStories = [
      { author_id: seedUsers[0].id, media_url: placeholderImg("Ari"), created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), expires_at: new Date(Date.now() + 1000 * 60 * 60 * 22).toISOString() },
    ];
    await supabase.from("stories").insert(seedStories);
    
    setIsSeeding(false);
    // Refresh data
    window.location.reload();
  };

  return (
    <div>
      <div className="flex justify-between items-center py-3">
        <div className="flex gap-2">
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
        <button
          onClick={seedDatabase}
          className={`px-4 py-2 rounded-full text-sm ${isSeeding ? 'bg-zinc-500' : 'bg-green-600'} text-white`}
          disabled={isSeeding}
        >
          {isSeeding ? 'Seeding...' : 'Seed Database'}
        </button>
      </div>

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

      <StoriesTray stories={stories} users={usersMap} onOpenProfile={onOpenProfile} me={me} />

      <div className="mt-4">
        {filtered.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            user={usersMap[p.author_id] || me}
            me={me}
            liked={likedPosts.includes(p.id)}
            recasted={recastedPosts.includes(p.id)}
            onToggle={(act: "like" | "recast" | "comment") => toggle(p.id, act)}
            onOpenProfile={onOpenProfile}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------
// Profile Screen (separate view)
// ---------------------------
function ProfileScreen({
  me,
  users,
  posts,
  followingIds,
  setUsers,
  setFollowingIds,
  userId,
  onBack,
  onOpenProfile,
}: {
  me: User;
  users: User[];
  posts: Post[];
  followingIds: string[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  setFollowingIds: React.Dispatch<React.SetStateAction<string[]>>;
  userId: string;
  onBack: () => void;
  onOpenProfile: (id: string) => void;
}) {
  const usersMap = useMemo(() => {
    return users.reduce<Record<string, User>>((acc, user) => {
      acc[user.id] = user;
      return acc;
    }, {});
  }, [users]);
  const user: User = usersMap[userId] || me;
  const isMe = userId === me.id;
  const postsByUser: Post[] = posts.filter((p: Post) => p.author_id === userId);

  const [editing, setEditing] = useState(false);
  const [draftBio, setDraftBio] = useState(user.bio || "");
  const [draftLinks, setDraftLinks] = useState((user.links || []).join("\n"));

  async function saveProfile() {
    const nextLinks = draftLinks
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
    const updates = {
      bio: draftBio.slice(0, 200),
      links: nextLinks,
    };
    await supabase.from("profiles").update(updates).eq("id", me.id);
    setUsers(users.map((u) => (u.id === me.id ? { ...u, ...updates } : u)));
    setEditing(false);
  }

  async function toggleFollow() {
    if (isMe) return;
    if (followingIds.includes(userId)) {
      await supabase.from("following").delete().match({ follower_id: me.id, followed_id: userId });
      setFollowingIds(followingIds.filter((id) => id !== userId));
    } else {
      await supabase.from("following").insert({ follower_id: me.id, followed_id: userId });
      setFollowingIds([...followingIds, userId]);
    }
  }

  const followingMe = followingIds.includes(userId);

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
      <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-6">
        <div className="flex items-center gap-4">
          <Avatar user={user} onClick={() => onOpenProfile(user.id)} />
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
            {user.bio && (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {user.bio}
              </p>
            )}
            {(user.links || []).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {(user.links || []).map((url, i) => (
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
                <b>{postsByUser.length}</b> posts
              </span>
              <span>
                <b>{Math.max(3, Math.floor(postsByUser.length * 3.2))}</b> followers
              </span>
              <span>
                Joined{" "}
                {new Date(
                  Math.min(...postsByUser.map((p) => new Date(p.created_at).getTime()), Date.now())
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
        {postsByUser.length === 0 ? (
          <div className="text-sm text-zinc-500">No posts yet.</div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {postsByUser.map((p) => (
              <div
                key={p.id}
                className="aspect-square rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900"
              >
                {p.media_urls?.[0] ? (
                  <img
                    src={p.media_urls[0]}
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

// ---------------------------
// Stories Tray
// ---------------------------
function StoriesTray({
  stories,
  users,
  me,
  onOpenProfile,
}: {
  stories: Story[];
  users: Record<string, User>;
  me: User;
  onOpenProfile: (id: string) => void;
}) {
  const filteredStories: Story[] = useMemo(
    () => stories.filter((s) => s.expires_at && new Date(s.expires_at).getTime() > Date.now()),
    [stories]
  );
  return (
    <div className="flex gap-3 overflow-x-auto py-3">
      {[
        { id: "self", author_id: me.id, media_url: "" } as Story,
        ...filteredStories,
      ].map((s, i) => (
        <button
          key={s.id + String(i)}
          className="text-center flex-shrink-0"
          onClick={() => onOpenProfile(s.author_id)}
          aria-label={`Open ${
            s.author_id === me.id
              ? "your"
              : users[s.author_id]?.name || "user"
          } profile`}
        >
          <div className="w-[70px] h-[70px] rounded-full p-[3px] bg-gradient-to-tr from-emerald-400 via-blue-400 to-pink-400">
            <div className="w-full h-full rounded-full bg-white dark:bg-zinc-950 border-2 border-white dark:border-zinc-950 overflow-hidden grid place-items-center">
              {s.media_url ? (
                <img
                  src={s.media_url}
                  alt="story"
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="text-xl">
                  {(users[s.author_id]?.name || me.name)[0]}
                </span>
              )}
            </div>
          </div>
          <div className="text-xs text-zinc-500 mt-1 w-[70px] truncate">
            {s.author_id === me.id ? "Your story" : users[s.author_id]?.name}
          </div>
        </button>
      ))}
    </div>
  );
}

// ---------------------------
// Post Card
// ---------------------------
function PostCard({
  post,
  user,
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
            {user.handle} · {timeAgo(post.created_at)}
          </div>
        </div>
      </div>
      <div className="mt-3 whitespace-pre-wrap">{linkify(post.text)}</div>
      {post.media_urls?.length > 0 && (
        <div className="flex gap-2 flex-wrap mt-3">
          {post.media_urls.map((src, i) => (
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
        <div className="ml-auto text-xs">ID {post.id.slice(0, 4)}...</div>
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
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
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
