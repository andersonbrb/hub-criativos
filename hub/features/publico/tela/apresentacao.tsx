import Link from "next/link";
import { AudioLines, Bot, Clapperboard, Columns3 } from "lucide-react";

import { HubLogo } from "@/components/hub-logo";
import { Button } from "@/components/ui/button";
import { ArteDoHub } from "@/features/acesso/tela/vitrine";
import { CAMINHO_DA_POLITICA, RESPONSAVEL } from "@/features/publico/contrato";
import { RodapePublico } from "@/features/publico/tela/moldura";

const O_QUE_FAZ = [
  { icone: Bot, texto: "Agentes de IA para estratégia, copy e roteiro." },
  { icone: AudioLines, texto: "Estúdios de voz, avatar e imagem." },
  { icone: Clapperboard, texto: "Edição de vídeo, legendas e tradução." },
  { icone: Columns3, texto: "O quadro da produção, do pedido à entrega." },
];

// Página inicial para quem não entrou (app/page.tsx). Mesma moldura da tela de entrar: o texto à esquerda e a arte
// do hub à direita. Diz o que o hub é e por que ele usa o Google Drive, com o link da política: o Google recusa uma
// página inicial que seja só a tela de login.
export function Apresentacao() {
  return (
    <main className="hub-auth">
      <section className="hub-auth-form">
        <HubLogo className="[&_.hub-mark]:size-7 [&_.hub-wordmark]:text-[1.0625rem]" />
        <div className="hub-auth-form-body">
          <h1 className="font-heading text-[1.75rem] leading-tight">Hub de Criativos</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            A ferramenta do {RESPONSAVEL} para produzir criativos de anúncio para Meta e TikTok, do briefing ao vídeo
            pronto, num lugar só.
          </p>
          <ul className="mt-6 grid gap-3 text-sm">
            {O_QUE_FAZ.map(({ icone: Icone, texto }) => (
              <li key={texto} className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-muted/40 text-muted-foreground">
                  <Icone className="size-4" />
                </span>
                <span className="leading-relaxed">{texto}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[0.8125rem] leading-relaxed text-muted-foreground">
            Os vídeos prontos ficam guardados no Google Drive da equipe e, quando alguém da equipe pede, podem ser
            enviados ao canal do YouTube dela. No Drive, o hub só acessa os arquivos que ele mesmo cria. Saiba mais na{" "}
            <Link href={CAMINHO_DA_POLITICA} className="text-foreground underline underline-offset-4 hover:text-primary">
              Política de Privacidade
            </Link>
            .
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button asChild size="lg">
              <Link href="/entrar">Entrar</Link>
            </Button>
            <span className="text-xs text-muted-foreground">Acesso só por convite.</span>
          </div>
        </div>
        <RodapePublico />
      </section>
      <ArteDoHub />
    </main>
  );
}
