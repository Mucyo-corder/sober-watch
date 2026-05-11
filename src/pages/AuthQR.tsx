import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/auth/qr/verify`, {
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
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
      <div className="text-center">
        <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
        <p className="text-slate-600">Authenticating via QR code...</p>
      </div>
    </div>
  );
}
