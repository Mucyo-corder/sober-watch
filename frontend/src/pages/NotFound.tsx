import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-y-auto bg-muted/35 p-4">
      <Card className="w-full max-w-md border p-10 text-center shadow-sm">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Error 404</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-foreground">Page not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">The URL you opened does not match a route in this app.</p>
        <Button asChild className="mt-8 w-full">
          <Link to="/">Return to dashboard</Link>
        </Button>
      </Card>
    </div>
  );
};

export default NotFound;
