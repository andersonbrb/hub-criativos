import type { Metadata } from "next";
import {
  Anton,
  Archivo,
  Archivo_Black,
  Bricolage_Grotesque,
  Cormorant_Garamond,
  DM_Mono,
  Fraunces,
  Fredoka,
  Manrope,
  Nunito,
  Outfit,
  Sora,
  Syne,
  Geist,
  Geist_Mono,
  Hanken_Grotesk,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  IBM_Plex_Sans_Condensed,
  Instrument_Sans,
  Instrument_Serif,
  JetBrains_Mono,
  Space_Grotesk,
  Space_Mono,
} from "next/font/google";
import "./globals.css";

import { AppSidebar } from "@/components/app-sidebar";
import { Topbar } from "@/components/topbar";
import { DEFAULT_DESIGN } from "@/lib/designs";
import { THEME_SCRIPT } from "@/lib/theme-script";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "700"],
});

// Fontes das direções de design (app/designs.css). preload: false = só baixam quando o design que usa estiver ativo.
// (o next/font exige as opções escritas por extenso em cada chamada)
const hanken = Hanken_Grotesk({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-hanken" });
const instrumentSerif = Instrument_Serif({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-instrument-serif", weight: "400" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-jetbrains" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-space-grotesk" });
const archivoBlack = Archivo_Black({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-archivo-black", weight: "400" });
const spaceMono = Space_Mono({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-space-mono", weight: ["400", "700"] });
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-plex-sans" });
const plexCondensed = IBM_Plex_Sans_Condensed({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-plex-condensed", weight: ["500", "600", "700"] });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-plex-mono", weight: ["400", "500"] });
const instrumentSans = Instrument_Sans({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-instrument-sans" });
const fraunces = Fraunces({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-fraunces", axes: ["SOFT", "WONK"] });
const archivo = Archivo({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-archivo" });
const dmMono = DM_Mono({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-dm-mono", weight: ["400", "500"] });
const sora = Sora({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-sora" });
const nunito = Nunito({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-nunito" });
const fredoka = Fredoka({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-fredoka" });
const manrope = Manrope({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-manrope" });
const anton = Anton({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-anton", weight: "400" });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-cormorant", weight: ["500", "600", "700"] });
const outfit = Outfit({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-outfit" });
const syne = Syne({ subsets: ["latin"], preload: false, display: "swap", variable: "--font-syne" });

const designFonts = [
  hanken,
  instrumentSerif,
  jetbrains,
  spaceGrotesk,
  archivoBlack,
  spaceMono,
  plexSans,
  plexCondensed,
  plexMono,
  instrumentSans,
  fraunces,
  archivo,
  dmMono,
  sora,
  nunito,
  fredoka,
  manrope,
  anton,
  cormorant,
  outfit,
  syne,
]
  .map((f) => f.variable)
  .join(" ");

export const metadata: Metadata = {
  title: "Hub de Criativos",
  description: "Hub de produção de criativos para anúncios, com um agente por etapa.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      // O script do <head> pode trocar a classe .dark antes da hidratação (tema claro salvo)
      suppressHydrationWarning
      // Design padrão já no HTML do servidor (o THEME_SCRIPT troca se houver outra escolha salva em /design).
      data-design={DEFAULT_DESIGN}
      className={`dark ${geistSans.variable} ${geistMono.variable} ${display.variable} ${designFonts} h-full antialiased`}
    >
      <head>
        {/* Aplica o tema salvo antes da primeira pintura (componente de servidor: o React não reclama do script). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset className="min-w-0">
              <Topbar />
              {children}
            </SidebarInset>
          </SidebarProvider>
          <Toaster position="bottom-center" />
        </TooltipProvider>
      </body>
    </html>
  );
}
