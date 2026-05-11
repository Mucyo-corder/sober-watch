import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type User = {
  id: number;
  email: string;
  role: string;
};

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem("auth_token");
    const storedUser = localStorage.getItem("auth_user");
    if (storedToken && storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser) as User;
        setToken(storedToken);
        setUser(parsedUser);
        setIsAdmin(parsedUser.role === "admin");
      } catch {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_user");
      }
    }
    setLoading(false);
  }, []);

  async function signIn(email: string, password: string) {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({ error: "Login failed" }));
      throw new Error(errorPayload.error || "Login failed");
    }
    const payload = await response.json();
    localStorage.setItem("auth_token", payload.token);
    localStorage.setItem("auth_user", JSON.stringify(payload.user));
    setToken(payload.token);
    setUser(payload.user);
    setIsAdmin(payload.user.role === "admin");
  }

  async function signUp(email: string, password: string) {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({ error: "Signup failed" }));
      throw new Error(errorPayload.error || "Signup failed");
    }
    const payload = await response.json();
    localStorage.setItem("auth_token", payload.token);
    localStorage.setItem("auth_user", JSON.stringify(payload.user));
    setToken(payload.token);
    setUser(payload.user);
    setIsAdmin(payload.user.role === "admin");
  }

  function signOut() {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    setToken(null);
    setUser(null);
    setIsAdmin(false);
  }

  return (
    <AuthContext.Provider value={{ user, token, isAdmin, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
