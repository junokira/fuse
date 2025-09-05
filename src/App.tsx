import { useEffect, useRef, useState } from "react";
import { createClient, SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";

/**
 * App.tsx (TypeScript)
 * - Uses Vite env variables: import.meta.env.VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 * - Ensure @supabase/supabase-js is installed
 */

// Vite env (works in Vite and most modern setups). Avoids `process` type issues.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "Missing Vite env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  );
}

const supabase: SupabaseClient = createClient(SUPABASE_URL ?? "", SUPABASE_ANON_KEY ?? "", {
  realtime: { params: { eventsPerSecond: 10 } },
});

/* ---------------------- Types ---------------------- */
type Profile = {
  id: string;
  name?: string | null;
  handle?: string | null;
  avatar?: string | null;
  bio?: string | null;
  created_at?: string | null;
};

type PostRow = {
  id: string;
  user_id: string;
  text: string | null;
  media?: string[] | null;
  likes?: number | null;
  recasts?: number | null;
  comments?: number | null;
  created_at?: string | null;
};

type Post = {
  id: string;
  userId: string;
  text: string;
  media: string[];
  likes: number;
  recasts: number;
  comments: number;
  createdAt: number;
  optimistic?: boolean;
};

/* ---------------------- Helpers ---------------------- */
function randomFilename(originalName = "file"): string {
  const ext = originalName.includes(".")
    ? "." + originalName.split(".").pop()
    : "";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
}

async function uploadFileToStorage(file: File, folder = "posts"): Promise<string | null> {
  const filePath = `${folder}/${randomFilename(file.name)}`;
  const { data, error } = await supabase.storage.from("media").upload(filePath, file);
  if (error) {
    console.error("upload error:", error);
    throw error;
  }
  const { data: pub } = supabase.storage.from("media").getPublicUrl(data.path ?? filePath);
  return pub?.publicUrl ?? null;
}

function mapPostRow(row: PostRow): Post {
  return {
    id: row.id,
    userId: row.user_id,
    text: row.text ?? "",
    media: row.media ?? [],
    likes: row.likes ?? 0,
    recasts: row.recasts ?? 0,
    comments: row.comments ?? 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

/* ---------------------- Component ---------------------- */
export default function App(): JSX.Element {
  const [loading, setLoading] = useState<boolean>(true);
  const [session, setSession] = useState<any | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [posts, setPosts] = useState<Post[]>([]);
  const [userLikes, setUserLikes] = useState<Record<string, boolean>>({});
  const [newText, setNewText] = useState<string>("");
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [email, setEmail] = useState<string>("");

  // typed ref for the realtime channel (avoids "never" type)
  const postsChannelRef = useRef<RealtimeChannel | null>(null);

  /* ---------------------- Init ---------------------- */
  useEffect(() => {
    let mounted = true;
    async function init() {
      setLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        const currentSession = data.session ?? null;
        if (!mounted) return;
        setSession(currentSession);

        if (currentSession?.user) {
          await ensureProfileExists(currentSession.user);
        }

        // load profiles and posts
        const [profilesRes, postsRes] = await Promise.all([
          supabase.from("profiles").select("*"),
          supabase.from("posts").select("*").order("created_at", { ascending: false }).limit(200),
        ]);

        if (!mounted) return;

        if (profilesRes.error) throw profilesRes.error;
        const profilesRows = (profilesRes.data ?? []) as Profile[];
        const profilesMap: Record<string, Profile> = {};
        profilesRows.forEach((p) => {
          if (p && p.id) profilesMap[p.id] = p;
        });
        setProfiles(profilesMap);

        if (postsRes.error) throw postsRes.error;
        const postsRows = (postsRes.data ?? []) as PostRow[];
        setPosts(postsRows.map(mapPostRow));

        if (currentSession?.user) {
          const likesRes = await supabase.from("likes").select("post_id").eq("user_id", currentSession.user.id);
          if (!likesRes.error) {
            const likesMap: Record<string, boolean> = {};
            (likesRes.data ?? []).forEach((l: any) => {
              if (l?.post_id) likesMap[l.post_id] = true;
            });
            setUserLikes(likesMap);
          }
          const myProfile = profilesMap[currentSession.user.id];
          if (myProfile) setMe(myProfile);
        }
      } catch (err: unknown) {
        console.error("init error", err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    init();

    // auth listener
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, sessionObj) => {
      setSession(sessionObj);
      if (sessionObj?.user) {
        await ensureProfileExists(sessionObj.user);
        const likesRes = await supabase.from("likes").select("post_id").eq("user_id", sessionObj.user.id);
        if (!likesRes.error) {
          const likesMap: Record<string, boolean> = {};
          (likesRes.data ?? []).forEach((l: any) => {
            if (l?.post_id) likesMap[l.post_id] = true;
          });
          setUserLikes(likesMap);
        }
        const p = await supabase.from("profiles").select("*").eq("id", sessionObj.user.id).single();
        if (!p.error) setMe(p.data as Profile);
      } else {
        setMe(null);
        setUserLikes({});
      }
    });

    return () => {
      mounted = false;
      // unsubscribe auth listener
      if (listener?.subscription?.unsubscribe) {
        listener.subscription.unsubscribe();
      }
    };
  }, []);

  /* ---------------------- Realtime subscription ---------------------- */
  useEffect(() => {
    async function setupRealtime() {
      // unsubscribe existing channel if any
      try {
        if (postsChannelRef.current) {
          await postsChannelRef.current.unsubscribe();
          postsChannelRef.current = null;
        }
      } catch (e) {
        // ignore
      }

      const channel = supabase.channel("public:posts");

      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        (payload: { new: PostRow }) => {
          const newPost = mapPostRow(payload.new);
          setPosts((cur) => {
            if (cur.some((p) => p.id === newPost.id)) return cur;
            return [newPost, ...cur].slice(0, 500);
          });
        }
      );

      channel.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "posts" },
        (payload: { new: PostRow }) => {
          const updated = mapPostRow(payload.new);
          setPosts((cur) => cur.map((p) => (p.id === updated.id ? updated : p)));
        }
      );

      channel.on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "posts" },
        (payload: { old: PostRow }) => {
          setPosts((cur) => cur.filter((p) => p.id !== payload.old.id));
        }
      );

      await channel.subscribe();
      postsChannelRef.current = channel;
    }

    setupRealtime();

    return () => {
      (async () => {
        try {
          if (postsChannelRef.current) {
            await postsChannelRef.current.unsubscribe();
            postsChannelRef.current = null;
          }
        } catch (e) {
          // ignore
        }
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------- Profile helpers ---------------------- */
  async function ensureProfileExists(user: any): Promise<void> {
    if (!user) return;
    try {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (error) {
        // If no row, insert
        if ((error as any)?.details?.includes("No rows found") || (error as any)?.code === "PGRST116") {
          await supabase.from("profiles").insert([
            {
              id: user.id,
              name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? (user.email ? user.email.split("@")[0] : "Anon"),
              handle: user.user_metadata?.handle ?? (user.email ? user.email.split("@")[0] : `u_${user.id.slice(0, 6)}`),
              avatar: user.user_metadata?.avatar_url ?? null,
            },
          ]);
        } else {
          console.warn("profile select error", error);
        }
      } else if (data) {
        setMe(data as Profile);
      }
    } catch (err) {
      console.error("ensureProfileExists", err);
    }
  }

  /* ---------------------- Auth ---------------------- */
  async function signInWithMagicLink(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email) return alert("Enter your email");
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) throw error;
      alert("Magic link sent — check your email (spam too).");
    } catch (err: unknown) {
      console.error("signin error", err);
      alert("Sign-in error");
    } finally {
      setLoading(false);
    }
  }

  async function signOut(): Promise<void> {
    await supabase.auth.signOut();
    setSession(null);
    setMe(null);
    setUserLikes({});
  }

  /* ---------------------- Posting ---------------------- */
  async function publishPost(): Promise<void> {
    if (!session?.user) return alert("Sign in first");
    if (!newText.trim() && newFiles.length === 0) return alert("Type something or attach a file");

    const optimisticPost: Post = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId: session.user.id,
      text: newText,
      media: [],
      likes: 0,
      recasts: 0,
      comments: 0,
      createdAt: Date.now(),
      optimistic: true,
    };

    setPosts((cur) => [optimisticPost, ...cur]);
    setNewText("");

    try {
      const uploadedUrls: string[] = [];
      for (const f of newFiles) {
        const url = await uploadFileToStorage(f, "posts");
        if (url) uploadedUrls.push(url);
      }

      const { data, error } = await supabase
        .from("posts")
        .insert([{ user_id: session.user.id, text: newText, media: uploadedUrls }])
        .select()
        .single();

      if (error || !data) throw error ?? new Error("Insert error");

      const serverPost = mapPostRow(data as PostRow);
      setPosts((cur) => [serverPost, ...cur.filter((p) => p.id !== optimisticPost.id)]);
    } catch (err) {
      console.error("publish error", err);
      setPosts((cur) => cur.filter((p) => p.id !== optimisticPost.id));
      alert("Failed to publish post.");
    } finally {
      setNewFiles([]);
    }
  }

  /* ---------------------- Likes ---------------------- */
  async function toggleLike(postId: string): Promise<void> {
    if (!session?.user) return alert("Sign in to like");
    const already = !!userLikes[postId];

    // optimistic
    setUserLikes((cur) => {
      const cp = { ...cur };
      if (already) delete cp[postId];
      else cp[postId] = true;
      return cp;
    });
    setPosts((cur) => cur.map((p) => (p.id === postId ? { ...p, likes: p.likes + (already ? -1 : 1) } : p)));

    try {
      if (!already) {
        const { error } = await supabase.from("likes").insert([{ user_id: session.user.id, post_id: postId }]);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("likes").delete().match({ user_id: session.user.id, post_id: postId });
        if (error) throw error;
      }

      const postRes = await supabase.from("posts").select("likes").eq("id", postId).single();
      if (!postRes.error && postRes.data) {
        setPosts((cur) => cur.map((p) => (p.id === postId ? { ...p, likes: postRes.data.likes ?? p.likes } : p)));
      }
    } catch (err) {
      console.error("toggleLike error", err);
      // rollback optimistic
      setUserLikes((cur) => {
        const cp = { ...cur };
        if (already) cp[postId] = true;
        else delete cp[postId];
        return cp;
      });
      // reload server post if possible
      try {
        const postRes = await supabase.from("posts").select("*").eq("id", postId).single();
        if (!postRes.error && postRes.data) {
          const serverPost = mapPostRow(postRes.data as PostRow);
          setPosts((cur) => cur.map((p) => (p.id === postId ? serverPost : p)));
        }
      } catch (_) {}
      alert("Failed to toggle like.");
    }
  }

  /* ---------------------- UI helpers ---------------------- */
  function handleFilesChange(ev: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(ev.target.files ?? []);
    setNewFiles(list);
  }

  function ProfileMini({ userId }: { userId: string }) {
    const p = profiles[userId] ?? (userId === me?.id ? me : undefined);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <img
          alt="avatar"
          src={p?.avatar ?? `https://api.dicebear.com/6.x/identicon/svg?seed=${userId}`}
          style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }}
        />
        <div style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600 }}>{p?.name ?? "Unknown"}</div>
          <div style={{ color: "#666", fontSize: 12 }}>@{p?.handle ?? userId.slice(0, 6)}</div>
        </div>
      </div>
    );
  }

  /* ---------------------- Render ---------------------- */
  if (loading) {
    return (
      <div style={{ padding: 24, fontFamily: "sans-serif" }}>
        <h3>Loading…</h3>
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div style={{ padding: 20, fontFamily: "sans-serif", maxWidth: 680, margin: "0 auto" }}>
        <h2>Mini Social (Supabase)</h2>
        <p>Sign in with a magic link (email)</p>
        <form onSubmit={signInWithMagicLink}>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: 10, width: "100%", marginBottom: 8 }}
          />
          <button disabled={loading} style={{ padding: 10 }}>
            Send magic link
          </button>
        </form>

        <hr style={{ margin: "20px 0" }} />
        <div>
          <h4>Recent posts (read-only)</h4>
          {posts.length === 0 && <div>No posts yet.</div>}
          {posts.map((post) => (
            <div key={post.id} style={{ border: "1px solid #eee", padding: 12, marginBottom: 10, borderRadius: 8 }}>
              <ProfileMini userId={post.userId} />
              <div style={{ marginTop: 8 }}>{post.text}</div>
              {post.media && post.media.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {post.media.map((m, i) => (
                    <img key={i} src={m} alt="" style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 6 }} />
                  ))}
                </div>
              )}
              <div style={{ color: "#666", fontSize: 12, marginTop: 8 }}>{new Date(post.createdAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // signed in UI
  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Mini Social (Supabase)</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <ProfileMini userId={me?.id ?? session.user.id} />
          <button onClick={signOut} style={{ padding: "8px 12px" }}>
            Sign out
          </button>
        </div>
      </div>

      <section style={{ marginTop: 16, marginBottom: 20, border: "1px solid #eee", padding: 12, borderRadius: 10 }}>
        <h4>Create post</h4>
        <textarea
          placeholder="What's happening?"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          rows={4}
          style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <input type="file" multiple onChange={handleFilesChange} />
          <button onClick={publishPost} style={{ padding: "8px 12px" }}>
            Publish
          </button>
          {newFiles.length > 0 && <div style={{ color: "#666" }}>{newFiles.length} file(s) ready</div>}
        </div>
      </section>

      <section>
        <h4>Feed</h4>
        {posts.length === 0 && <div>No posts</div>}
        {posts.map((post) => (
          <article key={post.id} style={{ border: "1px solid #eee", padding: 12, borderRadius: 8, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <ProfileMini userId={post.userId} />
              <div style={{ fontSize: 12, color: "#888" }}>{new Date(post.createdAt).toLocaleString()}</div>
            </div>

            <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{post.text}</div>

            {post.media && post.media.length > 0 && (
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {post.media.map((m, i) => (
                  <img key={i} src={m} alt="" style={{ width: 160, height: 120, objectFit: "cover", borderRadius: 6 }} />
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 12, marginTop: 10, alignItems: "center" }}>
              <button
                onClick={() => toggleLike(post.id)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: userLikes[post.id] ? "1px solid #0a84ff" : "1px solid #ddd",
                  background: userLikes[post.id] ? "#e8f0ff" : "white",
                }}
              >
                {userLikes[post.id] ? "♥ Liked" : "♡ Like"} ({post.likes})
              </button>
              <div style={{ color: "#666", fontSize: 13 }}>{post.recasts ?? 0} recasts</div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
// src/App.jsx
import React, { useEffect, useState, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

/*
  App.jsx
  - Single-file React app using Supabase for auth, posts, media uploads, likes, realtime updates.
  - Make sure REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY are set.
  - Ensure you created a storage bucket named 'media' and tables 'profiles','posts','likes'.
*/

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "Missing SUPABASE env vars. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } }, // mild throttle
});

function randomFilename(originalName = "file") {
  const ext = originalName.includes(".")
    ? "." + originalName.split(".").pop()
    : "";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
}

async function uploadFileToStorage(file, folder = "posts") {
  // returns public URL
  const filePath = `${folder}/${randomFilename(file.name)}`;
  const { data, error } = await supabase.storage
    .from("media")
    .upload(filePath, file);
  if (error) {
    // if file exists (409) - fallback to using that path's public URL
    throw error;
  }
  const { data: pub } = supabase.storage.from("media").getPublicUrl(
    data.path ?? filePath
  );
  return pub?.publicUrl ?? null;
}

function useAutoRef() {
  const ref = useRef(null);
  return ref;
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null); // supabase session
  const [me, setMe] = useState(null); // profile row for logged in user
  const [profiles, setProfiles] = useState({}); // map userId -> profile
  const [posts, setPosts] = useState([]); // list of posts newest first
  const [userLikes, setUserLikes] = useState({}); // map postId -> true
  const [newText, setNewText] = useState("");
  const [newFiles, setNewFiles] = useState([]); // File objects
  const [email, setEmail] = useState("");
  const postsChannelRef = useAutoRef();

  // Helper: map DB post row -> client post object
  function mapPostRow(row) {
    return {
      id: row.id,
      userId: row.user_id,
      text: row.text,
      media: row.media || [],
      likes: row.likes ?? 0,
      recasts: row.recasts ?? 0,
      comments: row.comments ?? 0,
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    };
  }

  // Initial load
  useEffect(() => {
    let mounted = true;
    async function init() {
      setLoading(true);

      // session and auth listener
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(currentSession);
      if (currentSession?.user) {
        await ensureProfileExists(currentSession.user);
      }

      // load profiles and posts (limit 200)
      try {
        const [profilesRes, postsRes] = await Promise.all([
          supabase.from("profiles").select("*"),
          supabase
            .from("posts")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(200),
        ]);

        if (!mounted) return;

        // profiles
        if (profilesRes.error) throw profilesRes.error;
        const profilesRows = profilesRes.data || [];
        const profilesMap = {};
        profilesRows.forEach((p) => {
          profilesMap[p.id] = p;
        });
        setProfiles(profilesMap);

        // posts
        if (postsRes.error) throw postsRes.error;
        const postsRows = postsRes.data || [];
        setPosts(postsRows.map(mapPostRow));

        // load likes for current user (if any)
        if (currentSession?.user) {
          const likesRes = await supabase
            .from("likes")
            .select("post_id")
            .eq("user_id", currentSession.user.id);
          if (!likesRes.error) {
            const likesMap = {};
            (likesRes.data || []).forEach((l) => (likesMap[l.post_id] = true));
            setUserLikes(likesMap);
          }
          // set me profile
          const profile = profilesMap[currentSession.user.id];
          if (profile) setMe(profile);
        }
      } catch (err) {
        console.error("Init error:", err);
      } finally {
        setLoading(false);
      }
    }

    init();

    // auth state change listener
    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, sessionObj) => {
        setSession(sessionObj);
        if (sessionObj?.user) {
          await ensureProfileExists(sessionObj.user);
          // reload likes and me
          const likesRes = await supabase
            .from("likes")
            .select("post_id")
            .eq("user_id", sessionObj.user.id);
          if (!likesRes.error) {
            const likesMap = {};
            (likesRes.data || []).forEach((l) => (likesMap[l.post_id] = true));
            setUserLikes(likesMap);
          }
          // get profile
          const p = await supabase
            .from("profiles")
            .select("*")
            .eq("id", sessionObj.user.id)
            .single();
          if (!p.error) setMe(p.data);
        } else {
          setMe(null);
          setUserLikes({});
        }
      }
    );

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe?.();
    };
  }, []);

  // Realtime: subscribe to posts table for INSERT/UPDATE/DELETE
  useEffect(() => {
    // cleanup existing channel if present
    async function setupRealtime() {
      // unsubscribe old
      try {
        if (postsChannelRef.current) {
          await postsChannelRef.current.unsubscribe();
          postsChannelRef.current = null;
        }
      } catch (e) {
        // ignore
      }

      // create a new channel
      const channel = supabase.channel("public:posts");
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        (payload) => {
          const newPost = mapPostRow(payload.new);
          setPosts((cur) => {
            // ignore if already present
            if (cur.some((p) => p.id === newPost.id)) return cur;
            return [newPost, ...cur].slice(0, 500);
          });
        }
      );

      channel.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "posts" },
        (payload) => {
          const updated = mapPostRow(payload.new);
          setPosts((cur) => cur.map((p) => (p.id === updated.id ? updated : p)));
        }
      );

      channel.on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "posts" },
        (payload) => {
          setPosts((cur) => cur.filter((p) => p.id !== payload.old.id));
        }
      );

      // subscribe
      await channel.subscribe();
      postsChannelRef.current = channel;
    }

    setupRealtime();

    return () => {
      (async () => {
        try {
          if (postsChannelRef.current) {
            await postsChannelRef.current.unsubscribe();
            postsChannelRef.current = null;
          }
        } catch (e) {
          // ignore
        }
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Utility: ensure profile row exists for an auth user
  async function ensureProfileExists(user) {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (error && error.code !== "PGRST116") {
        // if not found, upsert
        if (error.details?.includes("No rows found")) {
          await supabase.from("profiles").insert([
            {
              id: user.id,
              name:
                user.user_metadata?.full_name ||
                user.user_metadata?.name ||
                user.email?.split("@")[0] ||
                "Anon",
              handle:
                user.user_metadata?.handle ||
                (user.email ? user.email.split("@")[0] : `u_${user.id.slice(0, 6)}`),
              avatar: user.user_metadata?.avatar_url || null,
            },
          ]);
        } else {
          console.warn("Profile select error:", error);
        }
      } else if (data) {
        setMe(data);
      } else {
        // upsert fallback
        await supabase.from("profiles").upsert([
          {
            id: user.id,
            name:
              user.user_metadata?.full_name ||
              user.user_metadata?.name ||
              user.email?.split("@")[0] ||
              "Anon",
            handle:
              user.user_metadata?.handle ||
              (user.email ? user.email.split("@")[0] : `u_${user.id.slice(0, 6)}`),
            avatar: user.user_metadata?.avatar_url || null,
          },
        ]);
      }
    } catch (err) {
      console.error("ensureProfileExists error", err);
    }
  }

  // Sign-in (magic link)
  async function signInWithMagicLink(e) {
    e?.preventDefault();
    if (!email) return alert("Enter your email");
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) {
        throw error;
      }
      alert("Magic link sent to your email (check spam).");
    } catch (err) {
      console.error(err);
      alert("Sign-in error: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setMe(null);
    setUserLikes({});
  }

  // Publish a new post (uploads files then inserts post)
  async function publishPost() {
    if (!session?.user) {
      return alert("Sign in first");
    }
    if (!newText.trim() && newFiles.length === 0) {
      return alert("Type something or attach a file");
    }

    // optimistic post
    const optimisticPost = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId: session.user.id,
      text: newText,
      media: [],
      likes: 0,
      createdAt: Date.now(),
      optimistic: true,
    };
    setPosts((cur) => [optimisticPost, ...cur]);
    setNewText("");

    try {
      // upload files
      const uploadedUrls = [];
      for (const f of newFiles) {
        if (f instanceof File) {
          const url = await uploadFileToStorage(f, "posts");
          if (url) uploadedUrls.push(url);
        }
      }

      // insert post
      const { data, error } = await supabase
        .from("posts")
        .insert([
          {
            user_id: session.user.id,
            text: newText,
            media: uploadedUrls,
          },
        ])
        .select()
        .single();

      if (error) throw error;

      const serverPost = mapPostRow(data);

      // replace optimistic
      setPosts((cur) => [serverPost, ...cur.filter((p) => p.id !== optimisticPost.id)]);
    } catch (err) {
      console.error("publish error:", err);
      // rollback optimistic
      setPosts((cur) => cur.filter((p) => p.id !== optimisticPost.id));
      alert("Failed to publish post.");
    } finally {
      setNewFiles([]);
    }
  }

  // Toggle like for a post
  async function toggleLike(postId) {
    if (!session?.user) return alert("Sign in to like");

    const already = !!userLikes[postId];

    // optimistic toggle
    setUserLikes((cur) => {
      const copy = { ...cur };
      if (already) delete copy[postId];
      else copy[postId] = true;
      return copy;
    });
    setPosts((cur) =>
      cur.map((p) =>
        p.id === postId ? { ...p, likes: p.likes + (already ? -1 : 1) } : p
      )
    );

    try {
      if (!already) {
        // insert like
        const { error } = await supabase
          .from("likes")
          .insert([{ user_id: session.user.id, post_id: postId }]);
        if (error) {
          // rollback
          throw error;
        }
      } else {
        // delete like
        const { error } = await supabase
          .from("likes")
          .delete()
          .match({ user_id: session.user.id, post_id: postId });
        if (error) {
          throw error;
        }
      }

      // fetch latest count for the post and update (keeps consistent with server)
      const postRes = await supabase.from("posts").select("likes").eq("id", postId).single();
      if (!postRes.error && postRes.data) {
        setPosts((cur) => cur.map((p) => (p.id === postId ? { ...p, likes: postRes.data.likes ?? p.likes } : p)));
      }
    } catch (err) {
      console.error("toggleLike error", err);
      // rollback optimistic if error
      setUserLikes((cur) => {
        const copy = { ...cur };
        if (already) copy[postId] = true;
        else delete copy[postId];
        return copy;
      });
      // revert counts by reloading post
      try {
        const postRes = await supabase.from("posts").select("*").eq("id", postId).single();
        if (!postRes.error && postRes.data) {
          const serverPost = mapPostRow(postRes.data);
          setPosts((cur) => cur.map((p) => (p.id === postId ? serverPost : p)));
        }
      } catch (_) {}
      alert("Failed to toggle like.");
    }
  }

  // File input handler
  function handleFilesChange(ev) {
    const list = Array.from(ev.target.files || []);
    setNewFiles(list);
  }

  // Simple UI rendering helpers
  function ProfileMini({ userId }) {
    const p = profiles[userId] || (userId === me?.id ? me : null);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <img
          alt="avatar"
          src={p?.avatar || `https://api.dicebear.com/6.x/identicon/svg?seed=${userId}`}
          style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }}
        />
        <div style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600 }}>{p?.name || "Unknown"}</div>
          <div style={{ color: "#666", fontSize: 12 }}>@{p?.handle || userId.slice(0, 6)}</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 24, fontFamily: "sans-serif" }}>
        <h3>Loading…</h3>
      </div>
    );
  }

  // Auth UI
  if (!session?.user) {
    return (
      <div style={{ padding: 20, fontFamily: "sans-serif", maxWidth: 680, margin: "0 auto" }}>
        <h2>Mini Social (Supabase)</h2>
        <p>Sign in with a magic link (email)</p>
        <form onSubmit={signInWithMagicLink}>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: 10, width: "100%", marginBottom: 8 }}
          />
          <button disabled={loading} style={{ padding: 10 }}>
            Send magic link
          </button>
        </form>

        <hr style={{ margin: "20px 0" }} />
        <div>
          <h4>Recent posts (read-only)</h4>
          {posts.length === 0 && <div>No posts yet.</div>}
          {posts.map((post) => (
            <div
              key={post.id}
              style={{
                border: "1px solid #eee",
                padding: 12,
                marginBottom: 10,
                borderRadius: 8,
              }}
            >
              <ProfileMini userId={post.userId} />
              <div style={{ marginTop: 8 }}>{post.text}</div>
              {post.media && post.media.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {post.media.map((m, i) => (
                    <img key={i} src={m} alt="" style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 6 }} />
                  ))}
                </div>
              )}
              <div style={{ color: "#666", fontSize: 12, marginTop: 8 }}>{new Date(post.createdAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Signed-in UI
  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Mini Social (Supabase)</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <ProfileMini userId={me?.id || session.user.id} />
          <button onClick={signOut} style={{ padding: "8px 12px" }}>
            Sign out
          </button>
        </div>
      </div>

      <section style={{ marginTop: 16, marginBottom: 20, border: "1px solid #eee", padding: 12, borderRadius: 10 }}>
        <h4>Create post</h4>
        <textarea
          placeholder="What's happening?"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          rows={4}
          style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <input type="file" multiple onChange={handleFilesChange} />
          <button onClick={publishPost} style={{ padding: "8px 12px" }}>
            Publish
          </button>
          {newFiles.length > 0 && <div style={{ color: "#666" }}>{newFiles.length} file(s) ready</div>}
        </div>
      </section>

      <section>
        <h4>Feed</h4>
        {posts.length === 0 && <div>No posts</div>}
        {posts.map((post) => (
          <article key={post.id} style={{ border: "1px solid #eee", padding: 12, borderRadius: 8, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <ProfileMini userId={post.userId} />
              <div style={{ fontSize: 12, color: "#888" }}>{new Date(post.createdAt).toLocaleString()}</div>
            </div>
            <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{post.text}</div>

            {post.media && post.media.length > 0 && (
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {post.media.map((m, i) => (
                  <img key={i} src={m} alt="" style={{ width: 160, height: 120, objectFit: "cover", borderRadius: 6 }} />
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 12, marginTop: 10, alignItems: "center" }}>
              <button
                onClick={() => toggleLike(post.id)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: userLikes[post.id] ? "1px solid #0a84ff" : "1px solid #ddd",
                  background: userLikes[post.id] ? "#e8f0ff" : "white",
                }}
              >
                {userLikes[post.id] ? "♥ Liked" : "♡ Like"} ({post.likes})
              </button>
              <div style={{ color: "#666", fontSize: 13 }}>{post.recasts ?? 0} recasts</div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
