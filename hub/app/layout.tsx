import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";

import { AppSidebar } from "@/components/app-sidebar";
import { McpLoginToast } from "@/components/mcp-connect";
import { Topbar } from "@/components/topbar";
import { modoLocalSemBanco } from "@/features/acesso/modo-local";
import { usuarioDaSessao } from "@/features/acesso/servicos/sessao";
import { THEME_SCRIPT } from "@/lib/theme-script";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

// Fontes do design Suíço (app/designs.css): Archivo para texto e títulos, JetBrains Mono para números e rótulos.
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "Hub de Criativos",
  description: "Hub de produção de criativos para anúncios, com um agente por etapa.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Sem ninguém logado (telas de entrar e de convite) não há menu: só o conteúdo. A proteção de cada tela fica
  // em exigirPagina(); aqui é só a moldura.
  const usuario = await usuarioDaSessao();

  return (
    <html
      lang="pt-BR"
      // O script do <head> pode trocar a classe .dark antes da hidratação (tema claro salvo)
      suppressHydrationWarning
      className={`dark ${archivo.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        {/* Aplica o tema salvo antes da primeira pintura (componente de servidor: o React não reclama do script). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <TooltipProvider>
          {usuario ? (
            <SidebarProvider>
              <AppSidebar usuario={usuario} semBanco={modoLocalSemBanco()} />
              <SidebarInset className="min-w-0">
                <Topbar usuario={usuario} />
                {children}
              </SidebarInset>
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
