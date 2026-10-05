"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";

// Botão de protótipo: mostra o que a ação faria no produto real.
export function ToastButton({
  message,
  ...props
}: React.ComponentProps<typeof Button> & { message: string }) {
  return <Button {...props} onClick={() => toast(message)} />;
}
