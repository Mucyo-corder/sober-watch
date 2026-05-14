import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiUrl } from "@/lib/apiBase";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function AuthQR() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  useEffect(() => {
    async function verifyToken() {
      if (!token) {
        toast.error("Invalid QR code: no token found", { duration: 2000 });
        navigate("/auth");
        return;
      }

      try {
        const response = await fetch(apiUrl("/api/auth/qr/verify"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        
        if (!response.ok) {
          throw new Error("Authentication failed");
        }

        const data = await response.json();
        
        // Store the token
        localStorage.setItem("auth_token", data.token);
        localStorage.setItem("auth_user", JSON.stringify(data.user));
        
        toast.success("Logged in successfully via QR code", { duration: 2000 });
        navigate("/", { replace: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "QR code authentication failed";
        toast.error(message, { duration: 2000 });
        navigate("/auth");
      }
    }

    verifyToken();
  }, [token, navigate]);

  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-y-auto bg-gradient-hero p-4">
      <div className="text-center">
        <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Authenticating via QR code…</p>
      </div>
    </div>
  );
}
