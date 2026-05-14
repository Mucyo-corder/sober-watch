/** Auth disabled — always render children (dashboard is open). */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
