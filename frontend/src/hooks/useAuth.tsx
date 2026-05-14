import { createContext, useContext, useMemo, ReactNode } from "react";

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

/** Auth disabled — placeholder context until login/signup is re-enabled. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AuthContextValue>(
    () => ({
      user: null,
      token: null,
      isAdmin: false,
      loading: false,
      signIn: async () => {},
      signUp: async () => {},
      signOut: () => {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_user");
      },
    }),
    []
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
