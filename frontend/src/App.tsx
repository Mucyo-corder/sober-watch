import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import Setup from "./pages/Setup.tsx";
import PublicView from "./pages/PublicView.tsx";
import AuditLog from "./pages/AuditLog.tsx";
import NotFound from "./pages/NotFound.tsx";
import Auth from "./pages/Auth.tsx";
import AuthQR from "./pages/AuthQR.tsx";

const App = () => (
  <div className="h-full min-h-0">
    <TooltipProvider>
      <Sonner position="top-right" richColors />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <div className="h-full min-h-0">
          <Routes>
            <Route path="/public-view" element={<PublicView />} />
            <Route path="/" element={<Index />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/qr" element={<AuthQR />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </BrowserRouter>
    </TooltipProvider>
  </div>
);

export default App;
