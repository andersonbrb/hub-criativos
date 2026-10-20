"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CloudOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/generations";
import { cn } from "@/lib/utils";

// Regra do dono: vídeo só fica guardado no Google Drive. Nas telas que geram ou recebem vídeo, este aviso aparece
// ANTES de a pessoa tentar, quando o Drive da organização não está conectado. O servidor também recusa (com a mesma
// explicação); o aviso só poupa a tentativa.

type Estado = { conectado: boolean; podeConectar: boolean };

export function useDriveConectado(): Estado | null {
  const [estado, setEstado] = useState<Estado | null>(null);
  useEffect(() => {
    let vivo = true;
    apiFetch<Estado>("/api/drive/estado")
      .then((e) => vivo && setEstado(e))
      .catch(() => undefined); // sem resposta, sem aviso: o servidor ainda recusa com a explicação
    return () => {
      vivo = false;
    };
  }, []);
  return estado;
}

// `oQue`: o que fica bloqueado nesta tela ("gerar vídeos", "enviar vídeos", "exportar"...).
export function AvisoSemDrive({ oQue = "gerar ou enviar vídeos", className }: { oQue?: string; className?: string }) {
  const estado = useDriveConectado();
  if (!estado || estado.conectado) return null;
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-lg border border-warn/40 bg-warn/10 p-4 text-sm", className)}>
      <CloudOff className="mt-0.5 size-4 shrink-0 text-warn" />
      <div className="grid gap-2">
        <p className="font-medium">Conecte o Google Drive para {oQue}</p>
        <p className="text-muted-foreground">
          O hub guarda vídeos só no Google Drive da organização. Sem o Drive conectado, não dá para {oQue} aqui.
          {estado.podeConectar ? "" : " Peça a quem cuida das Integrações para conectar."}
        </p>
        {estado.podeConectar && (
          <div>
            <Button size="sm" asChild>
              <Link href="/integracoes">Conectar em Integrações</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
