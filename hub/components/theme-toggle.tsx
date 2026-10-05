"use client";

import { Moon, Sun } from "lucide-react";

import { setTheme, useTheme } from "@/components/theme";
import { Button } from "@/components/ui/button";

// Alterna entre tema claro e escuro. Os ícones trocam via CSS (classe .dark), sem depender do estado no primeiro render.
export function ThemeToggle() {
  const theme = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Alternar tema claro/escuro"
      title="Modo claro / modo escuro"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  );
}
