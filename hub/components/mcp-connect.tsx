"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Plug, Unplug } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/generations";

export type McpService = "heygen" | "flora" | "elevenlabs";

export const MCP_LABEL: Record<McpService, string> = { heygen: "HeyGen", flora: "FLORA", elevenlabs: "ElevenLabs" };

// Link do login MCP (OAuth) do serviço; volta para a tela atual depois de autorizar.
export function useLoginHref(service: McpService) {
  const pathname = usePathname();
  return `/api/integracoes/mcp/${service}/login?volta=${encodeURIComponent(pathname || "/integracoes")}`;
}

export function McpConnectButton({ service, size = "xs" }: { service: McpService; size?: "xs" | "sm" }) {
  const href = useLoginHref(service);
  return (
    <Button size={size} asChild>
      <a href={href}>
        <Plug />
        Conectar {MCP_LABEL[service]}
      </a>
    </Button>
  );
}

export function McpDisconnectButton({ service }: { service: McpService }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        if (!confirm(`Desconectar o ${MCP_LABEL[service]} deste hub?`)) return;
        setBusy(true);
        try {
          await apiFetch(`/api/integracoes/mcp/${service}`, { method: "DELETE" });
          toast.success(`${MCP_LABEL[service]} desconectado.`);
          router.refresh();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Não deu para desconectar.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Unplug />}
      Desconectar
    </Button>
  );
}

// Avisa o resultado do login (?mcp=<serviço>-conectado|erro|cancelado) e limpa a URL.
export function McpLoginToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const result = params.get("mcp");
  useEffect(() => {
    if (!result) return;
    const [service, status] = result.split("-") as [McpService, string];
    const name = MCP_LABEL[service] ?? service;
    if (status === "conectado") toast.success(`${name} conectado pelo MCP.`);
    else if (status === "cancelado") toast(`Login do ${name} cancelado.`);
    else toast.error(`Não deu para conectar o ${name}. Tente de novo.`);
    const rest = new URLSearchParams(params);
    rest.delete("mcp");
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [result, params, pathname, router]);
  return null;
}
