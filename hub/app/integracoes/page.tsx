import Link from "next/link";
import { connection } from "next/server";

import { McpConnectButton, McpDisconnectButton, type McpService } from "@/components/mcp-connect";
import { OpenAppButton } from "@/components/open-app-button";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { AppId } from "@/lib/apps";
import { usesApiBrain } from "@/lib/server/chat/claude-code";
import { mcp } from "@/lib/server/mcp-client";
import { exigirPagina } from "@/features/acesso/servicos/sessao";
import { oQueFaltaParaConectar, statusDrive } from "@/features/drive/servicos/conta";
import { CardGoogleDrive } from "@/features/drive/tela/card-google-drive";
import { problemaParaGravar, resumoDasChaves } from "@/features/integracoes/servicos/chaves";
import { CampoDeChave, SeletorDeModelo } from "@/features/integracoes/tela/campo-de-chave";

type Integration = {
  name: string;
  role: string;
  features: string[];
  studio?: { href: string; label: string };
  app?: AppId;
  status: "ok" | "warn";
  detail: string;
  mcp?: { service: McpService; connected: boolean };
  // Campos para colar as chaves (Claude, Venice), dentro do card.
  campos?: React.ReactNode;
};

// HeyGen, FLORA, ElevenLabs e Higgsfield vão pelo MCP do serviço: login da conta (OAuth), sem chave de API.
async function viaMcp(service: McpService, base: Omit<Integration, "status" | "detail" | "mcp">): Promise<Integration> {
  const { connected, account } = await mcp(service).connectionStatus();
  const who = account?.email ?? account?.name;
  return {
    ...base,
    status: connected ? "ok" : "warn",
    detail: connected ? `Conectado${who ? ` · ${who}` : ""}` : "Entre na sua conta para usar",
    mcp: { service, connected },
  };
}

// Primeiro valor de um parâmetro da URL (?drive=...&motivo=..., a volta do login do Google).
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function IntegrationsPage({ searchParams }: PageProps<"/integracoes">) {
  await exigirPagina("integracoes");
  await connection();

  // Chaves coladas aqui (no lugar das variáveis do servidor). Ler antes do Drive: o Drive usa o cliente do Google.
  const chaves = await resumoDasChaves();
  const semCofre = problemaParaGravar();

  // Google Drive: onde os vídeos gerados moram. Card próprio (conectar, espaço, levar os vídeos antigos).
  const drive = await statusDrive();
  const q = await searchParams;
  const retornoDoDrive = { drive: primeiro(q.drive), motivo: primeiro(q.motivo) };

  // Sem o Claude Code instalado (o hub da nuvem), o chat responde pela API da Anthropic com a chave colada aqui.
  const pelaApi = usesApiBrain();
  const claude: Integration = {
    name: "Claude",
    role: "Chat principal e agentes",
    features: ["Usa todas as ferramentas do hub", "Vê o histórico de gerações e os playbooks", "Pesquisa e lê páginas na web"],
    studio: { href: "/chat", label: "Chat" },
    app: "anthropic",
    status: !pelaApi || chaves.anthropic.salva ? "ok" : "warn",
    detail: pelaApi
      ? chaves.anthropic.salva
        ? "Chat pela API da Anthropic"
        : "Cole a chave da API para ligar o chat"
      : "Neste computador o chat usa o Claude Code da sua assinatura",
    campos: (
      <>
        <CampoDeChave
          nome="anthropic"
          resumo={chaves.anthropic}
          exemplo="sk-ant-..."
          ajuda={{ texto: "platform.claude.com → API Keys", href: "https://platform.claude.com/settings/keys" }}
        />
        {pelaApi && <SeletorDeModelo resumo={chaves["modelo-api"]} />}
      </>
    ),
  };

  const venice: Integration = {
    name: "Venice",
    role: "Modo Black do chat e dos agentes",
    features: ["Modelo sem filtro da Venice AI", "Usa as mesmas ferramentas do hub", "Ligado pelo botão Modo Black"],
    studio: { href: "/chat", label: "Chat" },
    app: "venice",
    status: chaves.venice.salva ? "ok" : "warn",
    detail: chaves.venice.salva ? "Modo Black pronto" : "Cole a chave da API para usar o Modo Black",
    campos: <CampoDeChave nome="venice" resumo={chaves.venice} ajuda={{ texto: "venice.ai → Settings → API", href: "https://venice.ai/settings/api" }} />,
  };

  // Edição final: o pipeline do playbook de edição roda nesta máquina, sem custo.
  const edicao: Integration = {
    name: "Edição final",
    role: "Cortes, junção, b-rolls e legenda (padrão)",
    features: ["Junta os vídeos do avatar e corta silêncios", "B-rolls nos momentos certos, com dissolve", "Legenda Montserrat MAIÚSCULA queimada"],
    studio: { href: "/estudios/edicao", label: "Edição" },
    status: "ok",
    detail: "Roda no próprio hub (Whisper + ffmpeg), sem créditos",
  };

  const integrations: Integration[] = [
    await viaMcp("elevenlabs", {
      name: "ElevenLabs",
      role: "Voz, narração e transcrição",
      features: ["Vozes da sua conta", "Narração com eleven_v4 e audio tags", "Transcrição palavra por palavra (Scribe)"],
      studio: { href: "/estudios/voz", label: "Voz" },
      app: "elevenlabs",
    }),
    await viaMcp("heygen", {
      name: "HeyGen",
      role: "Avatar falando, lipsync e tradução",
      features: ["Seus avatares e os públicos", "Criar avatar por foto, descrição ou vídeo", "Lipsync com narração do ElevenLabs"],
      studio: { href: "/estudios/avatar", label: "Avatar" },
      app: "heygen",
    }),
    edicao,
    await viaMcp("flora", {
      name: "FLORA",
      role: "Geração de imagem e vídeo",
      features: ["Modelos de imagem e vídeo da conta", "Variações em lote", "Foto ou geração anterior como referência"],
      studio: { href: "/estudios/geracao", label: "Geração" },
      app: "flora",
    }),
    await viaMcp("higgsfield", {
      name: "Higgsfield",
      role: "Créditos e gerações antigas",
      features: ["Créditos do plano no rodapé do menu", "Acompanha as gerações antigas do Higgsfield", "Login da conta, sem chave de API"],
      app: "higgsfield",
    }),
    claude,
    venice,
  ];

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-9">
      <PageHeader
        eyebrow="Administração"
        title="Integrações"
        description="Tudo o que o hub usa se conecta aqui. HeyGen, FLORA, ElevenLabs, Higgsfield e o Google Drive entram com o login da sua conta; Claude e Venice, colando a chave da API. As chaves ficam guardadas cifradas no hub."
      />
      {semCofre && <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">Este servidor ainda não consegue guardar chaves: {semCofre}</p>}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <CardGoogleDrive
          status={drive}
          falta={await oQueFaltaParaConectar()}
          retorno={retornoDoDrive}
          cliente={{ id: chaves["google-client-id"], segredo: chaves["google-client-secret"] }}
        />
        {integrations.map((i) => (
          <Card key={i.name} className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="font-heading text-base">{i.name}</CardTitle>
              <CardDescription>{i.role}</CardDescription>
              <CardAction>
                <StatusBadge status={i.status} label={i.status === "ok" ? "Conectado" : "Configurar"} />
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-3 px-4">
              <ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
                {i.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {i.campos && <div className="space-y-2 border-t pt-3">{i.campos}</div>}
            </CardContent>
            <CardFooter className="mt-auto flex flex-wrap items-center justify-between gap-2 px-4 text-xs text-muted-foreground">
              <span className="min-w-0 break-words">{i.detail}</span>
              <span className="flex flex-wrap gap-1.5">
                {i.mcp && (i.mcp.connected ? <McpDisconnectButton service={i.mcp.service} /> : <McpConnectButton service={i.mcp.service} />)}
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
