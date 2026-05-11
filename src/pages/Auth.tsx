import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, QrCode } from "lucide-react";

const schema = z.object({
  email: z.string().trim().email("Invalid email").max(255),
  password: z.string().min(6, "Min 6 characters").max(72),
});

export default function Auth() {
  const navigate = useNavigate();
  const { user, loading: authLoading, signIn, signUp } = useAuth();
  const [isSignup, setIsSignup] = useState(false);
  const [useQrCode, setUseQrCode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [qrCodeData, setQrCodeData] = useState("");
  const [generatingQr, setGeneratingQr] = useState(false);

  useEffect(() => {
    if (!authLoading && user) navigate("/", { replace: true });
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!useQrCode || qrCodeData) return;
    let cancelled = false;
    async function fetchQrCode() {
      setGeneratingQr(true);
      try {
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/auth/qr/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!response.ok) throw new Error("Failed to generate QR code");
        const data = await response.json();
        if (!cancelled) setQrCodeData(data.qrCode);
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Failed to generate QR code";
          toast.error(message, { duration: 2000 });
        }
      } finally {
        if (!cancelled) setGeneratingQr(false);
      }
    }
    fetchQrCode();
    return () => { cancelled = true; };
  }, [useQrCode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message, { duration: 2000 });
      return;
    }
    setSubmitting(true);
    try {
      if (isSignup) {
        await signUp(parsed.data.email, parsed.data.password);
        toast.success("Account created successfully", { duration: 2000 });
      } else {
        await signIn(parsed.data.email, parsed.data.password);
        toast.success("Welcome back", { duration: 2000 });
      }
      navigate("/", { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      toast.error(message, { duration: 2000 });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center justify-center mb-8">
          <img src="/logo.svg" alt="SoberWatch - IoT Alcohol Monitoring System" className="h-12 w-auto" />
        </Link>

        <Card className="p-8 shadow-elevated border-border/60">
          <div className="flex gap-2 mb-6">
            <Button
              variant={!useQrCode ? "default" : "outline"}
              className="flex-1"
              onClick={() => setUseQrCode(false)}
            >
              Email & Password
            </Button>
            <Button
              variant={useQrCode ? "default" : "outline"}
              className="flex-1"
              onClick={() => setUseQrCode(true)}
            >
              <QrCode className="w-4 h-4 mr-2" />
              QR Code
            </Button>
          </div>

          {!useQrCode ? (
            <>
              <h1 className="text-2xl font-bold mb-1">{isSignup ? "Create Admin Account" : "Sign in"}</h1>
              <p className="text-sm text-muted-foreground mb-6">
                {isSignup ? "Register a new administrator account" : "Access your monitoring dashboard"}
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete={isSignup ? "email" : "username"}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    maxLength={255}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete={isSignup ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    maxLength={72}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {isSignup ? "Create Account" : "Sign in"}
                </Button>
              </form>

              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => setIsSignup(!isSignup)}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {isSignup ? "Already have an account? Sign in" : "Need an admin account? Sign up"}
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold mb-1">QR Code Login</h1>
              <p className="text-sm text-muted-foreground mb-6">
                Scan QR code to access your dashboard
              </p>

              <div className="space-y-4">
                {generatingQr ? (
                  <div className="flex flex-col items-center justify-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mt-3">Generating QR code...</p>
                  </div>
                ) : qrCodeData ? (
                  <>
                    <div className="flex justify-center">
                      <img src={qrCodeData} alt="QR Code" className="w-48 h-48" />
                    </div>
                    <p className="text-sm text-muted-foreground text-center">
                      Scan this QR code with your phone to login
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Unable to generate QR code. Please try again.
                  </p>
                )}
              </div>
            </>
          )}
        </Card>

        <p className="text-xs text-muted-foreground text-center mt-6 max-w-sm mx-auto">
          Only administrator accounts can access the dashboard.
        </p>
      </div>
    </main>
  );
}
