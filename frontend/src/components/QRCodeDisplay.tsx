import QRCode from "react-qr-code";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface QRCodeDisplayProps {
  url: string;
  title?: string;
  size?: number;
}

export default function QRCodeDisplay({ url, title = "Scan to view", size = 160 }: QRCodeDisplayProps) {
  const [copied, setCopied] = useState(false);

  function copyUrl() {
    navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("URL copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="p-4 border-border/60 shadow-md">
      <div className="space-y-3">
        <div className="text-center">
          <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</Label>
        </div>
        
        <div className="flex justify-center bg-white p-3 rounded-lg border">
          <QRCode value={url} size={size} level="H" />
        </div>
        
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input value={url} readOnly className="h-8 text-xs font-mono" />
            <Button size="sm" variant="outline" className="h-8 px-3" onClick={copyUrl}>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-xs text-slate-500 text-center">
            Scan with phone camera to open
          </p>
        </div>
      </div>
    </Card>
  );
}
