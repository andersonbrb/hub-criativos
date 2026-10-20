"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Plug, Trash2, Unplug } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/generations";

export type McpService = "heygen" | "flora" | "elevenlabs" | "higgsfield";

export const MCP_LABEL: Record<McpService, string> = { heygen: "HeyGen", flora: "FLORA", elevenlabs: "ElevenLabs", higgsfield: "Higgsfield" };

// Link do login MCP (OAuth) do serviço; volta para a tela atual depois de autorizar.
export function useLoginHref(service: McpService) {
  const pathname = usePathname();
  return `/api/integracoes/mcp/${service}/login?volta=${encodeURIComponent(pathname || "/integracoes")}`;
}

// reconectar: o login venceu (ou é para trocar de conta); o caminho é o mesmo login da conta.
export function McpConnectButton({ service, size = "xs", reconectar = false }: { service: McpService; size?: "xs" | "sm"; reconectar?: boolean }) {
  const href = useLoginHref(service);
  return (
    <Button size={size} asChild>
      <a href={href}>
        <Plug />
        {reconectar ? "Reconectar" : "Conectar"} {MCP_LABEL[service]}
      </a>
    </Button>
  );
}

// Link discreto para entrar de novo com uma conexão ativa (renovar o login ou trocar de conta).
export function McpReconnectLink({ service }: { service: McpService }) {
  const href = useLoginHref(service);
  return (
    <a href={href} className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
      Reconectar
    </a>
  );
}

// compacto: só a lixeira (cartões da tela Integrações).
export function McpDisconnectButton({ service, compacto = false }: { service: McpService; compacto?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size={compacto ? "icon-sm" : "xs"}
      variant={compacto ? "ghost" : "outline"}
      className={compacto ? "text-destructive hover:text-destructive" : undefined}
      aria-label={compacto ? `Desconectar o ${MCP_LABEL[service]}` : undefined}
      title={compacto ? "Desconectar" : undefined}
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
      {busy ? <Loader2 className="animate-spin" /> : compacto ? <Trash2 /> : <Unplug />}
      {!compacto && "Desconectar"}
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
