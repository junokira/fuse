import React, { useCallback, useEffect, useMemo, useState } from "react";
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, getDoc, updateDoc, setDoc, getDocs, query, where, addDoc, deleteDoc } from 'firebase/firestore';

const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// ---------------------------
// Types
// ---------------------------
/**
 * Represents a user profile.
 * @typedef {object} User
 * @property {string} id - The user's unique ID.
 * @property {string} name - The user's display name.
 * @property {string} handle - The user's handle (e.g., @johndoe).
 * @property {string} [avatar] - The URL to the user's avatar image.
 */
export type User = { id: string; name: string; handle: string; avatar?: string };

/**
 * Represents a post.
 * @typedef {object} Post
 * @property {string} id - The post's unique ID.
 * @property {string} userId - The ID of the user who created the post.
 * @property {string} text - The content of the post.
 * @property {string[]} media - An array of URLs to media attached to the post.
 * @property {number} likes - The number of likes the post has.
 * @property {number} recasts - The number of recasts the post has.
 * @property {number} comments - The number of comments the post has.
 * @property {string} createdAt - The creation timestamp of the post.
 */
export type Post = { id: string; userId: string; text: string; media: string[]; likes: number; recasts: number; comments: number; createdAt: string };

/**
 * Represents a story.
 * @typedef {object} Story
 * @property {string} id - The story's unique ID.
 * @property {string} userId - The ID of the user who created the story.
 * @property {string} url - The URL to the story's media.
 * @property {string} createdAt - The creation timestamp of the story.
 * @property {string} expiresAt - The expiration timestamp of the story.
 */
export type Story = { id: string; userId: string; url: string; createdAt: string; expiresAt: string };

type Tab = "forYou" | "following" | "latest";
type Route = { name: "feed" } | { name: "profile"; userId: string } | { name: "auth" };

// ---------------------------
// Helpers
// ---------------------------
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10));
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);
const formatCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : String(n));
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
  const [theme, setTheme] = useState<string>(() => localStorage.getItem("fuse/theme") || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  const [route, setRoute] = useState<Route>({ name: "feed" });
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("forYou");
  const [me, setMe] = useState<User | null>(null);
  const [allPosts, setAllPosts] = useState<Post[]>([]);
  const [allUsers, setAllUsers] = useState<Record<string, User>>({});
  const [allStories, setAllStories] = useState<Story[]>([]);
  const [likes, setLikes] = useState<Record<string, boolean>>({});
  const [recasts, setRecasts] = useState<Record<string, boolean>>({});
  const [following, setFollowing] = useState<string[]>([]);
  const [db, setDb] = useState<any>(null);
  const [auth, setAuth] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Initialize Firebase and set up auth listener
  useEffect(() => {
    try {
      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const firebaseAuth = getAuth(app);
      setDb(firestore);
      setAuth(firebaseAuth);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          if (initialAuthToken) {
            try {
              await signInWithCustomToken(firebaseAuth, initialAuthToken);
            } catch (e) {
              console.error('Error with custom auth token:', e);
            }
          }
          await fetchUserData(user.uid, firestore);
          await fetchLikesAndRecasts(user.uid, firestore);
          await fetchFollowing(user.uid, firestore);
          setRoute({ name: "feed" });
        } else {
          // Sign in anonymously if no token is available
          await signInAnonymously(firebaseAuth);
        }
        setIsAuthReady(true);
      });
      return () => unsubscribe();
    } catch (e) {
      console.error('Failed to initialize Firebase:', e);
    }
  }, []);

  // Fetch all users on app load
  useEffect(() => {
    if (db) {
      const usersCol = collection(db, 'artifacts', appId, 'public', 'data', 'users');
      const unsubscribe = onSnapshot(usersCol, (snapshot) => {
        const userMap: Record<string, User> = {};
        snapshot.forEach(doc => {
          const userData = doc.data();
          userMap[doc.id] = {
            id: doc.id,
            name: userData.display_name,
            handle: `@${userData.username}`,
            avatar: userData.avatar_url || placeholderImg(userData.display_name || 'U')
          };
        });
        setAllUsers(userMap);
      });
      return () => unsubscribe();
    }
  }, [db]);

  // Real-time listeners for posts and stories
  useEffect(() => {
    if (db && isAuthReady) {
      const postsCol = collection(db, 'artifacts', appId, 'public', 'data', 'posts');
      const postsUnsubscribe = onSnapshot(postsCol, (snapshot) => {
        const posts: Post[] = [];
        snapshot.forEach(doc => {
          const postData = doc.data();
          posts.push({
            id: doc.id,
            userId: postData.user_id,
            text: postData.text,
            media: postData.media_urls,
            likes: postData.likes,
            recasts: postData.recasts,
            comments: postData.comments,
            createdAt: postData.created_at
          });
        });
        setAllPosts(posts);
      });

      const storiesCol = collection(db, 'artifacts', appId, 'public', 'data', 'stories');
      const storiesUnsubscribe = onSnapshot(storiesCol, (snapshot) => {
        const stories: Story[] = [];
        snapshot.forEach(doc => {
          const storyData = doc.data();
          stories.push({
            id: doc.id,
            userId: storyData.user_id,
            url: storyData.media_url,
            createdAt: storyData.created_at,
            expiresAt: storyData.expires_at
          });
        });
        setAllStories(stories);
      });
      return () => {
        postsUnsubscribe();
        storiesUnsubscribe();
      };
    }
  }, [db, isAuthReady]);

  const fetchUserData = async (userId: string, firestore: any) => {
    const userRef = doc(firestore, 'artifacts', appId, 'public', 'data', 'users', userId);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      const userProfile = userSnap.data();
      setMe({
        id: userSnap.id,
        name: userProfile.display_name,
        handle: `@${userProfile.username}`,
        avatar: userProfile.avatar_url || placeholderImg(userProfile.display_name || 'U')
      });
    }
  };

  const fetchLikesAndRecasts = async (userId: string, firestore: any) => {
    const likesQuery = query(collection(firestore, 'artifacts', appId, 'users', userId, 'likes'));
    const likesSnapshot = await getDocs(likesQuery);
    const likedMap: Record<string, boolean> = {};
    likesSnapshot.forEach(doc => likedMap[doc.id] = true);
    setLikes(likedMap);

    const recastsQuery = query(collection(firestore, 'artifacts', appId, 'users', userId, 'recasts'));
    const recastsSnapshot = await getDocs(recastsQuery);
    const recastedMap: Record<string, boolean> = {};
    recastsSnapshot.forEach(doc => recastedMap[doc.id] = true);
    setRecasts(recastedMap);
  };

  const fetchFollowing = async (userId: string, firestore: any) => {
    const followsQuery = query(collection(firestore, 'artifacts', appId, 'users', userId, 'following'));
    const followsSnapshot = await getDocs(followsQuery);
    const followingList: string[] = [];
    followsSnapshot.forEach(doc => followingList.push(doc.id));
    setFollowing(followingList);
  };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("fuse/theme", theme);
  }, [theme]);

  // Navigation handlers
  const openProfile = useCallback((userId: string) => setRoute({ name: "profile", userId }), []);
  const openFeed = useCallback(() => setRoute({ name: "feed" }), []);

  if (!isAuthReady) {
    return <div className="min-h-dvh flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">Loading...</div>;
  }
  if (!me) {
    return <AuthScreen db={db} auth={auth} />;
  }

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Topbar onThemeToggle={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} onSearch={setSearch} onHome={openFeed} onProfile={() => openProfile(me.id)} me={me} />
      <div className="max-w-3xl mx-auto p-4">
        {route.name === "feed" ? (
          <FeedScreen
            me={me}
            posts={allPosts}
            users={allUsers}
            stories={allStories}
            likes={likes}
            recasts={recasts}
            following={following}
            search={search}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onOpenProfile={openProfile}
            db={db}
            onLikeRecast={() => fetchLikesAndRecasts(me.id, db)}
          />
        ) : route.name === "profile" ? (
          <ProfileScreen me={me} posts={allPosts} users={allUsers} userId={route.userId} onBack={openFeed} onOpenProfile={openProfile} following={following} onFollowChange={() => fetchFollowing(me.id, db)} onUpdatePfp={() => fetchUserData(me.id, db)} db={db} />
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------
// Auth Screen
// ---------------------------
function AuthScreen({ db, auth }: { db: any, auth: any }) {
  const handleAuth = async () => {
    try {
      const credential = await signInAnonymously(auth);
      const user = credential.user;
      if (user) {
        // Create user profile in 'users' collection
        const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid);
        await setDoc(userRef, {
          display_name: 'New User',
          username: user.uid.substring(0, 8),
          created_at: new Date().toISOString()
        }, { merge: true });
      }
    } catch (error) {
      console.error("Error during anonymous sign-in:", error);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="bg-white dark:bg-zinc-900 p-8 rounded-xl shadow-lg w-full max-w-sm">
        <h2 className="text-2xl font-bold mb-4 text-center">Welcome to Fuse</h2>
        <button onClick={handleAuth} className="w-full p-2 rounded bg-blue-600 text-white">
          Start Anonymously
        </button>
      </div>
    </div>
  );
}

// ---------------------------
// Topbar
// ---------------------------
function Topbar({ onThemeToggle, onSearch, onHome, onProfile, me, auth }: { onThemeToggle: () => void; onSearch: (q: string) => void; onHome: () => void; onProfile: () => void; me: User; auth: any }) {
  const handleSignOut = async () => {
    if (auth) {
      await auth.signOut();
    }
  };
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200/50 dark:border-zinc-800/80 bg-white/70 dark:bg-zinc-950/70 backdrop-blur">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
        <button onClick={onHome} className="flex items-center gap-2 font-bold tracking-tight" aria-label="Go home">
          <div className="w-7 h-7 rounded-lg grid place-items-center text-zinc-900 dark:text-zinc-950 bg-gradient-to-br from-blue-400 via-emerald-300 to-zinc-200 shadow">ƒ</div>
          <span>Fuse</span>
        </button>
        <div className="flex-1" />
        <div className="hidden sm:flex items-center gap-2 flex-1 max-w-md">
          <div className="flex items-center gap-2 w-full rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 px-3 py-2">
            <svg className="w-4 h-4 opacity-70" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M10.5 19a8.5 8.5 0 1 1 6.02-2.48l4.48 4.49-1.42 1.41-4.48-4.48A8.46 8.46 0 0 1 10.5 19Zm0-2a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z" />
            </svg>
            <input aria-label="Search" onChange={(e) => onSearch(e.target.value)} placeholder="Search (people, posts, #tags)" className="bg-transparent outline-none text-sm w-full placeholder:text-zinc-400" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onThemeToggle} className="px-3 py-2 rounded-full border border-zinc-200 dark:border-zinc-800" aria-pressed={false}>Theme</button>
          <button onClick={onProfile} className="px-3 py-2 rounded-full border border-zinc-200 dark:border-zinc-800">Profile</button>
        </div>
        <button onClick={handleSignOut} className="px-3 py-2 rounded-full border border-zinc-200 dark:border-zinc-800">Sign Out</button>
      </div>
    </header>
  );
}

// ---------------------------
// Feed Screen
// ---------------------------
function FeedScreen({ me, posts, users, stories, likes, recasts, following, search, activeTab, setActiveTab, onOpenProfile, db, onLikeRecast }: { me: User; posts: Post[]; users: Record<string, User>; stories: Story[]; likes: Record<string, boolean>; recasts: Record<string, boolean>; following: string[]; search: string; activeTab: Tab; setActiveTab: (t: Tab) => void; onOpenProfile: (id: string) => void; db: any; onLikeRecast: () => void; }) {
  const [text, setText] = useState("");
  const [media, setMedia] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const urls = media.map(file => URL.createObjectURL(file));
    setPreviewUrls(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [media]);

  const score = useCallback((p: Post) => {
    const ageH = (Date.now() - new Date(p.createdAt).getTime()) / 3_600_000;
    const engagement = p.likes * 2 + p.recasts * 3 + p.comments;
    return engagement + clamp(12 - ageH, 0, 12);
  }, []);

  const filtered = useMemo(() => {
    let items: Post[] = [...posts];
    if (activeTab === "following") {
      const fset = new Set(following);
      items = items.filter((p) => fset.has(p.userId) || p.userId === me.id);
    }
    if (activeTab === "latest") items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (activeTab === "forYou") items.sort((a, b) => score(b) - score(a));
    const q = search.trim().toLowerCase();
    if (q) items = items.filter((p) => p.text.toLowerCase().includes(q) || users[p.userId]?.name.toLowerCase().includes(q));
    return items;
  }, [posts, users, following, search, activeTab, score, me]);

  const onSelectFiles = (files: FileList | null) => {
    if (!files) return;
    setMedia(Array.from(files).slice(0, 4));
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    onSelectFiles(e.dataTransfer.files);
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);

  async function publish(kind: "post" | "story") {
    if (kind === "post" && !text.trim() && media.length === 0) {
      console.error("Write something or add a photo.");
      return;
    }
    if (kind === "story" && media.length === 0) {
      console.error("Please add a photo for your story.");
      return;
    }

    const mediaUrls: string[] = [];
    if (media.length > 0) {
      // Mocking image upload with a placeholder
      const placeholderUrl = `https://placehold.co/600x400/232736/FFF?text=Image+Placeholder`;
      mediaUrls.push(placeholderUrl);
    }

    if (kind === "post") {
      const postsCol = collection(db, 'artifacts', appId, 'public', 'data', 'posts');
      await addDoc(postsCol, {
        user_id: me.id,
        text: text.slice(0, 500),
        media_urls: mediaUrls,
        likes: 0,
        recasts: 0,
        comments: 0,
        created_at: new Date().toISOString()
      });
    } else if (kind === "story") {
      const storiesCol = collection(db, 'artifacts', appId, 'public', 'data', 'stories');
      await addDoc(storiesCol, {
        user_id: me.id,
        media_url: mediaUrls[0],
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString()
      });
    }
    setText("");
    setMedia([]);
    setPreviewUrls([]);
  }

  const toggle = async (postId: string, act: "like" | "recast" | "comment") => {
    if (act === "like") {
      const likeRef = doc(db, 'artifacts', appId, 'users', me.id, 'likes', postId);
      if (likes[postId]) {
        await deleteDoc(likeRef);
      } else {
        await setDoc(likeRef, { post_id: postId });
      }

      const postRef = doc(db, 'artifacts', appId, 'public', 'data', 'posts', postId);
      const postSnap = await getDoc(postRef);
      if (postSnap.exists()) {
        const postData = postSnap.data();
        await updateDoc(postRef, { likes: Math.max(0, postData.likes + (likes[postId] ? -1 : 1)) });
      }
      onLikeRecast();
    }
    // TODO: Implement recasts and comments logic
  };

  const overLimit = text.length > 500;

  return (
    <div>
      {/* Tabs */}
      <div className="flex justify-center gap-2 py-3">
        {(["forYou", "following", "latest"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 rounded-full border text-sm ${activeTab === t ? "bg-blue-600 text-white border-transparent" : "border-zinc-300 dark:border-zinc-700"}`}
            aria-pressed={activeTab === t}
          >
            {t === "forYou" ? "For you" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Composer */}
      <div
        className={`bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-dashed ${isDragging ? "border-blue-500" : "border-zinc-200 dark:border-zinc-800"} p-4`}
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
            {previewUrls.length > 0 && (
              <div className="flex gap-2 flex-wrap mt-2">
                {previewUrls.map((src, i) => (
                  <img key={i} src={src} alt="preview" className="max-h-40 rounded-xl border border-zinc-200 dark:border-zinc-800" loading="lazy" />
                ))}
              </div>
            )}
            <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="cursor-pointer px-3 py-2 rounded-full border border-zinc-300 dark:border-zinc-700">
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => onSelectFiles(e.target.files)} />
                  Add photo
                </label>
                <span className={`text-xs ${overLimit ? "text-red-500" : "text-zinc-500"}`}>{Math.min(text.length, 999)}/500</span>
              </div>
              <div className="flex gap-2">
                <label className="cursor-pointer px-3 py-2 rounded-full border border-zinc-300 dark:border-zinc-700">
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                    if (e.target.files?.length) {
                      setMedia(Array.from(e.target.files));
                      publish("story");
                    }
                  }} />
                  Add to Story
                </label>
                <button onClick={() => publish("post")} className="px-4 py-2 rounded-full bg-blue-600 text-white" disabled={overLimit}>
                  Post
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stories */}
      <StoriesTray stories={allStories} users={users} me={me} onOpenProfile={onOpenProfile} />

      {/* Feed */}
      <div className="mt-4">
        {filtered.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            user={users[p.userId] || { id: p.userId, name: "Unknown", handle: "@unknown" }}
            me={me}
            liked={!!likes[p.id]}
            recasted={!!recasts[p.id]}
            onToggle={(act) => toggle(p.id, act)}
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
function ProfileScreen({ me, posts, users, userId, onBack, onOpenProfile, following, onFollowChange, onUpdatePfp, db }: { me: User; posts: Post[]; users: Record<string, User>; userId: string; onBack: () => void; onOpenProfile: (id: string) => void; following: string[]; onFollowChange: () => void; onUpdatePfp: () => void; db: any }) {
  const user = users[userId] || me;
  const isMe = userId === me.id;
  const userPosts = posts.filter((p: Post) => p.userId === userId);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(me.name);
  const [draftUsername, setDraftUsername] = useState(me.handle.substring(1));
  const [draftBio, setDraftBio] = useState('');
  const [draftLinks, setDraftLinks] = useState('');
  const [profileData, setProfileData] = useState<any>(null);

  useEffect(() => {
    fetchProfileData();
  }, [userId, db]);

  const fetchProfileData = async () => {
    const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', userId);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      setProfileData(userSnap.data());
      setDraftBio(userSnap.data().bio || '');
      setDraftLinks(userSnap.data().links?.join('\n') || '');
    }
  };

  const handleUpdateProfile = async () => {
    const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', me.id);
    await updateDoc(userRef, {
      display_name: draftName,
      username: draftUsername,
      bio: draftBio.slice(0, 200),
      links: draftLinks.split(/\s+/).filter(Boolean),
    });
    setEditing(false);
    onUpdatePfp();
  };

  const handlePfpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Mocking image upload with a placeholder
    if (e.target.files?.[0]) {
      const newAvatar = `https://placehold.co/60x60/232736/FFF?text=${draftName[0]}`;
      const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', me.id);
      updateDoc(userRef, { avatar_url: newAvatar });
      onUpdatePfp();
    }
  };

  const toggleFollow = async () => {
    const followRef = doc(db, 'artifacts', appId, 'users', me.id, 'following', userId);
    const isFollowing = following.includes(userId);
    if (isFollowing) {
      await deleteDoc(followRef);
    } else {
      await setDoc(followRef, { user_id: userId });
    }
    onFollowChange();
  };

  const followingMe = following.includes(userId);
  const userBio = profileData?.bio || '';
  const userLinks = profileData?.links || [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <button onClick={onBack} className="px-3 py-2 rounded-full border border-zinc-300 dark:border-zinc-700" aria-label="Back to feed">
          ← Back
        </button>
        <div className="text-sm text-zinc-500">Profile</div>
      </div>

      {/* Header */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-6">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar size={72} user={user} onClick={() => {}} />
            {isMe && (
              <label className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-blue-600 text-white grid place-items-center cursor-pointer">
                <input type="file" accept="image/*" className="hidden" onChange={handlePfpChange} />
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M14.93 16.2c-.41 0-.74.33-.74.74v2.52c0 .41.33.74.74.74h2.52c.41 0 .74-.33.74-.74v-2.52c0-.41-.33-.74-.74-.74h-2.52Zm.76-13.43c.12-.12.29-.19.47-.19.18 0 .35.07.47.19.24.24.24.62 0 .86l-1.39 1.4-1.33-1.33 1.39-1.4Zm-7.14 0c-.24-.24-.62-.24-.86 0L5.35 4.02l1.33 1.33 1.39-1.4c.24-.24.24-.62 0-.86Zm12.1 16.8c-.37 0-.67.3-.67.67v2.01c0 .37.3.67.67.67h2.01c.37 0 .67-.3.67-.67v-2.01c0-.37-.3-.67-.67-.67h-2.01ZM18.5 24h-13c-.83 0-1.5-.67-1.5-1.5v-13c0-.83.67-1.5 1.5-1.5h13c.83 0 1.5.67 1.5 1.5v13c0 .83-.67 1.5-1.5 1.5Zm-13-14.5c0-.28.22-.5.5-.5h2c.28 0 .5.22.5.5v2c0 .28-.22.5-.5.5h-2c-.28 0-.5-.22-.5-.5v-2Zm0-4.5c0-.28.22-.5.5-.5h2c.28 0 .5.22.5.5v2c0 .28-.22.5-.5.5h-2c-.28 0-.5-.22-.5-.5v-2Zm4.5 4.5c0-.28.22-.5.5-.5h2c.28 0 .5.22.5.5v2c0 .28-.22.5-.5.5h-2c-.28 0-.5-.22-.5-.5v-2Zm0-4.5c0-.28.22-.5.5-.5h2c.28 0 .5.22.5.5v2c0 .28-.22.5-.5.5h-2c-.28 0-.5-.22-.5-.5v-2Zm9-2c-.28 0-.5.22-.5.5v2c0 .28.22.5.5.5h2c.28 0 .5-.22.5-.5v-2c0-.28-.22-.5-.5-.5h-2Z"/></svg>
              </label>
            )}
          </div>
          <div className="flex-1">
            <div className="text-xl font-semibold">{user.name}</div>
            <div className="text-zinc-500">User ID: {user.id}</div>
          </div>
          {isMe ? (
            <button onClick={() => setEditing((e) => !e)} className="px-4 py-2 rounded-full border border-zinc-300 dark:border-zinc-700">
              {editing ? "Cancel" : "Edit profile"}
            </button>
          ) : (
            <button onClick={toggleFollow} className={`px-4 py-2 rounded-full ${followingMe ? "border border-zinc-300 dark:border-zinc-700" : "bg-blue-600 text-white"}`}>
              {followingMe ? "Following" : "Follow"}
            </button>
          )}
        </div>

        {!editing ? (
          <div className="mt-4 space-y-2">
            {userBio && <p className="text-sm leading-relaxed whitespace-pre-wrap">{userBio}</p>}
            {userLinks.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {userLinks.map((url: string, i: number) => (
                  <a key={i} href={url} {...safeLinkProps} className="text-sm underline break-all">
                    {url}
                  </a>
                ))}
              </div>
            )}
            <div className="flex gap-4 text-sm text-zinc-500 pt-1">
              <span>
                <b>{userPosts.length}</b> posts
              </span>
              <span>
                <b>{Math.max(3, Math.floor(userPosts.length * 3.2))}</b> followers
              </span>
              <span>
                Joined {new Date(profileData?.created_at || Date.now()).toLocaleDateString()}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block">
                <div className="text-sm text-zinc-500 mb-1">Display Name</div>
                <input type="text" value={draftName} onChange={(e) => setDraftName(e.target.value)} className="w-full bg-transparent rounded-xl border border-zinc-300 dark:border-zinc-700 p-3" />
            </label>
            <label className="block">
                <div className="text-sm text-zinc-500 mb-1">Username</div>
                <input type="text" value={draftUsername} onChange={(e) => setDraftUsername(e.target.value)} className="w-full bg-transparent rounded-xl border border-zinc-300 dark:border-zinc-700 p-3" />
            </label>
            <label className="block">
              <div className="text-sm text-zinc-500 mb-1">Bio (200 chars)</div>
              <textarea value={draftBio} onChange={(e) => setDraftBio(e.target.value)} className="w-full bg-transparent rounded-xl border border-zinc-300 dark:border-zinc-700 p-3" rows={3} />
            </label>
            <label className="block">
              <div className="text-sm text-zinc-500 mb-1">Links (one per line, up to 3)</div>
              <textarea value={draftLinks} onChange={(e) => setDraftLinks(e.target.value)} className="w-full bg-transparent rounded-xl border border-zinc-300 dark:border-zinc-700 p-3" rows={3} />
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-full border border-zinc-300 dark:border-zinc-700">
                Cancel
              </button>
              <button onClick={handleUpdateProfile} className="px-4 py-2 rounded-full bg-blue-600 text-white">
                Save
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Story Highlights (fun mock) */}
      <div className="mt-6">
        <div className="font-medium mb-2">Highlights</div>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {["Day One", "Walks", "Build", "IRL"].map((label, i) => (
            <div key={i} className="flex-shrink-0 text-center">
              <div className="w-20 h-20 rounded-full border-4 border-zinc-200 dark:border-zinc-800 grid place-items-center bg-zinc-100 dark:bg-zinc-900 text-2xl">{label[0]}</div>
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
            <button className="px-3 py-1 rounded-full border border-zinc-300 dark:border-zinc-700">Grid</button>
            <button className="px-3 py-1 rounded-full border border-zinc-300 dark:border-zinc-700">List</button>
          </div>
        </div>
        {userPosts.length === 0 ? (
          <div className="text-sm text-zinc-500">No posts yet.</div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {userPosts.map((p) => (
              <div key={p.id} className="aspect-square rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900">
                {p.media?.[0] ? (
                  <img src={p.media[0]} alt="post" className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className="w-full h-full grid place-items-center text-zinc-500 text-sm p-2 text-center">{p.text.slice(0, 60) || "Post"}</div>
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
function StoriesTray({ stories, users, me, onOpenProfile }: { stories: Story[]; users: Record<string, User>; me: User; onOpenProfile: (id: string) => void }) {
  const allStories = useMemo(() => {
    const myStories = stories.filter(s => s.userId === me.id);
    const otherStories = stories.filter(s => s.userId !== me.id);
    return [...myStories, ...otherStories];
  }, [stories, me]);
  
  return (
    <div className="flex gap-3 overflow-x-auto py-3">
      <button key="self" className="text-center flex-shrink-0" onClick={() => onOpenProfile(me.id)} aria-label="Open your profile">
        <div className="w-[70px] h-[70px] rounded-full p-[3px] bg-gradient-to-tr from-emerald-400 via-blue-400 to-pink-400">
          <div className="w-full h-full rounded-full bg-white dark:bg-zinc-950 border-2 border-white dark:border-950 overflow-hidden grid place-items-center">
            <span className="text-xl">{me.name?.[0]}</span>
          </div>
        </div>
        <div className="text-xs text-zinc-500 mt-1 w-[70px] truncate">Your story</div>
      </button>
      {allStories.map((s) => (
        <button key={s.id} className="text-center flex-shrink-0" onClick={() => onOpenProfile(s.userId)} aria-label={`Open ${users[s.userId]?.name || "user"} profile`}>
          <div className="w-[70px] h-[70px] rounded-full p-[3px] bg-gradient-to-tr from-emerald-400 via-blue-400 to-pink-400">
            <div className="w-full h-full rounded-full bg-white dark:bg-zinc-950 border-2 border-white dark:border-950 overflow-hidden grid place-items-center">
              {s.url ? <img src={s.url} alt="story" className="w-full h-full object-cover" loading="lazy" /> : <span className="text-xl">{(users[s.userId]?.name || "U")[0]}</span>}
            </div>
          </div>
          <div className="text-xs text-zinc-500 mt-1 w-[70px] truncate">{users[s.userId]?.name}</div>
        </button>
      ))}
    </div>
  );
}

// ---------------------------
// Post Card
// ---------------------------
function PostCard({ post, user, me, liked, recasted, onToggle, onOpenProfile }: { post: Post; user: User; me: User; liked: boolean; recasted: boolean; onToggle: (act: "like" | "recast" | "comment") => void; onOpenProfile: (id: string) => void }) {
  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Post by ${user.name}`,
          text: post.text,
          url: window.location.href, // You would replace this with the specific post URL
        });
      } catch (error) {
        console.error('Error sharing:', error);
      }
    } else {
      console.error("Web Share API is not supported in this browser.");
    }
  };

  return (
    <article className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-4 my-4">
      <div className="flex items-center gap-3">
        <Avatar user={user} onClick={() => onOpenProfile(user.id)} />
        <div className="leading-tight">
          <div className="font-medium">{user.name}</div>
          <div className="text-xs text-zinc-500">{user.handle} · {timeAgo(post.createdAt)}</div>
        </div>
      </div>
      <div className="mt-3 whitespace-pre-wrap">{linkify(post.text)}</div>
      {post.media?.length > 0 && (
        <div className="flex gap-2 flex-wrap mt-3">
          {post.media.map((src, i) => (
            <img key={i} src={src} alt="media" className="max-h-80 rounded-xl border border-zinc-200 dark:border-zinc-800" loading="lazy" />
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 text-sm text-zinc-500 mt-3">
        <button onClick={() => onToggle("like")} className={`px-2 py-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 ${liked ? "text-pink-600" : ""}`} aria-pressed={liked} aria-label="Like">
          ❤️ <span className="ml-1">{formatCount(post.likes)}</span>
        </button>
        <button onClick={() => onToggle("recast")} className={`px-2 py-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 ${recasted ? "text-emerald-600" : ""}`} aria-pressed={recasted} aria-label="Recast">
          🔁 <span className="ml-1">{formatCount(post.recasts)}</span>
        </button>
        <button onClick={() => onToggle("comment")} className="px-2 py-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Comment">
          💬 <span className="ml-1">{formatCount(post.comments)}</span>
        </button>
        <button onClick={handleShare} className="px-2 py-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Share">
          ↗️
        </button>
        <div className="ml-auto text-xs">ID {post.id.slice(-4)}</div>
      </div>
    </article>
  );
}

function Avatar({ user, onClick, size = 44 }: { user: User; onClick?: () => void; size?: number }) {
  return (
    <button onClick={onClick} className="shrink-0 rounded-full grid place-items-center font-bold text-zinc-900" style={{ width: size, height: size, background: "linear-gradient(145deg, var(--tw-gradient-stops))" }} aria-label={`Open ${user.name} profile`}>
      <div className="rounded-full grid place-items-center bg-gradient-to-br from-blue-400 to-emerald-300" style={{ width: size, height: size }}>
        <div className="rounded-full grid place-items-center bg-white/90 dark:bg-zinc-950/90 overflow-hidden" style={{ width: size - 6, height: size - 6 }}>
          {user.avatar ? (
            <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" loading="lazy" />
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
        if (/^https?:\/\//.test(p)) return (
          <a key={i} href={p} {...safeLinkProps} className="underline break-all">
            {p}
          </a>
        );
        if (/^#[\p{L}0-9_]+$/u.test(p)) return (
          <span key={i} className="px-2 py-0.5 rounded-full border text-xs ml-1">
            {p}
          </span>
        );
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}
