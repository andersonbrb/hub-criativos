import { Clapperboard } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";

import { McpConnectButton, McpDisconnectButton, McpReconnectLink, type McpService } from "@/components/mcp-connect";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { APPS, type AppId } from "@/lib/apps";
import { usesApiBrain } from "@/lib/server/chat/claude-code";
import { mcp } from "@/lib/server/mcp-client";
import { exigirPagina } from "@/features/acesso/servicos/sessao";
import { oQueFaltaParaConectar, statusDrive } from "@/features/drive/servicos/conta";
import { CardGoogleDrive } from "@/features/drive/tela/card-google-drive";
import { problemaParaGravar, resumoDasChaves } from "@/features/integracoes/servicos/chaves";
import { CampoDeChave, SeletorDeModelo } from "@/features/integracoes/tela/campo-de-chave";
import { CaixaDeStatus, CartaoDeIntegracao, LinkDoRodape } from "@/features/integracoes/tela/cartao";
import { podeUsar } from "@/features/acesso/contrato";
import { oQueFaltaParaConectar as oQueFaltaNoYoutube, statusYoutube } from "@/features/youtube/servicos/conta";
import { CardYoutube } from "@/features/youtube/tela/card-youtube";

// Primeiro valor de um parâmetro da URL (?drive=...&motivo=..., a volta do login do Google).
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

// Logos em public/logos (as oficiais de cada serviço). `cheia`: o ícone já é um quadrado com fundo próprio.
const LOGOS = {
  elevenlabs: { src: "/logos/elevenlabs.svg", cheia: true },
  heygen: { src: "/logos/heygen.png" },
  flora: { src: "/logos/flora.png", cheia: true },
  higgsfield: { src: "/logos/higgsfield.png", cheia: true },
  claude: { src: "/logos/claude.png", cheia: true },
  venice: { src: "/logos/venice.png", cheia: true },
};

// HeyGen, FLORA, ElevenLabs e Higgsfield vão pelo MCP do serviço: login da conta (OAuth), sem chave de API.
async function CartaoMcp({
  service,
  app,
  descricao,
  estudio,
}: {
  service: McpService;
  app: AppId;
  descricao: string;
  estudio?: { href: string; label: string };
}) {
  // ativa: caixa verde e "Reconectar" discreto (renovar ou trocar de conta); vencida: caixa amarela e o botão
  // "Reconectar" em destaque; desconectada: só o "Conectar". A lixeira aparece sempre que há algo guardado.
  const { situacao, account } = await mcp(service).connectionStatus();
  const nome = APPS[app].name;
  const conta = account?.email ?? account?.name ?? `Conta do ${nome}`;
  return (
    <CartaoDeIntegracao
      logo={LOGOS[service]}
      nome={nome}
      descricao={descricao}
      rodape={
        <>
          {situacao === "ativa" ? (
            <McpReconnectLink service={service} />
          ) : (
            <McpConnectButton service={service} size="sm" reconectar={situacao === "vencida"} />
          )}
          <LinkDoRodape href={APPS[app].url}>Abrir site</LinkDoRodape>
        </>
      }
    >
      {situacao === "ativa" && (
        <CaixaDeStatus
          titulo={conta}
          detalhe="Login da conta"
          acoes={
            <>
              {estudio && (
                <Button size="sm" asChild>
                  <Link href={estudio.href}>Abrir {estudio.label}</Link>
                </Button>
              )}
              <McpDisconnectButton service={service} compacto />
            </>
          }
        />
      )}
      {situacao === "vencida" && (
        <CaixaDeStatus
          titulo={conta}
          selo="Vencida"
          tom="aviso"
          detalhe="O login venceu. Conecte de novo."
          acoes={<McpDisconnectButton service={service} compacto />}
        />
      )}
    </CartaoDeIntegracao>
  );
}

export default async function IntegrationsPage({ searchParams }: PageProps<"/integracoes">) {
  const usuario = await exigirPagina("integracoes");
  await connection();

  // Chaves coladas aqui (no lugar das variáveis do servidor). Ler antes do Drive: o Drive usa o cliente do Google.
  const chaves = await resumoDasChaves();
  const semCofre = problemaParaGravar();

  // Google Drive: onde os vídeos gerados moram. Card próprio (conectar, espaço, levar os vídeos antigos).
  const drive = await statusDrive();
  const q = await searchParams;
  const retornoDoDrive = { drive: primeiro(q.drive), motivo: primeiro(q.motivo) };
  // YouTube: canal da organização para os vídeos prontos (mesmo cliente do Google do Drive).
  const youtube = await statusYoutube();
  const retornoDoYoutube = { youtube: primeiro(q.youtube), motivo: primeiro(q.motivo) };

  // Sem o Claude Code instalado (o hub da nuvem), o chat responde pela API da Anthropic com a chave colada aqui.
  const pelaApi = usesApiBrain();

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-9 2xl:max-w-[96rem]">
      <PageHeader
        title="Integrações"
        description="Conecte aqui as ferramentas que o hub usa: com o login da conta ou colando a chave da API. As chaves ficam guardadas cifradas."
      />
      {semCofre && <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">Este servidor ainda não consegue guardar chaves: {semCofre}</p>}
      <section className="hub-stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <CardGoogleDrive
          status={drive}
          falta={await oQueFaltaParaConectar()}
          retorno={retornoDoDrive}
          cliente={{ id: chaves["google-client-id"], segredo: chaves["google-client-secret"] }}
          chaveDeApi={chaves["google-api-key"]}
        />
        <CardYoutube status={youtube} falta={await oQueFaltaNoYoutube()} retorno={retornoDoYoutube} podeVerEnvios={podeUsar(usuario, "youtube")} />
        <CartaoMcp service="elevenlabs" app="elevenlabs" descricao="Voz, narração e transcrição com a sua conta." estudio={{ href: "/estudios/voz", label: "Voz" }} />
        <CartaoMcp service="heygen" app="heygen" descricao="Avatar falando, lipsync e tradução de vídeo." estudio={{ href: "/estudios/avatar", label: "Avatar" }} />
        <CartaoMcp service="flora" app="flora" descricao="Imagem e vídeo com os modelos da sua conta." estudio={{ href: "/estudios/geracao", label: "Geração" }} />
        <CartaoMcp service="higgsfield" app="higgsfield" descricao="Créditos do plano e as gerações antigas." />

        <CartaoDeIntegracao
          logo={LOGOS.claude}
          nome="Claude"
          descricao="O cérebro do chat e dos agentes."
          rodape={pelaApi && <LinkDoRodape href="https://platform.claude.com/settings/keys">Pegar a chave</LinkDoRodape>}
        >
          {pelaApi ? (
            <>
              <CampoDeChave nome="anthropic" titulo="Chave da API" resumo={chaves.anthropic} exemplo="sk-ant-..." />
              {chaves.anthropic.salva && <SeletorDeModelo resumo={chaves["modelo-api"]} />}
            </>
          ) : (
            <CaixaDeStatus
              titulo="Claude Code"
              detalhe="Sua assinatura"
              acoes={
                <Button size="sm" asChild>
                  <Link href="/chat">Abrir Chat</Link>
                </Button>
              }
            />
          )}
        </CartaoDeIntegracao>

        <CartaoDeIntegracao
          logo={LOGOS.venice}
          nome="Venice"
          descricao="Modo Black do chat, sem filtro."
          rodape={<LinkDoRodape href="https://venice.ai/settings/api">Pegar a chave</LinkDoRodape>}
        >
          <CampoDeChave nome="venice" titulo="Chave da API" resumo={chaves.venice} />
        </CartaoDeIntegracao>

        <CartaoDeIntegracao logo={{ icone: Clapperboard }} nome="Edição final" descricao="Cortes, b-rolls e legenda no próprio hub.">
          <CaixaDeStatus
            titulo="No próprio hub"
            detalhe="Sem créditos"
            acoes={
              <Button size="sm" asChild>
                <Link href="/estudios/edicao">Abrir Edição</Link>
              </Button>
            }
          />
        </CartaoDeIntegracao>
      </section>
    </main>
  );
}
