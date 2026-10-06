"use client";

import { useSyncExternalStore } from "react";
import { Languages } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CREATIVE_LANGUAGES } from "@/lib/languages";

// Idioma do criativo no chat: vai junto com cada mensagem (o agente escreve o anúncio nesse idioma).
// Lembrado por conversa; conversa nova começa com a última escolha.

const GLOBAL = "hub:lang";
const EVENT = "hub-lang";
const keyOf = (chatId: string) => `hub:lang:${chatId}`;

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
};

export function useCreativeLanguage(chatId: string | null) {
  const lang = useSyncExternalStore(
    subscribe,
    () => (chatId ? read(keyOf(chatId)) : null) ?? read(GLOBAL) ?? "auto",
    () => "auto",
  );
  // id: conversa recém-criada (o activeId ainda não chegou ao estado).
  const setLang = (value: string, id: string | null = chatId) => {
    write(GLOBAL, value);
    if (id) write(keyOf(id), value);
    window.dispatchEvent(new Event(EVENT));
  };
  return [lang, setLang] as const;
}

export function LanguagePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="h-7 gap-1 px-2 text-xs" aria-label="Idioma do criativo" title="Idioma em que o agente escreve o criativo">
        <Languages className="size-3.5" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">Idioma: automático</SelectItem>
        {CREATIVE_LANGUAGES.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
