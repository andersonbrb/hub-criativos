import Link from "next/link";
import { connection } from "next/server";

import { OpenAppButton } from "@/components/open-app-button";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { AppId } from "@/lib/apps";
import { hasKey, KEYS, type Provider } from "@/lib/server/env";

type Integration = {
  name: string;
  role: string;
  features: string[];
  studio?: { href: string; label: string };
  app?: AppId;
  status: "ok" | "warn";
  detail: string;
};

const keyed = (p: Provider, base: Omit<Integration, "status" | "detail">, where: string): Integration => ({
  ...base,
  status: hasKey(p) ? "ok" : "warn",
  detail: hasKey(p) ? `Chave ${KEYS[p]} configurada` : `Adicione ${KEYS[p]} em .env.local (${where})`,
});

export default async function IntegrationsPage() {
  await connection();

  // Edição final: o pipeline do playbook de edição (o mesmo do "sandbox do Higgsfield") roda nesta máquina, sem custo.
  const edicao: Integration = {
    name: "Edição final",
    role: "Cortes, junção, b-rolls e legenda (padrão)",
    features: ["Junta os vídeos do avatar e corta silêncios", "B-rolls nos momentos certos, com dissolve", "Legenda Montserrat MAIÚSCULA queimada"],
    studio: { href: "/estudios/edicao", label: "Edição" },
    status: "ok",
    detail: "Roda neste computador (Whisper + ffmpeg), sem créditos",
  };

  const integrations: Integration[] = [
    keyed(
      "elevenlabs",
      {
        name: "ElevenLabs",
        role: "Voz e narração",
        features: ["Vozes da sua conta", "Modelos v4, v3, Multilingual e Flash", "Ajuste de velocidade, estabilidade e estilo"],
        studio: { href: "/estudios/voz", label: "Voz" },
        app: "elevenlabs",
      },
      "elevenlabs.io → Developers → API Keys",
    ),
    keyed(
      "heygen",
      {
        name: "HeyGen",
        role: "Avatar falando e lipsync",
        features: ["Seus avatares e os públicos", "Roteiro com voz do HeyGen", "Lipsync com narração do ElevenLabs"],
        studio: { href: "/estudios/avatar", label: "Avatar" },
        app: "heygen",
      },
      "app.heygen.com → Settings → API",
    ),
    edicao,
    keyed(
      "flora",
      {
        name: "FLORA",
        role: "Geração de imagem e vídeo",
        features: ["Modelos de imagem e vídeo da conta", "Variações em lote", "Foto ou geração anterior como referência"],
        studio: { href: "/estudios/geracao", label: "Geração" },
        app: "flora",
      },
      "app.flora.ai → Settings → API Keys",
    ),
    keyed(
      "anthropic",
      {
        name: "Claude",
        role: "Chat principal (Claude Opus 5.5)",
        features: ["Usa todas as ferramentas do hub", "Vê o histórico de gerações e os playbooks", "Pesquisa e lê páginas na web"],
        studio: { href: "/chat", label: "Chat" },
        app: "anthropic",
      },
      "console.anthropic.com → API Keys",
    ),
    keyed(
      "venice",
      {
        name: "Venice",
        role: "Modo Black do chat e dos agentes",
        features: ["Modelo sem filtro da Venice AI", "Usa as mesmas ferramentas do hub", "Ligado pelo botão Modo Black"],
        studio: { href: "/chat", label: "Chat" },
        app: "venice",
      },
      "venice.ai → Settings → API",
    ),
  ];

  return (
    <main className="flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
      <PageHeader
        title="Integrações"
        description="Status real das conexões deste hub. As chaves ficam só no seu computador, no arquivo hub/.env.local."
      />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {integrations.map((i) => (
          <Card key={i.name} className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="font-heading text-base">{i.name}</CardTitle>
              <CardDescription>{i.role}</CardDescription>
              <CardAction>
                <StatusBadge status={i.status} label={i.status === "ok" ? "Conectado" : "Configurar"} />
              </CardAction>
            </CardHeader>
            <CardContent className="px-4">
              <ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
                {i.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </CardContent>
            <CardFooter className="mt-auto flex flex-wrap items-center justify-between gap-2 px-4 text-xs text-muted-foreground">
              <span className="min-w-0 break-words">{i.detail}</span>
              <span className="flex flex-wrap gap-1.5">
                {i.app && <OpenAppButton app={i.app} variant="outline" />}
                {i.studio && (
                  <Button size="xs" variant="outline" asChild>
                    <Link href={i.studio.href}>Abrir {i.studio.label}</Link>
                  </Button>
                )}
              </span>
            </CardFooter>
          </Card>
        ))}
      </section>
    </main>
  );
}
