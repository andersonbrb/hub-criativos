import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { cookies } from "next/headers";
import { Suspense } from "react";
import "./globals.css";

import { AppSidebar } from "@/components/app-sidebar";
import { CommandMenu } from "@/components/command-menu";
import { McpLoginToast } from "@/components/mcp-connect";
import { ShellEffects } from "@/components/shell-effects";
import { Topbar } from "@/components/topbar";
import { modoLocalSemBanco } from "@/features/acesso/modo-local";
import { usuarioDaSessao } from "@/features/acesso/servicos/sessao";
import { THEME_SCRIPT } from "@/lib/theme-script";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

// Fontes do design (app/designs.css): Inter no texto e nos títulos (como no ElevenLabs) e Geist Mono em números e atalhos.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Hub de Criativos",
  description: "Hub de produção de criativos para anúncios, com um agente por etapa.",
};

export const viewport: Viewport = {
  themeColor: "#0e0e0f",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Sem ninguém logado (telas de entrar e de convite) não há menu: só o conteúdo. A proteção de cada tela fica
  // em exigirPagina(); aqui é só a moldura.
  const usuario = await usuarioDaSessao();
  // Menu recolhido ou aberto: o mesmo da última visita (o próprio menu grava o cookie).
  const menuAberto = (await cookies()).get("sidebar_state")?.value !== "false";
  const semBanco = modoLocalSemBanco();

  return (
    <html
      lang="pt-BR"
      // O script do <head> pode trocar a classe .dark antes da hidratação (tema claro salvo)
      suppressHydrationWarning
      className={`dark ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Aplica o tema salvo antes da primeira pintura (componente de servidor: o React não reclama do script). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <TooltipProvider>
          {usuario ? (
            <SidebarProvider defaultOpen={menuAberto}>
              <AppSidebar usuario={usuario} semBanco={semBanco} />
              <SidebarInset className="min-w-0">
                <Topbar usuario={usuario} />
                {children}
              </SidebarInset>
              <CommandMenu usuario={usuario} semBanco={semBanco} />
              <ShellEffects />
            </SidebarProvider>
          ) : (
            children
          )}
          <Toaster position="bottom-center" />
          {usuario && (
            <Suspense>
              <McpLoginToast />
            </Suspense>
          )}
        </TooltipProvider>
      </body>
    </html>
  );
}
