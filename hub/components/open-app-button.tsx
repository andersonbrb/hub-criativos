import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { APPS, type AppId } from "@/lib/apps";
import { cn } from "@/lib/utils";

// Abre o aplicativo da ferramenta numa nova aba.
export function OpenAppButton({
  app,
  variant = "ghost",
  size = "xs",
  className,
}: {
  app: AppId;
  variant?: "ghost" | "outline";
  size?: "xs" | "sm";
  className?: string;
}) {
  const { name, url } = APPS[app];
  return (
    <Button variant={variant} size={size} className={cn("shrink-0", className)} asChild>
      <a href={url} target="_blank" rel="noreferrer">
        Abrir no {name}
        <ArrowUpRight />
      </a>
    </Button>
  );
}
